import type { NextFunction, Request, Response } from 'express';
import type { AppLogger } from '../infrastructure/logger.js';

export function requestSummaryMiddleware(logger: AppLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on('finish', () => {
      logger.requestSummary?.({
        method: req.method,
        statusCode: res.statusCode,
        route: req.path,
      });

      (req as any).log?.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
        },
        'http.request.completed',
      );
    });

    next();
  };
}
