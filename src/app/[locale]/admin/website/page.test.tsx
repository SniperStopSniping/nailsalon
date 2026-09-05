import { beforeEach, describe, expect, it, vi } from 'vitest';

import WebsiteHubPage from './page';

const mocks = vi.hoisted(() => ({ session: vi.fn(), guard: vi.fn(), salon: vi.fn(), handoff: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => {
  throw new Error(`redirect:${url}`);
}, notFound: () => {
  throw new Error('not found');
} }));
vi.mock('@/libs/adminAuth', () => ({ getAdminSession: mocks.session, requireAdmin: mocks.guard }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/bookingPageConfig', () => ({ resolveBookingPageConfig: () => ({ draft: { layout: 'quick_book' }, live: { layout: 'quick_book' } }) }));
vi.mock('@/libs/bookingPageContent', () => ({ resolveBookingPageContent: () => ({ draft: {}, live: {} }) }));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({ isOnboardingV1IntegrationEnabled: () => true }));
vi.mock('@/features/onboarding-v1-integration/admin-handoff.server', () => ({ getOnboardingSiteHandoff: mocks.handoff }));

const input = { params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ salon: 'my-salon' }) };

describe('Booking Page hub authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: 'owner', salons: [{ salonId: 'salon-1', role: 'owner' }] });
    mocks.guard.mockResolvedValue({ ok: true });
    mocks.salon.mockResolvedValue({ id: 'salon-1', name: 'My Salon', slug: 'my-salon', settings: {}, publicationStatus: 'published' });
    mocks.handoff.mockResolvedValue(null);
  });

  it('redirects signed-out visitors before reading a salon', async () => {
    mocks.session.mockResolvedValue(null);

    await expect(WebsiteHubPage(input)).rejects.toThrow('redirect:/en/owner-sign-in');
    expect(mocks.salon).not.toHaveBeenCalled();
  });

  it('denies another tenant before resolving saved setup', async () => {
    mocks.guard.mockResolvedValue({ ok: false });

    await expect(WebsiteHubPage(input)).rejects.toThrow('not found');
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it('uses current canonical salon data and does not manufacture a setup link', async () => {
    const page = await WebsiteHubPage(input);

    expect(mocks.guard).toHaveBeenCalledWith('salon-1');
    expect(page.props).toMatchObject({ salonName: 'My Salon', salonSlug: 'my-salon', published: true, hasDraftChanges: false, setupUrl: null });
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
});
