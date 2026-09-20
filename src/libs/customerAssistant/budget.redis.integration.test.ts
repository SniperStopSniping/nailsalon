import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type BudgetModule = typeof import('./budget.server');
type RedisClient = NonNullable<typeof import('@/core/redis/redisClient')['redis']>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function safeLoopbackRedisUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'redis:' && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
      ? value
      : null;
  } catch {
    return null;
  }
}

const loopbackRedisUrl = safeLoopbackRedisUrl(process.env.REDIS_URL);
const describeWithLoopbackRedis = loopbackRedisUrl ? describe : describe.skip;

describe('customer assistant Redis integration target', () => {
  it.each([undefined, 'not-a-url', 'redis://cache.example.test:6379', 'rediss://127.0.0.1:6379'])(
    'rejects non-local Redis target: %s',
    (value) => {
      expect(safeLoopbackRedisUrl(value)).toBeNull();
    },
  );
});

describeWithLoopbackRedis('customer assistant budget Redis concurrency', () => {
  const salonId = `customer-assistant-${randomUUID()}`;
  const clientIp = '203.0.113.99';
  const now = new Date('2026-09-18T12:00:00.000Z');
  let budget: BudgetModule;
  let client: RedisClient | null | undefined;
  let exactKeys: string[] = [];
  let warning: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    const originalWarn = console.warn;
    warning = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args.length === 1 && args[0] === '[Redis] Connected') {
        return;
      }
      originalWarn(...args);
    });
    [budget, { redis: client }] = await Promise.all([
      import('./budget.server'),
      import('@/core/redis/redisClient'),
    ]);
    if (!client) {
      throw new Error('Loopback Redis was not configured');
    }
    await client.ping();
  });

  afterAll(async () => {
    try {
      if (client && exactKeys.length > 0) {
        await client.del(...exactKeys);
      }
    } finally {
      client?.disconnect();
      warning?.mockRestore();
    }
  });

  it('accepts exactly six concurrent unique sessions for one IP, then preserves the IP cap', async () => {
    if (!client) {
      throw new Error('Loopback Redis was not initialized');
    }
    const inputs = Array.from({ length: 12 }, () => ({
      salonId,
      sessionId: randomUUID(),
      turnIndex: 0,
      clientIp,
      now,
    }));
    exactKeys = inputs.flatMap(input => budget.buildCustomerAssistantBudgetKeys(input));

    const results = await Promise.all(inputs.map(input => budget.reserveCustomerAssistantTurn(input)));

    expect(results.filter(result => result.ok)).toHaveLength(6);
    expect(results.filter(result => !result.ok && result.reason === 'rate_limited')).toHaveLength(6);

    const ipMinuteKey = budget.buildCustomerAssistantBudgetKeys(inputs[0]!)[2]!;

    expect(await client.get(ipMinuteKey)).toBe('6');
  });

  it('allows exactly one concurrent reservation for an identical session and turn', async () => {
    if (!client) {
      throw new Error('Loopback Redis was not initialized');
    }
    const replayInput = {
      salonId: `${salonId}-replay`,
      sessionId: randomUUID(),
      turnIndex: 0,
      clientIp: '203.0.113.100',
      now,
    };
    const keys = budget.buildCustomerAssistantBudgetKeys(replayInput);
    exactKeys.push(...keys);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => budget.reserveCustomerAssistantTurn(replayInput)),
    );

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.reason === 'stale_conversation')).toHaveLength(9);
    expect(await client.get(keys[1]!)).toBe('1');
  });
});
