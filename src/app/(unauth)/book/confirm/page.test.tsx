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
  getTechnicianById,
  resolvePublicBookingSelection,
  bookConfirmClientSpy,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  getPublicPageContext: vi.fn(),
  checkSalonStatus: vi.fn(),
  checkFeatureEnabled: vi.fn(),
  getClientSession: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getLocationById: vi.fn(),
  getTechnicianById: vi.fn(),
  resolvePublicBookingSelection: vi.fn(),
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

vi.mock('@/libs/publicBookingSelection', () => ({
  resolvePublicBookingSelection,
}));

vi.mock('@/libs/queries', () => ({
  getPrimaryLocation,
  getLocationById,
  getTechnicianById,
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
    getTechnicianById.mockResolvedValue(null);
    resolvePublicBookingSelection.mockResolvedValue({
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
});
