import type { ProductCache } from './product-cache.js';

export type RedisLikeClient = {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): Promise<unknown> | void;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  isOpen?: boolean;
  isReady?: boolean;
};

export class RedisProductCache<T> implements ProductCache<T> {
  constructor(
    readonly client: RedisLikeClient,
    private readonly cacheKey: string,
    private readonly ttlMs: number,
  ) {}

  async get(): Promise<T | null> {
    const rawValue = await this.client.get(this.cacheKey);
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue) as T;
    } catch {
      await this.client.del(this.cacheKey);
      return null;
    }
  }

  async set(value: T): Promise<void> {
    await this.client.set(this.cacheKey, JSON.stringify(value), {
      PX: this.ttlMs,
    });
  }

  async clear(): Promise<void> {
    await this.client.del(this.cacheKey);
  }
}
