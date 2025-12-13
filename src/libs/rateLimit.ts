/**
 * Simple In-Memory Rate Limiter
 *
 * For production, this should use Redis or similar.
 * This in-memory implementation works for single-instance deployments.
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// In-memory stores (will reset on server restart)
const ipLimits = new Map<string, RateLimitEntry>();
const phoneLimitsMinute = new Map<string, RateLimitEntry>();
const phoneLimitsDay = new Map<string, RateLimitEntry>();

// Generic endpoint rate limits (keyed by "endpoint:identifier")
const endpointLimits = new Map<string, RateLimitEntry>();

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
  cleanupExpired(endpointLimits);
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

function getRetryAfter(store: Map<string, RateLimitEntry>, key: string, defaultMs: number): number {
  const entry = store.get(key);
  return entry ? Math.max(0, entry.resetAt - Date.now()) : defaultMs;
}

/**
 * Rate limit configuration
 */
export type RateLimitConfig = {
  perIpPerMinute?: number;
  perPhonePerMinute?: number;
  perPhonePerDay?: number;
};

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

// =============================================================================
// GENERIC ENDPOINT RATE LIMITER
// =============================================================================

/**
 * Rate limit presets for different endpoint types
 */
export const RATE_LIMIT_PRESETS = {
  /** OTP/auth - strict limits (already handled by checkOtpRateLimit) */
  AUTH: { maxRequests: 5, windowMs: 60 * 1000 },
  /** Reviews - prevent spam (5 per minute per IP) */
  REVIEW: { maxRequests: 5, windowMs: 60 * 1000 },
  /** Referral claim - prevent abuse (10 per minute per IP) */
  REFERRAL: { maxRequests: 10, windowMs: 60 * 1000 },
  /** Billing checkout - prevent session abuse (10 per minute per IP) */
  BILLING: { maxRequests: 10, windowMs: 60 * 1000 },
  /** General API - loose limits (60 per minute per IP) */
  GENERAL: { maxRequests: 60, windowMs: 60 * 1000 },
} as const;

export type RateLimitPreset = keyof typeof RATE_LIMIT_PRESETS;

/**
 * Check rate limit for a specific endpoint.
 * Returns { allowed: true } or { allowed: false, retryAfterMs: number }
 *
 * @param endpoint - Unique identifier for the endpoint (e.g., 'reviews', 'billing/checkout')
 * @param identifier - Client identifier (usually IP, or IP:phone for auth)
 * @param preset - Rate limit preset to use
 */
export function checkEndpointRateLimit(
  endpoint: string,
  identifier: string,
  preset: RateLimitPreset = 'GENERAL',
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const config = RATE_LIMIT_PRESETS[preset];
  const key = `${endpoint}:${identifier}`;

  if (!checkLimit(endpointLimits, key, config.maxRequests, config.windowMs)) {
    return {
      allowed: false,
      retryAfterMs: getRetryAfter(endpointLimits, key, config.windowMs),
    };
  }

  return { allowed: true };
}

/**
 * Check rate limit for auth-sensitive endpoints using BOTH IP and phone.
 * This prevents attackers from rotating IPs to bypass limits.
 *
 * @param endpoint - Unique identifier for the endpoint
 * @param ip - Client IP address
 * @param phone - Phone number (normalized)
 * @param preset - Rate limit preset to use
 */
export function checkAuthEndpointRateLimit(
  endpoint: string,
  ip: string,
  phone: string,
  preset: RateLimitPreset = 'REFERRAL',
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const config = RATE_LIMIT_PRESETS[preset];

  // Check IP-based limit
  const ipKey = `${endpoint}:ip:${ip}`;
  if (!checkLimit(endpointLimits, ipKey, config.maxRequests, config.windowMs)) {
    return {
      allowed: false,
      retryAfterMs: getRetryAfter(endpointLimits, ipKey, config.windowMs),
    };
  }

  // Check phone-based limit (prevents IP rotation attacks)
  const phoneKey = `${endpoint}:phone:${phone}`;
  if (!checkLimit(endpointLimits, phoneKey, config.maxRequests, config.windowMs)) {
    return {
      allowed: false,
      retryAfterMs: getRetryAfter(endpointLimits, phoneKey, config.windowMs),
    };
  }

  return { allowed: true };
}

/**
 * Create a 429 response for rate limiting
 */
export function rateLimitResponse(retryAfterMs: number): Response {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return Response.json(
    {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        retryAfterMs,
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
      },
    },
  );
}
