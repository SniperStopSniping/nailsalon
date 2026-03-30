import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getClientSession,
  getLocationById,
  getPrimaryLocation,
  getPublicPageContext,
  getServicesByIds,
  getTechnicianById,
  resolvePublicBookingSelection,
  redirectMock,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getClientSession: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getPublicPageContext: vi.fn(),
  getServicesByIds: vi.fn(),
  getTechnicianById: vi.fn(),
  resolvePublicBookingSelection: vi.fn(),
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
  getServicesByIds,
  getTechnicianById,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/publicBookingSelection', () => ({
  resolvePublicBookingSelection,
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
    expect(getServicesByIds).not.toHaveBeenCalled();
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
    resolvePublicBookingSelection.mockRejectedValue(new Error('INVALID_SERVICES'));

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

  it('redirects back to tech with an explicit unsupported flag when the technician cannot perform the selected service', async () => {
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
    resolvePublicBookingSelection.mockRejectedValue(new Error('TECHNICIAN_SERVICE_UNSUPPORTED'));

    await expect(BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        baseServiceId: 'svc_combo',
        techId: 'tech_1',
        selectedAddOns: JSON.stringify([{ addOnId: 'addon_1' }]),
      },
    })).rejects.toThrow(
      'REDIRECT:/book/tech?salonSlug=salon-a&baseServiceId=svc_combo&selectedAddOns=%5B%7B%22addOnId%22%3A%22addon_1%22%7D%5D&techError=unsupported',
    );
  });

  it('passes the logged-in client phone into public booking selection so time-step totals match confirm', async () => {
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
    resolvePublicBookingSelection.mockResolvedValue({
      services: [{
        id: 'svc_1',
        name: 'BIAB',
        priceCents: 5000,
        durationMinutes: 75,
      }],
      addOns: [],
      totalPriceCents: 3750,
      visibleDurationMinutes: 75,
    });

    await BookTimePage({
      searchParams: {
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
        techId: 'any',
      },
    });

    expect(resolvePublicBookingSelection).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '+14165550123',
    }));
  });
});
