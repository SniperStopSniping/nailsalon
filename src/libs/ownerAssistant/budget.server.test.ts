/**
 * The budget is the only thing bounding provider spend, so the property that
 * matters is ATOMICITY: all three counters are checked before ANY of them is
 * incremented, in one script. These tests pin the script's contract (keys,
 * argument order, TTLs, UTC date keys) and the mapping of its return code, and
 * prove that every Redis problem becomes `redis_unavailable` rather than an
 * exception the route would have to handle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const redisHolder = vi.hoisted(() => ({
  client: null as null | { eval: ReturnType<typeof vi.fn> },
}));
vi.mock('@/core/redis/redisClient', () => ({
  get redis() {
    return redisHolder.client;
  },
}));

const { buildBudgetKeys, reserveTurn } = await import('./budget.server');
const { OWNER_ASSISTANT_LIMITS } = await import('./contracts');

const NOW = new Date('2026-09-16T04:30:00.000Z');
const evalMock = vi.fn();

beforeEach(() => {
  evalMock.mockReset();
  redisHolder.client = { eval: evalMock };
});

describe('reservation outcomes', () => {
  it('reserves when the script says there is room', async () => {
    evalMock.mockResolvedValue(0);

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW })).resolves.toEqual({ ok: true });
  });

  it.each([
    [1, 'day'],
    [2, 'month'],
    [3, 'global'],
  ])('maps script code %s to the %s scope', async (code, scope) => {
    evalMock.mockResolvedValue(code);

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW }))
      .resolves.toEqual({ ok: false, reason: 'budget_exhausted', scope });
  });

  it('tolerates a string reply (some clients stringify integers)', async () => {
    evalMock.mockResolvedValue('2');

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW }))
      .resolves.toEqual({ ok: false, reason: 'budget_exhausted', scope: 'month' });
  });

  it('treats an uninterpretable reply as unavailable rather than as room', async () => {
    evalMock.mockResolvedValue('unexpected');

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW }))
      .resolves.toEqual({ ok: false, reason: 'redis_unavailable' });

    evalMock.mockResolvedValue(99);

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW }))
      .resolves.toEqual({ ok: false, reason: 'redis_unavailable' });
  });
});

describe('redis problems never reach the route', () => {
  it('reports redis_unavailable when REDIS_URL was never configured', async () => {
    redisHolder.client = null;

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW }))
      .resolves.toEqual({ ok: false, reason: 'redis_unavailable' });
  });

  it('reports redis_unavailable when the eval rejects', async () => {
    evalMock.mockRejectedValue(new Error('READONLY You can not write against a read only replica.'));

    await expect(reserveTurn({ salonId: 'salon_a', now: NOW }))
      .resolves.toEqual({ ok: false, reason: 'redis_unavailable' });
  });

  it('reports redis_unavailable when the eval hangs past one second', async () => {
    vi.useFakeTimers();
    evalMock.mockImplementation(() => new Promise(() => {}));

    const pending = reserveTurn({ salonId: 'salon_a', now: NOW });
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'redis_unavailable' });

    vi.useRealTimers();
  });
});

describe('script and key contract', () => {
  it('passes three keys, the three limits and both TTLs, in order', async () => {
    evalMock.mockResolvedValue(0);
    await reserveTurn({ salonId: 'salon_a', now: NOW });

    const [script, keyCount, dayKey, monthKey, globalKey, ...argv] = evalMock.mock.calls[0] as [string, number, string, string, string, ...string[]];

    expect(keyCount).toBe(3);
    expect([dayKey, monthKey, globalKey]).toEqual(buildBudgetKeys('salon_a', NOW));
    expect(argv).toEqual([
      String(OWNER_ASSISTANT_LIMITS.turnsPerDay),
      String(OWNER_ASSISTANT_LIMITS.turnsPerMonth),
      String(OWNER_ASSISTANT_LIMITS.globalTurnsPerDay),
      String(2 * 24 * 60 * 60),
      String(35 * 24 * 60 * 60),
    ]);
    // Every check precedes every INCR: that is what makes the reservation
    // atomic, and it is the one property a future edit could silently lose.
    expect(script.indexOf('INCR')).toBeGreaterThan(script.lastIndexOf('return 1'));
    expect(script.indexOf('INCR')).toBeGreaterThan(script.lastIndexOf('return 3'));
  });

  it('namespaces keys and derives the date keys in UTC', () => {
    // The limits are defined per UTC day/month, so the key must be derived
    // from the UTC instant and never from a salon's local calendar.
    const [dayKey, monthKey, globalKey] = buildBudgetKeys('salon_a', NOW);

    expect(dayKey).toBe('luster:owner-assistant:v1:salon:salon_a:day:2026-09-16');
    expect(monthKey).toBe('luster:owner-assistant:v1:salon:salon_a:month:2026-09');
    expect(globalKey).toBe('luster:owner-assistant:v1:global:day:2026-09-16');
  });

  it('scopes the per-salon keys to the salon and shares only the global key', () => {
    const a = buildBudgetKeys('salon_a', NOW);
    const b = buildBudgetKeys('salon_b', NOW);

    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
    expect(a[2]).toBe(b[2]);
  });
});
