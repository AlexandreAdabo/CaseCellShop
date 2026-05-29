import type { ProductCache } from '../infrastructure/cache/product-cache.js';
import type { AppLogger } from '../infrastructure/logger.js';
import { Metrics } from '../infrastructure/metrics.js';
import type { Product } from '../domain/types.js';
import { ProductRepository } from '../repositories/product.repository.js';

export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly cache: ProductCache<Product[]>,
    private readonly metrics: Metrics,
    private readonly logger: AppLogger,
  ) {}

  async getProducts(): Promise<Product[]> {
    const cached = await this.cache.get();
    if (cached !== null) {
      this.metrics.increment('cacheHit');
      this.logger.info({ itemCount: cached.length }, 'products.cache.hit');
      return cached;
    }

    this.metrics.increment('cacheMiss');
    const products = this.productRepository.listProducts();
    await this.cache.set(products);

    this.logger.info({
      itemCount: products.length,
    }, 'products.cache.miss');

    return products;
  }
}
