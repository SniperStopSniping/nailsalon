import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  getDeploymentEnvironment,
  hashRateLimitIdentifier,
  redis,
  redisState,
} = vi.hoisted(() => {
  const redis = {
    eval: vi.fn(),
  };

  return {
    getDeploymentEnvironment: vi.fn(() => 'vercel:production'),
    hashRateLimitIdentifier: vi.fn((value: string) => {
      let digest = 2166136261;
      for (const character of value) {
        digest = Math.imul(digest ^ character.charCodeAt(0), 16777619);
      }
      return (digest >>> 0).toString(16).padStart(8, '0').repeat(8);
    }),
    redis,
    redisState: {
      current: redis as typeof redis | null,
    },
  };
});

vi.mock('@/core/redis/redisClient', () => ({
  get redis() {
    return redisState.current;
  },
}));

vi.mock('@/libs/authConfig.server', () => ({
  getDeploymentEnvironment,
  hashRateLimitIdentifier,
}));

/* eslint-disable import/first */
import {
  checkPublicBookingRateLimit,
  PUBLIC_BOOKING_RATE_LIMIT_TIMEOUT_MS,
  PUBLIC_BOOKING_RATE_LIMITS,
} from './publicBookingRateLimit.server';
/* eslint-enable import/first */

const SALON_ID = 'salon_test';
const CLIENT_IP = '203.0.113.10';
const CLIENT_PHONE = '4165550101';

type SlidingWindowEntry = {
  member: string;
  score: number;
};

const fakeRedisState = {
  nowMs: Date.parse('2026-08-02T12:00:00.000Z'),
  sortedSets: new Map<string, SlidingWindowEntry[]>(),
};

function clearFakeRedis() {
  fakeRedisState.nowMs = Date.parse('2026-08-02T12:00:00.000Z');
  fakeRedisState.sortedSets.clear();
}

function advanceFakeRedis(milliseconds: number) {
  fakeRedisState.nowMs += milliseconds;
}

function activeEntries(key: string, windowMs: number): SlidingWindowEntry[] {
  const cutoff = fakeRedisState.nowMs - windowMs;
  const active = (fakeRedisState.sortedSets.get(key) ?? [])
    .filter(entry => entry.score > cutoff);
  fakeRedisState.sortedSets.set(key, active);
  return active;
}

/**
 * Stateful implementation of the helper's one-EVAL Redis contract. All reads,
 * decisions and writes happen synchronously before this function returns,
 * which models Lua's atomic execution for Promise.all races.
 */
async function evaluateSlidingWindows(
  _script: unknown,
  keyCountInput: unknown,
  ...redisArguments: unknown[]
): Promise<[number, number]> {
  const keyCount = Number(keyCountInput);
  const keys = redisArguments.slice(0, keyCount).map(String);
  const args = redisArguments.slice(keyCount);
  const [
    ipBurstKey,
    ipSustainedKey,
    contactKey,
  ] = keys;
  const [
    hasIpInput,
    memberInput,
    ipBurstLimitInput,
    ipBurstWindowMsInput,
    ipSustainedLimitInput,
    ipSustainedWindowMsInput,
    contactLimitInput,
    contactWindowMsInput,
  ] = args;
  const hasIp = String(hasIpInput) === '1';
  const member = String(memberInput);
  const ipBurstLimit = Number(ipBurstLimitInput);
  const ipBurstWindowMs = Number(ipBurstWindowMsInput);
  const ipSustainedLimit = Number(ipSustainedLimitInput);
  const ipSustainedWindowMs = Number(ipSustainedWindowMsInput);
  const contactLimit = Number(contactLimitInput);
  const contactWindowMs = Number(contactWindowMsInput);

  const windows = [
    ...(hasIp
      ? [
          { key: ipBurstKey!, limit: ipBurstLimit, windowMs: ipBurstWindowMs },
          { key: ipSustainedKey!, limit: ipSustainedLimit, windowMs: ipSustainedWindowMs },
        ]
      : []),
    { key: contactKey!, limit: contactLimit, windowMs: contactWindowMs },
  ];
  const inspected = windows.map((window) => {
    const entries = activeEntries(window.key, window.windowMs);
    const oldestScore = entries.reduce(
      (oldest, entry) => Math.min(oldest, entry.score),
      Number.POSITIVE_INFINITY,
    );
    return {
      ...window,
      entries,
      retryAfterMs: entries.length >= window.limit
        ? Math.max(1, oldestScore + window.windowMs - fakeRedisState.nowMs)
        : 0,
    };
  });
  const retryAfterMs = inspected.reduce(
    (longest, window) => Math.max(longest, window.retryAfterMs),
    0,
  );

  if (retryAfterMs > 0) {
    return [0, retryAfterMs];
  }

  for (const window of inspected) {
    fakeRedisState.sortedSets.set(window.key, [
      ...window.entries,
      { member, score: fakeRedisState.nowMs },
    ]);
  }
  return [1, 0];
}

function phoneFor(index: number): string {
  return `41655${String(index).padStart(5, '0')}`;
}

function check(overrides: Partial<Parameters<typeof checkPublicBookingRateLimit>[0]> = {}) {
  return checkPublicBookingRateLimit({
    salonId: SALON_ID,
    clientIp: CLIENT_IP,
    normalizedPhone: CLIENT_PHONE,
    ...overrides,
  });
}

describe('public booking distributed rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFakeRedis();
    redisState.current = redis;
    redis.eval.mockImplementation(evaluateSlidingWindows);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the approved limits in one atomic sliding-window Redis operation', async () => {
    const result = await check();

    expect(PUBLIC_BOOKING_RATE_LIMITS).toEqual({
      ipBurst: { limit: 10, windowSeconds: 60 },
      ipSustained: { limit: 30, windowSeconds: 15 * 60 },
      contact: { limit: 5, windowSeconds: 15 * 60 },
    });
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
    expect(redis.eval).toHaveBeenCalledOnce();

    const call = redis.eval.mock.calls[0]!;
    const script = String(call[0]);
    const keys = call.slice(2, 5).map(String);
    const clusterTags = keys.map(key => key.match(/\{[^}]+\}/u)?.[0]);

    expect(script).toContain('redis.call(\'TIME\')');
    expect(script).toContain('redis.call(\'ZREMRANGEBYSCORE\'');
    expect(script).toContain('redis.call(\'ZADD\'');
    expect(script).toContain('redis.call(\'PEXPIRE\'');
    expect(call).toEqual([
      expect.any(String),
      3,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      '1',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
      10,
      60_000,
      30,
      900_000,
      5,
      900_000,
    ]);
    expect(clusterTags.every(Boolean)).toBe(true);
    expect(new Set(clusterTags)).toHaveLength(1);
    expect(hashRateLimitIdentifier).toHaveBeenCalledWith(
      `vercel:production:${SALON_ID}`,
    );
    expect(hashRateLimitIdentifier).toHaveBeenCalledWith(CLIENT_IP);
    expect(hashRateLimitIdentifier).toHaveBeenCalledWith(CLIENT_PHONE);

    const serializedRedisCall = JSON.stringify(call);

    expect(serializedRedisCall).not.toContain(SALON_ID);
    expect(serializedRedisCall).not.toContain(CLIENT_IP);
    expect(serializedRedisCall).not.toContain(CLIENT_PHONE);
  });

  it('allows five repeated contact attempts and rate-limits the sixth without extending the cooldown', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(check()).resolves.toEqual({
        allowed: true,
        reason: 'allowed',
      });
    }

    await expect(check()).resolves.toEqual({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: 900,
    });
    await expect(check()).resolves.toEqual({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: 900,
    });
  });

  it('allows a contact to retry after the sliding-window cooldown', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await check();
    }

    await expect(check()).resolves.toMatchObject({ allowed: false });

    advanceFakeRedis(15 * 60 * 1000);

    await expect(check()).resolves.toEqual({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('does not share contact quota between independent clients on the same IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await check();
    }

    await expect(check()).resolves.toMatchObject({ allowed: false });

    await expect(check({ normalizedPhone: '4165550102' })).resolves.toEqual({
      allowed: true,
      reason: 'allowed',
    });
    await expect(check({
      clientIp: '198.51.100.22',
      normalizedPhone: '4165550103',
    })).resolves.toEqual({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('applies the short IP burst limit even when a script rotates contact details', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(check({ normalizedPhone: phoneFor(attempt) })).resolves
        .toMatchObject({ allowed: true });
    }

    await expect(check({ normalizedPhone: phoneFor(10) })).resolves.toEqual({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: 60,
    });
  });

  it('applies the sustained IP limit across separate burst windows', async () => {
    for (let batch = 0; batch < 3; batch += 1) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expect(check({
          normalizedPhone: phoneFor(batch * 10 + attempt),
        })).resolves.toMatchObject({ allowed: true });
      }
      advanceFakeRedis(60_001);
    }

    await expect(check({ normalizedPhone: phoneFor(30) })).resolves
      .toMatchObject({
        allowed: false,
        reason: 'rate_limited',
      });
  });

  it('skips shared IP buckets when the platform cannot identify the client IP', async () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await expect(check({
        clientIp: ' UNKNOWN ',
        normalizedPhone: phoneFor(attempt),
      })).resolves.toEqual({ allowed: true, reason: 'allowed' });
    }

    for (const call of redis.eval.mock.calls) {
      expect(call[5]).toBe('0');
    }
  });

  it('fails open when Redis is not configured', async () => {
    redisState.current = null;

    await expect(check()).resolves.toEqual({
      allowed: true,
      reason: 'unavailable',
    });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('fails open when Redis rejects the atomic operation', async () => {
    redis.eval.mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(check()).resolves.toEqual({
      allowed: true,
      reason: 'unavailable',
    });
  });

  it('fails open on a slow Redis operation without delaying the booking', async () => {
    vi.useFakeTimers();
    redis.eval.mockReturnValueOnce(new Promise(() => {}));

    const result = check();
    await vi.advanceTimersByTimeAsync(PUBLIC_BOOKING_RATE_LIMIT_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      allowed: true,
      reason: 'unavailable',
    });
  });

  it.each([
    null,
    [],
    [1],
    [2, 0],
    [0, 0],
    [1, -1],
  ])('fails open on a malformed Redis result: %j', async (redisResult) => {
    redis.eval.mockResolvedValueOnce(redisResult);

    await expect(check()).resolves.toEqual({
      allowed: true,
      reason: 'unavailable',
    });
  });

  it('admits exactly the contact quota under concurrent attempts', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => check()),
    );

    expect(results.filter(result => result.reason === 'allowed')).toHaveLength(5);
    expect(results.filter(result => result.reason === 'rate_limited')).toHaveLength(15);
    expect(redis.eval).toHaveBeenCalledTimes(20);
  });
});
