import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { hashRateLimitIdentifier, redis } = vi.hoisted(() => ({
  hashRateLimitIdentifier: vi.fn((value: string) => `hashed-${value}`),
  redis: {
    eval: vi.fn(),
  },
}));

vi.mock('@/core/redis/redisClient', () => ({ redis }));
vi.mock('@/libs/authConfig.server', () => ({ hashRateLimitIdentifier }));

/* eslint-disable import/first */
import {
  checkServiceImagePresignRateLimit,
  resetServiceImagePresignRateLimitForTests,
  SERVICE_IMAGE_PRESIGN_LIMIT,
  SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS,
} from './serviceImagePresignRateLimit.server';
/* eslint-enable import/first */

describe('service image presign rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetServiceImagePresignRateLimitForTests();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  it('atomically increments a salon-wide Redis counter with a one-hour expiry', async () => {
    redis.eval.mockResolvedValue([1, SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS]);

    await expect(
      checkServiceImagePresignRateLimit('salon_1'),
    ).resolves.toEqual({
      allowed: true,
      remaining: SERVICE_IMAGE_PRESIGN_LIMIT - 1,
    });

    expect(hashRateLimitIdentifier).toHaveBeenCalledWith('salon_1');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining(`redis.call('INCR', KEYS[1])`),
      1,
      'luster:service-image-presign:prod:salon:hashed-salon_1',
      SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS,
    );
  });

  it('does not share Redis quota between production and branch-scoped previews', async () => {
    redis.eval.mockResolvedValue([1, SERVICE_IMAGE_PRESIGN_WINDOW_SECONDS]);

    await checkServiceImagePresignRateLimit('salon_1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'feat/service-image-controls');
    await checkServiceImagePresignRateLimit('salon_1');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'another-preview');
    await checkServiceImagePresignRateLimit('salon_1');

    const keys = redis.eval.mock.calls.map(call => call[2]);

    expect(new Set(keys)).toHaveLength(3);
    expect(keys[1]).toMatch(
      /^luster:service-image-presign:preview_[a-f0-9]{12}:salon:hashed-salon_1$/,
    );
  });

  it('allows the twentieth request and rate-limits the twenty-first', async () => {
    redis.eval
      .mockResolvedValueOnce([SERVICE_IMAGE_PRESIGN_LIMIT, 121])
      .mockResolvedValueOnce([SERVICE_IMAGE_PRESIGN_LIMIT + 1, 119]);

    await expect(
      checkServiceImagePresignRateLimit('salon_1'),
    ).resolves.toEqual({
      allowed: true,
      remaining: 0,
    });
    await expect(
      checkServiceImagePresignRateLimit('salon_1'),
    ).resolves.toEqual({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: 119,
    });
  });

  it.each([
    ['production', 'production'],
    ['production', 'preview'],
  ])(
    'fails closed when Redis is unhealthy in %s / %s',
    async (nodeEnv, vercelEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      redis.eval.mockRejectedValue(new Error('Redis unavailable'));

      await expect(
        checkServiceImagePresignRateLimit('salon_1'),
      ).resolves.toEqual({
        allowed: false,
        reason: 'unavailable',
      });
    },
  );

  it('uses the bounded in-memory fallback only in local development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    redis.eval.mockRejectedValue(new Error('Redis unavailable'));

    const results = await Promise.all(
      Array.from(
        { length: SERVICE_IMAGE_PRESIGN_LIMIT + 1 },
        () => checkServiceImagePresignRateLimit('salon_1'),
      ),
    );

    expect(results.slice(0, SERVICE_IMAGE_PRESIGN_LIMIT)).toEqual(
      Array.from(
        { length: SERVICE_IMAGE_PRESIGN_LIMIT },
        (_, index) => ({
          allowed: true,
          remaining: SERVICE_IMAGE_PRESIGN_LIMIT - index - 1,
        }),
      ),
    );
    expect(results.at(-1)).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
    });
  });

  it('fails closed on malformed Redis counter results in hosted environments', async () => {
    redis.eval.mockResolvedValue(['not-a-count', -1]);

    await expect(
      checkServiceImagePresignRateLimit('salon_1'),
    ).resolves.toEqual({
      allowed: false,
      reason: 'unavailable',
    });
  });
});
