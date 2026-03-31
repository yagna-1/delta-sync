import { applyOperation, type Operation } from 'fast-json-patch';
import { useSyncExternalStore } from 'react';

export type PatchOp = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
};

export type SyncMode =
  | 'idle'
  | 'full'
  | 'patch'
  | 'full-fallback'
  | 'not-modified'
  | 'resync'
  | 'error';

export type StoreState<T> = {
  data: T | null;
  mode: SyncMode;
  lastFullBytes: number;
  lastPatchBytes: number;
  totalSavedBytes: number;
};

type Store<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StoreState<T>;
  getServerSnapshot: () => StoreState<T>;
  fetchNow: (cold?: boolean) => Promise<void>;
};

type CreateStoreOptions = {
  fetcher?: typeof fetch;
};

const stores = new Map<string, Store<any>>();

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDeltaSyncStore<T>(
  url: string,
  interval: number,
  options: CreateStoreOptions = {},
): Store<T> {
  const fetcher = options.fetcher ?? fetch;

  let state: StoreState<T> = {
    data: null,
    mode: 'idle',
    lastFullBytes: 0,
    lastPatchBytes: 0,
    totalSavedBytes: 0,
  };

  let etag: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const listeners = new Set<() => void>();

  function notify(next: Partial<StoreState<T>>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  async function fetchData(cold = false): Promise<void> {
    if (inFlight) return;
    inFlight = true;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json-patch+json',
      };

      if (!cold && etag) {
        headers['If-None-Match'] = etag;
      }

      let response: Response;
      try {
        response = await fetcher(url, { headers });
      } catch {
        notify({ mode: 'error' });
        return;
      }

      if (response.status === 304) {
        notify({ mode: 'not-modified' });
        return;
      }

      if (response.status !== 200) {
        notify({ mode: 'error' });
        return;
      }

      const newETag = response.headers.get('ETag');
      const contentType = response.headers.get('Content-Type') ?? '';
      const xDeltaMode = response.headers.get('X-Delta-Sync') as SyncMode | null;
      const headerFullBytes = Number.parseInt(
        response.headers.get('X-Delta-Full-Size') ?? '0',
        10,
      );
      const headerPatchBytes = Number.parseInt(
        response.headers.get('X-Delta-Patch-Size') ?? '0',
        10,
      );

      const rawBody = await response.text();
      const bodyBytes = new TextEncoder().encode(rawBody).length;

      if (contentType.includes('application/json-patch+json') && state.data !== null) {
        let operations: PatchOp[];
        try {
          operations = JSON.parse(rawBody) as PatchOp[];
        } catch {
          etag = null;
          notify({ mode: 'resync' });
          inFlight = false;
          await fetchData(true);
          return;
        }

        try {
          let patched: any = cloneJson(state.data);
          for (const operation of operations) {
            patched = applyOperation(
              patched as unknown as object,
              operation as Operation,
              true,
            ).newDocument;
          }

          etag = newETag;
          const resolvedFullBytes = headerFullBytes || Math.max(bodyBytes, state.lastFullBytes);
          const resolvedPatchBytes = headerPatchBytes || bodyBytes;

          notify({
            data: patched,
            mode: 'patch',
            lastFullBytes: resolvedFullBytes,
            lastPatchBytes: resolvedPatchBytes,
            totalSavedBytes:
              state.totalSavedBytes +
              Math.max(0, resolvedFullBytes - resolvedPatchBytes),
          });
          return;
        } catch {
          etag = null;
          notify({ mode: 'resync' });
          inFlight = false;
          await fetchData(true);
          return;
        }
      }

      try {
        const data = JSON.parse(rawBody) as T;
        etag = newETag;
        notify({
          data,
          mode: xDeltaMode === 'full-fallback' ? 'full-fallback' : 'full',
          lastFullBytes: bodyBytes,
          lastPatchBytes: 0,
        });
      } catch {
        notify({ mode: 'error' });
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        void fetchData();
        timer = setInterval(() => {
          void fetchData();
        }, interval);
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot() {
      return state;
    },
    getServerSnapshot() {
      return state;
    },
    fetchNow(cold = false) {
      return fetchData(cold);
    },
  };
}

export function resetDeltaSyncStores(): void {
  stores.clear();
}

export function useDeltaSync<T = unknown>(
  url: string,
  options: { interval?: number } = {},
): StoreState<T> {
  const { interval = 5000 } = options;
  const key = `${url}::${interval}`;

  if (!stores.has(key)) {
    stores.set(key, createDeltaSyncStore<T>(url, interval));
  }

  const store = stores.get(key) as Store<T>;

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  ) as StoreState<T>;
}
