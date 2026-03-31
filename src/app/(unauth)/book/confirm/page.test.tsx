import React from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildTenantRedirectPath,
  getPublicPageContext,
  checkSalonStatus,
  checkFeatureEnabled,
  getClientSession,
  getPrimaryLocation,
  getLocationById,
  resolvePublicBookingTechnicianContext,
  bookConfirmClientSpy,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  getPublicPageContext: vi.fn(),
  checkSalonStatus: vi.fn(),
  checkFeatureEnabled: vi.fn(),
  getClientSession: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getLocationById: vi.fn(),
  resolvePublicBookingTechnicianContext: vi.fn(),
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

vi.mock('@/libs/queries', () => ({
  getPrimaryLocation,
  getLocationById,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkSalonStatus,
  checkFeatureEnabled,
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

import BookConfirmPage from './page';

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
    getClientSession.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue({
      id: 'loc_primary',
      name: 'Isla Nail Salon',
      address: '32 Clareville Crescent',
      city: 'North York',
      state: 'ON',
      zipCode: 'M2J 2C1',
    });
    getLocationById.mockResolvedValue(null);
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
        address: '32 Clareville Crescent',
        city: 'North York',
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
});
