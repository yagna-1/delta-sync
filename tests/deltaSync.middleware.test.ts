// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { deltaSync } from '../src/middleware/deltaSync.js';
import type { SnapshotStore } from '../src/middleware/snapshotStore.js';

type MockRequest = {
  get: (name: string) => string | undefined;
};

type MockResponse = {
  bodySent: string | null;
  ended: boolean;
  statusCode: number;
  headers: Map<string, string>;
  setHeader: (name: string, value: string) => void;
  getHeader: (name: string) => string | undefined;
  status: (code: number) => MockResponse;
  send: (body: unknown) => MockResponse;
  end: () => MockResponse;
  json: (body: unknown) => MockResponse;
};

function makeReq(headers: Record<string, string> = {}): MockRequest {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    get(name: string) {
      return normalized[name.toLowerCase()];
    },
  };
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    bodySent: null,
    ended: false,
    statusCode: 200,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      res.headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name: string) {
      return res.headers.get(name.toLowerCase());
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send(body: unknown) {
      res.bodySent = typeof body === 'string' ? body : JSON.stringify(body);
      res.ended = true;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
    json(body: unknown) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(body);
    },
  };

  return res;
}

function parseBody<T>(res: MockResponse): T | null {
  if (!res.bodySent) return null;
  return JSON.parse(res.bodySent) as T;
}

async function waitForResponse(res: MockResponse, timeoutMs = 200): Promise<void> {
  const start = Date.now();
  while (!res.ended) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for middleware response');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function runRequest(
  middleware: ReturnType<typeof deltaSync>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<MockResponse> {
  const req = makeReq(headers);
  const res = makeRes();
  middleware(req as any, res as any, () => {});
  res.json(body);
  await waitForResponse(res);
  return res;
}

describe('deltaSync middleware', () => {
  it('returns 200 + ETag on first request', async () => {
    const middleware = deltaSync();
    const res = await runRequest(middleware, { count: 1 });

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('etag')).toBeDefined();
    expect(res.getHeader('x-delta-sync')).toBe('full');
    expect(res.getHeader('cache-control')).toBe('private, no-store');
    expect(res.getHeader('vary')).toContain('If-None-Match');
  });

  it('returns 304 when ETag matches', async () => {
    const middleware = deltaSync();
    const initial = await runRequest(middleware, { count: 1 });

    const res = await runRequest(
      middleware,
      { count: 1 },
      {
        Accept: 'application/json-patch+json',
        'If-None-Match': initial.getHeader('etag')!,
      },
    );

    expect(res.statusCode).toBe(304);
  });

  it('returns RFC 6902 patch when data changes and patch is smaller', async () => {
    const middleware = deltaSync();
    const initial = await runRequest(middleware, {
      count: 1,
      payload: 'x'.repeat(1000),
    });

    const res = await runRequest(
      middleware,
      {
        count: 42,
        payload: 'x'.repeat(1000),
      },
      {
        Accept: 'application/json-patch+json',
        'If-None-Match': initial.getHeader('etag')!,
      },
    );

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toContain('application/json-patch+json');
    expect(res.getHeader('x-delta-sync')).toBe('patch');
    const patch = parseBody<Array<{ op: string; path: string; value?: unknown }>>(res);
    expect(patch).toContainEqual({ op: 'replace', path: '/count', value: 42 });
  });

  it('falls back to full response when patch is larger than full payload', async () => {
    const middleware = deltaSync();
    const initial = await runRequest(middleware, { value: 'x'.repeat(200) });

    const res = await runRequest(
      middleware,
      { value: 'y' },
      {
        Accept: 'application/json-patch+json',
        'If-None-Match': initial.getHeader('etag')!,
      },
    );

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('x-delta-sync')).toBe('full-fallback');
    expect(res.getHeader('content-type')).toContain('application/json');
    expect(parseBody<{ value: string }>(res)).toEqual({ value: 'y' });
  });

  it('generates stable ETags for nested objects with different key order', async () => {
    const middlewareA = deltaSync();
    const middlewareB = deltaSync();

    const res1 = await runRequest(middlewareA, { a: 1, b: { x: 2, y: 3 } });
    const res2 = await runRequest(middlewareB, { b: { y: 3, x: 2 }, a: 1 });

    expect(res1.getHeader('etag')).toBe(res2.getHeader('etag'));
  });

  it('ignores configured noisy fields for diff and ETag', async () => {
    const middleware = deltaSync({
      ignorePaths: ['/meta/timestamp', '/meta/requestId'],
    });

    const initial = await runRequest(middleware, {
      value: 10,
      meta: { timestamp: 't-1', requestId: 'r-1' },
    });

    const res = await runRequest(
      middleware,
      {
        value: 10,
        meta: { timestamp: 't-2', requestId: 'r-2' },
      },
      {
        Accept: 'application/json-patch+json',
        'If-None-Match': initial.getHeader('etag')!,
      },
    );

    expect(res.statusCode).toBe(304);
  });

  it('scopes cache by user identity when scopeKey is configured', async () => {
    const middleware = deltaSync({
      scopeKey: (req) => req.get('x-user-id') ?? 'anon',
    });

    const u1First = await runRequest(
      middleware,
      { count: 1, payload: 'x'.repeat(1000) },
      { 'x-user-id': 'u1' },
    );

    const u1Second = await runRequest(
      middleware,
      { count: 2, payload: 'x'.repeat(1000) },
      {
        Accept: 'application/json-patch+json',
        'If-None-Match': u1First.getHeader('etag')!,
        'x-user-id': 'u1',
      },
    );

    const u2Second = await runRequest(
      middleware,
      { count: 2, payload: 'x'.repeat(1000) },
      {
        Accept: 'application/json-patch+json',
        'If-None-Match': u1First.getHeader('etag')!,
        'x-user-id': 'u2',
      },
    );

    expect(u1Second.getHeader('x-delta-sync')).toBe('patch');
    expect(u2Second.getHeader('x-delta-sync')).toBe('full');
  });

  it('falls back to original res.json if middleware internals throw', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const brokenStore: SnapshotStore = {
      async get() {
        return undefined;
      },
      async set() {
        throw new Error('store unavailable');
      },
    };

    const middleware = deltaSync({ store: brokenStore });
    const res = await runRequest(middleware, { ok: true });

    expect(res.statusCode).toBe(200);
    expect(parseBody<{ ok: boolean }>(res)).toEqual({ ok: true });

    errorSpy.mockRestore();
  });
});
