import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const reviewMocks = vi.hoisted(() => ({ readiness: vi.fn(), lookup: vi.fn(), quote: vi.fn(), prepare: vi.fn() }));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'synthetic-no-provider', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./readiness.server', () => ({ assessReadyCustomerProposal: reviewMocks.readiness }));
vi.mock('./slots.server', () => ({ lookupCustomerSlots: reviewMocks.lookup }));
vi.mock('./prepareQuote.server', () => ({ prepareCustomerBookingQuote: reviewMocks.quote }));
vi.mock('./operationStore.server', () => ({
  prepareCustomerBookingOperation: reviewMocks.prepare,
  customerBookingOperationReference: () => ({ capability: 'synthetic-operation', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2026-09-18T12:05:00Z' }),
}));
vi.mock('./ledger.server', () => ({ recordCustomerAssistantUsage: vi.fn(async () => undefined) }));

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

  it('atomically fences historical tokens and in-flight edits while allowing latest acceptance retries', async () => {
    const revisions = await import('./revision.server');
    const initial = { salonId, sessionId: randomUUID(), turnIndex: 0, clientIp: '203.0.113.101', now };
    const current = { ...initial, turnIndex: 1, conversation: 'signed-revision-one' };
    const later = { ...initial, turnIndex: 2, conversation: 'signed-revision-two' };
    exactKeys.push(...[initial, current, later].flatMap(input => budget.buildCustomerAssistantBudgetKeys(input)));

    expect(await budget.reserveCustomerAssistantTurn(initial)).toEqual({ ok: true });
    expect(await revisions.isCurrentCustomerRevision(current, current.conversation)).toBe(false);
    expect(await revisions.completeCustomerRevision(current, current.conversation)).toBe(true);
    expect(await revisions.isCurrentCustomerRevision(current, current.conversation)).toBe(true);
    expect(await revisions.isCurrentCustomerRevision(current, current.conversation)).toBe(true);
    expect(await revisions.isCurrentCustomerRevision({ ...current, salonId: 'other' }, current.conversation)).toBe(false);
    expect(await budget.reserveCustomerAssistantTurn({ ...current, conversation: 'other-signed-revision' })).toEqual({ ok: false, reason: 'stale_conversation' });

    expect(await budget.reserveCustomerAssistantTurn(current)).toEqual({ ok: true });
    // A later edit fences the prior proposal before its model or catalogue work finishes.
    expect(await revisions.isCurrentCustomerRevision(current, current.conversation)).toBe(false);
    expect(await revisions.completeCustomerRevision(current, current.conversation)).toBe(false);
    expect(await revisions.completeCustomerRevision(later, later.conversation)).toBe(true);
    expect(await revisions.isCurrentCustomerRevision(current, current.conversation)).toBe(false);
    expect(await revisions.isCurrentCustomerRevision(later, later.conversation)).toBe(true);
    expect(await budget.reserveCustomerAssistantTurn(current)).toEqual({ ok: false, reason: 'stale_conversation' });
  });

  it('keeps a real reserved and completed legacy review revision usable while rejecting its prior token', async () => {
    const { createCustomerConversation, signCustomerConversation, verifyCustomerConversation } = await import('./conversation.server');
    const revisions = await import('./revision.server');
    const { prepareCustomerAssistantReview } = await import('./review.server');
    const secret = 'x'.repeat(32);
    const slot = { time: '15:00', startTime: '2026-09-20T19:00:00.000Z' };
    const selection = { baseServiceId: 'synthetic-gel', selectedAddOns: [] };
    const fingerprint = 'a'.repeat(64);
    const proposal = { selection, fingerprint, service: { id: 'synthetic-gel', name: 'Gel', priceCents: 5000 }, addOns: [], subtotalCents: 5000, durationMinutes: 60, currency: 'CAD', expiresAt: '2026-09-18T13:00:00Z' };
    const prior = {
      ...createCustomerConversation(salonId, secret, now.getTime()),
      turnIndex: 1,
      context: { question: null, options: [], selection },
      booking: { acceptedFingerprint: fingerprint, datePreference: { date: '2026-09-20', earliest: '12:00', latest: '17:00' }, offeredSlots: [slot], selectedSlot: slot },
    };
    const token = signCustomerConversation(prior, secret);
    const initial = { salonId, sessionId: prior.sessionId, turnIndex: 0, clientIp: '203.0.113.102', now };
    exactKeys.push(...[0, 1, 2].flatMap(turnIndex => budget.buildCustomerAssistantBudgetKeys({ ...initial, turnIndex })));
    reviewMocks.readiness.mockResolvedValue({ proposal });
    reviewMocks.lookup.mockResolvedValue({ proposal, timeZone: 'America/Toronto', slots: [slot], selected: slot, quoteChanged: false });
    reviewMocks.quote.mockResolvedValue({ review: { status: 'READY', timeZone: 'America/Toronto', financial: { currency: 'CAD', subtotalCents: 5000 } } });
    reviewMocks.prepare.mockImplementation(async (args: { material: unknown }) => ({ material: args.material }));

    expect(await budget.reserveCustomerAssistantTurn(initial)).toEqual({ ok: true });
    expect(await revisions.completeCustomerRevision(prior, token)).toBe(true);

    const args = {
      salon: { id: salonId, slug: 'synthetic-isla', name: 'Synthetic Isla' },
      features: null,
      conversation: token,
      contact: { name: 'Synthetic Customer', email: 'test@example.invalid', phone: '4165550199' },
      clientIp: initial.clientIp,
      now,
    };
    const review = await prepareCustomerAssistantReview(args);
    const current = verifyCustomerConversation(review.conversation, salonId, secret, now.getTime());

    expect(review.result).toMatchObject({ kind: 'booking_review', review: { status: 'READY' } });
    expect(current.turnIndex).toBe(2);
    expect(await revisions.isCurrentCustomerRevision(current, review.conversation)).toBe(true);
    expect(await revisions.isCurrentCustomerRevision(prior, token)).toBe(false);
    expect((await prepareCustomerAssistantReview(args)).result).toEqual({ kind: 'unavailable', reason: 'stale_conversation' });
    expect(reviewMocks.prepare).toHaveBeenCalledTimes(1);
    expect(await budget.reserveCustomerAssistantTurn({ ...initial, turnIndex: current.turnIndex, conversation: review.conversation })).toEqual({ ok: true });

    const next = { ...current, turnIndex: current.turnIndex + 1 };
    const nextToken = signCustomerConversation(next, secret);

    expect(await revisions.completeCustomerRevision(next, nextToken)).toBe(true);
    expect(await revisions.isCurrentCustomerRevision(current, review.conversation)).toBe(false);
    expect(await revisions.isCurrentCustomerRevision(next, nextToken)).toBe(true);
  });
});
