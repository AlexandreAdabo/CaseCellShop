import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'bullmq';
import type { AppLogger } from '../logger.js';
import { Metrics } from '../metrics.js';
import { SQLiteStore } from '../database/sqlite-store.js';
import type { CheckoutJobData } from './checkout-queue.js';

export function createCheckoutWorker(
  store: SQLiteStore,
  metrics: Metrics,
  logger: AppLogger,
  options?: {
    redisUrl?: string;
    processingDelayMs?: number;
  },
): Worker<CheckoutJobData> | null {
  if (!options?.redisUrl) return null;

  const processingDelayMs = options.processingDelayMs ?? 150;

  const worker = new Worker<CheckoutJobData>(
    'checkout',
    async (job) => {
      const { orderId, requestId, traceId, idempotencyKey } = job.data;

      metrics.increment('checkoutProcessing');
      logger.info({
        orderId,
        requestId,
        traceId,
        idempotencyKey: idempotencyKey ?? undefined,
      }, 'checkout.worker.started');

      try {
        store.updateOrderStatus(orderId, 'processing', new Date().toISOString());
        await delay(processingDelayMs);

        const items = store.getOrderItems(orderId);
        store.transaction(() => {
          for (const item of items) {
            store.completeReservedStock(item.productId, item.quantity);
          }

          store.updateOrderStatus(orderId, 'completed', new Date().toISOString(), null);
        });
        metrics.increment('checkoutCompleted');
        logger.info({
          orderId,
          requestId,
          traceId,
        }, 'checkout.worker.completed');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown worker error';
        try {
          const items = store.getOrderItems(orderId);
          store.transaction(() => {
            for (const item of items) {
              store.releaseStock(item.productId, item.quantity);
            }
            store.updateOrderStatus(orderId, 'failed', new Date().toISOString(), message);
          });
        } catch (failError) {
          logger.error({
            orderId,
            requestId,
            traceId,
            error: failError instanceof Error ? failError.message : 'Unknown failure',
          }, 'checkout.worker.fail_to_mark_failed');
        }

        metrics.increment('checkoutFailed');
        logger.error({
          orderId,
          requestId,
          traceId,
          error: message,
        }, 'checkout.worker.failed');
        throw error;
      }
    },
    {
      connection: { url: options.redisUrl },
      concurrency: 1,
    },
  );

  worker.on('error', () => {});

  return worker;
}

export async function getQueueDepth(queue: import('bullmq').Queue | null): Promise<number> {
  if (!queue) return 0;
  const [waiting, active, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
  ]);
  return waiting + active + delayed;
}
