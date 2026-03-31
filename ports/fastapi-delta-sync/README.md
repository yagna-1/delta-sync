# FastAPI Delta-Sync Starter

## Run

```bash
cd ports/fastapi-delta-sync
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 4200
```

## Test flow

```bash
curl -i http://localhost:4200/api/dashboard
curl -i -H 'If-None-Match: "<etag>"' -H 'Accept: application/json-patch+json' http://localhost:4200/api/dashboard
```

## Files

- `delta_sync.py`: ETag, patch/full fallback, cache, ignore paths
- `main.py`: FastAPI integration example
