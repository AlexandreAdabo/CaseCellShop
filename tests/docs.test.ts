import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from './helpers.js';

test('GET /docs and GET /openapi.json expose the API documentation', async (t) => {
  const harness = await createTestHarness();
  t.after(async () => {
    await harness.close();
  });

  const docsResponse = await fetch(`${harness.baseUrl}/docs`);
  assert.equal(docsResponse.status, 200);
  const docsHtml = await docsResponse.text();
  assert.match(docsHtml, /swagger-ui/);
  assert.match(docsHtml, /CaseCellShop API Docs/);

  const openApiResponse = await fetch(`${harness.baseUrl}/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json() as {
    paths?: Record<string, any>;
  };

  assert.ok(openApi.paths);
  assert.ok(openApi.paths['/products']);
  assert.ok(openApi.paths['/checkout']);
  assert.ok(openApi.paths['/orders/{orderId}/status']);

  const checkoutPath = openApi.paths['/checkout'];
  const checkoutPost = checkoutPath?.post;
  assert.ok(checkoutPost);
  const idempotencyHeader = checkoutPost?.parameters?.find((parameter: { name: string; in: string; required?: boolean }) => parameter.name === 'idempotency-key' && parameter.in === 'header');
  assert.ok(idempotencyHeader);
  assert.equal(idempotencyHeader?.required, true);
  const checkoutSchema = checkoutPost?.requestBody?.content?.['application/json']?.schema;
  assert.ok(checkoutSchema);
  assert.ok(!checkoutSchema?.properties || !Object.prototype.hasOwnProperty.call(checkoutSchema.properties, 'idempotencyKey'));
});
