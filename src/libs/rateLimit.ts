/**
 * Simple In-Memory Rate Limiter
 *
 * For production, this should use Redis or similar.
 * This in-memory implementation works for single-instance deployments.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory stores (will reset on server restart)
const ipLimits = new Map<string, RateLimitEntry>();
const phoneLimitsMinute = new Map<string, RateLimitEntry>();
const phoneLimitsDay = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries periodically
 */
function cleanupExpired(store: Map<string, RateLimitEntry>) {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}

// Cleanup every 5 minutes
setInterval(() => {
  cleanupExpired(ipLimits);
  cleanupExpired(phoneLimitsMinute);
  cleanupExpired(phoneLimitsDay);
}, 5 * 60 * 1000);

/**
 * Check and increment rate limit
 * Returns true if request is allowed, false if rate limited
 */
function checkLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // Window expired or new key - allow and start new window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    // Rate limited
    return false;
  }

  // Increment count
  entry.count++;
  return true;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  perIpPerMinute?: number;
  perPhonePerMinute?: number;
  perPhonePerDay?: number;
}

const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  perIpPerMinute: 5,
  perPhonePerMinute: 3,
  perPhonePerDay: 10,
};

/**
 * Check rate limits for OTP requests
 * Returns { allowed: true } or { allowed: false, retryAfterMs: number }
 */
export function checkOtpRateLimit(
  ip: string,
  phone: string,
  config: RateLimitConfig = {},
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const MINUTE_MS = 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Check IP limit
  if (!checkLimit(ipLimits, ip, cfg.perIpPerMinute, MINUTE_MS)) {
    const entry = ipLimits.get(ip);
    return {
      allowed: false,
      retryAfterMs: entry ? entry.resetAt - Date.now() : MINUTE_MS,
    };
  }

  // Check phone per-minute limit
  if (!checkLimit(phoneLimitsMinute, phone, cfg.perPhonePerMinute, MINUTE_MS)) {
    const entry = phoneLimitsMinute.get(phone);
    return {
      allowed: false,
      retryAfterMs: entry ? entry.resetAt - Date.now() : MINUTE_MS,
    };
  }

  // Check phone per-day limit
  if (!checkLimit(phoneLimitsDay, phone, cfg.perPhonePerDay, DAY_MS)) {
    const entry = phoneLimitsDay.get(phone);
    return {
      allowed: false,
      retryAfterMs: entry ? entry.resetAt - Date.now() : DAY_MS,
    };
  }

  return { allowed: true };
}

/**
 * Get client IP from request
 * Handles various proxy headers
 */
export function getClientIp(request: Request): string {
  // Check common proxy headers
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Take the first IP in the chain
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback
  return 'unknown';
}
