import type { CheckoutItemInput, CheckoutResult, OrderItemRow, OrderStatus, OrderStatusResponse } from '../domain/types.js';
import { SQLiteStore } from '../infrastructure/database/sqlite-store.js';

export class OrderRepository {
  constructor(private readonly store: SQLiteStore) {}

  transaction<T>(fn: () => T): T {
    return this.store.transaction(fn);
  }

  normalizeItems(items: CheckoutItemInput[]): CheckoutItemInput[] {
    return this.store.normalizeItems(items);
  }

  getOrder(orderId: string): OrderStatusResponse | null {
    return this.store.getOrder(orderId);
  }

  getOrderByIdempotencyKey(idempotencyKey: string): { id: string; idempotencyKey: string | null; status: OrderStatus; totalCents: number } | null {
    return this.store.getOrderByIdempotencyKey(idempotencyKey);
  }

  getOrderItems(orderId: string): OrderItemRow[] {
    return this.store.getOrderItems(orderId);
  }

  insertOrder(input: {
    orderId: string;
    idempotencyKey: string | null;
    totalCents: number;
    createdAt: string;
    updatedAt: string;
  }): void {
    this.store.insertOrder(input);
  }

  insertOrderItems(orderId: string, items: { productId: string; quantity: number; unitPriceCents: number }[]): void {
    this.store.insertOrderItems(orderId, items);
  }

  reserveStock(productId: string, quantity: number): void {
    this.store.reserveStock(productId, quantity);
  }

  releaseStock(productId: string, quantity: number): void {
    this.store.releaseStock(productId, quantity);
  }

  completeReservedStock(productId: string, quantity: number): void {
    this.store.completeReservedStock(productId, quantity);
  }

  updateOrderStatus(orderId: string, status: OrderStatus, updatedAt: string, errorMessage: string | null = null): void {
    this.store.updateOrderStatus(orderId, status, updatedAt, errorMessage);
  }
}
