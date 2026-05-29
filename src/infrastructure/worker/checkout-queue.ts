import { Queue } from 'bullmq';

export type CheckoutJobData = {
  orderId: string;
  traceId: string;
  requestId: string;
  idempotencyKey?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queue: Queue<any, any, string, any, any, string> | null = null;

export function getCheckoutQueue(redisUrl?: string): typeof queue {
  if (!redisUrl) return null;
  if (!queue) {
    queue = new Queue<CheckoutJobData>('checkout', {
      connection: { url: redisUrl },
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
