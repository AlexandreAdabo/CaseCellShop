import type { Request, Response } from 'express';
import { ProductService } from '../services/product.service.js';

export class ProductController {
  constructor(private readonly productService: ProductService) {}

  getProducts = async (_req: Request, res: Response): Promise<void> => {
    const products = await this.productService.getProducts();
    res.json({ products });
  };
}
