# Benchmark Results

## Demo benchmark (local)

Command:

```bash
cd examples/delta-sync-demo
npm run benchmark -- http://127.0.0.1:3000 --polls 12 --interval 600
```

Sample run (2026-03-31):

| Metric | Baseline full polling | Delta-Sync polling |
| --- | ---: | ---: |
| Polls | 12 | 12 |
| Bytes transferred | 800,936 B | 66,995 B |
| Equivalent full bytes | 800,936 B | 801,468 B |
| Payload saved | - | 734,473 B (91.6%) |
| Avg latency | 8.7 ms | 7.7 ms |
| P95 latency | 32.9 ms | 19.0 ms |
| Client CPU time | 142.9 ms | 59.4 ms |
| CPU / wall ratio | 2.1% | 0.9% |

Delta response mix:

- Full responses: 1
- Patch responses: 2
- 304 responses: 9

Notes:

- Numbers vary by endpoint volatility.
- CPU values shown are benchmark-client overhead in this run.
