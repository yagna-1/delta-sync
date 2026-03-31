# Delta-Sync Language Ports

Starter ports for teams that want Delta-Sync beyond Node/React.

## Included

- `fastapi-delta-sync`: Python FastAPI starter with RFC 6902 patches
- `gin-delta-sync`: Go Gin starter with JSON patch transport contract
- `spring-delta-sync`: Java Spring Boot starter with patch/full/304 flow

Each starter includes:
- deep-stable ETag concept
- patch size guard
- user-scoped snapshot cache keying
- `X-Delta-Sync` and size headers
- `Cache-Control` and `Vary` semantics

These are launch starters, intended to be adapted to your app's auth model and production caching layer.
