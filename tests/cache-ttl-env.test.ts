import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/logger.js';
import { Metrics } from '../src/metrics.js';
import { SQLiteStore } from '../src/db.js';

test('CACHE_TTL_MS can be loaded from .env and falls back when invalid', async (t) => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'casecellshop-env-'));
  writeFileSync(path.join(rootDir, '.env'), 'CACHE_TTL_MS=25\n');

  const previousCwd = process.cwd();
  process.chdir(rootDir);
  t.after(() => {
    process.chdir(previousCwd);
  });

  const env = loadEnv(rootDir);
  assert.equal(env.cacheTtlMs, 25);

  const dbPath = path.join(rootDir, 'env.sqlite');
  const store = new SQLiteStore(dbPath);
  store.init();

  const metrics = new Metrics();
  const logger = createLogger({ service: 'casecellshop-env-test' });
  const { app, worker, dispose } = await createApp({
    store,
    metrics,
    logger,
    cacheTtlMs: env.cacheTtlMs,
    autoStartWorker: false,
  });

  const server = createServer(app);
  server.listen(0);
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server.');
  }

  t.after(async () => {
    worker?.close();
    await dispose();
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const first = await fetch(`http://127.0.0.1:${address.port}/products`);
  assert.equal(first.status, 200);
  const second = await fetch(`http://127.0.0.1:${address.port}/products`);
  assert.equal(second.status, 200);

  const metricsResponse = await fetch(`http://127.0.0.1:${address.port}/metrics`);
  const snapshot = await metricsResponse.json() as { cacheHit: number; cacheMiss: number };
  assert.equal(snapshot.cacheMiss, 1);
  assert.equal(snapshot.cacheHit, 1);
});
