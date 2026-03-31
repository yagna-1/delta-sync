# Gin Delta-Sync Starter

## Run

```bash
cd ports/gin-delta-sync
go mod tidy
go run .
```

Server: `http://localhost:4300`

## Test flow

```bash
curl -i http://localhost:4300/api/dashboard
curl -i -H 'If-None-Match: "<etag>"' -H 'Accept: application/json-patch+json' http://localhost:4300/api/dashboard
```

## Notes

- Uses canonical JSON for stable ETag computation.
- Uses RFC 6902 patch generation (`evanphx/json-patch`).
- Includes size guard and full fallback behavior.
