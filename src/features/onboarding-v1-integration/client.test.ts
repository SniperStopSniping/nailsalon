import type {
  OnboardingIntegrationRequestError,
} from './client';
import {
  checkOnboardingSiteSlugAvailability,
  claimOnboardingDraft,
  getOnboardingDraftClaimStatus,
  saveOnboardingPlanIntent,
} from './client';
import type { OnboardingClaimSuccess } from './contracts';

const savedSite: OnboardingClaimSuccess = {
  claimId: 'claim-id',
  created: true,
  dashboardUrl: '/en/admin',
  media: { failed: 0, pending: 0, ready: 0 },
  ownerCreatedServiceIds: [],
  payloadFingerprint: '0123456789abcdef',
  revision: 4,
  revisionId: 'revision-id',
  salonId: 'salon-id',
  salonSlug: 'isla-nail-studio',
  serviceMenuApplied: true,
  serviceMappingIssues: [],
  siteId: '11111111-1111-4111-8111-111111111111',
};

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  { headers: { 'Content-Type': 'application/json' }, status },
);

describe('onboarding integration client', () => {
  it('checks a site URL through the anonymous availability route', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {
      available: false,
      reason: 'unavailable',
      slug: 'isla-nail-studio',
    } }));
    const signal = new AbortController().signal;

    await expect(checkOnboardingSiteSlugAvailability(
      'isla-nail-studio',
      signal,
      { fetcher },
    )).resolves.toEqual({
      available: false,
      reason: 'unavailable',
      slug: 'isla-nail-studio',
    });
    expect(fetcher).toHaveBeenCalledWith('/api/onboarding/v1/slug-availability', {
      body: JSON.stringify({ slug: 'isla-nail-studio' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
  });

  it('rejects an availability response for a different URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {
      available: true,
      reason: 'available',
      slug: 'different-studio',
    } }));

    await expect(checkOnboardingSiteSlugAvailability(
      'requested-studio',
      undefined,
      { fetcher },
    )).rejects.toMatchObject({ status: 200 });
  });

  it('recognizes the verified owner’s saved URL without reporting its own row as occupied', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(checkOnboardingSiteSlugAvailability(
      'isla-nail-studio',
      undefined,
      { fetcher, knownAvailableSlug: 'isla-nail-studio' },
    )).resolves.toEqual({
      available: true,
      reason: 'available',
      slug: 'isla-nail-studio',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads canonical claim and interrupted-save status envelopes', async () => {
    const claimFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: savedSite }),
    );
    const statusFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { claim: savedSite } }),
    );

    await expect(claimOnboardingDraft({} as never, { fetcher: claimFetcher }))
      .resolves.toEqual({ status: 'saved', value: savedSite });
    await expect(getOnboardingDraftClaimStatus(
      'draft_token_123456789012345678901234567890',
      { fetcher: statusFetcher },
    )).resolves.toEqual({ claim: savedSite });
    expect(statusFetcher).toHaveBeenCalledWith(
      '/api/onboarding/v1/status',
      {
        body: JSON.stringify({
          anonymousDraftToken: 'draft_token_123456789012345678901234567890',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: undefined,
      },
    );
  });

  it('returns a typed conflict without treating it as a failed save', async () => {
    const conflict = {
      businesses: [{ hasSite: false, id: 'salon-id', name: 'Isla', slug: 'isla' }],
      code: 'BUSINESS_TARGET_REQUIRED' as const,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: conflict.code, conflict, message: 'Choose a workspace.' },
    }, 409));

    await expect(claimOnboardingDraft({} as never, { fetcher }))
      .resolves.toEqual({ conflict, status: 'conflict' });
  });

  it('posts a legacy saved-site fallback for server owner verification without URL tokens', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: { claim: savedSite } }));
    const signal = new AbortController().signal;
    await getOnboardingDraftClaimStatus('rotated-draft-token', { fetcher, savedSiteId: savedSite.siteId, signal });

    expect(fetcher).toHaveBeenCalledWith('/api/onboarding/v1/status', {
      body: JSON.stringify({ anonymousDraftToken: 'rotated-draft-token', savedSiteId: savedSite.siteId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
  });

  it('stores plan intent through one truthful server response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {
      confirmationMessage: 'Nothing was charged today.',
      dashboardUrl: '/en/admin',
      intent: 'founding_interest',
      siteId: savedSite.siteId,
    } }));

    await expect(saveOnboardingPlanIntent({
      idempotencyKey: 'plan_key_123456789012345678901234567890',
      intent: 'founding_interest',
      siteId: savedSite.siteId,
    }, { fetcher })).resolves.toMatchObject({
      intent: 'founding_interest',
      siteId: savedSite.siteId,
    });
  });

  it('preserves the owner-safe API error for retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: 'SAVE_FAILED', message: 'Your work is still safe on this device.' },
    }, 503));

    await expect(getOnboardingDraftClaimStatus('draft-token', { fetcher }))
      .rejects.toEqual(expect.objectContaining<Partial<OnboardingIntegrationRequestError>>({
        code: 'SAVE_FAILED',
        message: 'Your work is still safe on this device.',
        status: 503,
      }));
  });
});
