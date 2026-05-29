import type { Request, Response } from 'express';
import type { CheckoutRequest, RequestContext } from '../domain/types.js';
import { CheckoutError } from '../domain/errors.js';
import { createErrorBody } from './http-response.js';
import { CheckoutService } from '../services/checkout.service.js';

type RequestWithContext = Request & {
  requestContext?: RequestContext;
};

function readIdempotencyKey(req: Request): string | null {
  const headerKey = req.header('idempotency-key');
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }

  return null;
}

export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  postCheckout = (req: Request, res: Response): void => {
    const typedReq = req as RequestWithContext;
    const context = typedReq.requestContext;
    const body = req.body as CheckoutRequest | undefined;
    const items = Array.isArray(body?.items) ? body.items : [];
    const idempotencyKey = readIdempotencyKey(req);

    if (!context) {
      res.status(500).json(createErrorBody('INTERNAL_ERROR', 'Missing request context.'));
      return;
    }

    if (!idempotencyKey) {
      res.status(400).json(createErrorBody('MISSING_IDEMPOTENCY_KEY', 'The idempotency-key header is required.'));
      return;
    }

    if (items.length === 0) {
      res.status(400).json(createErrorBody('INVALID_REQUEST', 'Checkout requires at least one item.'));
      return;
    }

    try {
      const result = this.checkoutService.createCheckout(
        {
          items,
        },
        idempotencyKey,
        context,
      );

      res.status(202).json({
        orderId: result.orderId,
        status: result.status,
        totalCents: result.totalCents,
        ...(result.idempotencyKey ? { idempotencyKey: result.idempotencyKey } : {}),
        statusUrl: `/orders/${result.orderId}/status`,
      });
    } catch (error) {
      if (error instanceof CheckoutError) {
        const checkoutError = error;
        (req as any).log?.warn(
          { err: checkoutError },
          'checkout.validation.error',
        );
        res.status(checkoutError.statusCode).json(createErrorBody(checkoutError.code, checkoutError.message, checkoutError.details));
        return;
      }

      res.status(500).json(createErrorBody('INTERNAL_ERROR', 'Unexpected error while creating checkout.'));
    }
  };
}
