import type { ErrorBody } from '../domain/types.js';

export function createErrorBody(code: string, message: string, details?: unknown): ErrorBody {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}
