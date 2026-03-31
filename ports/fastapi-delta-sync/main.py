from __future__ import annotations

import random
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import Response

from delta_sync import DeltaSyncEngine

app = FastAPI(title="Delta-Sync FastAPI Starter")
engine = DeltaSyncEngine(ignore_paths=["/meta/timestamp", "/meta/requestId"])

regions = ["us-east", "us-west", "eu-central", "ap-south"]
services = [
    {
        "id": f"svc-{i+1}",
        "name": f"Service {i+1}",
        "region": regions[i % len(regions)],
        "owner": f"team-{(i % 12) + 1}",
        "status": "healthy",
    }
    for i in range(120)
]

active_users = 1100
revenue = 250_000


def make_payload() -> dict:
    global active_users, revenue
    active_users += 1
    revenue += random.randint(0, 120)

    return {
        "activeUsers": active_users,
        "revenue": revenue,
        "services": services,
        "meta": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "requestId": f"r-{random.randint(10_000, 99_999)}",
        },
    }


@app.get("/api/dashboard")
async def dashboard(request: Request) -> Response:
    user_scope = request.headers.get("x-user-id", "anon")
    return await engine.respond(request, make_payload(), user_scope=user_scope)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
