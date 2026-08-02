import 'server-only';

import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { logWarn } from '@/core/logging/logger';
import { redis } from '@/core/redis/redisClient';
import {
  getDeploymentEnvironment,
  hashRateLimitIdentifier,
  isHostedDeployment,
} from '@/libs/authConfig.server';

export const PUBLIC_BOOKING_RATE_LIMITS = {
  ipBurst: {
    limit: 10,
    windowSeconds: 60,
  },
  ipSustained: {
    limit: 30,
    windowSeconds: 15 * 60,
  },
  contact: {
    limit: 5,
    windowSeconds: 15 * 60,
  },
} as const;

export const PUBLIC_BOOKING_RATE_LIMIT_TIMEOUT_MS = 500;

const UNKNOWN_CLIENT_IP = 'unknown';
const MAX_FORWARDED_HEADER_LENGTH = 1024;
const MAX_FORWARDED_HEADER_ENTRIES = 16;
const DEGRADATION_LOG_COOLDOWN_MS = 5 * 60 * 1000;

type ForwardedHeaderResult
  = | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'valid'; clientIp: string };

type DegradationStage = 'configuration' | 'redis_eval' | 'response_parse';
type DegradationCategory
  = | 'backend_unavailable'
  | 'timeout'
  | 'operation_failed'
  | 'malformed_response';

const degradationLastLoggedAt = new Map<string, number>();

class PublicBookingRateLimitTimeoutError extends Error {}

function normalizeIpAddress(value: string): string | null {
  const candidate = value.trim();
  if (
    !candidate
    || candidate.length > 64
    || candidate.includes('%')
  ) {
    return null;
  }

  const version = isIP(candidate);
  if (version === 4) {
    return candidate;
  }
  if (version !== 6) {
    return null;
  }

  try {
    // URL parsing provides a built-in, deterministic compressed/lowercase
    // representation after node:net has strictly validated the address.
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    const normalized = hostname.slice(1, -1).toLowerCase();
    const mappedIpv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(
      normalized,
    );
    if (!mappedIpv4) {
      return normalized;
    }

    const high = Number.parseInt(mappedIpv4[1]!, 16);
    const low = Number.parseInt(mappedIpv4[2]!, 16);
    return [
      high >>> 8,
      high & 0xFF,
      low >>> 8,
      low & 0xFF,
    ].join('.');
  } catch {
    return null;
  }
}

/**
 * Forwarded chains are read from the trusted proxy inward. Selecting the
 * rightmost strictly valid entry prevents caller-controlled leftmost values
 * from becoming the rate-limit identity.
 */
function parseForwardedHeader(value: string | null): ForwardedHeaderResult {
  if (value === null) {
    return { status: 'missing' };
  }
  if (!value || value.length > MAX_FORWARDED_HEADER_LENGTH) {
    return { status: 'invalid' };
  }

  const entries = value.split(',');
  if (
    entries.length === 0
    || entries.length > MAX_FORWARDED_HEADER_ENTRIES
  ) {
    return { status: 'invalid' };
  }

  const normalized = entries.map(normalizeIpAddress);
  if (normalized.includes(null)) {
    return { status: 'invalid' };
  }

  return {
    status: 'valid',
    clientIp: normalized.at(-1)!,
  };
}

function parseSingleIpHeader(value: string | null): ForwardedHeaderResult {
  if (value === null) {
    return { status: 'missing' };
  }
  const normalized = normalizeIpAddress(value);
  return normalized
    ? { status: 'valid', clientIp: normalized }
    : { status: 'invalid' };
}

/**
 * Resolves the public-booking IP without changing the shared rate-limit
 * helper used by unrelated owner, billing, recovery and authentication
 * routes. Vercel-specific headers are platform-calculated and take priority.
 * Generic X-Forwarded-For is considered only when those headers are absent,
 * and is parsed from the trusted-proxy side rather than the caller side.
 */
export function getPublicBookingClientIp(request: Pick<Request, 'headers'>): string {
  if (process.env.VERCEL_ENV) {
    const vercelForwardedFor = parseForwardedHeader(
      request.headers.get('x-vercel-forwarded-for'),
    );
    if (vercelForwardedFor.status === 'valid') {
      return vercelForwardedFor.clientIp;
    }

    const realIp = parseSingleIpHeader(request.headers.get('x-real-ip'));
    if (realIp.status === 'valid') {
      return realIp.clientIp;
    }

    // A malformed platform-specific value is an anomalous trust state. Do not
    // fall through from it to a generic header that a caller may have supplied.
    if (
      vercelForwardedFor.status === 'invalid'
      || realIp.status === 'invalid'
    ) {
      return UNKNOWN_CLIENT_IP;
    }
  }

  const forwardedFor = parseForwardedHeader(
    request.headers.get('x-forwarded-for'),
  );
  if (forwardedFor.status === 'valid') {
    return forwardedFor.clientIp;
  }

  // Retain the existing local/test x-real-ip fallback without treating a
  // caller-supplied x-vercel-* name as platform evidence off Vercel.
  if (!process.env.VERCEL_ENV) {
    const realIp = parseSingleIpHeader(request.headers.get('x-real-ip'));
    if (realIp.status === 'valid') {
      return realIp.clientIp;
    }
  }

  return UNKNOWN_CLIENT_IP;
}

function observeDegradation(
  stage: DegradationStage,
  category: DegradationCategory,
): void {
  if (!isHostedDeployment()) {
    return;
  }

  const key = `${stage}:${category}`;
  const now = Date.now();
  const lastLoggedAt = degradationLastLoggedAt.get(key);
  if (
    lastLoggedAt !== undefined
    && now - lastLoggedAt < DEGRADATION_LOG_COOLDOWN_MS
  ) {
    return;
  }
  degradationLastLoggedAt.set(key, now);

  try {
    logWarn('public_booking.rate_limit.degraded', { stage, category });
  } catch {
    // Observability must never turn a fail-open limiter into a booking outage.
  }
}

export function resetPublicBookingRateLimitObservabilityForTests(): void {
  degradationLastLoggedAt.clear();
}

/**
 * Atomically checks all applicable sliding windows before recording an
 * attempt. Denied attempts do not extend the cooldown. The booking route's
 * existing distributed idempotency lock ensures concurrent same-key requests
 * reach this check only once; failed retries intentionally consume quota.
 */
const checkRateLimitScript = `
local hasIp = ARGV[1] == '1'
local requestMember = ARGV[2]
local ipBurstLimit = tonumber(ARGV[3])
local ipBurstWindowMs = tonumber(ARGV[4])
local ipSustainedLimit = tonumber(ARGV[5])
local ipSustainedWindowMs = tonumber(ARGV[6])
local contactLimit = tonumber(ARGV[7])
local contactWindowMs = tonumber(ARGV[8])

local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)

local function inspectWindow(key, limit, windowMs, enabled)
  if not enabled then
    return { false, 0 }
  end

  redis.call('ZREMRANGEBYSCORE', key, '-inf', nowMs - windowMs)
  local count = redis.call('ZCARD', key)
  if count < limit then
    return { false, 0 }
  end

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = windowMs
  if oldest[2] then
    retryAfterMs = math.max(1, math.ceil(tonumber(oldest[2]) + windowMs - nowMs))
  end
  return { true, retryAfterMs }
end

local ipBurst = inspectWindow(KEYS[1], ipBurstLimit, ipBurstWindowMs, hasIp)
local ipSustained = inspectWindow(KEYS[2], ipSustainedLimit, ipSustainedWindowMs, hasIp)
local contact = inspectWindow(KEYS[3], contactLimit, contactWindowMs, true)

if ipBurst[1] or ipSustained[1] or contact[1] then
  return { 0, math.max(ipBurst[2], ipSustained[2], contact[2]) }
end

local function recordWindow(key, windowMs, enabled)
  if enabled then
    redis.call('ZADD', key, nowMs, requestMember)
    redis.call('PEXPIRE', key, windowMs + 1000)
  end
end

recordWindow(KEYS[1], ipBurstWindowMs, hasIp)
recordWindow(KEYS[2], ipSustainedWindowMs, hasIp)
recordWindow(KEYS[3], contactWindowMs, true)

return { 1, 0 }
`;

export type PublicBookingRateLimitResult
  = | {
    allowed: true;
    reason: 'allowed' | 'unavailable';
  }
  | {
    allowed: false;
    reason: 'rate_limited';
    retryAfterSeconds: number;
  };

type PublicBookingRateLimitInput = {
  salonId: string;
  clientIp: string;
  normalizedPhone: string;
};

async function settleBeforeDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new PublicBookingRateLimitTimeoutError());
    }, PUBLIC_BOOKING_RATE_LIMIT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function parseRedisResult(result: unknown): PublicBookingRateLimitResult | null {
  if (!Array.isArray(result) || result.length !== 2) {
    return null;
  }

  const allowed = Number(result[0]);
  const retryAfterMs = Number(result[1]);
  if (
    ![0, 1].includes(allowed)
    || !Number.isFinite(retryAfterMs)
    || retryAfterMs < 0
  ) {
    return null;
  }

  if (allowed === 1 && retryAfterMs === 0) {
    return { allowed: true, reason: 'allowed' };
  }

  if (allowed === 1) {
    return null;
  }

  if (retryAfterMs <= 0) {
    return null;
  }

  return {
    allowed: false,
    reason: 'rate_limited',
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

function buildKeys(input: PublicBookingRateLimitInput): {
  hasIp: boolean;
  keys: [string, string, string];
} {
  const scope = hashRateLimitIdentifier(
    `${getDeploymentEnvironment()}:${input.salonId}`,
  );
  // One cluster hash tag keeps the multi-key Lua script compatible with
  // Redis Cluster while retaining per-salon/deployment isolation.
  const prefix = `luster:public-booking:{${scope}}`;
  const normalizedIp = input.clientIp.trim().toLowerCase();
  const hasIp = Boolean(normalizedIp && normalizedIp !== UNKNOWN_CLIENT_IP);

  return {
    hasIp,
    keys: [
      hasIp
        ? `${prefix}:ip:burst:${hashRateLimitIdentifier(normalizedIp)}`
        : `${prefix}:ip:burst:disabled`,
      hasIp
        ? `${prefix}:ip:sustained:${hashRateLimitIdentifier(normalizedIp)}`
        : `${prefix}:ip:sustained:disabled`,
      `${prefix}:contact:${hashRateLimitIdentifier(input.normalizedPhone)}`,
    ],
  };
}

/**
 * Limits only validated new public-booking writes. Redis is the sole counter
 * authority so the result is shared by every serverless instance. Missing,
 * unhealthy, or malformed Redis responses fail open: a temporary limiter
 * outage must never become a customer-visible booking outage.
 */
export async function checkPublicBookingRateLimit(
  input: PublicBookingRateLimitInput,
): Promise<PublicBookingRateLimitResult> {
  if (!redis) {
    observeDegradation('configuration', 'backend_unavailable');
    return { allowed: true, reason: 'unavailable' };
  }

  const { hasIp, keys } = buildKeys(input);
  try {
    const result = await settleBeforeDeadline(
      redis.eval(
        checkRateLimitScript,
        keys.length,
        ...keys,
        hasIp ? '1' : '0',
        randomUUID(),
        PUBLIC_BOOKING_RATE_LIMITS.ipBurst.limit,
        PUBLIC_BOOKING_RATE_LIMITS.ipBurst.windowSeconds * 1000,
        PUBLIC_BOOKING_RATE_LIMITS.ipSustained.limit,
        PUBLIC_BOOKING_RATE_LIMITS.ipSustained.windowSeconds * 1000,
        PUBLIC_BOOKING_RATE_LIMITS.contact.limit,
        PUBLIC_BOOKING_RATE_LIMITS.contact.windowSeconds * 1000,
      ),
    );

    const parsed = parseRedisResult(result);
    if (!parsed) {
      observeDegradation('response_parse', 'malformed_response');
      return { allowed: true, reason: 'unavailable' };
    }
    return parsed;
  } catch (error) {
    observeDegradation(
      'redis_eval',
      error instanceof PublicBookingRateLimitTimeoutError
        ? 'timeout'
        : 'operation_failed',
    );
    return { allowed: true, reason: 'unavailable' };
  }
}
