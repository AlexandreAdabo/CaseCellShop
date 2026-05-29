import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CheckoutItemInput,
  CheckoutResult,
  OrderItemRow,
  OrderStatus,
  OrderStatusResponse,
  Product,
} from '../../domain/types.js';
import { CheckoutError } from '../../domain/errors.js';

type ProductRow = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stockAvailable: number;
  stockReserved: number;
};

type OrderRow = {
  id: string;
  idempotencyKey: string | null;
  status: OrderStatus;
  totalCents: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type OrderItemDbRow = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
};

export class SQLiteStore {
  private readonly db: DatabaseSync;

  constructor(private readonly filePath: string) {
    const directory = path.dirname(filePath);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        stock_available INTEGER NOT NULL,
        stock_reserved INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    `);

    const countRow = this.db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number } | undefined;
    if (!countRow || countRow.count > 0) {
      return;
    }

    const seedProducts = [
      {
        id: 'iphone-15-case',
        name: 'iPhone 15 Case',
        description: 'Premium slim case for iPhone 15',
        priceCents: 12990,
        stockAvailable: 12,
      },
      {
        id: 'samsung-s24-case',
        name: 'Samsung S24 Case',
        description: 'Shockproof case for Samsung S24',
        priceCents: 11990,
        stockAvailable: 8,
      },
      {
        id: 'screen-protector',
        name: 'Tempered Glass Protector',
        description: 'Anti-scratch tempered glass protector',
        priceCents: 4990,
        stockAvailable: 25,
      },
    ];

    const insert = this.db.prepare(`
      INSERT INTO products (id, name, description, price_cents, stock_available, stock_reserved)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    this.transaction(() => {
      for (const row of seedProducts) {
        insert.run(row.id, row.name, row.description, row.priceCents, row.stockAvailable);
      }
    });
  }

  listProducts(): Product[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, name, description, price_cents AS priceCents, stock_available AS stockAvailable, stock_reserved AS stockReserved
          FROM products
          ORDER BY name ASC
        `,
      )
      .all() as ProductRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      stockAvailable: row.stockAvailable,
      stockReserved: row.stockReserved,
    }));
  }

  getProduct(productId: string): Product | null {
    const row = this.db
      .prepare(
        `
          SELECT id, name, description, price_cents AS priceCents, stock_available AS stockAvailable,
                 stock_reserved AS stockReserved
          FROM products
          WHERE id = ?
        `,
      )
      .get(productId) as ProductRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      stockAvailable: row.stockAvailable,
      stockReserved: row.stockReserved,
    };
  }

  getOrder(orderId: string): OrderStatusResponse | null {
    const row = this.db
      .prepare(
        `
          SELECT id, idempotency_key AS idempotencyKey, status, total_cents AS totalCents,
                 error_message AS errorMessage, created_at AS createdAt, updated_at AS updatedAt
          FROM orders
          WHERE id = ?
        `,
      )
      .get(orderId) as OrderRow | undefined;

    if (!row) {
      return null;
    }

    return {
      orderId: row.id,
      status: row.status,
      totalCents: row.totalCents,
      idempotencyKey: row.idempotencyKey,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      statusUrl: `/orders/${row.id}/status`,
    };
  }

  getOrderByIdempotencyKey(idempotencyKey: string): { id: string; idempotencyKey: string | null; status: OrderStatus; totalCents: number } | null {
    const row = this.db
      .prepare(
        `
          SELECT id, idempotency_key AS idempotencyKey, status, total_cents AS totalCents
          FROM orders
          WHERE idempotency_key = ?
        `,
      )
      .get(idempotencyKey) as { id: string; idempotencyKey: string | null; status: OrderStatus; totalCents: number } | undefined;

    if (!row) {
      return null;
    }

    return row;
  }

  getOrderItems(orderId: string): OrderItemRow[] {
    return this.db
      .prepare(
        `
          SELECT product_id AS productId, quantity, unit_price_cents AS unitPriceCents
          FROM order_items
          WHERE order_id = ?
          ORDER BY id ASC
        `,
      )
      .all(orderId) as OrderItemRow[];
  }

  insertOrder(input: {
    orderId: string;
    idempotencyKey: string | null;
    totalCents: number;
    createdAt: string;
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO orders (id, idempotency_key, status, total_cents, error_message, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, NULL, ?, ?)
        `,
      )
      .run(input.orderId, input.idempotencyKey, input.totalCents, input.createdAt, input.updatedAt);
  }

  insertOrderItems(orderId: string, items: OrderItemDbRow[]): void {
    const insertItem = this.db.prepare(`
      INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(orderId, item.productId, item.quantity, item.unitPriceCents);
    }
  }

  reserveStock(productId: string, quantity: number): void {
    this.db
      .prepare(
        `
          UPDATE products
          SET stock_available = stock_available - ?,
              stock_reserved = stock_reserved + ?
          WHERE id = ?
        `,
      )
      .run(quantity, quantity, productId);
  }

  releaseStock(productId: string, quantity: number): void {
    this.db
      .prepare(
        `
          UPDATE products
          SET stock_available = stock_available + ?,
              stock_reserved = stock_reserved - ?
          WHERE id = ?
        `,
      )
      .run(quantity, quantity, productId);
  }

  completeReservedStock(productId: string, quantity: number): void {
    this.db
      .prepare(
        `
          UPDATE products
          SET stock_reserved = stock_reserved - ?
          WHERE id = ?
        `,
      )
      .run(quantity, productId);
  }

  updateOrderStatus(orderId: string, status: OrderStatus, updatedAt: string, errorMessage: string | null = null): void {
    const result = this.db
      .prepare(
        `
          UPDATE orders
          SET status = ?,
              error_message = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(status, errorMessage, updatedAt, orderId);

    if (result.changes === 0) {
      throw new CheckoutError(`Order ${orderId} not found.`, 404, 'ORDER_NOT_FOUND');
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  normalizeItems(items: CheckoutItemInput[]): CheckoutItemInput[] {
    const aggregated = new Map<string, number>();

    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!item.productId || !Number.isInteger(quantity) || quantity <= 0) {
        throw new CheckoutError('Invalid checkout item payload.', 400, 'INVALID_ITEM', {
          item,
        });
      }

      aggregated.set(item.productId, (aggregated.get(item.productId) ?? 0) + quantity);
    }

    return [...aggregated.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
  }

  static defaultPath(): string {
    return path.join(process.cwd(), 'data', 'casecellshop.sqlite');
  }

  close(): void {
    this.db.close();
  }
}
