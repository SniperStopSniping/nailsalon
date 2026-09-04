import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOnboardingDraftClaimStatus: vi.fn(),
  identity: {
    clerkUserId: 'clerk_status_owner',
    email: 'owner@example.test',
    name: 'Daniela',
    phoneE164: null,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  OnboardingIntegrationDisabledError: class OnboardingIntegrationDisabledError extends Error {
    code = 'ONBOARDING_INTEGRATION_DISABLED';
  },
  requireOnboardingV1IntegrationEnabled: vi.fn(),
}));
vi.mock('@/features/onboarding-v1-integration/identity.server', () => ({
  requireAuthenticatedOnboardingIdentity: vi.fn(async () => mocks.identity),
}));
vi.mock('@/features/onboarding-v1-integration/persistence.server', () => ({
  getOnboardingDraftClaimStatus: mocks.getOnboardingDraftClaimStatus,
  OnboardingPersistenceError: class OnboardingPersistenceError extends Error {},
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const ANONYMOUS_DRAFT_TOKEN = 'draft_123456789012345678901234567890';

function statusRequest(savedSiteId?: string): Request {
  return new Request('http://localhost/api/onboarding/v1/status', {
    body: JSON.stringify({ anonymousDraftToken: ANONYMOUS_DRAFT_TOKEN, savedSiteId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('POST /api/onboarding/v1/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOnboardingDraftClaimStatus.mockResolvedValue(null);
  });

  it('keeps the opaque draft token out of the URL and returns a non-cacheable status envelope', async () => {
    const request = statusRequest();

    expect(new URL(request.url).search).toBe('');
    expect(request.url).not.toContain(ANONYMOUS_DRAFT_TOKEN);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: { claim: null } });
    expect(mocks.getOnboardingDraftClaimStatus).toHaveBeenCalledWith(
      mocks.identity,
      ANONYMOUS_DRAFT_TOKEN,
      undefined,
      undefined,
    );
  });

  it('passes an optional saved site only to the server-owned membership resolver', async () => {
    const savedSiteId = '11111111-1111-4111-8111-111111111111';
    const response = await POST(statusRequest(savedSiteId));

    expect(response.status).toBe(200);
    expect(mocks.getOnboardingDraftClaimStatus).toHaveBeenCalledWith(mocks.identity, ANONYMOUS_DRAFT_TOKEN, undefined, savedSiteId);
  });
});
