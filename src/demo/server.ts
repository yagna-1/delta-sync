import compression from 'compression';
import express from 'express';
import { register } from 'prom-client';

import { deltaSync } from '../middleware/deltaSync.js';

const app = express();
app.use(compression());

let count = 1;
let revenue = 12345;
const regions = ['us-east', 'us-west', 'eu-central', 'ap-south'];
const heavyNote =
  'Synthetic service baseline for dashboard load testing with stable content blocks.';
const services = Array.from({ length: 180 }, (_, index) => ({
  id: `svc-${index + 1}`,
  name: `Service ${index + 1}`,
  region: regions[index % regions.length],
  owner: `team-${(index % 24) + 1}`,
  status: 'healthy',
  slo: 99.95,
  latencyMs: 20 + (index % 40),
  notes: `${heavyNote} ${heavyNote} ${heavyNote} ${heavyNote}`,
}));
const history = Array.from({ length: 240 }, (_, index) => ({
  ts: `2026-03-${String((index % 30) + 1).padStart(2, '0')}T12:00:00.000Z`,
  users: 800 + (index % 120),
  revenue: 9500 + (index % 400),
}));

let alerts = [
  { id: 'a1', level: 'info', text: 'All systems nominal' },
  { id: 'a2', level: 'warn', text: 'Slow query detected' },
];

setInterval(() => {
  count += 1;
  revenue += Math.floor(Math.random() * 150);
  if (Math.random() > 0.6) {
    alerts = [
      ...alerts.slice(-4),
      {
        id: `a${Date.now()}`,
        level: Math.random() > 0.5 ? 'warn' : 'info',
        text: 'Background sync updated',
      },
    ];
  }
}, 3000);

const deltaSyncMiddleware = deltaSync({
  ignorePaths: ['/meta/timestamp', '/meta/requestId'],
  scopeKey: (req) => req.get('x-user-id') ?? 'anon',
  maxDiffInputBytes: 512_000,
  minPatchSavingsBytes: 16,
  enableMetrics: true,
});

app.use('/api', (req, res, next) => {
  if (process.env.DELTA_SYNC_ENABLED === 'false') {
    next();
    return;
  }
  deltaSyncMiddleware(req, res, next);
});

app.get('/api/dashboard', (_req, res) => {
  res.json({
    activeUsers: count,
    revenue,
    alerts,
    services,
    history,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: Math.random().toString(16).slice(2),
    },
  });
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
app.listen(port, () => {
  console.log(`Delta-Sync demo listening on http://localhost:${port}`);
});
