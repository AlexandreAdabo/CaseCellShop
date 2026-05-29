import { createClient, type RedisClientOptions } from 'redis';
import type { AppLogger } from '../logger.js';
import type { ProductCache } from './product-cache.js';
import { MemoryProductCache } from './memory-product-cache.js';
import { RedisProductCache, type RedisLikeClient } from './redis-product-cache.js';

export type ProductCacheBackend = 'redis' | 'memory';

export type RedisClientFactory = (options: RedisClientOptions) => RedisLikeClient;

export type ProductCacheManagerOptions = {
  ttlMs: number;
  logger: AppLogger;
  redisUrl?: string;
  redisConnectTimeoutMs?: number;
  cacheKey?: string;
  redisClientFactory?: RedisClientFactory;
};

export class ProductCacheManager<T> implements ProductCache<T> {
  backend: ProductCacheBackend = 'memory';

  private readonly memoryCache: MemoryProductCache<T>;
  private readonly redisCache: RedisProductCache<T> | null;
  private readonly initialization: Promise<void>;
  private connected = false;

  private constructor(
    ttlMs: number,
    private readonly logger: AppLogger,
    redisUrl: string | undefined,
    redisConnectTimeoutMs: number,
    cacheKey: string,
    redisClientFactory: RedisClientFactory,
  ) {
    this.memoryCache = new MemoryProductCache<T>(ttlMs);

    if (!redisUrl) {
      this.redisCache = null;
      this.initialization = Promise.resolve();
      this.logger.info({ cacheBackend: 'memory' }, 'products.cache.backend.memory');
      return;
    }

    const client = redisClientFactory({
      url: redisUrl,
      socket: {
        connectTimeout: redisConnectTimeoutMs,
      },
    });

    this.redisCache = new RedisProductCache<T>(client, cacheKey, ttlMs);
    this.initialization = this.initializeRedis(client, redisUrl);
  }

  static async create<T>(options: ProductCacheManagerOptions): Promise<ProductCacheManager<T>> {
    const manager = new ProductCacheManager<T>(
      options.ttlMs,
      options.logger,
      options.redisUrl,
      options.redisConnectTimeoutMs ?? 1000,
      options.cacheKey ?? 'products:list',
      options.redisClientFactory ?? ((clientOptions) => createClient(clientOptions)),
    );

    await manager.initialization;
    return manager;
  }

  async get(): Promise<T | null> {
    if (this.connected && this.redisCache) {
      try {
        const value = await this.redisCache.get();
        if (value !== null) {
          await this.memoryCache.set(value);
        } else {
          await this.memoryCache.clear();
        }
        return value;
      } catch (error) {
        this.failoverToMemory(error);
      }
    }

    return this.memoryCache.get();
  }

  async set(value: T): Promise<void> {
    if (this.connected && this.redisCache) {
      try {
        await this.redisCache.set(value);
        await this.memoryCache.set(value);
        return;
      } catch (error) {
        this.failoverToMemory(error);
      }
    }

    await this.memoryCache.set(value);
  }

  async clear(): Promise<void> {
    if (this.connected && this.redisCache) {
      try {
        await this.redisCache.clear();
        await this.memoryCache.clear();
        return;
      } catch (error) {
        this.failoverToMemory(error);
      }
    }

    await this.memoryCache.clear();
  }

  async dispose(): Promise<void> {
    if (!this.redisCache) {
      return;
    }

    const client = this.getRedisClient();
    if (client && (client.isOpen ?? this.connected)) {
      await client.quit();
    }
  }

  private async initializeRedis(client: RedisLikeClient, redisUrl: string): Promise<void> {
    try {
      await client.connect();
      this.connected = true;
      this.backend = 'redis';
      this.logger.info({ redisUrl, cacheBackend: 'redis' }, 'products.cache.backend.redis');
    } catch (error) {
      this.connected = false;
      this.logger.warn({
        redisUrl,
        cacheBackend: 'memory',
        error: error instanceof Error ? { message: error.message, name: error.name } : { message: String(error) },
      }, 'products.cache.redis_unavailable');
      if (typeof client.disconnect === 'function') {
        await client.disconnect();
      }
    }
  }

  private failoverToMemory(error: unknown): void {
    if (this.connected) {
      this.connected = false;
      this.backend = 'memory';
      this.logger.warn({
        cacheBackend: 'memory',
        error: error instanceof Error ? { message: error.message, name: error.name } : { message: String(error) },
      }, 'products.cache.redis_failover');
    }
  }

  private getRedisClient(): RedisLikeClient | null {
    if (!this.redisCache) {
      return null;
    }

    return this.redisCache.client;
  }
}
