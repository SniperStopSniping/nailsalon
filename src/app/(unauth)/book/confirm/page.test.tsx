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
}));

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
      },
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
