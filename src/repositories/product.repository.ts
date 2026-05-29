import type { Product } from '../domain/types.js';
import { SQLiteStore } from '../infrastructure/database/sqlite-store.js';

export class ProductRepository {
  constructor(private readonly store: SQLiteStore) {}

  listProducts(): Product[] {
    return this.store.listProducts();
  }

  getProduct(productId: string): Product | null {
    return this.store.getProduct(productId);
  }
}
