import { initializeStarter } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';

const mocks = vi.hoisted(() => ({ claim: vi.fn(), currentUser: vi.fn(), resolveClerkAdmin: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ currentUser: mocks.currentUser }));
vi.mock('@/libs/adminAuth', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/adminAuth')>(),
  resolveClerkAdmin: mocks.resolveClerkAdmin,
}));
vi.mock('@/features/onboarding-v1-integration/config.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/config.server')>(),
  requireOnboardingV1IntegrationEnabled: vi.fn(),
}));
vi.mock('@/features/onboarding-v1-integration/persistence.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/persistence.server')>(),
  claimOnboardingDraft: mocks.claim,
}));

/* eslint-disable import/first */
import { createPersistableOnboardingDraft } from '@/features/onboarding-v1-integration/snapshot';

import { POST } from './route';
/* eslint-enable import/first */

describe('onboarding claim authentication boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 before reading a request body or querying business choices', async () => {
    mocks.currentUser.mockResolvedValue(null);
    const request = new Request('http://localhost/api/onboarding/v1/claim', { method: 'POST', body: 'not-json' });
    const readBody = vi.spyOn(request, 'json');
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to save your Luster site.' } });
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.resolveClerkAdmin).not.toHaveBeenCalled();
  });

  it('never queries salon choices for an unverified owner', async () => {
    mocks.currentUser.mockResolvedValue({
      id: 'unverified-owner',
      primaryEmailAddressId: 'email-primary',
      emailAddresses: [{ id: 'email-primary', emailAddress: 'owner@example.test', verification: { status: 'unverified' } }],
    });
    const response = await POST(new Request('http://localhost/api/onboarding/v1/claim', { method: 'POST', body: '{}' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'EMAIL_NOT_VERIFIED' } });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.resolveClerkAdmin).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses only the verified server identity (client identity injection: %s)', async (injectIdentity) => {
    mocks.currentUser.mockResolvedValue({
      id: 'verified-owner',
      primaryEmailAddressId: 'primary',
      emailAddresses: [{ id: 'primary', emailAddress: 'owner@example.test', verification: { status: 'verified' } }],
      phoneNumbers: [],
    });
    mocks.resolveClerkAdmin.mockResolvedValue(null);
    mocks.claim.mockResolvedValue({ kind: 'success', data: { saved: true } });
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Test studio';
    state.profile.ownerName = 'Owner';
    state.profile.businessStructure = 'solo';
    state.recipe.starter = 'one_page';
    state.recipe.starterDocumentSiteId = 'local-site';
    const document = initializeStarter('one_page', { siteId: 'local-site', siteName: 'Test studio' });
    const payload = createPersistableOnboardingDraft(state, state.recipe.palettePreset, null, document);
    const response = await POST(new Request('http://localhost/api/onboarding/v1/claim', {
      method: 'POST',
      body: JSON.stringify({
        anonymousDraftToken: `draft_${'x'.repeat(48)}`,
        idempotencyKey: `claim_${'x'.repeat(48)}`,
        ...payload,
        ...(injectIdentity ? { clerkUserId: 'untrusted-client-identity', email: 'untrusted@example.test' } : {}),
      }),
    }));

    if (injectIdentity) {
      expect(response.status).toBe(400);
      expect(mocks.resolveClerkAdmin).not.toHaveBeenCalled();
      expect(mocks.claim).not.toHaveBeenCalled();

      return;
    }

    expect(response.status).toBe(200);
    expect(mocks.resolveClerkAdmin).toHaveBeenCalledWith('verified-owner');
    expect(mocks.resolveClerkAdmin.mock.invocationCallOrder[0]).toBeLessThan(mocks.claim.mock.invocationCallOrder[0]!);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ clerkUserId: 'verified-owner', email: 'owner@example.test' }), expect.any(Object));
  });

  it('does not reconcile an account for an invalid save payload', async () => {
    mocks.currentUser.mockResolvedValue({
      id: 'verified-owner',
      primaryEmailAddressId: 'primary',
      emailAddresses: [{ id: 'primary', emailAddress: 'owner@example.test', verification: { status: 'verified' } }],
      phoneNumbers: [],
    });
    const response = await POST(new Request('http://localhost/api/onboarding/v1/claim', { method: 'POST', body: '{}' }));

    expect(response.status).toBe(400);
    expect(mocks.resolveClerkAdmin).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
