import { TTLCache } from './ttl-cache.js';
import type { ProductCache } from './product-cache.js';

export class MemoryProductCache<T> implements ProductCache<T> {
  private readonly cache: TTLCache<T>;

  constructor(ttlMs: number) {
    this.cache = new TTLCache(ttlMs);
  }

  async get(): Promise<T | null> {
    return this.cache.get();
  }

  async set(value: T): Promise<void> {
    this.cache.set(value);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}
