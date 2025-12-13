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

/**
 * Idempotency key for appointment booking creation.
 * Scoped by salonId to prevent cross-tenant collisions.
 * TTL: 900 seconds (15 minutes)
 * Value: JSON string of successful response + request body hash
 */
export function getBookingIdempotencyKey(salonId: string, idempotencyKey: string): string {
  return `idem:appointments:create:${salonId}:${idempotencyKey}`;
}

/**
 * Lock key for booking creation (prevents race condition).
 * Value: owner token (UUID) for atomic verification
 */
export function getBookingLockKey(salonId: string, idempotencyKey: string): string {
  return `lock:appointments:create:${salonId}:${idempotencyKey}`;
}

// =============================================================================
// TTL CONSTANTS (in seconds)
// =============================================================================

export const TTL = {
  RATE_LIMIT: 3600, // 1 hour
  PRESIGN: 900, // 15 minutes
  IDEMPOTENCY: 86400, // 24 hours
  BOOKING_IDEMPOTENCY: 900, // 15 minutes - prevents double-submit during booking flow
  // Lock TTL covers ONLY the critical DB path (no SMS/slow external calls)
  // Critical path: cache check → lock → DB insert → cache write
  // SMS and other slow work happens AFTER cache write (outside lock)
  BOOKING_LOCK: 15, // 15 seconds - pure DB work only
} as const;

// Derived constants for poll window (computed from TTL)
export const BOOKING_POLL_WINDOW_MS = (TTL.BOOKING_LOCK - 2) * 1000; // 2s buffer before TTL
export const BOOKING_LOCK_MS = TTL.BOOKING_LOCK * 1000;

/**
 * Lua script for atomic lock ownership verification + TTL extension.
 * Returns 1 if we own the lock (and extended TTL), 0 if not owner.
 * This prevents the race: GET token → TTL expires → another acquires → both proceed
 */
export const EXTEND_IF_OWNER_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  return 1
else
  return 0
end
`;

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
