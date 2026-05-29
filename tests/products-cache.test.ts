import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from './helpers.js';

test('GET /products uses cache and exposes metrics', async (t) => {
  const harness = await createTestHarness();
  t.after(async () => {
    await harness.close();
  });

  const first = await fetch(`${harness.baseUrl}/products`);
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { products: unknown[] };
  assert.ok(Array.isArray(firstBody.products));
  assert.ok(firstBody.products.length > 0);

  const second = await fetch(`${harness.baseUrl}/products`);
  assert.equal(second.status, 200);

  const metricsResponse = await fetch(`${harness.baseUrl}/metrics`);
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.json() as { cacheHit: number; cacheMiss: number };

  assert.equal(metrics.cacheMiss, 1);
  assert.equal(metrics.cacheHit, 1);
});
