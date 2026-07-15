import 'server-only';

import type Redis from 'ioredis';

import { redis } from '@/core/redis/redisClient';

import { hashRateLimitIdentifier, isHostedDeployment } from './authConfig.server';

const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 30 * 60;
const IP_ATTEMPT_LIMIT = 5;
const ACCOUNT_FAILURE_LIMIT = 10;

type MemoryCounter = { count: number; expiresAt: number };
const memoryCounters = new Map<string, MemoryCounter>();

const incrementScript = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { value, ttl }
`;

function key(kind: 'ip' | 'account' | 'lock', identifier: string): string {
  return `luster:super-admin-auth:${kind}:${hashRateLimitIdentifier(identifier)}`;
}

function memoryIncrement(counterKey: string, ttlSeconds: number): { count: number; ttl: number } {
  const now = Date.now();
  const existing = memoryCounters.get(counterKey);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(counterKey, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return { count: 1, ttl: ttlSeconds };
  }
  existing.count += 1;
  return { count: existing.count, ttl: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)) };
}

async function redisIncrement(client: Redis, counterKey: string, ttlSeconds: number) {
  const result = await client.eval(incrementScript, 1, counterKey, ttlSeconds) as [number, number];
  return { count: Number(result[0]), ttl: Math.max(1, Number(result[1])) };
}

async function requireRedis(): Promise<Redis | null> {
  if (!redis) {
    if (isHostedDeployment()) {
      throw new Error('AUTH_RATE_LIMIT_UNAVAILABLE');
    }
    return null;
  }

  try {
    await redis.ping();
    return redis;
  } catch {
    if (isHostedDeployment()) {
      throw new Error('AUTH_RATE_LIMIT_UNAVAILABLE');
    }
    return null;
  }
}

export type LoginAttemptResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: 'ip_limit' | 'account_locked' };

export async function beginSuperAdminLoginAttempt(ip: string, configuredAccount: string): Promise<LoginAttemptResult> {
  const client = await requireRedis();
  const ipKey = key('ip', ip || 'unknown');
  const accountLockKey = key('lock', configuredAccount);

  if (client) {
    const lockTtl = await client.ttl(accountLockKey);
    if (lockTtl > 0) {
      return { allowed: false, retryAfterSeconds: lockTtl, reason: 'account_locked' };
    }
    const current = await redisIncrement(client, ipKey, WINDOW_SECONDS);
    if (current.count > IP_ATTEMPT_LIMIT) {
      return { allowed: false, retryAfterSeconds: current.ttl, reason: 'ip_limit' };
    }
    return { allowed: true };
  }

  const lock = memoryCounters.get(accountLockKey);
  if (lock && lock.expiresAt > Date.now()) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((lock.expiresAt - Date.now()) / 1000)),
      reason: 'account_locked',
    };
  }
  const current = memoryIncrement(ipKey, WINDOW_SECONDS);
  return current.count > IP_ATTEMPT_LIMIT
    ? { allowed: false, retryAfterSeconds: current.ttl, reason: 'ip_limit' }
    : { allowed: true };
}

export async function recordSuperAdminLoginFailure(configuredAccount: string): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const client = await requireRedis();
  const failureKey = key('account', configuredAccount);
  const lockKey = key('lock', configuredAccount);

  if (client) {
    const current = await redisIncrement(client, failureKey, WINDOW_SECONDS);
    if (current.count >= ACCOUNT_FAILURE_LIMIT) {
      await client.set(lockKey, '1', 'EX', LOCK_SECONDS);
      return { locked: true, retryAfterSeconds: LOCK_SECONDS };
    }
    return { locked: false };
  }

  const current = memoryIncrement(failureKey, WINDOW_SECONDS);
  if (current.count >= ACCOUNT_FAILURE_LIMIT) {
    memoryCounters.set(lockKey, { count: 1, expiresAt: Date.now() + LOCK_SECONDS * 1000 });
    return { locked: true, retryAfterSeconds: LOCK_SECONDS };
  }
  return { locked: false };
}

export async function clearSuperAdminLoginFailures(configuredAccount: string): Promise<void> {
  const client = await requireRedis();
  const failureKey = key('account', configuredAccount);
  const lockKey = key('lock', configuredAccount);
  if (client) {
    await client.del(failureKey, lockKey);
    return;
  }
  memoryCounters.delete(failureKey);
  memoryCounters.delete(lockKey);
}

export function resetSuperAdminPasswordRateLimitForTests(): void {
  memoryCounters.clear();
}
