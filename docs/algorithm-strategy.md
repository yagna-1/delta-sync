# Delta Algorithm Strategy

## Positioning

Delta-Sync is a **drop-in delta-sync layer for REST APIs**.

## Current Strategy (Implemented)

1. **Payload normalization**
- Remove noisy fields via JSON Pointer ignore paths (`/meta/timestamp`, `/meta/requestId`, etc.)
- Keep stable ordering using `fast-json-stable-stringify`

2. **Structural hashing**
- Compute `ETag` from normalized payload:
- `sha256(stable_json(payload)).slice(0, 16)`

3. **Scope-safe snapshot lookup**
- Snapshot keys are user-scoped:
- `${scope}:${etag}`
- Stores supported:
- in-memory LRU TTL store
- Redis-backed store

4. **JSON structural diff**
- Diff engine: `jsondiffpatch`
- Array move detection enabled
- Object identity strategy: `id | _id | key | uuid | stable stringify fallback`

5. **RFC 6902 patch emit**
- Convert internal diff output to JSON Patch operations
- Return `Content-Type: application/json-patch+json`

6. **Patch-size guard**
- If patch size >= full payload size:
- return full payload (`X-Delta-Sync: full-fallback`)

## Why this strategy

- Works immediately for JSON API responses
- Requires no client transport rewrite
- Reuses existing HTTP cache semantics (`ETag`, `If-None-Match`, `Vary`)

## Not in scope today

- Binary delta (e.g., rsync-like block diffs)
- CRDT conflict resolution
- OT collaboration semantics

## Roadmap Extensions

- Rolling-hash chunking for very large payload segments
- Edge snapshot evaluation (CDN/worker)
- Pluggable diff engines per payload class
