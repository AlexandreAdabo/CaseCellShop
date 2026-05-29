import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import type { Metrics } from '../infrastructure/metrics.js';
import type { CheckoutController } from '../controllers/checkout.controller.js';
import type { ProductController } from '../controllers/product.controller.js';
import type { OrderController } from '../controllers/order.controller.js';

function loadOpenApiDocument(): unknown {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../openapi.json');
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

export function registerRoutes(
  app: Express,
  dependencies: {
    metrics: Metrics;
    queueDepth: () => Promise<number>;
    productController: ProductController;
    checkoutController: CheckoutController;
    orderController: OrderController;
  },
): void {
  const openApiDocument = loadOpenApiDocument() as Record<string, unknown>;

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    explorer: true,
    swaggerOptions: {
      docExpansion: 'list',
      displayRequestDuration: true,
    },
    customSiteTitle: 'CaseCellShop API Docs',
  }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });

  app.get('/metrics', async (_req, res) => {
    res.json({
      ...dependencies.metrics.snapshot(),
      queueDepth: await dependencies.queueDepth(),
    });
  });

  app.get('/products', dependencies.productController.getProducts);
  app.post('/checkout', dependencies.checkoutController.postCheckout);
  app.get('/orders/:orderId/status', dependencies.orderController.getOrderStatus);
}
