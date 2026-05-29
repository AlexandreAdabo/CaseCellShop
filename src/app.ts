import express from 'express';
import { loadEnv } from './config/env.js';
import { ProductCacheManager, type RedisClientFactory } from './infrastructure/cache/product-cache-manager.js';
import { SQLiteStore } from './infrastructure/database/sqlite-store.js';
import { createLogger, type AppLogger } from './infrastructure/logger.js';
import { Metrics } from './infrastructure/metrics.js';
import { getCheckoutQueue, closeCheckoutQueue } from './infrastructure/worker/checkout-queue.js';
import { createCheckoutWorker, getQueueDepth } from './infrastructure/worker/checkout-worker.js';
import { ProductRepository } from './repositories/product.repository.js';
import { OrderRepository } from './repositories/order.repository.js';
import { ProductService } from './services/product.service.js';
import { CheckoutService } from './services/checkout.service.js';
import { OrderService } from './services/order.service.js';
import { ProductController } from './controllers/product.controller.js';
import { CheckoutController } from './controllers/checkout.controller.js';
import { OrderController } from './controllers/order.controller.js';
import { registerRoutes } from './routes/index.js';
import { requestContextMiddleware } from './middlewares/request-context.middleware.js';
import { requestSummaryMiddleware } from './middlewares/request-summary.middleware.js';
import { errorLoggerMiddleware } from './middlewares/error-logger.middleware.js';
import type { Product } from './domain/types.js';

export type CreateAppOptions = {
  store: SQLiteStore;
  metrics?: Metrics;
  logger?: AppLogger;
  cacheTtlMs?: number;
  redisUrl?: string;
  redisConnectTimeoutMs?: number;
  redisClientFactory?: RedisClientFactory;
  workerProcessingDelayMs?: number;
  autoStartWorker?: boolean;
};

export async function createApp(options: CreateAppOptions) {
  const env = loadEnv();
  const metrics = options.metrics ?? new Metrics();
  const logger = options.logger ?? createLogger();
  const store = options.store;
  const redisUrl = options.redisUrl ?? env.redisUrl;

  const cache = await ProductCacheManager.create<Product[]>({
    ttlMs: options.cacheTtlMs ?? env.cacheTtlMs ?? 5_000,
    logger,
    redisUrl,
    redisConnectTimeoutMs: options.redisConnectTimeoutMs,
    redisClientFactory: options.redisClientFactory,
    cacheKey: 'products:list',
  });

  const queue = getCheckoutQueue(redisUrl);
  const worker = (options.autoStartWorker ?? true)
    ? createCheckoutWorker(store, metrics, logger.child({ component: 'checkout-worker' }), {
        redisUrl,
        processingDelayMs: options.workerProcessingDelayMs ?? 150,
      })
    : null;

  const productRepository = new ProductRepository(store);
  const orderRepository = new OrderRepository(store);

  const productService = new ProductService(productRepository, cache, metrics, logger);
  const checkoutService = new CheckoutService(orderRepository, productRepository, cache, queue, metrics, logger);
  const orderService = new OrderService(orderRepository, logger);

  const productController = new ProductController(productService);
  const checkoutController = new CheckoutController(checkoutService);
  const orderController = new OrderController(orderService);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(requestContextMiddleware(logger));
  app.use(requestSummaryMiddleware(logger));

  registerRoutes(app, {
    metrics,
    queueDepth: () => getQueueDepth(queue),
    productController,
    checkoutController,
    orderController,
  });

  app.use(errorLoggerMiddleware);

  return {
    app,
    cache,
    metrics,
    store,
    queue,
    worker,
    dispose: async () => {
      await cache.dispose();
      await closeCheckoutQueue();
    },
  };
}
