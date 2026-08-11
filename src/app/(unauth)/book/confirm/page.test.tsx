import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  resolvePublicBookingTechnicianContext,
  resolvePublicRetentionCampaignPreview,
  bookConfirmClientSpy,
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
  resolvePublicBookingTechnicianContext: vi.fn(),
  resolvePublicRetentionCampaignPreview: vi.fn(),
  bookConfirmClientSpy: vi.fn(),
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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
// D3 — the dark disclosure (tests 30, 30a, 30b, 32, 33, 35b, 35c)
// =============================================================================

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
    // resolve ACTIVE if the collection flag were on.
    expect(props.depositDisclosure).toBeNull();
    expect(props.depositNoticeSuppressed).toBe(false);
    expect(props.depositFingerprint).toBe('deposit-v1:none');
  });

  it('test 30a — the resolved reason while dark is collection_not_live', async () => {
    const { getDepositPolicyForSalon } = await import('@/libs/depositPolicy.server');
    const policy = await getDepositPolicyForSalon({
      salonId: 'salon_1',
      salon: {
        features: { money: { deposits: true } },
        settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
      },
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
