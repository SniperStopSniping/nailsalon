import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftSalonGateResult } from '@/libs/ownerPreview';

import BookTimePage from './page';

const {
  bookTimeClientMock,
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getBookingConfigForSalon,
  getClientSession,
  getLocationById,
  getPrimaryLocation,
  getPublicPageContext,
  resolveDraftSalonAccess,
  resolvePublicBookingTechnicianContext,
  redirectMock,
} = vi.hoisted(() => ({
  bookTimeClientMock: vi.fn((_props: Record<string, unknown>) => null),
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getBookingConfigForSalon: vi.fn(async () => ({
    minimumNoticeMinutes: 240,
    timezone: 'America/Toronto',
  })),
  getClientSession: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getPublicPageContext: vi.fn(),
  resolveDraftSalonAccess: vi.fn((): Promise<DraftSalonGateResult> => Promise.resolve({
    allowed: true,
    isPreviewingDraftSalon: false,
    isPreviewingDraftConfig: false,
    actorType: null,
  })),
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

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
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

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

vi.mock('./BookTimeClient', () => ({
  BookTimeClient: bookTimeClientMock,
}));

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
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        techId: 'tech_1',
      }),
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
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'tech_1',
      }),
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
      params: Promise.resolve({
        locale: 'en',
        slug: 'salon-a',
      }),
      searchParams: Promise.resolve({
        serviceIds: 'srv_1',
        techId: 'tech_1',
      }),
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
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        baseServiceId: 'svc_combo',
        selectedAddOns: JSON.stringify([{ addOnId: 'addon_1' }]),
      }),
    })).rejects.toThrow(
      'REDIRECT:/book/time?salonSlug=salon-a&baseServiceId=svc_combo&selectedAddOns=%5B%7B%22addOnId%22%3A%22addon_1%22%7D%5D&techId=tech_1',
    );
  });

  it('canonicalizes the auto-selected technician for a free-solo flow without an artist step', async () => {
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: ['service', 'time', 'confirm'],
        freeSoloEnabled: true,
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        services: [{ id: 'svc_1', name: 'Russian Manicure', priceCents: 4500, durationMinutes: 60 }],
        addOns: [],
        totalPriceCents: 4500,
        visibleDurationMinutes: 60,
      },
      activeTechnicians: [],
      compatibleTechnicians: [],
      compatibleCount: 1,
      compatibleTechnicianIds: ['tech_daniela'],
      soleCompatibleTechnician: {
        id: 'tech_daniela',
        name: 'Daniela',
        imageUrl: null,
        specialties: [],
        rating: 5,
        reviewCount: 0,
        enabledServiceIds: ['svc_1'],
        serviceIds: ['svc_1'],
        primaryLocationId: null,
      },
      requestedTechnicianId: null,
      hasValidExplicitTechnician: false,
      validExplicitTechnician: null,
      effectiveTechnicianId: 'tech_daniela',
      effectiveTechnician: {
        id: 'tech_daniela',
        name: 'Daniela',
        imageUrl: null,
        specialties: [],
        rating: 5,
        reviewCount: 0,
        enabledServiceIds: ['svc_1'],
        serviceIds: ['svc_1'],
        primaryLocationId: null,
      },
      effectiveTechnicianSelectionSource: 'auto',
      shouldAutoSkipTech: true,
    });

    await expect(BookTimePage({
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
      }),
    })).rejects.toThrow(
      'REDIRECT:/book/time?salonSlug=salon-a&baseServiceId=svc_1&techId=tech_daniela',
    );

    expect(resolvePublicBookingTechnicianContext).toHaveBeenCalledWith(expect.objectContaining({
      allowAutoSkip: true,
    }));
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
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
      }),
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

    const element = await BookTimePage({
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
        techId: 'any',
      }),
    });

    expect(resolvePublicBookingTechnicianContext).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '+14165550123',
    }));

    render(element);

    expect(bookTimeClientMock.mock.calls.at(-1)?.[0]).toMatchObject({
      minimumNoticeMinutes: 240,
      salonTimeZone: 'America/Toronto',
    });

    // Post-launch privacy fix ("Blocker 2"): this page mounts
    // `PublicSalonPageShell` with NO `salonContentInput`, so the shell's own
    // `locationDisplayMode` resolution is the only thing protecting a
    // salon-level address on this route. An ordinary visitor here must be
    // threaded through as `isPreviewingDraftConfig: false` so the shell
    // resolves live, not draft. `BookTimePage` returns the
    // `<PublicSalonPageShell>` element directly, so its own `.props` can be
    // inspected without rendering.
    expect((element as unknown as { props: Record<string, unknown> }).props).toMatchObject({
      isPreviewingDraftConfig: false,
    });
  });
});

describe('BookTimePage owner-preview gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
    getClientSession.mockResolvedValue(null);
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        settings: null,
        publicationStatus: 'published',
        freeSoloEnabled: true,
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
  });

  it('redirects to not-found and renders no draft content when the preview gate denies access', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: false,
      reason: 'no_session',
    });
    buildTenantRedirectPath.mockReturnValue('/en/salon-a/not-found');

    await expect(BookTimePage({
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
      }),
      params: Promise.resolve({ locale: 'en', slug: 'salon-a' }),
    })).rejects.toThrow('REDIRECT:/en/salon-a/not-found');

    // Real deny-before-render proof: nothing past the gate ever ran.
    expect(checkSalonStatus).not.toHaveBeenCalled();
    expect(resolvePublicBookingTechnicianContext).not.toHaveBeenCalled();
  });

  it('allows an authorized owner previewing a draft salon through to the time step', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: 'owner',
    });
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        services: [{ id: 'svc_1', name: 'Gel Manicure', priceCents: 4000, durationMinutes: 60 }],
        addOns: [],
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

    const element = await BookTimePage({
      searchParams: Promise.resolve({
        salonSlug: 'salon-a',
        baseServiceId: 'svc_1',
        techId: 'any',
      }),
      params: Promise.resolve({ locale: 'en', slug: 'salon-a' }),
    });

    expect(element).toBeTruthy();
    expect(resolvePublicBookingTechnicianContext).toHaveBeenCalled();
    // Mirrors the visitor-side assertion in the describe block above: an
    // authorized owner preview must forward `isPreviewingDraftConfig: true`
    // so the shell resolves the DRAFT `locationDisplayMode` side, not live.
    expect((element as unknown as { props: Record<string, unknown> }).props).toMatchObject({
      isPreviewingDraftConfig: true,
    });
  });
});
