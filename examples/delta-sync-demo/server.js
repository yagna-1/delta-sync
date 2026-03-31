import crypto from 'node:crypto';
import compression from 'compression';
import express from 'express';
import stringify from 'fast-json-stable-stringify';
import * as jsondiffpatch from 'jsondiffpatch';
import { format as formatJsonPatch } from 'jsondiffpatch/formatters/jsonpatch';

const app = express();
app.use(compression());
app.use(express.static('public'));

const differ = jsondiffpatch.create({
  objectHash: (obj) => obj?.id ?? obj?._id ?? obj?.key ?? obj?.uuid ?? stringify(obj),
  arrays: { detectMove: true, includeValueOnMove: false },
});

function computeETag(body) {
  const stable = stringify(body);
  return `"${crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16)}"`;
}

function decodePointerSegment(segment) {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function stripPaths(value, ignorePaths) {
  if (!ignorePaths.length) return value;
  const clone = JSON.parse(JSON.stringify(value));

  for (const pointer of ignorePaths) {
    const parts = pointer.split('/').filter(Boolean).map(decodePointerSegment);
    if (!parts.length) continue;

    let node = clone;
    for (let i = 0; i < parts.length - 1; i += 1) {
      node = node?.[parts[i]];
      if (node == null) break;
    }

    if (node != null) {
      delete node[parts[parts.length - 1]];
    }
  }

  return clone;
}

class SnapshotCache {
  constructor(maxEntries = 500, ttlMs = 10 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  get(key) {
    const entry = this.items.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.items.delete(key);
      return undefined;
    }

    this.items.delete(key);
    this.items.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.items.delete(key);
    this.items.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.items.size > this.maxEntries) {
      const oldest = this.items.keys().next().value;
      this.items.delete(oldest);
    }
  }
}

function deltaSync({ ignorePaths = [] } = {}) {
  const snapshots = new SnapshotCache();

  return function middleware(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = async function patchedJson(body) {
      try {
        const diffBody = stripPaths(body, ignorePaths);
        const fullBody = JSON.stringify(body);
        const fullLen = Buffer.byteLength(fullBody);
        const etag = computeETag(diffBody);

        const clientEtag = req.get('if-none-match') ?? null;
        const acceptsPatch = (req.get('accept') ?? '').includes('application/json-patch+json');
        const userKey = req.get('x-user-id') ?? 'anon';
        const keyOf = (rawEtag) => `${userKey}:${rawEtag}`;

        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'If-None-Match, Accept');

        if (clientEtag === etag) {
          return res.status(304).end();
        }

        if (acceptsPatch && clientEtag) {
          const prev = snapshots.get(keyOf(clientEtag));
          if (prev !== undefined) {
            const delta = differ.diff(prev, diffBody);
            if (!delta) {
              return res.status(304).end();
            }

            const patch = formatJsonPatch(delta, prev);
            const patchBody = JSON.stringify(patch);
            const patchLen = Buffer.byteLength(patchBody);

            if (patchLen < fullLen) {
              snapshots.set(keyOf(etag), diffBody);
              res.setHeader('ETag', etag);
              res.setHeader('Content-Type', 'application/json-patch+json');
              res.setHeader('X-Delta-Sync', 'patch');
              res.setHeader('X-Delta-Full-Size', String(fullLen));
              res.setHeader('X-Delta-Patch-Size', String(patchLen));
              return res.status(200).send(patchBody);
            }

            res.setHeader('X-Delta-Sync', 'full-fallback');
          }
        }

        snapshots.set(keyOf(etag), diffBody);
        res.setHeader('ETag', etag);
        res.setHeader('Content-Type', 'application/json');
        if (!res.getHeader('X-Delta-Sync')) res.setHeader('X-Delta-Sync', 'full');
        return res.status(200).send(fullBody);
      } catch (error) {
        console.error('[delta-sync-demo] middleware error', error);
        return originalJson(body);
      }
    };

    next();
  };
}

const serviceRegions = ['us-east', 'us-west', 'eu-central', 'ap-south'];
const baseLine = 'Synthetic service payload for before/after network profiling';
const services = Array.from({ length: 180 }, (_, i) => ({
  id: `svc-${i + 1}`,
  name: `Service ${i + 1}`,
  region: serviceRegions[i % serviceRegions.length],
  owner: `team-${(i % 20) + 1}`,
  status: 'healthy',
  notes: `${baseLine}. ${baseLine}. ${baseLine}.`,
  latencyMs: 20 + (i % 50),
}));

const history = Array.from({ length: 240 }, (_, i) => ({
  minute: i,
  activeUsers: 800 + (i % 120),
  revenue: 12000 + (i % 400),
}));

let activeUsers = 1200;
let revenue = 456000;
let alerts = [
  { id: 'a1', level: 'info', text: 'All systems nominal' },
  { id: 'a2', level: 'warn', text: 'Slow query detected on analytics shard' },
];

setInterval(() => {
  activeUsers += 1;
  revenue += Math.floor(Math.random() * 130);

  if (Math.random() > 0.65) {
    alerts = [
      ...alerts.slice(-6),
      {
        id: `a${Date.now()}`,
        level: Math.random() > 0.5 ? 'warn' : 'info',
        text: Math.random() > 0.5 ? 'Retry queue grew by 4 jobs' : 'Background rollup completed',
      },
    ];
  }
}, 2500);

function makeDashboard() {
  return {
    activeUsers,
    revenue,
    alerts,
    services,
    history,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: Math.random().toString(16).slice(2),
    },
  };
}

app.get('/api/dashboard-full', (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Delta-Sync', 'full-only');
  res.status(200).send(JSON.stringify(makeDashboard()));
});

app.use('/api', deltaSync({ ignorePaths: ['/meta/timestamp', '/meta/requestId'] }));
app.get('/api/dashboard', (_req, res) => {
  res.json(makeDashboard());
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
app.listen(port, () => {
  console.log(`Delta-Sync demo running at http://localhost:${port}`);
  console.log('Open / in your browser and DevTools Network tab for before/after.');
});
