import { describe, expect, it, vi } from 'vitest';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getLocationById,
  getPrimaryLocation,
  getPublicPageContext,
  getServicesByIds,
  getTechnicianById,
  redirectMock,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getPublicPageContext: vi.fn(),
  getServicesByIds: vi.fn(),
  getTechnicianById: vi.fn(),
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

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

import BookTimePage from './page';

describe('BookTimePage', () => {
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
    getServicesByIds.mockResolvedValue([]);

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
});
