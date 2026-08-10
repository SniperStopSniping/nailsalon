import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DraftSalonGateResult } from '@/libs/ownerPreview';

import BookTechPage from './page';

vi.mock('server-only', () => ({}));

const {
  bookTechClientMock,
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getClientSession,
  getLocationById,
  getPrimaryLocation,
  getPublicPageContext,
  redirectMock,
  resolveDraftSalonAccess,
  resolvePublicBookingTechnicianContext,
} = vi.hoisted(() => ({
  bookTechClientMock: vi.fn(({ technicians }: { technicians: unknown }) => (
    <pre>{JSON.stringify(technicians)}</pre>
  )),
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getClientSession: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getPublicPageContext: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  resolveDraftSalonAccess: vi.fn((): Promise<DraftSalonGateResult> => Promise.resolve({
    allowed: true,
    isPreviewingDraftSalon: false,
    isPreviewingDraftConfig: false,
    actorType: null,
  })),
  resolvePublicBookingTechnicianContext: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('./BookTechClient', () => ({
  BookTechClient: bookTechClientMock,
}));

vi.mock('@/libs/queries', () => ({
  getLocationById,
  getPrimaryLocation,
}));

vi.mock('@/libs/publicBookingTechnicians', () => ({
  resolvePublicBookingTechnicianContext,
}));

vi.mock('@/libs/ownerPreview', () => ({
  resolveDraftSalonAccess,
}));

vi.mock('@/libs/bookingPageConfig', () => ({
  resolveBookingPageConfig: vi.fn(() => ({
    version: 1,
    draft: {
      layout: 'quick_book',
      stylePack: 'default',
      tokenOverrides: null,
      sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
      sectionVariants: {},
      hiddenSections: [],
      businessMode: 'solo',
      startMode: 'services_first',
    },
    live: {
      layout: 'quick_book',
      stylePack: 'default',
      tokenOverrides: null,
      sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
      sectionVariants: {},
      hiddenSections: [],
      businessMode: 'solo',
      startMode: 'services_first',
    },
  })),
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

describe('BookTechPage', () => {
  it('shows unassigned technicians as disabled for base-service booking instead of hiding them', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'isla-nail-studio',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getClientSession.mockResolvedValue({ phone: '+14165550123' });
    getPrimaryLocation.mockResolvedValue(null);
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'base-service',
        requestedServices: [{
          id: 'svc_combo',
          name: 'BIAB + Classic Pedicure',
          category: 'combo',
        }],
        services: [{
          id: 'svc_combo',
          name: 'BIAB + Classic Pedicure',
          priceCents: 8500,
          durationMinutes: 110,
        }],
        addOns: [],
        selectedAddOns: [],
        totalPriceCents: 8500,
        visibleDurationMinutes: 110,
      },
      activeTechnicians: [{
        id: 'tech_1',
        name: 'Daniela',
        imageUrl: null,
        specialties: [],
        rating: 5,
        reviewCount: 0,
        enabledServiceIds: [],
        serviceIds: [],
        primaryLocationId: null,
      }],
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

    render(await BookTechPage({
      searchParams: {
        baseServiceId: 'svc_combo',
        salonSlug: 'isla-nail-studio',
      },
    }));

    expect(screen.getByText(/"bookable":false/)).toBeInTheDocument();
    expect(screen.getByText(/"unavailableReason":"Not assigned to this service yet"/)).toBeInTheDocument();
    expect(resolvePublicBookingTechnicianContext).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '+14165550123',
    }));
  });

  it('redirects straight to time with techId when exactly one compatible technician exists', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'isla-nail-studio',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getClientSession.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue(null);
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'base-service',
        requestedServices: [{ id: 'svc_1', name: 'Gel Manicure', category: 'manicure' }],
        services: [{ id: 'svc_1', name: 'Gel Manicure', priceCents: 4000, durationMinutes: 60 }],
        addOns: [],
        selectedAddOns: [],
        totalPriceCents: 4000,
        visibleDurationMinutes: 60,
      },
      activeTechnicians: [{
        id: 'tech_1',
        name: 'Mila',
        imageUrl: null,
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['svc_1'],
        serviceIds: ['svc_1'],
        primaryLocationId: null,
      }],
      compatibleTechnicians: [{
        id: 'tech_1',
        name: 'Mila',
        imageUrl: null,
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['svc_1'],
        serviceIds: ['svc_1'],
        primaryLocationId: null,
      }],
      compatibleCount: 1,
      compatibleTechnicianIds: ['tech_1'],
      soleCompatibleTechnician: {
        id: 'tech_1',
        name: 'Mila',
        imageUrl: null,
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['svc_1'],
        serviceIds: ['svc_1'],
        primaryLocationId: null,
      },
      requestedTechnicianId: null,
      hasValidExplicitTechnician: false,
      validExplicitTechnician: null,
      effectiveTechnicianId: 'tech_1',
      effectiveTechnician: {
        id: 'tech_1',
        name: 'Mila',
        imageUrl: null,
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['svc_1'],
        serviceIds: ['svc_1'],
        primaryLocationId: null,
      },
      effectiveTechnicianSelectionSource: 'auto',
      shouldAutoSkipTech: true,
    });

    await expect(BookTechPage({
      searchParams: {
        salonSlug: 'isla-nail-studio',
        baseServiceId: 'svc_1',
      },
    })).rejects.toThrow('REDIRECT:/book/time?salonSlug=isla-nail-studio&baseServiceId=svc_1&techId=tech_1');
  });
});

describe('BookTechPage owner-preview gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'isla-nail-studio',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        settings: null,
        publicationStatus: 'published',
        freeSoloEnabled: true,
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getClientSession.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue(null);
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
  });

  it('redirects to not-found and renders no draft content when the preview gate denies access', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: false,
      reason: 'wrong_owner',
    });
    buildTenantRedirectPath.mockReturnValue('/en/isla-nail-studio/not-found');

    await expect(BookTechPage({
      searchParams: {
        salonSlug: 'isla-nail-studio',
        baseServiceId: 'svc_1',
      },
      params: { locale: 'en', slug: 'isla-nail-studio' },
    })).rejects.toThrow('REDIRECT:/en/isla-nail-studio/not-found');

    // Real deny-before-render proof: nothing past the gate ever ran.
    expect(checkSalonStatus).not.toHaveBeenCalled();
    expect(resolvePublicBookingTechnicianContext).not.toHaveBeenCalled();
    expect(bookTechClientMock).not.toHaveBeenCalled();
  });

  it('allows an authorized owner previewing a draft salon through to the technician step', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: 'owner',
    });
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'base-service',
        requestedServices: [{ id: 'svc_1', name: 'Gel Manicure', category: 'manicure' }],
        services: [{ id: 'svc_1', name: 'Gel Manicure', priceCents: 4000, durationMinutes: 60 }],
        addOns: [],
        selectedAddOns: [],
        totalPriceCents: 4000,
        visibleDurationMinutes: 60,
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

    render(await BookTechPage({
      searchParams: {
        salonSlug: 'isla-nail-studio',
        baseServiceId: 'svc_1',
      },
      params: { locale: 'en', slug: 'isla-nail-studio' },
    }));

    expect(bookTechClientMock).toHaveBeenCalled();
  });
});
