import 'server-only';

import { randomUUID } from 'node:crypto';

import { redis } from '@/core/redis/redisClient';
import {
  getDeploymentEnvironment,
  hashRateLimitIdentifier,
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
      reject(new Error('PUBLIC_BOOKING_RATE_LIMIT_TIMEOUT'));
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
  if (!Array.isArray(result) || result.length < 2) {
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

  if (allowed === 1) {
    return { allowed: true, reason: 'allowed' };
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
  const hasIp = Boolean(normalizedIp && normalizedIp !== 'unknown');

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

    return parseRedisResult(result)
      ?? { allowed: true, reason: 'unavailable' };
  } catch {
    return { allowed: true, reason: 'unavailable' };
  }
}
