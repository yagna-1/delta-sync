# Delta-Sync Drop-in Demo

This demo is optimized for the instant "aha" moment.

## Quick Start

```bash
cd examples/delta-sync-demo
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Instant Aha Toggle

Use the on-page button:

`Toggle Delta-Sync ON/OFF`

Behavior:
- `OFF` -> calls `/api/dashboard-full`
- `ON` -> calls `/api/dashboard`

In DevTools Network this becomes:
- click OFF -> large payload every poll
- click ON -> one full, then mostly patch/304

## CLI Benchmark

```bash
cd examples/delta-sync-demo
npm run benchmark -- http://localhost:3000 --polls 20 --interval 1000
```

## Endpoints

- `GET /api/dashboard-full` (baseline full polling)
- `GET /api/dashboard` (Delta-Sync)

Delta endpoint headers:
- `ETag`
- `X-Delta-Sync: full | patch | full-fallback | full-skip-large`
- `X-Delta-Full-Size`
- `X-Delta-Patch-Size`

## Notes

- Compression is enabled.
- Noisy fields (`/meta/timestamp`, `/meta/requestId`) are ignored for diff and ETag.
