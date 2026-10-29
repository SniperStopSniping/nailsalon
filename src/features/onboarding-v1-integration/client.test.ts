import type {
  OnboardingIntegrationRequestError,
} from './client';
import {
  checkOnboardingSiteSlugAvailability,
  claimOnboardingDraft,
  getOnboardingDraftClaimStatus,
  OnboardingClaimTransportError,
  prepareOnboardingCanva,
  resolveOnboardingOrganization,
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
  it('sends the pending session token only on the organization endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {
      created: false,
      organizations: [{ id: 'org_owner', name: 'Owner Studio' }],
    } }));
    await resolveOnboardingOrganization('Owner Studio', { fetcher, sessionToken: 'synthetic-session-token' });

    expect(fetcher).toHaveBeenCalledWith('/api/onboarding/v1/organization', {
      body: JSON.stringify({ businessName: 'Owner Studio' }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer synthetic-session-token' },
      method: 'POST',
      signal: undefined,
    });
  });

  it('keeps the ordinary cookie-based organization request free of an invented token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {
      created: false,
      organizations: [{ id: 'org_owner', name: 'Owner Studio' }],
    } }));
    await resolveOnboardingOrganization('Owner Studio', { fetcher });

    expect(fetcher).toHaveBeenCalledWith('/api/onboarding/v1/organization', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });

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

  it('distinguishes an uncertain claim transport failure without retrying or exposing its diagnostic', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Load failed'));
    const failure = await claimOnboardingDraft({} as never, { fetcher }).catch(error => error);

    expect(failure).toBeInstanceOf(OnboardingClaimTransportError);
    expect(failure.message).not.toContain('Load failed');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 409, 500])('preserves a known HTTP %s claim error instead of marking it uncertain', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: 'KNOWN_REJECTION', message: 'The server refused this save.' },
    }, status));
    const failure = await claimOnboardingDraft({} as never, { fetcher }).catch(error => error);

    expect(failure).not.toBeInstanceOf(OnboardingClaimTransportError);
    expect(failure).toMatchObject({ code: 'KNOWN_REJECTION', status });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not reconcile an intentional claim abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException('Aborted', 'AbortError');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);

    await expect(claimOnboardingDraft({} as never, { fetcher, signal: controller.signal })).rejects.toBe(error);
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
      confirmationMessage: 'Your core Luster app is free for life.',
      coreAccess: { status: 'active', offerKey: 'founding_lifetime_2026', claimedAt: '2026-10-07T12:00:00.000Z', expiresAt: null, monthlySoftwarePriceCents: 0, usageBilledSeparately: true },
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

  it('does not accept a legacy interest-only response as a lifetime grant', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: {
      confirmationMessage: 'Founding offer reserved.',
      intent: 'founding_interest',
      siteId: savedSite.siteId,
    } }));

    await expect(saveOnboardingPlanIntent({
      idempotencyKey: 'lifetime_key_123456789012345678901234567890',
      intent: 'founding_interest',
      siteId: savedSite.siteId,
    }, { fetcher })).rejects.toMatchObject({ code: 'LIFETIME_CLAIM_UNCONFIRMED' });
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

it('retries an interrupted Canva preparation safely without exposing a raw browser error', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

  await expect(prepareOnboardingCanva({ siteId: savedSite.siteId, expectedRevision: 4 }, { fetcher })).rejects.toMatchObject({ status: 0, message: 'We could not confirm your design is ready for review. Your saved setup is safe. Please try again.' });
  expect(fetcher).toHaveBeenCalledOnce();
});
