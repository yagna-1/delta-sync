<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-simple-b-dark.svg">
    <img src="docs/assets/logo-simple-b-light.svg" alt="Delta-Sync logo" width="760">
  </picture>
</p>

# Stop sending 42KB every 5 seconds

Delta-Sync reduces API bandwidth by 90-99% without WebSockets.
Positioning: **Drop-in delta-sync layer for REST APIs**.

## Why Delta-Sync

- Keep polling and existing REST/GraphQL endpoints.
- Send full payload once, then JSON patch deltas.
- Return `304 Not Modified` when data is unchanged.
- Preserve standard HTTP semantics (`ETag`, `If-None-Match`, `Vary`).

## Demo (Instant Aha)

```bash
git clone https://github.com/your-org/delta-sync.git
cd delta-sync/examples/delta-sync-demo
npm install
npm run dev
```

Open `http://localhost:3000` and use `Toggle Delta-Sync ON/OFF`.

- `OFF` -> calls `/api/dashboard-full` (full payload every poll)
- `ON` -> calls `/api/dashboard` (full once, then patch/304)

![Delta-Sync toggle OFF](docs/assets/demo-toggle-off.png)
![Delta-Sync toggle ON](docs/assets/demo-toggle-on.png)

## One-Line Integration

Server:

```ts
app.use('/api', deltaSync())
```

Client:

```ts
const { data } = useDeltaSync('/api/dashboard')
```

## Configuration

```ts
app.use('/api', deltaSync({
  ignorePaths: ['/meta/timestamp', '/meta/requestId'],
  maxDiffInputBytes: 512_000,
  minPatchSavingsBytes: 16,
  // optional per-route tuning
  tuningForRequest: (req) => req.path.startsWith('/api/reports')
    ? { maxDiffInputBytes: 256_000, minPatchSavingsBytes: 64 }
    : undefined,
}))
```

Recommended starting points:

- High-traffic dashboards: `maxDiffInputBytes: 512_000`, `minPatchSavingsBytes: 16`
- Occasional large report endpoints: `maxDiffInputBytes: 256_000`, `minPatchSavingsBytes: 64`
- Low-traffic/internal APIs: `maxDiffInputBytes: Infinity`, `minPatchSavingsBytes: 0`

## Benchmark Proof

Sample run (`polls=12`, `interval=600ms`):

| Metric | Baseline | Delta-Sync |
| --- | ---: | ---: |
| Bytes transferred | 800,936 B | 66,995 B |
| Payload saved | - | 734,473 B (91.6%) |
| Avg latency | 8.7 ms | 7.7 ms |
| P95 latency | 32.9 ms | 19.0 ms |
| Client CPU time | 142.9 ms | 59.4 ms |

![Benchmark output](docs/assets/benchmark-proof.png)

See full benchmark details in `docs/benchmark-results.md`.

## Installation

```bash
npm install
npm run build
npm test
```

## Project Structure

- `src/middleware/deltaSync.ts` - server middleware
- `src/hooks/useDeltaSync.ts` - React polling hook
- `src/components/DeltaSyncDevPanel.tsx` - dev diagnostics panel
- `scripts/delta-benchmark.ts` - CLI benchmark
- `examples/delta-sync-demo` - drop-in visual demo
- `examples/graphql` - GraphQL polling integration
- `ports` - FastAPI, Gin, and Spring starters
- `docs/cdn-story.md` - CDN passthrough + edge roadmap

## HTTP Contract

Request headers:
- `If-None-Match`
- `Accept: application/json-patch+json`

Response headers:
- `ETag`
- `Vary: If-None-Match, Accept`
- `X-Delta-Sync: full | patch | full-fallback | full-skip-large`
- `X-Delta-Full-Size`
- `X-Delta-Patch-Size` (patch responses only)

## Delta Algorithm Strategy

- Structural JSON diff + stable hashing (implemented)
- Patch-size guard + full fallback (implemented)
- Rolling-hash chunking (roadmap)

See:
- `docs/algorithm-strategy.md`
- `docs/architecture.md`

## GraphQL Integration

Use the same GraphQL query model and add Delta-Sync transport behavior:

- full on cold load
- patch on change
- 304 when unchanged

See `examples/graphql/README.md`.

## CDN Story

Delta-Sync works behind CDN today via ETag passthrough, with edge diff compute as the next optimization layer.

See `docs/cdn-story.md`.

## Language Ports

- Python FastAPI: `ports/fastapi-delta-sync`
- Go Gin: `ports/gin-delta-sync`
- Java Spring Boot: `ports/spring-delta-sync`

See `ports/README.md`.

## Real-world Use Cases

- Operational dashboards
- Chat/inbox metadata streams
- Config/state distribution
- GraphQL polling workloads

See `docs/use-cases.md`.

## Testing

Core package:

```bash
npm test
npm run typecheck
```

Demo benchmark:

```bash
cd examples/delta-sync-demo
npm run benchmark -- http://localhost:3000 --polls 20 --interval 1000
```

## Roadmap

- Edge diff compute mode for ultra-low-latency revalidation
- Additional production adapters
- Broader language ports

## Documentation

- [Demo Guide](examples/delta-sync-demo/README.md)
- [GraphQL Guide](examples/graphql/README.md)
- [CDN Story](docs/cdn-story.md)
- [Algorithm Strategy](docs/algorithm-strategy.md)
- [Architecture Diagram](docs/architecture.md)
- [Benchmark Results](docs/benchmark-results.md)
- [Use Cases](docs/use-cases.md)
- [Language Ports](ports/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Community and OSS

- License: [MIT](LICENSE)
- Code of Conduct: [Contributor Covenant](CODE_OF_CONDUCT.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Support: [SUPPORT.md](SUPPORT.md)

## License

MIT
