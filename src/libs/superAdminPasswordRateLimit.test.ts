/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { counters, redis } = vi.hoisted(() => {
  const counters = new Map<string, { count: number; ttl: number }>();
  const redis = {
    ping: vi.fn(async () => 'PONG'),
    ttl: vi.fn(async (key: string) => counters.get(key)?.ttl ?? -2),
    eval: vi.fn(async (_script: string, _keys: number, key: string, ttl: number) => {
      const current = counters.get(key) ?? { count: 0, ttl: Number(ttl) };
      current.count += 1;
      counters.set(key, current);
      return [current.count, current.ttl];
    }),
    set: vi.fn(async (key: string, _value: string, _mode: string, ttl: number) => {
      counters.set(key, { count: 1, ttl: Number(ttl) });
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      keys.forEach(key => counters.delete(key));
      return keys.length;
    }),
  };
  return { counters, redis };
});

vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({ redis }));

import {
  beginSuperAdminLoginAttempt,
  clearSuperAdminLoginFailures,
  recordSuperAdminLoginFailure,
} from './superAdminPasswordRateLimit';

const originalEnv = { ...process.env };

describe('super-admin distributed password throttling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counters.clear();
    process.env = { ...originalEnv, NODE_ENV: 'production', VERCEL_ENV: 'preview' };
    redis.ping.mockResolvedValue('PONG');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('limits an IP to five attempts per fifteen minutes using hashed keys', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(beginSuperAdminLoginAttempt('203.0.113.1', '+14165550123'))
        .resolves.toEqual({ allowed: true });
    }

    await expect(beginSuperAdminLoginAttempt('203.0.113.1', '+14165550123'))
      .resolves.toMatchObject({ allowed: false, reason: 'ip_limit' });

    const serializedCalls = JSON.stringify(redis.eval.mock.calls);

    expect(serializedCalls).not.toContain('203.0.113.1');
    expect(serializedCalls).not.toContain('+14165550123');
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, expect.stringContaining(':ip:'), 900);
  });

  it('locks the configured account for thirty minutes after ten failures', async () => {
    for (let failure = 0; failure < 9; failure += 1) {
      await expect(recordSuperAdminLoginFailure('+14165550123'))
        .resolves.toEqual({ locked: false });
    }

    await expect(recordSuperAdminLoginFailure('+14165550123'))
      .resolves.toEqual({ locked: true, retryAfterSeconds: 1800 });
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(':lock:'), '1', 'EX', 1800);
  });

  it('clears account failure and lock keys after successful authentication', async () => {
    await recordSuperAdminLoginFailure('+14165550123');
    await clearSuperAdminLoginFailures('+14165550123');

    expect(redis.del).toHaveBeenCalledWith(
      expect.stringContaining(':account:'),
      expect.stringContaining(':lock:'),
    );
  });

  it('fails closed in a hosted environment when Redis is unavailable', async () => {
    redis.ping.mockRejectedValueOnce(new Error('unavailable'));

    await expect(beginSuperAdminLoginAttempt('203.0.113.1', '+14165550123'))
      .rejects.toThrow('AUTH_RATE_LIMIT_UNAVAILABLE');
  });
});
