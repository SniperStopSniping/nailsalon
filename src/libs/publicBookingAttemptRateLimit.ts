import 'server-only';

import { redis } from '@/core/redis/redisClient';
import { hashRateLimitIdentifier, isHostedDeployment } from '@/libs/authConfig.server';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 60;
const memory = new Map<string, { count: number; expiresAt: number }>();
const incrementScript = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return value
`;

/** Shared admission for status reconciliation and durable attempt registration. */
export async function checkPublicBookingAttemptRateLimit(ip: string, salonId: string): Promise<boolean> {
  const identity = hashRateLimitIdentifier(ip || 'unknown');
  const keys = [`luster:booking-attempt:ip:${identity}`, `luster:booking-attempt:salon:${salonId}:${identity}`];
  const client = redis;
  if (client) {
    try {
      const counts = await Promise.all(keys.map(key => client.eval(incrementScript, 1, key, WINDOW_SECONDS)));
      return counts.every(count => Number(count) <= MAX_REQUESTS);
    } catch {
      throw new Error('BOOKING_ATTEMPT_RATE_LIMIT_UNAVAILABLE');
    }
  }
  if (isHostedDeployment()) {
    throw new Error('BOOKING_ATTEMPT_RATE_LIMIT_UNAVAILABLE');
  }
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) {
      memory.delete(key);
    }
  }
  return keys.map((key) => {
    const current = memory.get(key) ?? { count: 0, expiresAt: now + WINDOW_SECONDS * 1000 };
    current.count += 1;
    memory.set(key, current);
    return current.count;
  }).every(count => count <= MAX_REQUESTS);
}
