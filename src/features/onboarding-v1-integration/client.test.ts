import type {
  OnboardingIntegrationRequestError,
} from './client';
import {
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
