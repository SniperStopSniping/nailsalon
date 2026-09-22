import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPublicBookingAttemptRateLimit } from './publicBookingAttemptRateLimit';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ eval: vi.fn(), hosted: vi.fn() }));
vi.mock('@/core/redis/redisClient', () => ({ redis: { eval: mocks.eval } }));
vi.mock('@/libs/authConfig.server', () => ({ hashRateLimitIdentifier: (value: string) => `hashed-${value.length}`, isHostedDeployment: mocks.hosted }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eval.mockResolvedValue(1);
  mocks.hosted.mockReturnValue(true);
});

describe('durable booking attempt rate admission', () => {
  it('uses shared expiring IP and salon buckets without storing the raw IP', async () => {
    await expect(checkPublicBookingAttemptRateLimit('203.0.113.25', 'salon-a')).resolves.toBe(true);
    expect(mocks.eval).toHaveBeenCalledTimes(2);
    expect(mocks.eval.mock.calls.map(call => call[2])).toEqual([
      'luster:booking-attempt:ip:hashed-12',
      'luster:booking-attempt:salon:salon-a:hashed-12',
    ]);
    expect(mocks.eval.mock.calls.every(call => call[3] === 60)).toBe(true);
  });

  it('rejects when either bucket is exhausted', async () => {
    mocks.eval.mockResolvedValueOnce(61).mockResolvedValueOnce(1);

    await expect(checkPublicBookingAttemptRateLimit('203.0.113.25', 'salon-a')).resolves.toBe(false);
  });

  it('fails closed on distributed limiter failure', async () => {
    mocks.eval.mockRejectedValue(new Error('unavailable'));

    await expect(checkPublicBookingAttemptRateLimit('203.0.113.25', 'salon-a')).rejects.toThrow('BOOKING_ATTEMPT_RATE_LIMIT_UNAVAILABLE');
  });
});
