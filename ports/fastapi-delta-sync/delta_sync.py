from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import jsonpatch
from fastapi import Request
from fastapi.responses import Response


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def compute_etag(value: Any) -> str:
    stable = canonical_json(value)
    digest = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:16]
    return f'"{digest}"'


def strip_paths(payload: Any, ignore_paths: list[str]) -> Any:
    if not ignore_paths:
        return payload

    clone = json.loads(json.dumps(payload))
    for pointer in ignore_paths:
        tokens = [t for t in pointer.split("/") if t]
        node = clone
        for idx in range(len(tokens) - 1):
            token = tokens[idx]
            if isinstance(node, dict):
                node = node.get(token)
            elif isinstance(node, list) and token.isdigit():
                i = int(token)
                node = node[i] if 0 <= i < len(node) else None
            else:
                node = None
            if node is None:
                break

        if node is None or not tokens:
            continue

        leaf = tokens[-1]
        if isinstance(node, dict):
            node.pop(leaf, None)
        elif isinstance(node, list) and leaf.isdigit():
            i = int(leaf)
            if 0 <= i < len(node):
                node.pop(i)

    return clone


@dataclass
class CacheEntry:
    value: Any
    expires_at: float


class SnapshotCache:
    def __init__(self, max_entries: int = 500, ttl_ms: int = 600_000) -> None:
        self.max_entries = max_entries
        self.ttl_ms = ttl_ms
        self.items: Dict[str, CacheEntry] = {}

    def get(self, key: str) -> Optional[Any]:
        entry = self.items.get(key)
        if not entry:
            return None
        if entry.expires_at < time.time() * 1000:
            self.items.pop(key, None)
            return None
        return entry.value

    def set(self, key: str, value: Any) -> None:
        self.items[key] = CacheEntry(
            value=value,
            expires_at=(time.time() * 1000) + self.ttl_ms,
        )
        if len(self.items) > self.max_entries:
            oldest_key = next(iter(self.items.keys()))
            self.items.pop(oldest_key, None)


class DeltaSyncEngine:
    def __init__(
        self,
        ignore_paths: Optional[list[str]] = None,
        max_entries: int = 500,
        ttl_ms: int = 600_000,
    ) -> None:
        self.ignore_paths = ignore_paths or []
        self.cache = SnapshotCache(max_entries=max_entries, ttl_ms=ttl_ms)

    async def respond(self, request: Request, payload: Any, user_scope: str = "anon") -> Response:
        diff_payload = strip_paths(payload, self.ignore_paths)
        full_text = json.dumps(payload, separators=(",", ":"))
        full_len = len(full_text.encode("utf-8"))

        etag = compute_etag(diff_payload)
        client_etag = request.headers.get("if-none-match")
        accept = request.headers.get("accept", "")
        wants_patch = "application/json-patch+json" in accept

        common_headers = {
            "Cache-Control": "private, no-store",
            "Vary": "If-None-Match, Accept",
        }

        if client_etag == etag:
            return Response(status_code=304, headers=common_headers)

        cache_key = lambda tag: f"{user_scope}:{tag}"

        if wants_patch and client_etag:
            previous = self.cache.get(cache_key(client_etag))
            if previous is not None:
                patch_ops = jsonpatch.make_patch(previous, diff_payload).patch
                patch_text = json.dumps(patch_ops, separators=(",", ":"))
                patch_len = len(patch_text.encode("utf-8"))

                if patch_len < full_len:
                    self.cache.set(cache_key(etag), diff_payload)
                    headers = {
                        **common_headers,
                        "ETag": etag,
                        "Content-Type": "application/json-patch+json",
                        "X-Delta-Sync": "patch",
                        "X-Delta-Full-Size": str(full_len),
                        "X-Delta-Patch-Size": str(patch_len),
                    }
                    return Response(content=patch_text, status_code=200, headers=headers)

                headers = {
                    **common_headers,
                    "X-Delta-Sync": "full-fallback",
                }
            else:
                headers = common_headers
        else:
            headers = common_headers

        self.cache.set(cache_key(etag), diff_payload)
        headers = {
            **headers,
            "ETag": etag,
            "Content-Type": "application/json",
        }
        if "X-Delta-Sync" not in headers:
            headers["X-Delta-Sync"] = "full"

        return Response(content=full_text, status_code=200, headers=headers)
