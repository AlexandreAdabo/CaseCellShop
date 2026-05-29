import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { CheckoutRequest, CheckoutResult, RequestContext } from '../domain/types.js';
import type { Product } from '../domain/types.js';
import { CheckoutError } from '../domain/errors.js';
import type { ProductCache } from '../infrastructure/cache/product-cache.js';
import type { AppLogger } from '../infrastructure/logger.js';
import { Metrics } from '../infrastructure/metrics.js';
import type { CheckoutJobData } from '../infrastructure/worker/checkout-queue.js';
import { OrderRepository } from '../repositories/order.repository.js';
import { ProductRepository } from '../repositories/product.repository.js';

function canonicalizeCheckoutItems(items: Array<{ productId: string; quantity: number }>): string {
  return JSON.stringify(
    [...items]
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
      .sort((left, right) => {
        const productComparison = left.productId.localeCompare(right.productId);
        if (productComparison !== 0) {
          return productComparison;
        }

        return left.quantity - right.quantity;
      }),
  );
}

export class CheckoutService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly productRepository: ProductRepository,
    private readonly productCache: ProductCache<Product[]>,
    private readonly queue: Queue<CheckoutJobData> | null,
    private readonly metrics: Metrics,
    private readonly logger: AppLogger,
  ) {}

  createCheckout(input: CheckoutRequest, idempotencyKey: string, context: RequestContext): CheckoutResult {
    const items = Array.isArray(input.items) ? input.items : [];
    const normalizedItems = this.orderRepository.normalizeItems(items);

    if (normalizedItems.length === 0) {
      throw new CheckoutError('Checkout requires at least one item.', 400, 'EMPTY_CART');
    }

    const now = new Date().toISOString();

    const result = this.orderRepository.transaction((): CheckoutResult => {
      const existing = this.orderRepository.getOrderByIdempotencyKey(idempotencyKey);
      if (existing) {
        const existingItems = this.orderRepository.getOrderItems(existing.id);
        const existingSignature = canonicalizeCheckoutItems(existingItems);
        const incomingSignature = canonicalizeCheckoutItems(normalizedItems);

        if (existingSignature !== incomingSignature) {
          throw new CheckoutError('The idempotency-key cannot be reused with a different payload.', 409, 'IDEMPOTENCY_KEY_CONFLICT', {
            idempotencyKey,
          });
        }

        return {
          orderId: existing.id,
          totalCents: existing.totalCents,
          idempotencyKey: existing.idempotencyKey,
          status: existing.status,
          created: false,
        };
      }

      const orderId = randomUUID();
      let totalCents = 0;
      const preparedItems: { productId: string; quantity: number; unitPriceCents: number }[] = [];

      for (const item of normalizedItems) {
        const product = this.productRepository.getProduct(item.productId);
        if (!product) {
          throw new CheckoutError(`Product ${item.productId} not found.`, 404, 'PRODUCT_NOT_FOUND', {
            productId: item.productId,
          });
        }

        if (product.stockAvailable < item.quantity) {
          throw new CheckoutError(`Insufficient stock for ${product.id}.`, 409, 'OUT_OF_STOCK', {
            productId: product.id,
            requested: item.quantity,
            available: product.stockAvailable,
          });
        }

        this.orderRepository.reserveStock(item.productId, item.quantity);
        totalCents += product.priceCents * item.quantity;
        preparedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCents: product.priceCents,
        });
      }

      this.orderRepository.insertOrder({
        orderId,
        idempotencyKey,
        totalCents,
        createdAt: now,
        updatedAt: now,
      });
      this.orderRepository.insertOrderItems(orderId, preparedItems);

      return {
        orderId,
        totalCents,
        idempotencyKey,
        status: 'pending',
        created: true,
      };
    });

    this.metrics.increment('checkoutAccepted');
    this.logger.info({
      orderId: result.orderId,
      totalCents: result.totalCents,
      created: result.created,
    }, 'checkout.accepted');

    if (result.created) {
      void this.productCache.clear().catch((error) => {
        this.logger.warn({
          requestId: context.requestId,
          correlationId: context.correlationId,
          traceId: context.traceId,
          error: error instanceof Error ? { message: error.message, name: error.name } : { message: String(error) },
        }, 'products.cache.clear_failed');
      });

      if (this.queue) {
        this.metrics.increment('checkoutEnqueued');
        this.logger.info({
          orderId: result.orderId,
          requestId: context.requestId,
          traceId: context.traceId,
          idempotencyKey: result.idempotencyKey ?? undefined,
        }, 'checkout.enqueued');
        void this.queue.add('process', {
          orderId: result.orderId,
          requestId: context.requestId,
          traceId: context.traceId,
          idempotencyKey: result.idempotencyKey,
        }, { jobId: result.orderId });
      } else {
        this.logger.info({
          orderId: result.orderId,
          requestId: context.requestId,
          traceId: context.traceId,
        }, 'checkout.inline.processing');
        this.processCheckoutInline(result.orderId, context);
      }
    } else {
      this.logger.info({
        requestId: context.requestId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        orderId: result.orderId,
      }, 'checkout.idempotent.replay');
    }

    return result;
  }

  private processCheckoutInline(orderId: string, context: RequestContext): void {
    const now = new Date().toISOString();
    try {
      this.orderRepository.updateOrderStatus(orderId, 'processing', now);

      const items = this.orderRepository.getOrderItems(orderId);
      this.orderRepository.transaction(() => {
        for (const item of items) {
          this.orderRepository.completeReservedStock(item.productId, item.quantity);
        }
        this.orderRepository.updateOrderStatus(orderId, 'completed', new Date().toISOString(), null);
      });

      this.metrics.increment('checkoutCompleted');
      this.logger.info({
        orderId,
        requestId: context.requestId,
        traceId: context.traceId,
      }, 'checkout.inline.completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown inline error';
      try {
        const items = this.orderRepository.getOrderItems(orderId);
        this.orderRepository.transaction(() => {
          for (const item of items) {
            this.orderRepository.releaseStock(item.productId, item.quantity);
          }
          this.orderRepository.updateOrderStatus(orderId, 'failed', new Date().toISOString(), message);
        });
      } catch (failError) {
        this.logger.error({
          orderId,
          requestId: context.requestId,
          traceId: context.traceId,
          error: failError instanceof Error ? failError.message : 'Unknown failure',
        }, 'checkout.inline.fail_to_mark_failed');
      }

      this.metrics.increment('checkoutFailed');
      this.logger.error({
        orderId,
        requestId: context.requestId,
        traceId: context.traceId,
        error: message,
      }, 'checkout.inline.failed');
    }
  }
}
