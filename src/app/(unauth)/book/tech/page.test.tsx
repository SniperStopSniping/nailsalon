import { describe, expect, it, vi } from 'vitest';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getPublicPageContext,
  redirectMock,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getPublicPageContext: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/libs/bookingPolicy', () => ({
  resolveTechnicianCapabilityMode: vi.fn(() => 'unrestricted'),
  technicianCanPerformServices: vi.fn(() => true),
  technicianSupportsLocation: vi.fn(() => true),
}));

vi.mock('@/libs/queries', () => ({
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getServicesByIds: vi.fn(),
  getTechniciansBySalonId: vi.fn(),
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

import BookTechPage from './page';

describe('BookTechPage', () => {
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

    await expect(BookTechPage({
      searchParams: {
        salonSlug: 'salon-a',
        locationId: 'loc_1',
      },
    })).rejects.toThrow('REDIRECT:/book/service?salonSlug=salon-a&locationId=loc_1');
  });
});
