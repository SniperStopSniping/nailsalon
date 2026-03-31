import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getClientSession,
  getLocationById,
  getPrimaryLocation,
  getPublicPageContext,
  resolvePublicBookingTechnicianContext,
  redirectMock,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getClientSession: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getPublicPageContext: vi.fn(),
  resolvePublicBookingTechnicianContext: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/queries', () => ({
  getLocationById,
  getPrimaryLocation,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/publicBookingTechnicians', () => ({
  resolvePublicBookingTechnicianContext,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

import BookTimePage from './page';

describe('BookTimePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
    getClientSession.mockResolvedValue(null);
  });

  it('redirects back to service selection when no services are selected', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: null,
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});

    await expect(BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        techId: 'tech_1',
      },
    })).rejects.toThrow('REDIRECT:/book/service?salonSlug=salon-a&techId=tech_1');
    expect(resolvePublicBookingTechnicianContext).not.toHaveBeenCalled();
  });

  it('redirects back to service selection when selected services no longer exist', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: null,
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
    resolvePublicBookingTechnicianContext.mockRejectedValue(new Error('INVALID_SERVICES'));

    await expect(BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'tech_1',
      },
    })).rejects.toThrow('REDIRECT:/book/service?salonSlug=salon-a&techId=tech_1');
  });

  it('uses a tenant-aware status redirect when a slug route is active', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: null,
      },
    });
    checkSalonStatus.mockResolvedValue({ redirectPath: '/cancelled' });
    buildTenantRedirectPath.mockReturnValue('/en/salon-a/cancelled');

    await expect(BookTimePage({
      params: {
        locale: 'en',
        slug: 'salon-a',
      },
      searchParams: {
        serviceIds: 'srv_1',
        techId: 'tech_1',
      },
    })).rejects.toThrow('REDIRECT:/en/salon-a/cancelled');
  });

  it('redirects to time with techId when exactly one compatible technician exists', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        services: [{ id: 'svc_combo', name: 'BIAB', priceCents: 5000, durationMinutes: 75 }],
        addOns: [],
        totalPriceCents: 5000,
        visibleDurationMinutes: 75,
      },
      activeTechnicians: [],
      compatibleTechnicians: [],
      compatibleCount: 1,
      compatibleTechnicianIds: ['tech_1'],
      soleCompatibleTechnician: {
        id: 'tech_1',
        name: 'Taylor',
        imageUrl: '/tech.jpg',
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['svc_combo'],
        serviceIds: ['svc_combo'],
        primaryLocationId: null,
      },
      requestedTechnicianId: null,
      hasValidExplicitTechnician: false,
      validExplicitTechnician: null,
      effectiveTechnicianId: 'tech_1',
      effectiveTechnician: {
        id: 'tech_1',
        name: 'Taylor',
        imageUrl: '/tech.jpg',
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['svc_combo'],
        serviceIds: ['svc_combo'],
        primaryLocationId: null,
      },
      effectiveTechnicianSelectionSource: 'auto',
      shouldAutoSkipTech: true,
    });

    await expect(BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        baseServiceId: 'svc_combo',
        selectedAddOns: JSON.stringify([{ addOnId: 'addon_1' }]),
      },
    })).rejects.toThrow(
      'REDIRECT:/book/time?salonSlug=salon-a&baseServiceId=svc_combo&selectedAddOns=%5B%7B%22addOnId%22%3A%22addon_1%22%7D%5D&techId=tech_1',
    );
  });

  it('restores the normal artist step when multiple compatible technicians exist and the client skipped it', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        services: [{ id: 'svc_1', name: 'BIAB', priceCents: 5000, durationMinutes: 75 }],
        addOns: [],
        totalPriceCents: 5000,
        visibleDurationMinutes: 75,
      },
      activeTechnicians: [],
      compatibleTechnicians: [],
      compatibleCount: 2,
      compatibleTechnicianIds: ['tech_1', 'tech_2'],
      soleCompatibleTechnician: null,
      requestedTechnicianId: null,
      hasValidExplicitTechnician: false,
      validExplicitTechnician: null,
      effectiveTechnicianId: null,
      effectiveTechnician: null,
      effectiveTechnicianSelectionSource: null,
      shouldAutoSkipTech: false,
    });

    await expect(BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
      },
    })).rejects.toThrow('REDIRECT:/book/tech?salonSlug=salon-a&baseServiceId=svc_1');
  });

  it('passes the logged-in client phone into canonical technician resolution so time-step totals stay aligned', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: null,
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
    getClientSession.mockResolvedValue({ phone: '+14165550123' });
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        services: [{
          id: 'svc_1',
          name: 'BIAB',
          priceCents: 5000,
          durationMinutes: 75,
        }],
        addOns: [],
        totalPriceCents: 3750,
        visibleDurationMinutes: 75,
      },
      activeTechnicians: [],
      compatibleTechnicians: [],
      compatibleCount: 0,
      compatibleTechnicianIds: [],
      soleCompatibleTechnician: null,
      requestedTechnicianId: null,
      hasValidExplicitTechnician: false,
      validExplicitTechnician: null,
      effectiveTechnicianId: null,
      effectiveTechnician: null,
      effectiveTechnicianSelectionSource: null,
      shouldAutoSkipTech: false,
    });

    await BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
        techId: 'any',
      },
    });

    expect(resolvePublicBookingTechnicianContext).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '+14165550123',
    }));
  });
});
