// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createDeltaSyncStore } from '../src/hooks/useDeltaSync.js';

function getHeader(init: RequestInit | undefined, name: string): string | null {
  if (!init?.headers) return null;
  const headers = new Headers(init.headers);
  return headers.get(name);
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createDeltaSyncStore', () => {
  it('applies full then patch responses and tracks saved bytes', async () => {
    let call = 0;

    const fetcher: typeof fetch = async (_input, init) => {
      call += 1;

      if (call === 1) {
        return new Response(JSON.stringify({ count: 1 }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: '"v1"',
            'X-Delta-Sync': 'full',
          },
        });
      }

      expect(getHeader(init, 'If-None-Match')).toBe('"v1"');
      return new Response(JSON.stringify([{ op: 'replace', path: '/count', value: 2 }]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json-patch+json',
          ETag: '"v2"',
          'X-Delta-Sync': 'patch',
          'X-Delta-Full-Size': '200',
          'X-Delta-Patch-Size': '25',
        },
      });
    };

    const store = createDeltaSyncStore<{ count: number }>('/api/test', 60_000, { fetcher });
    const unsubscribe = store.subscribe(() => {});

    await waitFor(() => store.getSnapshot().mode === 'full');

    await store.fetchNow();

    await waitFor(() => store.getSnapshot().mode === 'patch');
    const state = store.getSnapshot();

    expect(state.data).toEqual({ count: 2 });
    expect(state.lastFullBytes).toBe(200);
    expect(state.lastPatchBytes).toBe(25);
    expect(state.totalSavedBytes).toBe(175);

    unsubscribe();
  });

  it('resyncs cold on invalid patch application', async () => {
    let call = 0;

    const fetcher: typeof fetch = async (_input, init) => {
      call += 1;

      if (call === 1) {
        return new Response(JSON.stringify({ count: 0 }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: '"v1"',
            'X-Delta-Sync': 'full',
          },
        });
      }

      if (call === 2) {
        expect(getHeader(init, 'If-None-Match')).toBe('"v1"');
        return new Response(
          JSON.stringify([{ op: 'replace', path: '/does/not/exist', value: 99 }]),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json-patch+json',
              ETag: '"v2"',
              'X-Delta-Sync': 'patch',
            },
          },
        );
      }

      expect(getHeader(init, 'If-None-Match')).toBeNull();
      return new Response(JSON.stringify({ count: 1 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: '"v3"',
          'X-Delta-Sync': 'full',
        },
      });
    };

    const store = createDeltaSyncStore<{ count: number }>('/api/test', 60_000, { fetcher });
    const unsubscribe = store.subscribe(() => {});

    await waitFor(() => store.getSnapshot().mode === 'full');
    await store.fetchNow();

    await waitFor(() => store.getSnapshot().mode === 'full');
    const state = store.getSnapshot();

    expect(state.data).toEqual({ count: 1 });
    expect(state.mode).toBe('full');
    expect(call).toBe(3);

    unsubscribe();
  });
});
