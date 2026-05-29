import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from './helpers.js';

test('concurrent checkout requests do not oversell the same stock', async (t) => {
  const harness = await createTestHarness({ autoStartWorker: false });
  t.after(async () => {
    await harness.close();
  });

  const payload = {
    items: [
      {
        productId: 'samsung-s24-case',
        quantity: 8,
      },
    ],
  };

  const [first, second] = await Promise.all([
    fetch(`${harness.baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'stock-race-001',
      },
      body: JSON.stringify(payload),
    }),
    fetch(`${harness.baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'stock-race-002',
      },
      body: JSON.stringify(payload),
    }),
  ]);

  const responses = [first, second];
  const statuses = responses.map((response) => response.status).sort();

  assert.deepEqual(statuses, [202, 409]);

  const success = responses.find((response) => response.status === 202);
  assert.ok(success);
  const successBody = await success.json() as { orderId: string };
  assert.ok(successBody.orderId);

  const productResponse = await fetch(`${harness.baseUrl}/products`);
  assert.equal(productResponse.status, 200);
  const body = await productResponse.json() as { products: Array<{ id: string; stockAvailable: number; stockReserved: number }> };
  const product = body.products.find((item) => item.id === 'samsung-s24-case');
  assert.ok(product);
  assert.equal(product?.stockAvailable, 0);
  assert.ok(product?.stockReserved === 8 || product?.stockReserved === 0);
});

test('concurrent checkout requests with the same idempotency-key return the same order', async (t) => {
  const harness = await createTestHarness({ autoStartWorker: false });
  t.after(async () => {
    await harness.close();
  });

  const payload = {
    items: [
      {
        productId: 'screen-protector',
        quantity: 2,
      },
    ],
  };

  const [first, second] = await Promise.all([
    fetch(`${harness.baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-race-001',
      },
      body: JSON.stringify(payload),
    }),
    fetch(`${harness.baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-race-001',
      },
      body: JSON.stringify(payload),
    }),
  ]);

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);

  const firstBody = await first.json() as { orderId: string; status: string };
  const secondBody = await second.json() as { orderId: string; status: string };

  assert.equal(firstBody.orderId, secondBody.orderId);
  assert.ok(firstBody.status === 'pending' || firstBody.status === 'completed');
  assert.ok(secondBody.status === 'pending' || secondBody.status === 'completed');
});
