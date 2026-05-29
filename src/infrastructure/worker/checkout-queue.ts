import { Queue } from 'bullmq';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

let queue: Queue | null = null;

export type CheckoutJobData = {
  orderId: string;
  traceId: string;
  requestId: string;
  idempotencyKey?: string | null;
};

export function getCheckoutQueue(redisUrl?: string): Queue {
  if (!queue) {
    queue = new Queue<CheckoutJobData>('checkout', {
      connection: { url: redisUrl || DEFAULT_REDIS_URL },
      defaultJobOptions: {
        removeOnComplete: { age: 60 * 60 * 24 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });
  }
  return queue;
}

export async function closeCheckoutQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
