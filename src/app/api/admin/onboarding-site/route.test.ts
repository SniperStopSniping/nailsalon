import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH } from './route';

const {
  enabledMock,
  getAdminMock,
  getHandoffMock,
  requireAdminSalonMock,
  updateHandoffMock,
} = vi.hoisted(() => ({
  enabledMock: vi.fn(() => true),
  getAdminMock: vi.fn(),
  getHandoffMock: vi.fn(),
  requireAdminSalonMock: vi.fn(),
  updateHandoffMock: vi.fn(),
}));

vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: enabledMock,
}));

vi.mock('@/features/onboarding-v1-integration/admin-handoff.server', () => ({
  getOnboardingSiteHandoff: getHandoffMock,
  updateOnboardingSiteHandoff: updateHandoffMock,
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: getAdminMock,
  requireAdminSalon: requireAdminSalonMock,
}));

const salon = {
  id: 'salon_1',
  publicationStatus: 'draft',
  slug: 'isla',
};

beforeEach(() => {
  vi.clearAllMocks();
  enabledMock.mockReturnValue(true);
  getAdminMock.mockResolvedValue({
    id: 'admin_1',
    salons: [{ role: 'owner', salonId: salon.id }],
  });
  requireAdminSalonMock.mockResolvedValue({ error: null, salon });
  getHandoffMock.mockResolvedValue({
    handoff: { planIntent: 'free', showWelcome: true, tourCompleted: false },
    setup: {
      googleCalendar: 'not_started',
      payments: 'not_started',
      servicesAdded: true,
      shareLink: 'not_started',
    },
    site: {
      hasVisibleBookingSection: true,
      id: '2d799a1b-2eab-4de5-b005-a1e688658bad',
      previewUrl: '/en/admin/website/preview/2d799a1b-2eab-4de5-b005-a1e688658bad',
      revision: 1,
      setupUrl: '/en/onboarding-v1?resume=review&site=2d799a1b-2eab-4de5-b005-a1e688658bad&revision=3',
    },
  });
  updateHandoffMock.mockResolvedValue(true);
});

describe('/api/admin/onboarding-site', () => {
  it('fails closed behind the integration flag', async () => {
    enabledMock.mockReturnValue(false);
    const response = await GET(new Request('http://localhost/api/admin/onboarding-site?salonSlug=isla'));

    expect(response.status).toBe(404);
    expect(requireAdminSalonMock).not.toHaveBeenCalled();
  });

  it('returns only the signed-in member salon handoff without caching', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/onboarding-site?salonSlug=isla&locale=en',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(requireAdminSalonMock).toHaveBeenCalledWith('isla');
    expect(getHandoffMock).toHaveBeenCalledWith({ canEditSetup: true, locale: 'en', salon });
  });

  it.each([
    [{ role: 'admin', salonId: salon.id }],
    [{ role: 'owner', salonId: 'another_salon' }],
  ])('does not offer owner-only setup without ownership of this salon (%j)', async (membership) => {
    getAdminMock.mockResolvedValue({ id: 'admin_1', salons: [membership] });

    const response = await GET(new Request(
      'http://localhost/api/admin/onboarding-site?salonSlug=isla&locale=en',
    ));

    expect(response.status).toBe(200);
    expect(getHandoffMock).toHaveBeenCalledWith({ canEditSetup: false, locale: 'en', salon });
  });

  it('scopes welcome and tour writes to the authorized salon and current site', async () => {
    const siteId = '2d799a1b-2eab-4de5-b005-a1e688658bad';
    const response = await PATCH(new Request(
      'http://localhost/api/admin/onboarding-site?salonSlug=isla',
      {
        body: JSON.stringify({ action: 'dismiss_welcome', siteId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      },
    ));

    expect(response.status).toBe(200);
    expect(updateHandoffMock).toHaveBeenCalledWith({
      action: 'dismiss_welcome',
      salonId: 'salon_1',
      siteId,
    });
  });

  it('rejects malformed state changes without touching persistence', async () => {
    const response = await PATCH(new Request(
      'http://localhost/api/admin/onboarding-site?salonSlug=isla',
      {
        body: JSON.stringify({ action: 'publish_site' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      },
    ));

    expect(response.status).toBe(400);
    expect(updateHandoffMock).not.toHaveBeenCalled();
  });
});
