import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisProductCache, type RedisLikeClient } from '../src/infrastructure/cache/redis-product-cache.js';
import { createTestHarness } from './helpers.js';

test('RedisProductCache serializes values, preserves TTL and handles cache misses', async () => {
  const store = new Map<string, string>();
  const setCalls: Array<{ key: string; value: string; options?: { PX?: number } }> = [];
  const deletedKeys: string[] = [];

  const client: RedisLikeClient = {
    async connect() {},
    async quit() {},
    async disconnect() {},
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, options?: { PX?: number }) {
      store.set(key, value);
      setCalls.push({ key, value, options });
      return 'OK';
    },
    async del(key: string) {
      deletedKeys.push(key);
      return store.delete(key) ? 1 : 0;
    },
  };

  const cache = new RedisProductCache(client, 'products:list', 1_500);
  assert.equal(await cache.get(), null);

  const products = [
    {
      id: 'iphone-15-case',
      name: 'iPhone 15 Case',
      description: 'Premium slim case',
      priceCents: 12990,
      stockAvailable: 12,
      stockReserved: 0,
    },
  ];

  await cache.set(products);

  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].key, 'products:list');
  assert.equal(setCalls[0].options?.PX, 1_500);
  assert.deepEqual(await cache.get(), products);

  store.set('products:list', '{bad-json');
  assert.equal(await cache.get(), null);
  assert.deepEqual(deletedKeys, ['products:list']);
});

test('application falls back to memory cache when Redis connection fails', async (t) => {
  const harness = await createTestHarness({
    redisUrl: 'redis://127.0.0.1:1',
    redisConnectTimeoutMs: 50,
  });
  t.after(async () => {
    await harness.close();
  });

  assert.equal(harness.cache.backend, 'memory');

  const first = await fetch(`${harness.baseUrl}/products`);
  assert.equal(first.status, 200);

  const second = await fetch(`${harness.baseUrl}/products`);
  assert.equal(second.status, 200);

  const metricsResponse = await fetch(`${harness.baseUrl}/metrics`);
  const metrics = await metricsResponse.json() as { cacheHit: number; cacheMiss: number };
  assert.equal(metrics.cacheMiss, 1);
  assert.equal(metrics.cacheHit, 1);
});
