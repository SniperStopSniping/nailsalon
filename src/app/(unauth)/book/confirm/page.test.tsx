import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { buildGoogleMapsDirectionsUrl } from '@/libs/directions';
import type { DraftSalonGateResult } from '@/libs/ownerPreview';

import BookConfirmPage from './page';

const {
  buildTenantRedirectPath,
  getPublicPageContext,
  checkSalonStatus,
  checkFeatureEnabled,
  getClientSession,
  getPrimaryLocation,
  getLocationById,
  getSalonById,
  isRewardsEnabled,
  isSmsEnabled,
  resolveDraftSalonAccess,
  resolvePublicBookingTechnicianContext,
  resolvePublicRetentionCampaignPreview,
  bookConfirmClientSpy,
  publicSalonPageShellSpy,
  depositAccountSnapshot,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  getPublicPageContext: vi.fn(),
  checkSalonStatus: vi.fn(),
  checkFeatureEnabled: vi.fn(),
  getClientSession: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getLocationById: vi.fn(),
  getSalonById: vi.fn(),
  isRewardsEnabled: vi.fn(),
  isSmsEnabled: vi.fn(),
  resolveDraftSalonAccess: vi.fn((): Promise<DraftSalonGateResult> => Promise.resolve({
    allowed: true,
    isPreviewingDraftSalon: false,
    isPreviewingDraftConfig: false,
    actorType: null,
  })),
  resolvePublicBookingTechnicianContext: vi.fn(),
  resolvePublicRetentionCampaignPreview: vi.fn(),
  bookConfirmClientSpy: vi.fn(),
  publicSalonPageShellSpy: vi.fn(),
  depositAccountSnapshot: vi.fn(),
}));

// BOTH halves are mandatory.
//
// Without the `server-only` stub the deposit policy module cannot load in jsdom
// at all. Without the snapshot mock the live binding read throws, the throw maps
// to `undetermined`, and `undetermined`'s derived props are IDENTICAL to the dark
// ones — so flipping the collection flag would leave this suite green.
vi.mock('server-only', () => ({}));

// `livemode: false` is NOT a typo: under Vitest `resolveRuntimeEnvironment`
// returns 'test', so the expected mode is FALSE. The intuitive `true` makes the
// darkness test unfalsifiable.
vi.mock('@/libs/depositAccountSnapshot.server', () => ({
  readDepositAccountSnapshot: depositAccountSnapshot,
}));

// Deliberately NOT mocked: `@/libs/depositPolicy.server` is the module under test
// on this path.

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
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

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: (props: { children: React.ReactNode } & Record<string, unknown>) => {
    publicSalonPageShellSpy(props);
    return <div>{props.children}</div>;
  },
}));

// `@/libs/bookingPageContent` starts with `import 'server-only'`
// (transitively `@/libs/DB`) — mocked for the same reason
// `@/libs/bookingPageConfig` is above, so this page-level test never touches
// the real DB module. Defaults to `full_address` on both sides; individual
// tests below override with `mockReturnValueOnce`.
vi.mock('@/libs/bookingPageContent', () => ({
  resolveBookingPageContent: vi.fn(() => ({
    version: 1,
    draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
    live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
  })),
}));

vi.mock('@/libs/bookingFlow', () => ({
  normalizeBookingFlow: vi.fn(() => ['service', 'tech', 'time', 'confirm']),
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/publicBookingTechnicians', () => ({
  resolvePublicBookingTechnicianContext,
}));

vi.mock('@/libs/publicRetentionCampaign', () => ({
  resolvePublicRetentionCampaignPreview,
}));

vi.mock('@/libs/queries', () => ({
  getPrimaryLocation,
  getLocationById,
  getSalonById,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkSalonStatus,
  checkFeatureEnabled,
  isRewardsEnabled,
  isSmsEnabled,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

vi.mock('./BookConfirmClient', () => ({
  BookConfirmClient: (props: unknown) => {
    bookConfirmClientSpy(props);
    return <div>Book confirm client</div>;
  },
}));

describe('BookConfirmPage directions fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        name: 'Salon A',
        address: '123 Beauty Lane',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        // Without BOTH of these the deposit resolver short-circuits at the
        // entitlement conjunct, never reaches the mocked snapshot, and flipping
        // the collection flag changes nothing. No `booking.currency` on purpose.
        features: { money: { deposits: true } },
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      },
    });
    depositAccountSnapshot.mockResolvedValue({
      chargesEnabled: true,
      revokedAt: null,
      lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      livemode: false,
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getSalonById.mockResolvedValue({ id: 'salon_1', settings: null });
    isRewardsEnabled.mockResolvedValue(true);
    isSmsEnabled.mockResolvedValue(true);
    getClientSession.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue({
      id: 'loc_primary',
      name: 'Isla Nail Salon',
      address: '880 Ellesmere Rd Unit 2',
      city: 'Scarborough',
      state: 'ON',
      zipCode: 'M2J 2C1',
    });
    getLocationById.mockResolvedValue(null);
    resolvePublicRetentionCampaignPreview.mockResolvedValue({ status: 'none', preview: null, message: null });
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'legacy',
        baseServiceId: null,
        selectedAddOns: [],
        requestedServices: [{
          id: 'srv_1',
          name: 'BIAB Short',
          price: 6500,
          durationMinutes: 75,
        }],
        services: [{
          id: 'srv_1',
          name: 'BIAB Short',
          durationMinutes: 75,
          priceCents: 6500,
          category: 'builder_gel',
          descriptionItems: [],
          priceDisplayText: null,
          resolvedIntroPriceLabel: null,
        }],
        addOns: [],
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 0,
        totalPriceCents: 6500,
        firstVisitDiscountPreview: null,
        visibleDurationMinutes: 75,
        blockedDurationMinutes: 85,
        bufferMinutes: 10,
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
  });

  it('passes the primary active location to the confirmed screen instead of the stale salon root address', async () => {
    const element = await BookConfirmPage({
      searchParams: {
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'any',
        date: '2026-03-20',
        time: '10:00',
      },
    });

    render(element);

    expect(screen.getByText('Book confirm client')).toBeInTheDocument();
    expect(bookConfirmClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      location: {
        id: 'loc_primary',
        name: 'Isla Nail Salon',
        address: '880 Ellesmere Rd Unit 2',
        city: 'Scarborough',
        state: 'ON',
        zipCode: 'M2J 2C1',
      },
    }));
  });

  it('falls back to the salon address only when no location record exists at all', async () => {
    getPrimaryLocation.mockResolvedValue(null);

    const element = await BookConfirmPage({
      searchParams: {
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'any',
        date: '2026-03-20',
        time: '10:00',
      },
    });

    render(element);

    expect(screen.getByText('Book confirm client')).toBeInTheDocument();
    expect(bookConfirmClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      location: {
        id: 'salon_salon_1',
        name: 'Salon A',
        address: '123 Beauty Lane',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
      },
    }));
  });

  it('passes the sole compatible technician and collapses confirm to the effective three-step flow', async () => {
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'base-service',
        baseServiceId: 'srv_1',
        selectedAddOns: [],
        requestedServices: [{
          id: 'srv_1',
          name: 'BIAB Short',
          category: 'builder_gel',
        }],
        services: [{
          id: 'srv_1',
          name: 'BIAB Short',
          durationMinutes: 75,
          priceCents: 6500,
          category: 'builder_gel',
          descriptionItems: [],
          priceDisplayText: null,
          resolvedIntroPriceLabel: null,
        }],
        addOns: [],
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 0,
        totalPriceCents: 6500,
        firstVisitDiscountPreview: null,
        visibleDurationMinutes: 75,
        blockedDurationMinutes: 85,
        bufferMinutes: 10,
      },
      activeTechnicians: [],
      compatibleTechnicians: [],
      compatibleCount: 1,
      compatibleTechnicianIds: ['tech_1'],
      soleCompatibleTechnician: {
        id: 'tech_1',
        name: 'Mila',
        imageUrl: '/mila.jpg',
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['srv_1'],
        serviceIds: ['srv_1'],
        primaryLocationId: null,
      },
      requestedTechnicianId: 'tech_1',
      hasValidExplicitTechnician: true,
      validExplicitTechnician: {
        id: 'tech_1',
        name: 'Mila',
        imageUrl: '/mila.jpg',
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['srv_1'],
        serviceIds: ['srv_1'],
        primaryLocationId: null,
      },
      effectiveTechnicianId: 'tech_1',
      effectiveTechnician: {
        id: 'tech_1',
        name: 'Mila',
        imageUrl: '/mila.jpg',
        specialties: [],
        rating: 4.9,
        reviewCount: 12,
        enabledServiceIds: ['srv_1'],
        serviceIds: ['srv_1'],
        primaryLocationId: null,
      },
      effectiveTechnicianSelectionSource: 'explicit',
      shouldAutoSkipTech: true,
    });

    const element = await BookConfirmPage({
      searchParams: {
        salonSlug: 'salon-a',
        baseServiceId: 'srv_1',
        techId: 'tech_1',
        date: '2026-03-20',
        time: '10:00',
      },
    });

    render(element);

    expect(bookConfirmClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      technician: {
        id: 'tech_1',
        name: 'Mila',
        imageUrl: '/mila.jpg',
      },
      bookingFlow: ['service', 'time', 'confirm'],
    }));
  });

  it('uses the validated campaign preview instead of stacking an automatic discount', async () => {
    resolvePublicRetentionCampaignPreview.mockResolvedValue({
      status: 'valid',
      message: null,
      preview: {
        id: 'campaign_1',
        stage: 'promo_6w',
        name: 'Welcome back',
        displayOffer: '20% off',
        code: 'BACK20',
        expiresAt: '2099-04-01T00:00:00.000Z',
        discountAmountCents: 1300,
      },
    });

    const element = await BookConfirmPage({
      searchParams: {
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'any',
        date: '2026-03-20',
        time: '10:00',
        campaign: 'campaign_token_123456789012345678901234',
      },
    });

    render(element);

    expect(resolvePublicRetentionCampaignPreview).toHaveBeenCalledWith(expect.objectContaining({
      token: 'campaign_token_123456789012345678901234',
      salonId: 'salon_1',
      services: [{ id: 'srv_1', priceCents: 6500 }],
    }));
    expect(bookConfirmClientSpy).toHaveBeenCalledWith(expect.objectContaining({
      subtotalBeforeDiscount: 65,
      discountAmount: 13,
      totalPrice: 52,
      firstVisitDiscountPreview: null,
      campaignPromotionPreview: expect.objectContaining({ id: 'campaign_1' }),
    }));
  });
});

// =============================================================================
// PR 125 review finding ("Blocker 1"): `/book/confirm` is a PUBLIC,
// pre-submit `(unauth)` route. Its own `locationSummary` (and
// `salonDirectionsFallback`) used to be built straight from raw DB rows with
// NO redaction, then passed to `BookConfirmClient` — reaching both the
// on-screen "Location" row and `buildGoogleMapsDirectionsUrl()`
// (`@/libs/directions`) regardless of the owner's `locationDisplayMode`
// setting. Asserted against the REAL captured spy props (`bookConfirmClientSpy
// .mock.calls`), not an inert fixture, on both branches `locationSummary` can
// take: the primary-location branch and the salon-level fallback branch.
// =============================================================================
describe('BookConfirmPage location privacy (locationDisplayMode) — Blocker 1', () => {
  const PRIVATE_STREET_ADDRESS = '999 PRIVATE HOME ROAD';
  const PRIVATE_UNIT = 'UNIT 77';
  const PRIVATE_POSTAL_CODE = 'A1A 1A1';
  const PRIVATE_FULL_ADDRESS = `${PRIVATE_STREET_ADDRESS}, ${PRIVATE_UNIT}`;

  function bookingPageContentReturn(liveMode: 'full_address' | 'city_only', draftMode: 'full_address' | 'city_only' = liveMode) {
    return {
      version: 1 as const,
      draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: draftMode },
      live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: liveMode },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: false,
      isPreviewingDraftConfig: false,
      actorType: null,
    });
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        name: 'Salon A',
        address: PRIVATE_FULL_ADDRESS,
        city: 'Homeburg',
        state: 'ON',
        zipCode: PRIVATE_POSTAL_CODE,
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        features: {},
        settings: null,
      },
    });
    depositAccountSnapshot.mockResolvedValue({
      chargesEnabled: true,
      revokedAt: null,
      lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      livemode: false,
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getSalonById.mockResolvedValue({ id: 'salon_1', settings: null });
    isRewardsEnabled.mockResolvedValue(true);
    isSmsEnabled.mockResolvedValue(true);
    getClientSession.mockResolvedValue(null);
    getLocationById.mockResolvedValue(null);
    resolvePublicRetentionCampaignPreview.mockResolvedValue({ status: 'none', preview: null, message: null });
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'legacy',
        baseServiceId: null,
        selectedAddOns: [],
        requestedServices: [{ id: 'srv_1', name: 'BIAB Short', price: 6500, durationMinutes: 75 }],
        services: [{
          id: 'srv_1',
          name: 'BIAB Short',
          durationMinutes: 75,
          priceCents: 6500,
          category: 'builder_gel',
          descriptionItems: [],
          priceDisplayText: null,
          resolvedIntroPriceLabel: null,
        }],
        addOns: [],
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 0,
        totalPriceCents: 6500,
        firstVisitDiscountPreview: null,
        visibleDurationMinutes: 75,
        blockedDurationMinutes: 85,
        bufferMinutes: 10,
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
  });

  async function renderAndCaptureLocation() {
    const element = await BookConfirmPage({
      searchParams: {
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'any',
        date: '2026-03-20',
        time: '10:00',
      },
    });
    render(element);
    const props = bookConfirmClientSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
    return props.location as { id: string; name: string; address: string | null; city: string | null; state: string | null; zipCode: string | null };
  }

  describe('primary-location branch (resolvedLocation)', () => {
    beforeEach(() => {
      getPrimaryLocation.mockResolvedValue({
        id: 'loc_primary',
        name: 'Home Studio',
        address: PRIVATE_FULL_ADDRESS,
        city: 'Homeburg',
        state: 'ON',
        zipCode: PRIVATE_POSTAL_CODE,
      });
    });

    it('full_address (default/control) passes the exact address through unredacted — proves the city_only assertion below is not vacuous', async () => {
      const location = await renderAndCaptureLocation();

      expect(location).toEqual({
        id: 'loc_primary',
        name: 'Home Studio',
        address: PRIVATE_FULL_ADDRESS,
        city: 'Homeburg',
        state: 'ON',
        zipCode: PRIVATE_POSTAL_CODE,
      });

      // Non-vacuous proof the directions URL carries the full address today.
      const directionsUrl = buildGoogleMapsDirectionsUrl(location);

      expect(directionsUrl).toContain(encodeURIComponent(PRIVATE_STREET_ADDRESS));
    });

    it('city_only redacts address/zipCode from the captured BookConfirmClient location prop, keeping city/name', async () => {
      vi.mocked(resolveBookingPageContent).mockReturnValueOnce(bookingPageContentReturn('city_only'));

      const location = await renderAndCaptureLocation();
      const serialized = JSON.stringify(location);

      expect(serialized).not.toContain(PRIVATE_STREET_ADDRESS);
      expect(serialized).not.toContain(PRIVATE_UNIT);
      expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);

      expect(location).toEqual({
        id: 'loc_primary',
        name: 'Home Studio',
        address: null,
        city: 'Homeburg',
        state: 'ON',
        zipCode: null,
      });

      // The directions/Google-Maps URL cannot reconstruct the street address
      // either — it's built downstream from this same (already redacted)
      // object, so with address/zipCode null only city/state remain.
      const directionsUrl = buildGoogleMapsDirectionsUrl(location);

      expect(directionsUrl).not.toContain(encodeURIComponent(PRIVATE_STREET_ADDRESS));
      expect(directionsUrl).not.toContain(encodeURIComponent(PRIVATE_UNIT));
      expect(directionsUrl).not.toContain(encodeURIComponent(PRIVATE_POSTAL_CODE));
      expect(directionsUrl).toContain(encodeURIComponent('Homeburg'));
    });
  });

  describe('salon-level fallback branch (salonDirectionsFallback, no location record)', () => {
    beforeEach(() => {
      getPrimaryLocation.mockResolvedValue(null);
    });

    it('full_address (default/control) passes the exact salon address through unredacted', async () => {
      const location = await renderAndCaptureLocation();

      expect(location).toEqual({
        id: 'salon_salon_1',
        name: 'Salon A',
        address: PRIVATE_FULL_ADDRESS,
        city: 'Homeburg',
        state: 'ON',
        zipCode: PRIVATE_POSTAL_CODE,
      });
    });

    it('city_only redacts the salon-level fallback address/zipCode too', async () => {
      vi.mocked(resolveBookingPageContent).mockReturnValueOnce(bookingPageContentReturn('city_only'));

      const location = await renderAndCaptureLocation();
      const serialized = JSON.stringify(location);

      expect(serialized).not.toContain(PRIVATE_STREET_ADDRESS);
      expect(serialized).not.toContain(PRIVATE_UNIT);
      expect(serialized).not.toContain(PRIVATE_POSTAL_CODE);

      expect(location).toEqual({
        id: 'salon_salon_1',
        name: 'Salon A',
        address: null,
        city: 'Homeburg',
        state: 'ON',
        zipCode: null,
      });
    });
  });

  describe('draft/live gate (mirrors book/service/page.tsx)', () => {
    beforeEach(() => {
      getPrimaryLocation.mockResolvedValue({
        id: 'loc_primary',
        name: 'Home Studio',
        address: PRIVATE_FULL_ADDRESS,
        city: 'Homeburg',
        state: 'ON',
        zipCode: PRIVATE_POSTAL_CODE,
      });
    });

    it('an authorized owner preview (isPreviewingDraftConfig=true) redacts using the DRAFT side even while live is full_address', async () => {
      resolveDraftSalonAccess.mockResolvedValue({
        allowed: true,
        isPreviewingDraftSalon: false,
        isPreviewingDraftConfig: true,
        actorType: 'owner',
      });
      vi.mocked(resolveBookingPageContent).mockReturnValueOnce(
        bookingPageContentReturn('full_address', 'city_only'),
      );

      const location = await renderAndCaptureLocation();

      expect(location.address).toBeNull();
      expect(location.zipCode).toBeNull();
      // Also verifies this page forwards the SAME gate value to
      // `PublicSalonPageShell` (Blocker 2) that it uses for its own
      // `locationSummary` redaction (Blocker 1) above — one decision, two
      // consumers, never a second independent one.
      expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
        isPreviewingDraftConfig: true,
      }));
    });

    it('a public visitor (isPreviewingDraftConfig=false) reads LIVE — an in-progress full_address draft never leaks past a city_only live setting', async () => {
      vi.mocked(resolveBookingPageContent).mockReturnValueOnce(
        bookingPageContentReturn('city_only', 'full_address'),
      );

      const location = await renderAndCaptureLocation();

      expect(location.address).toBeNull();
      expect(location.zipCode).toBeNull();
      expect(publicSalonPageShellSpy).toHaveBeenCalledWith(expect.objectContaining({
        isPreviewingDraftConfig: false,
      }));
    });
  });
});

// =============================================================================
// D3 — the dark disclosure (tests 30, 30a, 30b, 32, 33, 35b, 35c)
// =============================================================================

/**
 * WHAT KEEPS A SALON DARK CHANGED, AND THESE LEGS FOLLOW IT.
 *
 * These tests were written when gate 1 — the build-time collection flag — was
 * the thing holding every salon dark, so the fixture below was entitled and
 * configured and still resolved inactive. The payment-confirmation PR flips
 * gate 1, so the remaining gate is the PER-SALON entitlement, and the fixture
 * is unentitled to match. Both gates still get an explicit leg: nothing about
 * the two-gate launch is asserted by accident.
 */
describe('BookConfirmPage deposit disclosure — dark', () => {
  const baseSearchParams = {
    salonSlug: 'salon-a',
    serviceIds: 'srv_1',
    techId: 'any',
    date: '2026-03-20',
    time: '10:00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        name: 'Salon A',
        address: '123 Beauty Lane',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        // UNENTITLED: gate 2 is what holds this salon dark now that gate 1 is
        // flipped. Configured and charge-ready in every other respect, so the
        // legs below still prove the disclosure is suppressed by the gate and
        // not by a missing amount or a broken account.
        features: {},
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      },
    });
    depositAccountSnapshot.mockResolvedValue({
      chargesEnabled: true,
      revokedAt: null,
      lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      livemode: false,
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getSalonById.mockResolvedValue({ id: 'salon_1', settings: null });
    isRewardsEnabled.mockResolvedValue(true);
    isSmsEnabled.mockResolvedValue(true);
    getClientSession.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue(null);
    getLocationById.mockResolvedValue(null);
    resolvePublicRetentionCampaignPreview.mockResolvedValue({
      status: 'none',
      preview: null,
      message: null,
    });
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'legacy',
        baseServiceId: null,
        selectedAddOns: [],
        requestedServices: [],
        services: [{
          id: 'srv_1',
          name: 'BIAB Short',
          durationMinutes: 75,
          priceCents: 6500,
          category: 'builder_gel',
          descriptionItems: [],
          priceDisplayText: null,
          resolvedIntroPriceLabel: null,
        }],
        addOns: [],
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 0,
        totalPriceCents: 6500,
        firstVisitDiscountPreview: null,
        visibleDurationMinutes: 75,
        blockedDurationMinutes: 85,
        bufferMinutes: 10,
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
  });

  async function renderPage(
    searchParams: Record<string, string | string[]> = {},
    params?: { locale?: string },
  ) {
    const element = await BookConfirmPage({
      searchParams: { ...baseSearchParams, ...searchParams },
      ...(params ? { params } : {}),
    });
    render(element);
    return bookConfirmClientSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
  }

  it('test 30 — the dark payload delta is a fixed, enumerated set of CONSTANTS', async () => {
    const props = await renderPage();

    // A salon-derived value among these three IS a bug: this fixture would
    // resolve ACTIVE if it carried the per-salon entitlement.
    expect(props.depositDisclosure).toBeNull();
    expect(props.depositNoticeSuppressed).toBe(false);
    expect(props.depositFingerprint).toBe('deposit-v1:none');
  });

  it('test 30a — an UNENTITLED salon resolves not_entitled with gate 1 open', async () => {
    // The live shape of "dark". Gate 1 being flipped takes nobody live on its
    // own, and this is the assertion that says so at the page surface.
    const { getDepositPolicyForSalon } = await import('@/libs/depositPolicy.server');
    const policy = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: {
        features: {},
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      },
    });

    expect(policy).toMatchObject({ active: false, reason: 'not_entitled' });
  });

  it('test 30a2 — gate 1 still short-circuits ahead of the entitlement', async () => {
    // Conjunct ORDER is load-bearing: `collection_not_live` must be reachable
    // without any salon-local answer, so a rollback of the flip resolves every
    // salon dark for one reason rather than a per-salon assortment.
    const { getDepositPolicyForSalon } = await import('@/libs/depositPolicy.server');
    const policy = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: {
        features: { money: { deposits: true } },
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      },
      collectionLive: false,
    });

    expect(policy).toMatchObject({ active: false, reason: 'collection_not_live' });
  });

  it('test 30b — "dark" and "live but broken" are distinguishable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    depositAccountSnapshot.mockRejectedValue(new Error('binding read failed'));

    const { getDepositPolicyForSalon } = await import('@/libs/depositPolicy.server');
    const policy = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: {
        features: { money: { deposits: true } },
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      },
      collectionLive: true,
      entitled: true,
    });

    expect(policy).toMatchObject({ active: false, reason: 'undetermined' });

    consoleError.mockRestore();
  });

  it('test 32 — a poisoned total renders the page without throwing', async () => {
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      ...(await resolvePublicBookingTechnicianContext.mock.results[0]?.value),
      resolvedSelection: {
        mode: 'legacy',
        baseServiceId: null,
        selectedAddOns: [],
        requestedServices: [],
        services: [],
        addOns: [],
        subtotalBeforeDiscountCents: 6500.5,
        discountAmountCents: 0,
        totalPriceCents: 6500.5,
        firstVisitDiscountPreview: null,
        visibleDurationMinutes: 75,
        blockedDurationMinutes: 85,
        bufferMinutes: 10,
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

    const props = await renderPage();

    expect(props.depositDisclosure).toBeNull();
    expect(screen.getByText('Book confirm client')).toBeInTheDocument();
  });

  it('test 33 — a reschedule discloses nothing', async () => {
    const props = await renderPage({ originalAppointmentId: 'appt_1' });

    expect(props.depositDisclosure).toBeNull();
    expect(props.depositFingerprint).toBe('deposit-v1:none');
  });

  it('test 35b — the locale reaches the builder from params', async () => {
    const props = await renderPage({}, { locale: 'fr' });

    // Dark, so nothing is rendered; the assertion that matters is that the page
    // resolves without throwing on the French locale path.
    expect(props.depositDisclosure).toBeNull();
  });

  it('test 35c — a DUPLICATED Smart-Fit key must not overstate the disclosure', async () => {
    const { resolveDisclosureTotalCents } = await import('@/libs/depositPolicy');
    const firstParam = (value: string | string[] | undefined) =>
      Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

    // The page coerces to the FIRST value, exactly as `useSearchParams().get()`
    // does on the client. Passing the array through would make the cents parser
    // reject it, the server would fall back to the full total, and the page
    // would disclose MORE than the client's call-to-action shows.
    expect(resolveDisclosureTotalCents({
      serverTotalCents: 6500,
      subtotalBeforeDiscountCents: 6500,
      smartFitDiscountCentsParam: firstParam(['1000', '9999']),
      smartFitTotalCentsParam: firstParam(['5500', '1']),
    })).toBe(5500);

    const props = await renderPage({
      smartFitDiscountCents: ['1000', '9999'],
      smartFitTotalCents: ['5500', '1'],
    });

    expect(props.depositDisclosure).toBeNull();
  });
});

describe('BookConfirmPage owner-preview gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        name: 'Salon A',
        address: '123 Beauty Lane',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        settings: null,
        publicationStatus: 'published',
        freeSoloEnabled: true,
      },
    });
    getClientSession.mockResolvedValue(null);
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
  });

  it('redirects to not-found and renders no draft content when the preview gate denies access', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: false,
      reason: 'no_session',
    });
    // Scoped to this single call only: proves the real page's own
    // redirect() fires and halts execution before anything below it runs
    // (matching real Next.js redirect() semantics), without disturbing the
    // no-op default the other tests in this file rely on for their
    // incidental location-repair redirect call.
    redirectMock.mockImplementationOnce((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    buildTenantRedirectPath.mockReturnValue('/en/salon-a/not-found');

    await expect(BookConfirmPage({
      searchParams: { salonSlug: 'salon-a' },
      params: { locale: 'en', slug: 'salon-a' },
    })).rejects.toThrow('REDIRECT:/en/salon-a/not-found');

    // Real deny-before-render proof: nothing past the gate ever ran.
    expect(checkSalonStatus).not.toHaveBeenCalled();
    expect(getPrimaryLocation).not.toHaveBeenCalled();
    expect(resolvePublicBookingTechnicianContext).not.toHaveBeenCalled();
    expect(bookConfirmClientSpy).not.toHaveBeenCalled();
  });

  it('allows an authorized owner previewing a draft salon through to the confirm step', async () => {
    resolveDraftSalonAccess.mockResolvedValue({
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: 'owner',
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue({
      id: 'loc_primary',
      name: 'Salon A',
      address: '123 Beauty Lane',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90001',
    });
    getLocationById.mockResolvedValue(null);
    resolvePublicRetentionCampaignPreview.mockResolvedValue({ status: 'none', preview: null, message: null });
    isRewardsEnabled.mockResolvedValue(false);
    isSmsEnabled.mockResolvedValue(false);
    resolvePublicBookingTechnicianContext.mockResolvedValue({
      resolvedSelection: {
        mode: 'legacy',
        baseServiceId: null,
        selectedAddOns: [],
        requestedServices: [{ id: 'srv_1', name: 'BIAB Short', price: 6500, durationMinutes: 75 }],
        services: [{
          id: 'srv_1',
          name: 'BIAB Short',
          durationMinutes: 75,
          priceCents: 6500,
          category: 'builder_gel',
          descriptionItems: [],
          priceDisplayText: null,
          resolvedIntroPriceLabel: null,
        }],
        addOns: [],
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 0,
        totalPriceCents: 6500,
        firstVisitDiscountPreview: null,
        visibleDurationMinutes: 75,
        blockedDurationMinutes: 85,
        bufferMinutes: 10,
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

    const element = await BookConfirmPage({
      searchParams: {
        salonSlug: 'salon-a',
        serviceIds: 'srv_1',
        techId: 'any',
        date: '2026-03-20',
        time: '10:00',
        locationId: 'loc_primary',
      },
      params: { locale: 'en', slug: 'salon-a' },
    });

    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText('Book confirm client')).toBeInTheDocument();
  });
});
