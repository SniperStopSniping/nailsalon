/* eslint-disable import/first */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftSalonGateResult } from '@/libs/ownerPreview';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getActiveAddOnsBySalonId,
  getActiveLocationsBySalonId,
  getBookingConfigForSalon,
  getClientSession,
  getPublicPageContext,
  getPublicBookableServiceIds,
  getServiceAddOnRulesBySalonId,
  getServicesBySalonId,
  getTechniciansBySalonId,
  isClientEligibleForFirstVisitDiscount,
  resolveDraftSalonAccess,
  bookServiceClientSpy,
  publicSalonPageShellSpy,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  resolveDraftSalonAccess: vi.fn((): Promise<DraftSalonGateResult> => Promise.resolve({
    allowed: true,
    isPreviewingDraftSalon: false,
    isPreviewingDraftConfig: false,
    actorType: null,
  })),
  getActiveAddOnsBySalonId: vi.fn(),
  getActiveLocationsBySalonId: vi.fn(),
  getBookingConfigForSalon: vi.fn(),
  getClientSession: vi.fn(),
  getPublicPageContext: vi.fn(),
  getPublicBookableServiceIds: vi.fn(),
  getServiceAddOnRulesBySalonId: vi.fn(),
  getServicesBySalonId: vi.fn(),
  getTechniciansBySalonId: vi.fn(),
  isClientEligibleForFirstVisitDiscount: vi.fn(),
  bookServiceClientSpy: vi.fn(),
  publicSalonPageShellSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: (props: { children: React.ReactNode } & Record<string, unknown>) => {
    publicSalonPageShellSpy(props);
    return <div>{props.children}</div>;
  },
}));

vi.mock('@/libs/bookingFlow', () => ({
  normalizeBookingFlow: vi.fn(() => ['service', 'tech', 'time', 'confirm']),
}));

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon,
  resolveIntroPriceLabel: vi.fn(() => null),
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/firstVisitDiscount', () => ({
  isClientEligibleForFirstVisitDiscount,
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

vi.mock('@/libs/bookingPageContent', () => ({
  resolveBookingPageContent: vi.fn(() => ({
    version: 1,
    draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
    live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
  })),
}));

vi.mock('@/libs/queries', () => ({
  getActiveAddOnsBySalonId,
  getActiveLocationsBySalonId,
  getServiceAddOnRulesBySalonId,
  getServicesBySalonId,
  getTechniciansBySalonId,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/serviceAssignments', () => ({
  getPublicBookableServiceIds,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

vi.mock('./BookServiceClient', () => ({
  BookServiceClient: (props: unknown) => {
    bookServiceClientSpy(props);
    return <div>Book service client</div>;
  },
}));

import { resolveBookingPageContent } from '@/libs/bookingPageContent';

import BookServicePage from './page';

describe('BookServicePage first-visit offer visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T16:00:00.000Z'));
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
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: true,
    });
    getServicesBySalonId.mockResolvedValue([]);
    getActiveAddOnsBySalonId.mockResolvedValue([]);
    getServiceAddOnRulesBySalonId.mockResolvedValue([]);
    getTechniciansBySalonId.mockResolvedValue([]);
    getPublicBookableServiceIds.mockResolvedValue(null);
    getActiveLocationsBySalonId.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the offer for unknown visitors when the salon offer is enabled', async () => {
    getClientSession.mockResolvedValue(null);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    expect(screen.getByText('Book service client')).toBeInTheDocument();
    expect(bookServiceClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      showNewClientPromo: true,
      showServiceImages: true,
    }));
    expect(isClientEligibleForFirstVisitDiscount).not.toHaveBeenCalled();
  });

  it('passes an explicit image opt-out without removing stored service image data', async () => {
    getClientSession.mockResolvedValue(null);
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        settings: {
          merchandising: {
            showServiceImages: false,
          },
        },
      },
    });
    getServicesBySalonId.mockResolvedValue([
      {
        id: 'svc_image_opt_out',
        salonId: 'salon_1',
        name: 'Stored image service',
        description: null,
        descriptionItems: [],
        slug: null,
        price: 5000,
        priceDisplayText: null,
        durationMinutes: 60,
        isIntroPrice: false,
        introPriceLabel: null,
        introPriceExpiresAt: null,
        bookingQuestions: null,
        category: 'manicure',
        bookingCategory: 'manicure',
        templateKey: null,
        featuredOrder: null,
        imageUrl: '/assets/images/biab-medium.webp',
        sortOrder: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    expect(bookServiceClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      showServiceImages: false,
      services: [
        expect.objectContaining({
          id: 'svc_image_opt_out',
          imageUrl: '/assets/images/biab-medium.webp',
        }),
      ],
    }));
  });

  it('shows the offer for known customers who are still eligible', async () => {
    getClientSession.mockResolvedValue({ phone: '+14165551234' });
    isClientEligibleForFirstVisitDiscount.mockResolvedValue(true);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    expect(bookServiceClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      showNewClientPromo: true,
    }));
    expect(isClientEligibleForFirstVisitDiscount).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientPhone: '+14165551234',
    });
  });

  it('hides the offer for known customers who are no longer eligible', async () => {
    getClientSession.mockResolvedValue({ phone: '+14165551234' });
    isClientEligibleForFirstVisitDiscount.mockResolvedValue(false);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    expect(bookServiceClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      showNewClientPromo: false,
    }));
  });

  it('hides the promo after May 1, 2026 in the booking timezone even when the first-visit offer remains enabled', async () => {
    vi.setSystemTime(new Date('2026-05-01T04:30:00.000Z'));
    getClientSession.mockResolvedValue(null);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    expect(bookServiceClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      showNewClientPromo: false,
    }));
  });

  it('normalizes invalid public service image URLs before passing them to the client', async () => {
    getClientSession.mockResolvedValue(null);
    getServicesBySalonId.mockResolvedValue([
      {
        id: 'svc_valid_local',
        salonId: 'salon_1',
        name: 'Local asset',
        description: null,
        descriptionItems: null,
        slug: null,
        price: 3500,
        priceDisplayText: null,
        durationMinutes: 45,
        isIntroPrice: false,
        introPriceLabel: null,
        introPriceExpiresAt: null,
        bookingQuestions: null,
        category: 'manicure',
        imageUrl: '/assets/images/biab-medium.webp',
        sortOrder: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc_blank',
        salonId: 'salon_1',
        name: 'Blank image',
        description: null,
        descriptionItems: null,
        slug: null,
        price: 3500,
        priceDisplayText: null,
        durationMinutes: 45,
        isIntroPrice: false,
        introPriceLabel: null,
        introPriceExpiresAt: null,
        bookingQuestions: null,
        category: 'manicure',
        imageUrl: '   ',
        sortOrder: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc_upload',
        salonId: 'salon_1',
        name: 'Upload path',
        description: null,
        descriptionItems: null,
        slug: null,
        price: 3500,
        priceDisplayText: null,
        durationMinutes: 45,
        isIntroPrice: false,
        introPriceLabel: null,
        introPriceExpiresAt: null,
        bookingQuestions: null,
        category: 'manicure',
        imageUrl: '/uploads/services/salon_1/broken.jpg',
        sortOrder: 2,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc_unknown_remote',
        salonId: 'salon_1',
        name: 'Unknown remote',
        description: null,
        descriptionItems: null,
        slug: null,
        price: 3500,
        priceDisplayText: null,
        durationMinutes: 45,
        isIntroPrice: false,
        introPriceLabel: null,
        introPriceExpiresAt: null,
        bookingQuestions: null,
        category: 'manicure',
        imageUrl: 'https://example.com/services/image.jpg',
        sortOrder: 3,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc_cloudinary',
        salonId: 'salon_1',
        name: 'Cloudinary image',
        description: null,
        descriptionItems: null,
        slug: null,
        price: 3500,
        priceDisplayText: null,
        durationMinutes: 45,
        isIntroPrice: false,
        introPriceLabel: null,
        introPriceExpiresAt: null,
        bookingQuestions: null,
        category: 'manicure',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/services/ok.jpg',
        sortOrder: 4,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    const passedServices = bookServiceClientSpy.mock.calls.at(-1)?.[0]?.services;

    expect(passedServices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'svc_valid_local',
        imageUrl: '/assets/images/biab-medium.webp',
      }),
      expect.objectContaining({
        id: 'svc_blank',
        imageUrl: '/assets/images/biab-short.webp',
      }),
      expect.objectContaining({
        id: 'svc_upload',
        imageUrl: '/assets/images/biab-short.webp',
      }),
      expect.objectContaining({
        id: 'svc_unknown_remote',
        imageUrl: '/assets/images/biab-short.webp',
      }),
      expect.objectContaining({
        id: 'svc_cloudinary',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/services/ok.jpg',
      }),
    ]));
  });

  it('omits services that have no enabled technician assignment in a structured salon', async () => {
    getClientSession.mockResolvedValue(null);
    getPublicBookableServiceIds.mockResolvedValue(new Set(['svc_bookable']));
    getServicesBySalonId.mockResolvedValue([
      {
        id: 'svc_bookable',
        name: 'Gel Manicure',
        price: 5000,
        durationMinutes: 60,
        category: 'hands',
        isActive: true,
      },
      {
        id: 'svc_unassigned',
        name: 'Builder Gel Overlay',
        price: 6500,
        durationMinutes: 90,
        category: 'builder_gel',
        isActive: true,
      },
    ]);

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    expect(bookServiceClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      services: [expect.objectContaining({ id: 'svc_bookable' })],
    }));
  });
});

describe('BookServicePage owner-preview wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: false,
    });
    getClientSession.mockResolvedValue(null);
    getServicesBySalonId.mockResolvedValue([]);
    getActiveAddOnsBySalonId.mockResolvedValue([]);
    getServiceAddOnRulesBySalonId.mockResolvedValue([]);
    getTechniciansBySalonId.mockResolvedValue([]);
    getPublicBookableServiceIds.mockResolvedValue(null);
    getActiveLocationsBySalonId.mockResolvedValue([]);
  });

  it('does not pass ownerPreview/bookingPage props indicating a preview for an ordinary visitor', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
      ownerPreview: { isPreviewing: false, actorType: null },
      previewBannerVariant: null,
      bookingPage: expect.objectContaining({ layout: 'quick_book' }),
    }));
  });

  it('threads ownerPreview/bookingPage/previewBannerVariant through to PublicSalonPageShell for an authorized owner previewing a draft salon', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: 'owner',
    });

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
      ownerPreview: { isPreviewing: true, actorType: 'owner' },
      previewBannerVariant: 'draft-salon',
      bookingPage: expect.objectContaining({ layout: 'quick_book' }),
    }));
  });

  it('threads a draft-config banner variant for an authorized previewer on an already-published salon', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: true,
      actorType: 'super_admin',
    });

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
      ownerPreview: { isPreviewing: true, actorType: 'super_admin' },
      previewBannerVariant: 'draft-config',
      bookingPage: expect.objectContaining({ layout: 'quick_book' }),
    }));
  });

  it('threads the active locationDisplayMode through to salonContentInput.content unchanged (full_address)', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
      salonContentInput: expect.objectContaining({
        content: expect.objectContaining({ locationDisplayMode: 'full_address' }),
      }),
    }));
  });

  it('redirects to not-found and renders no draft content when the preview gate denies access', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: false,
      reason: 'no_session',
    });
    buildTenantRedirectPath.mockReturnValue('/en/salon-a/not-found');

    await expect(BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    })).rejects.toThrow('REDIRECT:/en/salon-a/not-found');

    // Real deny-before-render proof: nothing past the gate ever ran —
    // neither the draft-content queries nor PublicSalonPageShell/
    // BookServiceClient were reached.
    expect(checkSalonStatus).not.toHaveBeenCalled();
    expect(getServicesBySalonId).not.toHaveBeenCalled();
    expect(publicSalonPageShellSpy).not.toHaveBeenCalled();
    expect(bookServiceClientSpy).not.toHaveBeenCalled();
  });
});

// Post-launch privacy fix: `locationDisplayMode` was stored and validated
// but nothing ever read it — `BookServiceClient`'s own `locations` prop (the
// service location picker) is built directly from raw DB rows here in
// page.tsx, entirely bypassing `resolveSalonContent`'s projection, so it
// needed its OWN redaction call (`applyLocationDisplayMode`). Unmistakable
// synthetic PII strings, per the hotfix's own test requirement.
const PRIVATE_STREET_ADDRESS = '999 PRIVATE HOME ROAD';
const PRIVATE_UNIT = 'UNIT 77';
const PRIVATE_POSTAL_CODE = 'A1A 1A1';
const PRIVATE_FULL_ADDRESS = `${PRIVATE_STREET_ADDRESS}, ${PRIVATE_UNIT}`;

describe('BookServicePage location privacy (locationDisplayMode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `vi.clearAllMocks()` clears call history but not a `mockReturnValue`
    // set by an earlier test (e.g. the 'redirects to not-found...' test
    // above sets `buildTenantRedirectPath.mockReturnValue(...)`, which
    // otherwise persists) — restore its default identity behaviour so this
    // describe block's redirect checks below start from a clean slate
    // regardless of run order.
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: false,
    });
    getClientSession.mockResolvedValue(null);
    getServicesBySalonId.mockResolvedValue([]);
    getActiveAddOnsBySalonId.mockResolvedValue([]);
    getServiceAddOnRulesBySalonId.mockResolvedValue([]);
    getTechniciansBySalonId.mockResolvedValue([]);
    getPublicBookableServiceIds.mockResolvedValue(null);
    getActiveLocationsBySalonId.mockResolvedValue([
      {
        id: 'loc-private',
        name: 'Home Studio',
        address: PRIVATE_FULL_ADDRESS,
        city: 'Homeburg',
        state: 'ON',
        zipCode: PRIVATE_POSTAL_CODE,
        phone: '555-0100',
        isPrimary: true,
      },
    ]);
    // Explicit, per-test default — `vi.clearAllMocks()` clears call history
    // but does not reset a `mockReturnValue` set by a previous test, so this
    // keeps each test's starting state independent of run order.
    vi.mocked(resolveBookingPageContent).mockReturnValue({
      version: 1,
      draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
      live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
    });
  });

  it('full_address (default) passes the exact address through to the locations prop unchanged', async () => {
    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    const passedLocations = bookServiceClientSpy.mock.calls.at(-1)?.[0]?.locations;

    expect(passedLocations).toEqual([
      expect.objectContaining({
        id: 'loc-private',
        address: PRIVATE_FULL_ADDRESS,
        zipCode: PRIVATE_POSTAL_CODE,
        city: 'Homeburg',
      }),
    ]);
  });

  it('city_only strips address/zipCode from the locations prop passed to the location picker, keeping city/name', async () => {
    vi.mocked(resolveBookingPageContent).mockReturnValue({
      version: 1,
      draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'city_only' },
      live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'city_only' },
    });

    const element = await BookServicePage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    });
    render(element);

    const passedLocations = bookServiceClientSpy.mock.calls.at(-1)?.[0]?.locations;
    const serializedLocations = JSON.stringify(passedLocations);

    // The unmistakable proof: none of the private strings survive anywhere
    // in what gets passed as a prop to the client component.
    expect(serializedLocations).not.toContain(PRIVATE_STREET_ADDRESS);
    expect(serializedLocations).not.toContain(PRIVATE_UNIT);
    expect(serializedLocations).not.toContain(PRIVATE_POSTAL_CODE);

    expect(passedLocations).toEqual([
      expect.objectContaining({
        id: 'loc-private',
        name: 'Home Studio',
        address: null,
        zipCode: null,
        city: 'Homeburg',
        state: 'ON',
        phone: '555-0100',
        isPrimary: true,
      }),
    ]);

    // Also threaded into salonContentInput.content, so resolveSalonContent
    // (inside PublicSalonPageShell) redacts salonContent.place the same way
    // for the Editorial "Visit" section and any other salonContent consumer.
    expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
      salonContentInput: expect.objectContaining({
        content: expect.objectContaining({ locationDisplayMode: 'city_only' }),
        locations: expect.arrayContaining([
          expect.objectContaining({ id: 'loc-private', address: PRIVATE_FULL_ADDRESS }),
        ]),
      }),
    }));
  });
});
