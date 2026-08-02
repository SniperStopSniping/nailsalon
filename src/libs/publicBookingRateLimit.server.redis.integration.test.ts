import { randomUUID } from 'node:crypto';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/core/logging/logger', () => ({
  logWarn: vi.fn(),
}));

type CheckPublicBookingRateLimit
  = typeof import('./publicBookingRateLimit.server')['checkPublicBookingRateLimit'];
type RedisClient
  = NonNullable<typeof import('@/core/redis/redisClient')['redis']>;

const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

function safeLoopbackRedisUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'redis:'
      && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
      ? value
      : null;
  } catch {
    return null;
  }
}

function redisTimeMs(redisTime: Array<number | string>): number {
  return Number(redisTime[0]) * 1000 + Math.floor(Number(redisTime[1]) / 1000);
}

const loopbackRedisUrl = safeLoopbackRedisUrl(process.env.REDIS_URL);
const describeWithLoopbackRedis = loopbackRedisUrl ? describe : describe.skip;

describe('public booking rate limit Redis integration guard', () => {
  it.each([
    undefined,
    'not-a-url',
    'redis://cache.example.test:6379',
    'rediss://127.0.0.1:6379',
  ])('rejects a non-loopback Redis target without importing the limiter: %s', (value) => {
    expect(safeLoopbackRedisUrl(value)).toBeNull();
  });

  it.each([
    'redis://localhost:6379',
    'redis://127.0.0.1:6379',
    'redis://[::1]:6379',
  ])('accepts an explicit loopback Redis target: %s', (value) => {
    expect(safeLoopbackRedisUrl(value)).toBe(value);
  });
});

describeWithLoopbackRedis('public booking rate limit Redis integration', () => {
  const salonId = `redis-lua-test-${randomUUID()}`;
  const clientIp = '203.0.113.10';
  const contacts = Array.from(
    { length: 11 },
    (_, index) => `155501${String(index).padStart(4, '0')}`,
  );

  let checkPublicBookingRateLimit: CheckPublicBookingRateLimit;
  let redisClient: RedisClient | undefined;
  let redisWarningSpy: ReturnType<typeof vi.spyOn> | undefined;
  let ipBurstKey = '';
  let ipSustainedKey = '';
  let contactKeys: string[] = [];
  let exactKeys: string[] = [];

  beforeAll(async () => {
    const existingConsoleWarn = console.warn;
    redisWarningSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args.length === 1 && args[0] === '[Redis] Connected') {
        return;
      }
      existingConsoleWarn(...args);
    });

    const [rateLimitModule, redisModule, authConfigModule] = await Promise.all([
      import('./publicBookingRateLimit.server'),
      import('@/core/redis/redisClient'),
      import('@/libs/authConfig.server'),
    ]);

    checkPublicBookingRateLimit = rateLimitModule.checkPublicBookingRateLimit;
    redisClient = redisModule.redis ?? undefined;
    if (!redisClient) {
      throw new Error('Loopback Redis integration client was not configured');
    }

    await redisClient.ping();

    const deploymentScope = authConfigModule.hashRateLimitIdentifier(
      `${authConfigModule.getDeploymentEnvironment()}:${salonId}`,
    );
    const prefix = `luster:public-booking:{${deploymentScope}}`;
    const hashedIp = authConfigModule.hashRateLimitIdentifier(clientIp);
    ipBurstKey = `${prefix}:ip:burst:${hashedIp}`;
    ipSustainedKey = `${prefix}:ip:sustained:${hashedIp}`;
    contactKeys = contacts.map(contact => (
      `${prefix}:contact:${authConfigModule.hashRateLimitIdentifier(contact)}`
    ));
    exactKeys = [ipBurstKey, ipSustainedKey, ...contactKeys];

    await redisClient.del(...exactKeys);
  });

  afterAll(async () => {
    try {
      if (redisClient && exactKeys.length > 0) {
        await redisClient.del(...exactKeys);
      }
    } finally {
      redisClient?.disconnect();
      redisWarningSpy?.mockRestore();
    }
  });

  it('executes the production Lua script atomically with Redis server time', async () => {
    if (!redisClient) {
      throw new Error('Loopback Redis integration client was not initialized');
    }

    const limitsModule = await import('./publicBookingRateLimit.server');
    const beforeMs = redisTimeMs(await redisClient.time());
    const results = await Promise.all(contacts.map(normalizedPhone => (
      checkPublicBookingRateLimit({
        salonId,
        clientIp,
        normalizedPhone,
      })
    )));
    const afterMs = redisTimeMs(await redisClient.time());

    const allowed = results.filter(
      result => result.allowed && result.reason === 'allowed',
    );
    const unavailable = results.filter(
      result => result.allowed && result.reason === 'unavailable',
    );
    const limited = results.filter(result => !result.allowed);

    expect(allowed).toHaveLength(10);
    expect(unavailable).toHaveLength(0);
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: expect.any(Number),
    });

    const [
      ipBurstCardinality,
      ipSustainedCardinality,
      contactCardinalities,
      ipBurstEntries,
      ipBurstTtlMs,
      ipSustainedTtlMs,
    ] = await Promise.all([
      redisClient.zcard(ipBurstKey),
      redisClient.zcard(ipSustainedKey),
      Promise.all(contactKeys.map(key => redisClient!.zcard(key))),
      redisClient.zrange(ipBurstKey, 0, -1, 'WITHSCORES'),
      redisClient.pttl(ipBurstKey),
      redisClient.pttl(ipSustainedKey),
    ]);

    expect(ipBurstCardinality).toBe(10);
    expect(ipSustainedCardinality).toBe(10);
    expect(contactCardinalities.every(count => count === 0 || count === 1)).toBe(true);
    expect(contactCardinalities.reduce((total, count) => total + count, 0)).toBe(10);

    const members = ipBurstEntries.filter((_value, index) => index % 2 === 0);
    const scores = ipBurstEntries
      .filter((_value, index) => index % 2 === 1)
      .map(Number);

    expect(members).toHaveLength(10);
    expect(new Set(members)).toHaveLength(10);
    expect(members.every(member => (
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(member)
    ))).toBe(true);
    expect(scores.every(score => score >= beforeMs && score <= afterMs)).toBe(true);

    expect(ipBurstTtlMs).toBeGreaterThan(0);
    expect(ipBurstTtlMs).toBeLessThanOrEqual(
      limitsModule.PUBLIC_BOOKING_RATE_LIMITS.ipBurst.windowSeconds * 1000 + 1000,
    );
    expect(ipSustainedTtlMs).toBeGreaterThan(0);
    expect(ipSustainedTtlMs).toBeLessThanOrEqual(
      limitsModule.PUBLIC_BOOKING_RATE_LIMITS.ipSustained.windowSeconds * 1000 + 1000,
    );
  });
});
