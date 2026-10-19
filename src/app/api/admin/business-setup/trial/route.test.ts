import { beforeEach, expect, it, vi } from 'vitest';

import { OnboardingPersistenceError } from '@/features/onboarding-v1-integration/persistence.server';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ enabled: vi.fn(), identity: vi.fn(), open: vi.fn() }));
vi.mock('@/features/business-setup/access.server', () => ({ setupPreviewTrialEnabled: mocks.enabled }));
vi.mock('@/features/business-setup/preview-trial.server', () => ({ openPreviewTrial: mocks.open }));
vi.mock('@/features/onboarding-v1-integration/identity.server', () => ({ requireAuthenticatedOnboardingIdentity: mocks.identity }));
const identity = { clerkUserId: 'verified-test-owner', email: 'owner@example.invalid' };
const request = (origin = 'https://preview.example.test') => new Request('https://preview.example.test/api/admin/business-setup/trial', { method: 'POST', headers: { origin }, body: JSON.stringify({ salonId: 'another-salon', clerkUserId: 'another-owner' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.identity.mockResolvedValue(identity);
  mocks.open.mockResolvedValue('ai-test-saved-owner');
});

it('rejects disabled and cross-origin requests before resolving an owner', async () => {
  mocks.enabled.mockReturnValue(false);

  expect((await POST(request())).status).toBe(404);

  mocks.enabled.mockReturnValue(true);

  expect((await POST(request('https://attacker.invalid'))).status).toBe(403);
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it.each([['UNAUTHENTICATED', 401], ['EMAIL_NOT_VERIFIED', 403]] as const)('refuses %s without opening a salon', async (code, status) => {
  mocks.identity.mockRejectedValue(new OnboardingPersistenceError(code, 'Verify your account.', status));

  expect((await POST(request())).status).toBe(status);
  expect(mocks.open).not.toHaveBeenCalled();
});

it('ignores client identities and returns only the server-owned trial with no caching', async () => {
  const response = await POST(request());

  expect(mocks.open).toHaveBeenCalledWith(identity);
  expect(await response.json()).toEqual({ data: { slug: 'ai-test-saved-owner' } });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('keeps unexpected connection details out of the response', async () => {
  mocks.open.mockRejectedValue(new Error('private database detail'));
  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private database detail');
});
