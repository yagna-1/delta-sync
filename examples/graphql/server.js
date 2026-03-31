import crypto from 'node:crypto';
import compression from 'compression';
import express from 'express';
import stringify from 'fast-json-stable-stringify';
import * as jsondiffpatch from 'jsondiffpatch';
import { format as formatJsonPatch } from 'jsondiffpatch/formatters/jsonpatch';

const app = express();
app.use(express.json());
app.use(compression());

const differ = jsondiffpatch.create({
  objectHash: (obj) => obj?.id ?? obj?._id ?? obj?.key ?? obj?.uuid ?? stringify(obj),
  arrays: { detectMove: true, includeValueOnMove: false },
});

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

function computeETag(body) {
  return `"${crypto.createHash('sha256').update(stringify(body)).digest('hex').slice(0, 16)}"`;
}

function deltaSyncGraphQL() {
  const snapshots = new SnapshotCache();

  return function middleware(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = async function patchedJson(body) {
      try {
        const diffBody = JSON.parse(JSON.stringify(body));
        delete diffBody?.extensions?.timestamp;
        delete diffBody?.extensions?.requestId;

        const fullBody = JSON.stringify(body);
        const fullLen = Buffer.byteLength(fullBody);
        const etag = computeETag(diffBody);
        const clientEtag = req.get('if-none-match') ?? null;
        const acceptsPatch = (req.get('accept') ?? '').includes('application/json-patch+json');
        const opName = req.body?.operationName ?? 'anonymous';
        const userScope = req.get('x-user-id') ?? 'anon';
        const keyOf = (rawEtag) => `${userScope}:${opName}:${rawEtag}`;

        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'If-None-Match, Accept');

        if (clientEtag === etag) {
          return res.status(304).end();
        }

        if (acceptsPatch && clientEtag) {
          const prev = snapshots.get(keyOf(clientEtag));
          if (prev !== undefined) {
            const delta = differ.diff(prev, diffBody);
            if (!delta) return res.status(304).end();

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
        console.error('[graphql-delta] middleware error', error);
        return originalJson(body);
      }
    };

    next();
  };
}

const regions = ['us-east', 'us-west', 'eu-central', 'ap-south'];
const widgets = Array.from({ length: 140 }, (_, i) => ({
  id: `widget-${i + 1}`,
  title: `Widget ${i + 1}`,
  region: regions[i % regions.length],
  owner: `team-${(i % 12) + 1}`,
  status: 'ok',
  note: 'GraphQL polling payload sample for Delta-Sync adoption.',
}));

let activeUsers = 980;
let mrr = 214000;
let incidents = [
  { id: 'i1', severity: 'low', summary: 'Cache warmup in progress' },
  { id: 'i2', severity: 'medium', summary: 'One slow shard in analytics' },
];

setInterval(() => {
  activeUsers += 1;
  mrr += Math.floor(Math.random() * 120);
  if (Math.random() > 0.65) {
    incidents = [
      ...incidents.slice(-5),
      {
        id: `i${Date.now()}`,
        severity: Math.random() > 0.7 ? 'high' : 'low',
        summary: Math.random() > 0.5 ? 'Worker retry spike' : 'Background compaction complete',
      },
    ];
  }
}, 3000);

function buildGraphQLResponse() {
  return {
    data: {
      dashboard: {
        activeUsers,
        mrr,
        incidents,
        widgets,
      },
    },
    extensions: {
      timestamp: new Date().toISOString(),
      requestId: Math.random().toString(16).slice(2),
    },
  };
}

app.post('/graphql/full', (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Delta-Sync', 'full-only');
  res.status(200).send(JSON.stringify(buildGraphQLResponse()));
});

app.use('/graphql/delta', deltaSyncGraphQL());
app.post('/graphql/delta', (_req, res) => {
  res.json(buildGraphQLResponse());
});

const port = Number.parseInt(process.env.PORT ?? '4100', 10);
app.listen(port, () => {
  console.log(`GraphQL Delta-Sync example running at http://localhost:${port}`);
});
