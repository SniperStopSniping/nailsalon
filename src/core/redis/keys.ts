// =============================================================================
// REDIS KEY HELPERS
// =============================================================================
// Deterministic key generation to prevent typos and ensure consistency.
// =============================================================================

/**
 * Rate limit key for presign requests.
 * TTL: 3600 seconds (1 hour)
 * Limit: 100 requests per hour per tech
 */
export function getRateLimitKey(techId: string): string {
  return `rate_limit:presign:${techId}`;
}

/**
 * Presign replay protection key.
 * TTL: 900 seconds (15 minutes)
 * Value: objectKey
 */
export function getPresignKey(appointmentId: string, kind: 'before' | 'after'): string {
  return `presign:${appointmentId}:${kind}`;
}

/**
 * Idempotency key for upload confirm.
 * TTL: 86400 seconds (24 hours)
 * Value: JSON string of successful response
 */
export function getIdempotencyKey(idempotencyKey: string): string {
  return `idempotency:confirm:${idempotencyKey}`;
}

// =============================================================================
// TTL CONSTANTS
// =============================================================================

export const TTL = {
  RATE_LIMIT: 3600, // 1 hour
  PRESIGN: 900, // 15 minutes
  IDEMPOTENCY: 86400, // 24 hours
} as const;

/**
 * Get rate limit max from feature flags.
 * This allows runtime configuration via environment variables.
 */
export function getRateLimitMax(): number {
  // Dynamic import to avoid circular dependency
  // Falls back to 50 if flag not available
  const envValue = process.env.MAX_PRESIGNS_PER_HOUR;
  return envValue ? Number(envValue) : 50;
}

export const LIMITS = {
  RATE_LIMIT_MAX: 100, // Legacy constant, use getRateLimitMax() instead
} as const;
