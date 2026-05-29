import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness, waitForOrderStatus } from './helpers.js';

test('POST /checkout creates an async order and idempotency returns the same order', async (t) => {
  const harness = await createTestHarness({ workerDelayMs: 25 });
  t.after(async () => {
    await harness.close();
  });

  const checkoutResponse = await fetch(`${harness.baseUrl}/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'idem-001',
    },
    body: JSON.stringify({
      items: [
        {
          productId: 'iphone-15-case',
          quantity: 2,
        },
      ],
    }),
  });

  assert.equal(checkoutResponse.status, 202);
  const checkoutBody = await checkoutResponse.json() as {
    orderId: string;
    status: string;
    statusUrl: string;
    totalCents: number;
    idempotencyKey?: string;
  };

  assert.ok(checkoutBody.orderId);
  assert.equal(checkoutBody.status, 'pending');
  assert.equal(checkoutBody.statusUrl, `/orders/${checkoutBody.orderId}/status`);
  assert.equal(checkoutBody.idempotencyKey, 'idem-001');

  const completed = await waitForOrderStatus(harness.baseUrl, checkoutBody.orderId, 'completed');
  const completedBody = completed as { orderId: string; status: string; totalCents: number };
  assert.equal(completedBody.orderId, checkoutBody.orderId);
  assert.equal(completedBody.status, 'completed');
  assert.equal(completedBody.totalCents, checkoutBody.totalCents);

  const replayResponse = await fetch(`${harness.baseUrl}/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'idem-001',
    },
    body: JSON.stringify({
      items: [
        {
          productId: 'iphone-15-case',
          quantity: 2,
        },
      ],
    }),
  });

  assert.equal(replayResponse.status, 202);
  const replayBody = await replayResponse.json() as { orderId: string; status: string };
  assert.equal(replayBody.orderId, checkoutBody.orderId);
  assert.equal(replayBody.status, 'completed');
});

test('POST /checkout requires idempotency-key in the header', async (t) => {
  const harness = await createTestHarness({ workerDelayMs: 25, redisUrl: '' });
  t.after(async () => {
    await harness.close();
  });

  const response = await fetch(`${harness.baseUrl}/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      items: [
        {
          productId: 'iphone-15-case',
          quantity: 1,
        },
      ],
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as {
    error: {
      code: string;
      message: string;
    };
  };

  assert.equal(body.error.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('POST /checkout rejects the same idempotency-key when payload changes', async (t) => {
  const harness = await createTestHarness({ workerDelayMs: 25 });
  t.after(async () => {
    await harness.close();
  });

  const firstResponse = await fetch(`${harness.baseUrl}/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'idem-conflict-001',
    },
    body: JSON.stringify({
      items: [
        {
          productId: 'iphone-15-case',
          quantity: 1,
        },
      ],
    }),
  });

  assert.equal(firstResponse.status, 202);

  const secondResponse = await fetch(`${harness.baseUrl}/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'idem-conflict-001',
    },
    body: JSON.stringify({
      items: [
        {
          productId: 'iphone-15-case',
          quantity: 2,
        },
      ],
    }),
  });

  assert.equal(secondResponse.status, 409);
  const body = await secondResponse.json() as {
    error: {
      code: string;
      message: string;
    };
  };

  assert.equal(body.error.code, 'IDEMPOTENCY_KEY_CONFLICT');
});
