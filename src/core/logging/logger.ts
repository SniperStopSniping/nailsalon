/**
 * Structured Logging Helper
 *
 * Thin wrapper over the existing pino logger from src/libs/Logger.ts.
 * Provides consistent event-based logging with safe payload sanitization.
 *
 * Usage:
 *   logInfo('autopost.job.started', { jobId, platform });
 *   logError('autopost.job.failed', { jobId, error: err.message });
 *
 * Rules:
 * - Never log tokens, cookies, or secrets
 * - Always include event name for searchability
 * - Include requestId if available
 */

import { logger as pinoLogger } from '@/libs/Logger';

// =============================================================================
// TYPES
// =============================================================================

type LogPayload = {
  [key: string]: unknown;
  // Explicitly forbidden keys (will be stripped)
  // token?: never;
  // cookie?: never;
  // secret?: never;
  // password?: never;
};

// =============================================================================
// SANITIZATION
// =============================================================================

const FORBIDDEN_KEYS = new Set([
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'cookie',
  'cookies',
  'secret',
  'password',
  'apiKey',
  'api_key',
  'authorization',
]);

/**
 * Remove sensitive keys from payload before logging.
 * This is a safety net - callers should avoid passing secrets in the first place.
 */
function sanitizePayload(payload: LogPayload): LogPayload {
  const sanitized: LogPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively sanitize nested objects (one level deep)
      sanitized[key] = sanitizePayload(value as LogPayload);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// =============================================================================
// LOGGING FUNCTIONS
// =============================================================================

/**
 * Log an info-level event.
 *
 * @param event - Dot-separated event name (e.g., 'autopost.job.started')
 * @param payload - Additional context (will be sanitized)
 */
export function logInfo(event: string, payload: LogPayload = {}): void {
  const sanitized = sanitizePayload(payload);
  pinoLogger.info({ event, ...sanitized });
}

/**
 * Log a warning-level event.
 *
 * @param event - Dot-separated event name (e.g., 'autopost.job.slow')
 * @param payload - Additional context (will be sanitized)
 */
export function logWarn(event: string, payload: LogPayload = {}): void {
  const sanitized = sanitizePayload(payload);
  pinoLogger.warn({ event, ...sanitized });
}

/**
 * Log an error-level event.
 *
 * @param event - Dot-separated event name (e.g., 'autopost.job.failed')
 * @param payload - Additional context (will be sanitized)
 */
export function logError(event: string, payload: LogPayload = {}): void {
  const sanitized = sanitizePayload(payload);
  pinoLogger.error({ event, ...sanitized });
}

/**
 * Create a child logger with bound context (e.g., requestId).
 * Useful for tracing a single request across multiple log lines.
 *
 * @param context - Context to bind to all logs from this logger
 */
export function createContextLogger(context: LogPayload) {
  const sanitizedContext = sanitizePayload(context);

  return {
    info: (event: string, payload: LogPayload = {}) => {
      pinoLogger.info({ event, ...sanitizedContext, ...sanitizePayload(payload) });
    },
    warn: (event: string, payload: LogPayload = {}) => {
      pinoLogger.warn({ event, ...sanitizedContext, ...sanitizePayload(payload) });
    },
    error: (event: string, payload: LogPayload = {}) => {
      pinoLogger.error({ event, ...sanitizedContext, ...sanitizePayload(payload) });
    },
  };
}
