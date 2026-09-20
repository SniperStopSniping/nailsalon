import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ client: null as null | { eval: ReturnType<typeof vi.fn> } }));
vi.mock('@/core/redis/redisClient', () => ({
  get redis() {
    return holder.client;
  },
}));

const { CUSTOMER_ASSISTANT_INTERPRETATION_SCHEMA_BYTES, CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD, CUSTOMER_ASSISTANT_TURN_COST_UPPER_BOUND_MICRO_USD, buildCustomerAssistantBudgetKeys, reserveCustomerAssistantTurn } = await import('./budget.server');

const evalMock = vi.fn();
const input = { salonId: 'salon_a', sessionId: 'd0ec6a39-7d12-47d8-b80d-41d56d10fbe5', turnIndex: 0, clientIp: '203.0.113.44', now: new Date('2026-09-18T12:34:00.000Z') };

beforeEach(() => {
  evalMock.mockReset();
  holder.client = { eval: evalMock };
});

describe('customer assistant budget reservation', () => {
  it.each([
    [0, { ok: true }],
    [1, { ok: false, reason: 'stale_conversation' }],
    [3, { ok: false, reason: 'session_limit' }],
    [2, { ok: false, reason: 'rate_limited' }],
  ])('maps atomic reservation result %s', async (code, result) => {
    evalMock.mockResolvedValue(code);

    await expect(reserveCustomerAssistantTurn(input)).resolves.toEqual(result);
  });

  it('fails closed for missing, unhealthy, malformed, or slow Redis', async () => {
    holder.client = null;

    await expect(reserveCustomerAssistantTurn(input)).resolves.toEqual({ ok: false, reason: 'unavailable' });

    holder.client = { eval: evalMock };
    evalMock.mockRejectedValueOnce(new Error('unhealthy'));

    await expect(reserveCustomerAssistantTurn(input)).resolves.toEqual({ ok: false, reason: 'unavailable' });

    evalMock.mockResolvedValueOnce(9);

    await expect(reserveCustomerAssistantTurn(input)).resolves.toEqual({ ok: false, reason: 'unavailable' });

    evalMock.mockResolvedValueOnce(null);

    await expect(reserveCustomerAssistantTurn(input)).resolves.toEqual({ ok: false, reason: 'unavailable' });

    evalMock.mockResolvedValueOnce('');

    await expect(reserveCustomerAssistantTurn(input)).resolves.toEqual({ ok: false, reason: 'unavailable' });

    vi.useFakeTimers();
    evalMock.mockImplementationOnce(() => new Promise(() => {}));
    const pending = reserveCustomerAssistantTurn(input);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'unavailable' });

    vi.useRealTimers();
  });

  it('reserves a schema-aware two-stage maximum with fixed conservative headroom', () => {
    expect(CUSTOMER_ASSISTANT_INTERPRETATION_SCHEMA_BYTES).toBeGreaterThan(0);
    expect(CUSTOMER_ASSISTANT_TURN_COST_UPPER_BOUND_MICRO_USD).toBeLessThanOrEqual(CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD);
    expect(CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD).toBe(150_000);
  });

  it('uses one atomic script with same cluster hash tag and no raw IP key', async () => {
    evalMock.mockResolvedValue(0);
    await reserveCustomerAssistantTurn(input);
    const [script, keyCount, ...rest] = evalMock.mock.calls[0] as [string, number, ...string[]];
    const keys = rest.slice(0, keyCount);
    const args = rest.slice(keyCount);

    expect(keyCount).toBe(9);
    expect(keys).toEqual(buildCustomerAssistantBudgetKeys(input));
    expect(keys.every(key => key.includes('{customer-booking-assistant}'))).toBe(true);
    expect(keys.join('|')).not.toContain(input.clientIp);
    expect(script.indexOf('redis.call(\'SET\', KEYS[1]')).toBeGreaterThan(script.lastIndexOf('return 2'));
    expect(args).toContain(String(CUSTOMER_ASSISTANT_TURN_COST_MICRO_USD));
  });

  it('keeps all repeated session turns in a separate replay key', () => {
    const first = buildCustomerAssistantBudgetKeys(input);
    const retried = buildCustomerAssistantBudgetKeys({ ...input, turnIndex: 1 });
    const anotherIp = buildCustomerAssistantBudgetKeys({ ...input, clientIp: '203.0.113.45' });

    expect(first[0]).not.toBe(retried[0]);
    expect(first[1]).toBe(retried[1]);
    expect(first[2]).not.toBe(anotherIp[2]);
  });

  it('uses UTC calendar keys while preserving fixed counter TTL windows across rollover', async () => {
    const beforeMidnight = { ...input, now: new Date('2026-09-18T23:59:59.000Z') };
    const afterMidnight = { ...input, now: new Date('2026-09-19T00:00:01.000Z') };
    const beforeKeys = buildCustomerAssistantBudgetKeys(beforeMidnight);
    const afterKeys = buildCustomerAssistantBudgetKeys(afterMidnight);

    expect(beforeKeys[3]).toContain(':day:2026-09-18');
    expect(afterKeys[3]).toContain(':day:2026-09-19');
    expect(beforeKeys[5]).toContain(':month:2026-09');

    evalMock.mockResolvedValue(0);
    await reserveCustomerAssistantTurn(beforeMidnight);
    const args = (evalMock.mock.calls[0] as unknown[]).slice(2 + 9).map(String);

    expect(args.slice(6, 10)).toEqual([
      String(2 * 60 * 60 + 60),
      String(2 * 60),
      String(2 * 24 * 60 * 60),
      String(35 * 24 * 60 * 60),
    ]);
  });

  it('denies a thirty-third request before reaching Redis', async () => {
    await expect(reserveCustomerAssistantTurn({ ...input, turnIndex: 32 }))
      .resolves.toEqual({ ok: false, reason: 'session_limit' });
    expect(evalMock).not.toHaveBeenCalled();
  });
});
