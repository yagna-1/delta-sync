# CDN Story: Delta-Sync at the Edge

Delta-Sync works behind a CDN today and has a clear edge-compute upgrade path.

## What We Have Today

Delta-Sync responses are generated at origin using:
- `ETag`
- `If-None-Match`
- `Accept: application/json-patch+json`
- `Vary: If-None-Match, Accept`

For user-scoped endpoints, keep:

```http
Cache-Control: private, no-store
```

That prevents shared caching while still allowing CDN transport benefits:
- TLS termination
- edge routing
- HTTP/2 and HTTP/3 multiplexing
- origin shielding and connection reuse

## Production Modes

### Mode A: CDN Pass-through (Now)

Use the CDN as a smart transport layer, not a shared response cache.

Requirements:
- pass `If-None-Match` through to origin
- preserve origin `ETag` and `Vary` headers
- do not rewrite JSON response bodies
- keep compression on (`gzip` or `brotli`)

### Mode B: Public Cache + Revalidation (Selective)

For non-personalized endpoints only, you can add shared cache policy, for example:

```http
Cache-Control: public, max-age=30, stale-while-revalidate=60
Vary: If-None-Match, Accept
```

This lets the CDN cache full responses while still supporting conditional fetches and patch negotiation.

### Mode C: Edge Diff Compute (Future)

Future architecture:
- store latest snapshot at edge KV/cache
- evaluate `If-None-Match` at edge
- emit `304`, `patch`, or `full-fallback` without origin hop for hot keys

This reduces origin CPU and latency while retaining the same wire contract.

## CDN Configuration Checklist

1. Forward request headers:
- `If-None-Match`
- `Accept`
- auth/session headers when needed

2. Preserve response headers:
- `ETag`
- `Vary`
- `Cache-Control`
- `X-Delta-*` debug headers

3. Keep compression enabled:
- `Content-Encoding: gzip` or `br` on larger full payloads

4. Do not normalize away ETag quotes.

5. Avoid middleware that rewrites JSON bodies after Delta-Sync runs.

## Example: Nginx Reverse Proxy

```nginx
location /api/ {
  proxy_pass http://origin;
  proxy_set_header If-None-Match $http_if_none_match;
  proxy_set_header Accept $http_accept;

  # Preserve origin caching semantics and vary behavior
  proxy_pass_header ETag;
  proxy_pass_header Vary;
  proxy_pass_header Cache-Control;

  gzip on;
  gzip_types application/json application/json-patch+json;
}
```

## Example: Cloudflare Rule Intent

- Cache Level: Standard
- Respect Existing Headers: On
- Do not cache authenticated/private API responses
- Preserve `ETag` and `Vary`
- Compression: Brotli enabled

## Positioning Line

Use this in docs and launch messaging:

> Delta-Sync works behind CDN today via ETag passthrough, with edge diff compute as the next optimization layer.
