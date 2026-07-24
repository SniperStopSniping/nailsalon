import 'server-only';

import { redis } from '@/core/redis/redisClient';
import { hashRateLimitIdentifier } from '@/libs/authConfig.server';
import { serviceImageDeploymentScope } from '@/libs/serviceImageDeploymentScope.server';

export const SERVICE_IMAGE_PRESIGN_LIMIT = 20;
export const SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS = 60 * 60;

export type ServiceImagePresignRateLimitResult
  = | {
    allowed: true;
    remaining: number;
  }
  | {
    allowed: false;
    reason: 'rate_limited';
    retryAfterSeconds: number;
  }
  | {
    allowed: false;
    reason: 'unavailable';
  };

type MemoryCounter = {
  count: number;
  expiresAt: number;
};

const memoryCounters = new Map<string, MemoryCounter>();

const incrementScript = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { value, redis.call('TTL', KEYS[1]) }
`;

function rateLimitKey(salonId: string): string {
  return [
    'luster',
    'service-image-presign',
    serviceImageDeploymentScope(),
    'salon',
    hashRateLimitIdentifier(salonId),
  ].join(':');
}

function canUseMemoryFallback(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  const isLocalDevelopment
    = process.env.NODE_ENV === 'development'
    || process.env.APP_ENV === 'development';
  const isHostedProductionOrPreview
    = process.env.VERCEL_ENV === 'production'
    || process.env.VERCEL_ENV === 'preview'
    || process.env.APP_ENV === 'production'
    || process.env.APP_ENV === 'staging';

  return isLocalDevelopment && !isHostedProductionOrPreview;
}

function memoryIncrement(key: string): { count: number; retryAfterSeconds: number } {
  const now = Date.now();
  const current = memoryCounters.get(key);

  if (!current || current.expiresAt <= now) {
    memoryCounters.set(key, {
      count: 1,
      expiresAt: now + SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS * 1000,
    });
    return {
      count: 1,
      retryAfterSeconds: SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS,
    };
  }

  current.count += 1;
  return {
    count: current.count,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((current.expiresAt - now) / 1000),
    ),
  };
}

function resultForCounter(
  count: number,
  retryAfterSeconds: number,
): ServiceImagePresignRateLimitResult {
  if (count > SERVICE_IMAGE_PRESIGN_LIMIT) {
    return {
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  return {
    allowed: true,
    remaining: SERVICE_IMAGE_PRESIGN_LIMIT - count,
  };
}

function memoryResult(key: string): ServiceImagePresignRateLimitResult {
  const current = memoryIncrement(key);
  return resultForCounter(current.count, current.retryAfterSeconds);
}

function parseRedisCounter(result: unknown): {
  count: number;
  retryAfterSeconds: number;
} | null {
  if (!Array.isArray(result) || result.length < 2) {
    return null;
  }

  const count = Number(result[0]);
  const retryAfterSeconds = Number(result[1]);
  if (
    !Number.isInteger(count)
    || count <= 0
    || !Number.isInteger(retryAfterSeconds)
    || retryAfterSeconds <= 0
  ) {
    return null;
  }

  return { count, retryAfterSeconds };
}

/**
 * Bound signed service-image upload authorizations per authenticated salon.
 *
 * Hosted Preview and Production deployments fail closed when Redis is absent
 * or unhealthy. The process-local fallback exists only for local development
 * and tests, where multiple serverless instances are not involved.
 */
export async function checkServiceImagePresignRateLimit(
  salonId: string,
): Promise<ServiceImagePresignRateLimitResult> {
  const key = rateLimitKey(salonId);

  if (!redis) {
    return canUseMemoryFallback()
      ? memoryResult(key)
      : { allowed: false, reason: 'unavailable' };
  }

  try {
    const rawResult = await redis.eval(
      incrementScript,
      1,
      key,
      SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS,
    );
    const counter = parseRedisCounter(rawResult);

    if (!counter) {
      throw new Error('Invalid Redis rate-limit response');
    }

    return resultForCounter(counter.count, counter.retryAfterSeconds);
  } catch {
    return canUseMemoryFallback()
      ? memoryResult(key)
      : { allowed: false, reason: 'unavailable' };
  }
}

export function resetServiceImagePresignRateLimitForTests(): void {
  memoryCounters.clear();
}
