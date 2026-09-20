import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ client: null as null | { eval: ReturnType<typeof vi.fn> } }));
vi.mock('@/core/redis/redisClient', () => ({ get redis() {
  return holder.client;
} }));

const { completeCustomerRevision, customerRevisionKey, isCurrentCustomerRevision } = await import('./revision.server');
const state = { salonId: 'salon-a', sessionId: 'session', turnIndex: 1 };
const evaluate = vi.fn();

beforeEach(() => {
  evaluate.mockReset();
  holder.client = { eval: evaluate };
});

afterEach(() => vi.useRealTimers());

describe('customer consultation revision authority', () => {
  it('isolates tenant, session and deployment while keeping the customer Redis cluster slot', () => {
    expect(customerRevisionKey(state)).toContain('{customer-booking-assistant}');
    expect(customerRevisionKey(state)).not.toBe(customerRevisionKey({ ...state, salonId: 'salon-b' }));
    expect(customerRevisionKey(state)).not.toBe(customerRevisionKey({ ...state, sessionId: 'other' }));
  });

  it('accepts only an affirmative atomic authority result', async () => {
    evaluate.mockResolvedValueOnce(1).mockResolvedValueOnce('1').mockResolvedValueOnce(null).mockResolvedValueOnce(0);

    await expect(completeCustomerRevision(state, 'signed-token')).resolves.toBe(true);
    await expect(isCurrentCustomerRevision(state, 'signed-token')).resolves.toBe(true);
    await expect(isCurrentCustomerRevision(state, 'signed-token')).resolves.toBe(false);
    await expect(completeCustomerRevision(state, 'signed-token')).resolves.toBe(false);
    expect(evaluate.mock.calls[0]?.slice(1, 4)).toEqual([1, customerRevisionKey(state), '1']);
    expect(evaluate.mock.calls[0]).not.toContain('signed-token');
  });

  it('fails closed for absent, rejected and timed-out Redis', async () => {
    holder.client = null;

    await expect(isCurrentCustomerRevision(state, 'signed-token')).resolves.toBe(false);

    holder.client = { eval: evaluate };
    evaluate.mockRejectedValueOnce(new Error('unhealthy'));

    await expect(isCurrentCustomerRevision(state, 'signed-token')).resolves.toBe(false);

    vi.useFakeTimers();
    evaluate.mockImplementationOnce(() => new Promise(() => {}));
    const pending = completeCustomerRevision(state, 'signed-token');
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(pending).resolves.toBe(false);
  });
});
