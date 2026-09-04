/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authProviders: vi.fn(() => Promise.resolve({
    apple: false,
    email: true,
    google: false,
    source: 'fallback' as const,
  })),
  enabled: vi.fn(() => true),
  getAdmin: vi.fn(),
  loadResume: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/onboarding-v1-integration/auth-providers.server', () => ({
  getOnboardingAuthProviderAvailability: mocks.authProviders,
}));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: mocks.enabled,
}));
vi.mock('@/features/onboarding-v1-integration/OnboardingV1Integration', () => ({
  OnboardingV1Integration: () => null,
}));
vi.mock('@/features/onboarding-v1-integration/resume.server', () => ({
  loadInitialOnboardingResumeDraft: mocks.loadResume,
}));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: mocks.getAdmin,
}));

import OnboardingV1Page from './page';

const siteId = '22222222-2222-4222-8222-222222222222';
const initialResumeDraft = {
  document: { siteId: 'saved-document' },
  media: [],
  payloadFingerprint: '0123456789abcdef',
  siteId,
  state: {},
  verifiedRevision: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.getAdmin.mockResolvedValue({ id: 'admin-owner' });
  mocks.loadResume.mockResolvedValue(initialResumeDraft);
});

describe('account-backed onboarding resume route', () => {
  it('keeps the ordinary onboarding entry public and does not query account data', async () => {
    const element = await OnboardingV1Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.loadResume).not.toHaveBeenCalled();
    expect(element.props).toEqual({
      authProviders: await mocks.authProviders(),
      locale: 'en',
    });
  });

  it('passes an exact owner-authorized revision to the client rehydration boundary', async () => {
    const element = await OnboardingV1Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ resume: 'review', revision: '4', site: siteId }),
    });

    expect(mocks.getAdmin).toHaveBeenCalledOnce();
    expect(mocks.loadResume).toHaveBeenCalledWith({
      adminId: 'admin-owner',
      siteId,
      verifiedRevision: 4,
    });
    expect(element.props).toEqual({
      authProviders: await mocks.authProviders(),
      initialResumeDraft,
      locale: 'en',
    });
  });

  it('redirects an expired session before loading the requested site', async () => {
    mocks.getAdmin.mockResolvedValue(null);

    await expect(OnboardingV1Page({
      params: Promise.resolve({ locale: 'fr' }),
      searchParams: Promise.resolve({ resume: 'review', revision: '4', site: siteId }),
    })).rejects.toThrow('REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/fr/owner-sign-in');
    expect(mocks.loadResume).not.toHaveBeenCalled();
  });

  it.each([
    ['non-owner membership'],
    ['published business'],
    ['stale revision'],
    ['missing site'],
  ])('fails closed for %s', async () => {
    mocks.loadResume.mockResolvedValue(null);

    await expect(OnboardingV1Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ resume: 'review', revision: '4', site: siteId }),
    })).rejects.toThrow('NOT_FOUND');
  });

  it('rejects malformed resume coordinates before authentication', async () => {
    await expect(OnboardingV1Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ resume: 'review', revision: '4x', site: 'not-a-site-id' }),
    })).rejects.toThrow('NOT_FOUND');

    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.loadResume).not.toHaveBeenCalled();
  });
});
