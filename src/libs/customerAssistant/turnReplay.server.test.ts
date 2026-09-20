import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), current: vi.fn() }));
vi.mock('./revision.server', () => ({ isCurrentCustomerRevision: mocks.current }));
vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({ redis: { get: mocks.get, set: mocks.set } }));

const { createCustomerConversation, signCustomerConversation } = await import('./conversation.server');
const { readCompletedCustomerTurn, storeCompletedCustomerTurn } = await import('./turnReplay.server');

const secret = 'customer-assistant-replay-secret-which-is-long-enough';
const request = { salonId: 'salon-a', conversation: '', message: 'Book Gel-X', locale: 'en' as const };

function response(salonId = request.salonId, signingSecret = secret) {
  return {
    conversation: signCustomerConversation(createCustomerConversation(salonId, signingSecret), signingSecret),
    result: { kind: 'unavailable' as const, reason: 'unavailable' as const },
  };
}

beforeEach(() => {
  vi.useRealTimers();
  mocks.get.mockReset();
  mocks.set.mockReset();
  mocks.current.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('completed customer-turn replay cache', () => {
  it('reuses an identical request only after validating its signed response', async () => {
    const completed = response();
    await storeCompletedCustomerTurn(request, completed);
    const encoded = mocks.set.mock.calls[0]?.[1];
    mocks.get.mockResolvedValue(encoded);

    await expect(readCompletedCustomerTurn(request, secret)).resolves.toEqual(completed);
    await expect(readCompletedCustomerTurn(request, secret)).resolves.toEqual(completed);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), JSON.stringify(completed), 'EX', 7_260);
  });

  it('rejects cross-tenant, wrong-secret, and tampered cached responses', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify(response('salon-b')));

    await expect(readCompletedCustomerTurn(request, secret)).resolves.toBeNull();

    mocks.get.mockResolvedValueOnce(JSON.stringify(response(request.salonId, `${secret}different`)));

    await expect(readCompletedCustomerTurn(request, secret)).resolves.toBeNull();

    const completed = response();
    mocks.get.mockResolvedValueOnce(JSON.stringify({ ...completed, conversation: `${completed.conversation}tampered` }));

    await expect(readCompletedCustomerTurn(request, secret)).resolves.toBeNull();
  });

  it('never replays an obsolete proposal or one superseded by an in-flight turn', async () => {
    mocks.get.mockResolvedValue(JSON.stringify(response()));
    mocks.current.mockResolvedValue(false);

    await expect(readCompletedCustomerTurn(request, secret)).resolves.toBeNull();
  });

  it('separates cache keys by tenant and message', async () => {
    const completed = response();
    await storeCompletedCustomerTurn(request, completed);
    await storeCompletedCustomerTurn({ ...request, message: 'Book a French tip' }, completed);
    await storeCompletedCustomerTurn({ ...request, salonId: 'salon-b' }, completed);

    const keys = mocks.set.mock.calls.map(([cacheKey]) => cacheKey);

    expect(new Set(keys).size).toBe(3);
  });

  it('returns after the one-second cache deadline and cache failures never escape', async () => {
    vi.useFakeTimers();
    mocks.get.mockReturnValue(new Promise(() => {}));
    const pending = readCompletedCustomerTurn(request, secret);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBeNull();

    mocks.set.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(storeCompletedCustomerTurn(request, response())).resolves.toBeUndefined();

    mocks.get.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(readCompletedCustomerTurn(request, secret)).resolves.toBeNull();
  });
});
