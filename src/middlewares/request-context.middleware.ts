import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type pino from 'pino';
import type { RequestContext } from '../domain/types.js';
import { createRequestLogger } from '../infrastructure/logger.js';

type RequestWithContext = Request & {
  requestContext?: RequestContext;
  log?: pino.Logger;
};

export function requestContextMiddleware(parentLogger: pino.Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const typedReq = req as RequestWithContext;
    const requestId = req.header('x-request-id')?.trim() || randomUUID();
    const correlationId = req.header('x-correlation-id')?.trim() || requestId;
    const traceId = req.header('x-trace-id')?.trim() || requestId;

    const context: RequestContext = {
      requestId,
      correlationId,
      traceId,
    };

    typedReq.requestContext = context;
    typedReq.log = createRequestLogger(parentLogger, context);

    res.setHeader('x-request-id', requestId);
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-trace-id', traceId);
    next();
  };
}
