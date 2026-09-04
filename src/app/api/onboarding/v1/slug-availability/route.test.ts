import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkEndpointRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  getOnboardingSiteSlugAvailability: vi.fn(),
  rateLimitResponse: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/onboarding-v1-integration/config.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/config.server')>(),
  requireOnboardingV1IntegrationEnabled: vi.fn(),
}));
vi.mock('@/features/onboarding-v1-integration/persistence.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/persistence.server')>(),
  getOnboardingSiteSlugAvailability: mocks.getOnboardingSiteSlugAvailability,
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: mocks.checkEndpointRateLimit,
  getClientIp: mocks.getClientIp,
  rateLimitResponse: mocks.rateLimitResponse,
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const request = (body: unknown): Request => new Request(
  'http://localhost/api/onboarding/v1/slug-availability',
  {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.42' },
    method: 'POST',
  },
);

describe('POST /api/onboarding/v1/slug-availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkEndpointRateLimit.mockReturnValue({ allowed: true });
    mocks.getClientIp.mockReturnValue('192.0.2.42');
    mocks.getOnboardingSiteSlugAvailability.mockResolvedValue({
      available: true,
      reason: 'available',
      slug: 'new-studio',
    });
  });

  it('checks the global URL namespace before login without returning salon metadata', async () => {
    const response = await POST(request({ slug: ' New-Studio ' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      data: { available: true, reason: 'available', slug: 'new-studio' },
    });
    expect(mocks.getOnboardingSiteSlugAvailability).toHaveBeenCalledWith('New-Studio');
    expect(mocks.checkEndpointRateLimit).toHaveBeenCalledWith(
      'onboarding/v1/slug-availability',
      '192.0.2.42',
      'GENERAL',
    );
  });

  it('rejects malformed input without querying the URL namespace', async () => {
    const response = await POST(request({ slug: 'x'.repeat(65) }));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(mocks.getOnboardingSiteSlugAvailability).not.toHaveBeenCalled();
  });

  it('rate limits anonymous enumeration before reading the request body', async () => {
    mocks.checkEndpointRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 30_000 });
    mocks.rateLimitResponse.mockReturnValue(Response.json(
      { error: { code: 'RATE_LIMIT_EXCEEDED' } },
      { status: 429 },
    ));
    const incoming = request({ slug: 'new-studio' });
    const readBody = vi.spyOn(incoming, 'json');
    const response = await POST(incoming);

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.getOnboardingSiteSlugAvailability).not.toHaveBeenCalled();
  });
});
