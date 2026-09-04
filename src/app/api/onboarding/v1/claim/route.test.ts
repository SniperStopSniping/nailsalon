const mocks = vi.hoisted(() => ({ claim: vi.fn(), currentUser: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ currentUser: mocks.currentUser }));
vi.mock('@/features/onboarding-v1-integration/config.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/config.server')>(),
  requireOnboardingV1IntegrationEnabled: vi.fn(),
}));
vi.mock('@/features/onboarding-v1-integration/persistence.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/persistence.server')>(),
  claimOnboardingDraft: mocks.claim,
}));

/* eslint-disable import/first */
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
  });
});
