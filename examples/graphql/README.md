# GraphQL Integration: Delta-Sync Polling Layer

This example shows how to keep GraphQL polling and add Delta-Sync transport semantics.

## Why This Matters

Most GraphQL clients poll with full JSON payloads. Delta-Sync keeps the same query model and sends:
- full response on cold load
- RFC 6902 patch on change
- 304 when unchanged

## Quick Start

```bash
cd examples/graphql
npm install
npm start
```

Server runs on `http://localhost:4100`.

## Endpoints

- Baseline full polling: `POST /graphql/full`
- Delta-enabled polling: `POST /graphql/delta`

Both accept the same GraphQL request body.

## Poller Scripts

Delta mode:

```bash
cd examples/graphql
npm run poll:delta
```

Full mode baseline:

```bash
cd examples/graphql
npm run poll:full
```

## Integration Pattern (Apollo / urql / custom)

1. Keep your existing poll interval.
2. Send `Accept: application/json-patch+json`.
3. Send `If-None-Match` with last `ETag`.
4. Handle responses:
- `304`: keep snapshot
- `application/json-patch+json`: apply patch to previous snapshot
- `application/json`: replace snapshot

## Apollo-style Fetch Wrapper (Concept)

```ts
const headers: Record<string, string> = {
  Accept: 'application/json-patch+json',
  'Content-Type': 'application/json',
};
if (etag) headers['If-None-Match'] = etag;

const res = await fetch('/graphql/delta', {
  method: 'POST',
  headers,
  body: JSON.stringify({ query, variables, operationName }),
});
```

Then branch on status/content-type exactly like REST Delta-Sync.

## Key Notes

- Cache keys should include user scope and `operationName`.
- Exclude noisy extension fields from diff/ETag.
- Keep `Vary: If-None-Match, Accept`.
