import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cleanupPendingServiceImages,
  isCloudinaryConfigured,
} = vi.hoisted(() => ({
  cleanupPendingServiceImages: vi.fn(),
  isCloudinaryConfigured: vi.fn(),
}));

vi.mock('@/libs/Cloudinary', () => ({ isCloudinaryConfigured }));
vi.mock('@/libs/authConfig.server', () => ({
  constantTimeSecretEqual: (left: string, right: string) => left === right,
}));
vi.mock('@/libs/serviceImagePendingCleanup.server', () => ({
  cleanupPendingServiceImages,
}));

/* eslint-disable import/first */
import { GET, POST } from './route';
/* eslint-enable import/first */

const summary = {
  pagesScanned: 1,
  scanned: 2,
  eligible: 2,
  actionsAttempted: 2,
  deleted: 1,
  referenced: 1,
  pendingCleared: 1,
  skippedYoung: 0,
  skippedUnsafe: 0,
  failures: 0,
  truncated: false,
};

describe('/api/service-images/pending/cleanup', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'expected-secret');
    isCloudinaryConfigured.mockReturnValue(true);
    cleanupPendingServiceImages.mockResolvedValue(summary);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(new Request(
      'http://localhost/api/service-images/pending/cleanup',
    ));

    expect(response.status).toBe(500);
    expect(cleanupPendingServiceImages).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid cron secret', async () => {
    const response = await GET(new Request(
      'http://localhost/api/service-images/pending/cleanup',
      { headers: { 'x-cron-secret': 'wrong-secret' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(cleanupPendingServiceImages).not.toHaveBeenCalled();
  });

  it('accepts Vercel bearer authentication and returns the bounded summary', async () => {
    const response = await GET(new Request(
      'http://localhost/api/service-images/pending/cleanup',
      { headers: { authorization: 'Bearer expected-secret' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: summary });
    expect(cleanupPendingServiceImages).toHaveBeenCalledTimes(1);
  });

  it('accepts x-cron-secret for manual POST invocations', async () => {
    const response = await POST(new Request(
      'http://localhost/api/service-images/pending/cleanup',
      {
        method: 'POST',
        headers: { 'x-cron-secret': 'expected-secret' },
      },
    ));

    expect(response.status).toBe(200);
    expect(cleanupPendingServiceImages).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Cloudinary is unavailable', async () => {
    isCloudinaryConfigured.mockReturnValue(false);

    const response = await GET(new Request(
      'http://localhost/api/service-images/pending/cleanup',
      { headers: { authorization: 'Bearer expected-secret' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('IMAGE_STORAGE_UNAVAILABLE');
    expect(cleanupPendingServiceImages).not.toHaveBeenCalled();
  });

  it('returns a private generic failure without exposing provider details', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    cleanupPendingServiceImages.mockRejectedValue(
      new Error('provider secret detail'),
    );

    const response = await GET(new Request(
      'http://localhost/api/service-images/pending/cleanup',
      { headers: { authorization: 'Bearer expected-secret' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Pending service image cleanup failed',
      },
    });
    expect(JSON.stringify(body)).not.toContain('provider secret detail');
    expect(consoleError).toHaveBeenCalledWith(
      'Pending service image cleanup failed',
    );
  });
});
