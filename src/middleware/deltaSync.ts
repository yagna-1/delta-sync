import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import stringify from 'fast-json-stable-stringify';
import * as jsondiffpatch from 'jsondiffpatch';
import { format as formatJsonPatch } from 'jsondiffpatch/formatters/jsonpatch';

import {
  deltaRequests,
  diffDurationMs,
  patchSizeBytes,
  savedBytesTotal,
} from '../metrics/deltaSyncMetrics.js';
import { makeLRUStore, type SnapshotStore } from './snapshotStore.js';

const differ = jsondiffpatch.create({
  objectHash: (obj: any) => obj?.id ?? obj?._id ?? obj?.key ?? obj?.uuid ?? stringify(obj),
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
});

export function computeETag(body: unknown): string {
  return computeETagFromStableString(stringify(body));
}

export type DeltaSyncOptions = {
  ignorePaths?: string[];
  maxCacheEntries?: number;
  cacheTTLMs?: number;
  maxDiffInputBytes?: number;
  minPatchSavingsBytes?: number;
  tuningForRequest?: (req: Request) => DeltaSyncRequestTuning | undefined;
  store?: SnapshotStore;
  scopeKey?: (req: Request) => string;
  enableMetrics?: boolean;
};

export type DeltaSyncRequestTuning = {
  maxDiffInputBytes?: number;
  minPatchSavingsBytes?: number;
};

function computeETagFromStableString(stable: string): string {
  return `"${createHash('sha256').update(stable).digest('hex').slice(0, 16)}"`;
}

type PointerPath = string[];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function compileIgnorePaths(ignorePaths: string[]): PointerPath[] {
  return ignorePaths
    .map((path) =>
      path
        .split('/')
        .filter(Boolean)
        .map(decodePointerSegment),
    )
    .filter((parts) => parts.length > 0);
}

function stripPaths(input: unknown, ignorePaths: PointerPath[]): unknown {
  if (!ignorePaths.length) return input;

  const clone = cloneJson(input);

  for (const parts of ignorePaths) {
    let node: any = clone;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const token = parts[i];
      if (Array.isArray(node)) {
        const index = Number.parseInt(token, 10);
        if (!Number.isInteger(index) || index < 0 || index >= node.length) {
          node = undefined;
          break;
        }
        node = node[index];
        continue;
      }
      node = node?.[token];
      if (node === undefined || node === null) break;
    }

    if (node !== undefined && node !== null) {
      const leaf = parts[parts.length - 1];
      if (Array.isArray(node)) {
        const index = Number.parseInt(leaf, 10);
        if (Number.isInteger(index) && index >= 0 && index < node.length) {
          node.splice(index, 1);
        }
      } else {
        delete node[leaf];
      }
    }
  }

  return clone;
}

export function deltaSync(options: DeltaSyncOptions = {}): RequestHandler {
  const {
    ignorePaths = [],
    maxCacheEntries = 500,
    cacheTTLMs = 600_000,
    maxDiffInputBytes = Number.POSITIVE_INFINITY,
    minPatchSavingsBytes = 0,
    tuningForRequest,
    store = makeLRUStore(maxCacheEntries, cacheTTLMs),
    scopeKey,
    enableMetrics = false,
  } = options;
  const compiledIgnorePaths = compileIgnorePaths(ignorePaths);

  return function deltaSyncMiddleware(req: Request, res: Response, next: NextFunction) {
    const originalJson = res.json.bind(res);

    async function handleResponse(body: unknown): Promise<void> {
      try {
        const userScope = scopeKey?.(req) ?? 'anon';
        const diffBody = stripPaths(body, compiledIgnorePaths);
        const fullStr = stringify(body);
        const fullBytes = Buffer.byteLength(fullStr);
        const stableDiffStr = stringify(diffBody);
        const etag = computeETagFromStableString(stableDiffStr);
        const clientETag = req.get('if-none-match') ?? null;
        const acceptHeader = req.get('accept') ?? '';
        const wantsPatch = acceptHeader.includes('application/json-patch+json');
        const perRequestTuning = tuningForRequest?.(req);
        const effectiveMaxDiffInputBytes =
          perRequestTuning?.maxDiffInputBytes ?? maxDiffInputBytes;
        const effectiveMinPatchSavingsBytes =
          perRequestTuning?.minPatchSavingsBytes ?? minPatchSavingsBytes;

        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'If-None-Match, Accept');

        if (clientETag === etag) {
          if (enableMetrics) deltaRequests.inc({ type: 'not_modified' });
          res.status(304).end();
          return;
        }

        const cacheKeyFor = (rawEtag: string): string => `${userScope}:${rawEtag}`;

        if (wantsPatch && clientETag) {
          if (fullBytes > effectiveMaxDiffInputBytes) {
            res.setHeader('X-Delta-Sync', 'full-skip-large');
            if (enableMetrics) deltaRequests.inc({ type: 'full-skip-large' });
          } else {
            const prev = await store.get(cacheKeyFor(clientETag));
            if (prev !== undefined) {
              const start = performance.now();
              const delta = differ.diff(prev, diffBody);
              if (enableMetrics) diffDurationMs.observe(performance.now() - start);

              if (!delta) {
                if (enableMetrics) deltaRequests.inc({ type: 'not_modified' });
                res.status(304).end();
                return;
              }

              const patch = formatJsonPatch(delta, prev);
              const patchStr = JSON.stringify(patch);
              const patchBytes = Buffer.byteLength(patchStr);

              if (patchBytes + effectiveMinPatchSavingsBytes <= fullBytes) {
                await store.set(cacheKeyFor(etag), diffBody);
                res.setHeader('ETag', etag);
                res.setHeader('Content-Type', 'application/json-patch+json');
                res.setHeader('X-Delta-Sync', 'patch');
                res.setHeader('X-Delta-Full-Size', String(fullBytes));
                res.setHeader('X-Delta-Patch-Size', String(patchBytes));
                if (enableMetrics) {
                  deltaRequests.inc({ type: 'patch' });
                  patchSizeBytes.observe(patchBytes);
                  savedBytesTotal.inc(Math.max(0, fullBytes - patchBytes));
                }
                res.status(200).send(patchStr);
                return;
              }

              res.setHeader('X-Delta-Sync', 'full-fallback');
              if (enableMetrics) deltaRequests.inc({ type: 'full-fallback' });
            }
          }
        }

        await store.set(cacheKeyFor(etag), diffBody);
        res.setHeader('ETag', etag);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Delta-Full-Size', String(fullBytes));
        if (!res.getHeader('X-Delta-Sync')) {
          res.setHeader('X-Delta-Sync', 'full');
          if (enableMetrics) deltaRequests.inc({ type: 'full' });
        }
        res.status(200).send(fullStr);
      } catch (error) {
        if (enableMetrics) deltaRequests.inc({ type: 'error' });
        console.error('[delta-sync] middleware error:', error);
        originalJson(body);
      }
    }

    res.json = function deltaSyncJson(body: unknown): Response {
      void handleResponse(body);
      return res;
    } as Response['json'];

    next();
  };
}
