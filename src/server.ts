import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { SQLiteStore } from './db.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    service: 'casecellshop-api',
    environment: process.env.NODE_ENV ?? 'development',
    level: env.logLevel,
  });
  const metrics = new Metrics();

  const databasePath = SQLiteStore.defaultPath();
  const store = new SQLiteStore(databasePath);
  store.init();

  const { app, worker, dispose } = await createApp({
    store,
    metrics,
    logger,
    autoStartWorker: true,
  });

  const port = env.port;
  const server = app.listen(port, () => {
    logger.info({ port }, 'server.started');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.warn({ signal }, 'server.shutdown_requested');
    worker?.close();
    await dispose();
    store.close();
    server.close(() => {
      process.exit(0);
    });
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
