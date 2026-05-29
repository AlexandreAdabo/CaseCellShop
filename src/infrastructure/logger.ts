import pino from 'pino';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const logPath = process.env.LOG_FILE || 'req.log';
const logStream = createWriteStream(resolve(logPath), { flags: 'a' });

export type AppLogger = pino.Logger & {
  requestSummary?: (input: {
    method: string;
    statusCode: number;
    route: string;
    at?: Date;
  }) => void;
};

const serializers = {
  err: (err: Error) => ({
    type: err.name,
    message: err.message,
    stack: err.stack,
    ...('code' in err ? { code: (err as any).code } : {}),
    ...('statusCode' in err ? { statusCode: (err as any).statusCode } : {}),
    ...('details' in err ? { details: (err as any).details } : {}),
  }),
};

export function createLogger(base: pino.Bindings = {}): AppLogger {
  const logger = pino(
    {
      base,
      level: process.env.LOG_LEVEL ?? 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers,
    },
    logStream,
  ) as AppLogger;

  logger.requestSummary = ({ method, statusCode, route, at = new Date() }) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    console.log(`[${timestamp}] ${method} ${statusCode} ${route}`);
  };

  return logger;
}

export function createRequestLogger(
  parent: pino.Logger,
  context: { requestId: string; correlationId: string; traceId: string },
): pino.Logger {
  return parent.child({
    requestId: context.requestId,
    correlationId: context.correlationId,
    traceId: context.traceId,
  });
}
