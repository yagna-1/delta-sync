import { LRUCache } from 'lru-cache';
import { createClient, type RedisClientType } from 'redis';
import stringify from 'fast-json-stable-stringify';

export interface SnapshotStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export function makeLRUStore(max = 500, ttl = 600_000): SnapshotStore {
  const cache = new LRUCache<string, any>({ max, ttl });

  return {
    async get(key: string) {
      return cache.get(key);
    },
    async set(key: string, value: unknown) {
      cache.set(key, value);
    },
  };
}

export type RedisStoreOptions = {
  prefix?: string;
  ttlSeconds?: number;
};

export async function makeRedisStore(
  url: string,
  options: RedisStoreOptions = {},
): Promise<SnapshotStore> {
  const { prefix = 'ds:', ttlSeconds = 600 } = options;
  const client: RedisClientType = createClient({ url });
  await client.connect();

  return {
    async get(key: string) {
      const raw = await client.get(`${prefix}${key}`);
      return raw ? JSON.parse(raw) : undefined;
    },
    async set(key: string, value: unknown) {
      await client.setEx(`${prefix}${key}`, ttlSeconds, stringify(value));
    },
  };
}
