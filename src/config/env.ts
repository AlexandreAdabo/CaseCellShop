import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type AppEnv = {
  port: number;
  logLevel: string;
  cacheTtlMs: number | undefined;
  redisUrl: string | undefined;
};

const DEFAULT_PORT = 3000;

export function loadEnv(cwd = process.cwd()): AppEnv {
  const envPath = path.join(cwd, '.env');
  const fileValues = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};

  const portValue = readEnvValue('PORT', fileValues);
  const logLevelValue = readEnvValue('LOG_LEVEL', fileValues);
  const cacheTtlValue = readEnvValue('CACHE_TTL_MS', fileValues);
  const redisUrlValue = readEnvValue('REDIS_URL', fileValues);

  return {
    port: parsePositiveInteger(portValue, DEFAULT_PORT) ?? DEFAULT_PORT,
    logLevel: logLevelValue ?? 'info',
    cacheTtlMs: parsePositiveInteger(cacheTtlValue, undefined),
    redisUrl: redisUrlValue,
  };
}

export function parseEnvText(raw: string): Record<string, string> {
  return parseEnvFile(raw);
}

function readEnvValue(key: string, fileValues: Record<string, string>): string | undefined {
  const runtimeValue = process.env[key]?.trim();
  if (runtimeValue) {
    return runtimeValue;
  }

  const fileValue = fileValues[key]?.trim();
  return fileValue ? fileValue : undefined;
}

function parseEnvFile(raw: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (!key) {
      continue;
    }

    result[key] = stripQuotes(value);
  }

  return result;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number | undefined): number | undefined {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
