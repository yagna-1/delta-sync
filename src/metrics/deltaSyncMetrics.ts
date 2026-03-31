import { Counter, Histogram } from 'prom-client';

export const deltaRequests = new Counter({
  name: 'delta_sync_requests_total',
  help: 'Delta-Sync responses by outcome type',
  labelNames: ['type'],
});

export const patchSizeBytes = new Histogram({
  name: 'delta_sync_patch_bytes',
  help: 'Patch payload sizes in bytes',
  buckets: [50, 200, 500, 1000, 2000, 5000, 10000],
});

export const savedBytesTotal = new Counter({
  name: 'delta_sync_saved_bytes_total',
  help: 'Cumulative bytes saved versus sending full responses',
});

export const diffDurationMs = new Histogram({
  name: 'delta_sync_diff_duration_ms',
  help: 'jsondiffpatch diff duration in milliseconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 25],
});
