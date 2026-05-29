import type { NextFunction, Request, Response } from 'express';

export function errorLoggerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const log = (req as any).log;
  if (log) {
    log.error({ err }, 'http.request.error');
  }

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
}
