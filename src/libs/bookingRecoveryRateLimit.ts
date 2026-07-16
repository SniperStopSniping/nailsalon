import 'server-only';

import { redis } from '@/core/redis/redisClient';
import { hashRateLimitIdentifier, isHostedDeployment } from '@/libs/authConfig.server';
import { hashOpaqueToken } from '@/libs/lusterSecurity';

const WINDOW_SECONDS = 15 * 60;
const IP_LIMIT = 10;
const EMAIL_LIMIT = 3;
const memory = new Map<string, { count: number; expiresAt: number }>();

const incrementScript = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { value, redis.call('TTL', KEYS[1]) }
`;

function memoryIncrement(key: string) {
  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 });
    return 1;
  }
  current.count += 1;
  return current.count;
}

export async function checkBookingRecoveryRateLimit(ip: string, salonId: string, email: string) {
  const ipKey = `luster:booking-recovery:ip:${hashRateLimitIdentifier(ip || 'unknown')}`;
  const emailKey = `luster:booking-recovery:email:${salonId}:${hashOpaqueToken(email)}`;
  if (!redis) {
    if (isHostedDeployment()) {
      throw new Error('RECOVERY_RATE_LIMIT_UNAVAILABLE');
    }
    return memoryIncrement(ipKey) <= IP_LIMIT && memoryIncrement(emailKey) <= EMAIL_LIMIT;
  }
  try {
    const [ipResult, emailResult] = await Promise.all([
      redis.eval(incrementScript, 1, ipKey, WINDOW_SECONDS) as Promise<[number, number]>,
      redis.eval(incrementScript, 1, emailKey, WINDOW_SECONDS) as Promise<[number, number]>,
    ]);
    return Number(ipResult[0]) <= IP_LIMIT && Number(emailResult[0]) <= EMAIL_LIMIT;
  } catch {
    if (isHostedDeployment()) {
      throw new Error('RECOVERY_RATE_LIMIT_UNAVAILABLE');
    }
    return false;
  }
}
