import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { Worker } from 'bullmq';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/logger.js';
import { Metrics } from '../src/metrics.js';
import { SQLiteStore } from '../src/db.js';

export type TestHarness = {
  baseUrl: string;
  store: SQLiteStore;
  metrics: Metrics;
  worker: Worker | null;
  cache: Awaited<ReturnType<typeof createApp>>['cache'];
  close: () => Promise<void>;
};

export async function createTestHarness(options?: {
  workerDelayMs?: number;
  cacheTtlMs?: number;
  autoStartWorker?: boolean;
  envCacheTtlMs?: number;
  redisUrl?: string;
  redisConnectTimeoutMs?: number;
}): Promise<TestHarness> {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'casecellshop-'));
  const dbPath = path.join(rootDir, 'test.sqlite');
  const store = new SQLiteStore(dbPath);
  store.init();

  const metrics = new Metrics();
  const logger = createLogger({ service: 'casecellshop-test' });
  const env = loadEnv();
  const { app, worker, cache } = await createApp({
    store,
    metrics,
    logger,
    cacheTtlMs: options?.cacheTtlMs ?? options?.envCacheTtlMs ?? env.cacheTtlMs,
    redisUrl: options?.redisUrl ?? env.redisUrl,
    redisConnectTimeoutMs: options?.redisConnectTimeoutMs,
    workerProcessingDelayMs: options?.workerDelayMs ?? 30,
    autoStartWorker: options?.autoStartWorker ?? true,
  });

  const server = createServer(app);
  server.listen(0);
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server.');
  }

  const close = async (): Promise<void> => {
    await worker?.close();
    await cache.dispose();
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    metrics,
    worker,
    cache,
    close,
  };
}

export async function waitForOrderStatus(baseUrl: string, orderId: string, expected: string, timeoutMs = 2_000): Promise<unknown> {
  const startedAt = Date.now();
  let lastPayload: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}/orders/${orderId}/status`);
    lastPayload = await response.json();

    if (response.ok) {
      const payload = lastPayload as { status?: string };
      if (payload.status === expected) {
        return lastPayload;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Order ${orderId} did not reach ${expected} in time. Last payload: ${JSON.stringify(lastPayload)}`);
}
