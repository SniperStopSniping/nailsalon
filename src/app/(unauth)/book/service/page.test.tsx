import React from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getActiveAddOnsBySalonId,
  getActiveLocationsBySalonId,
  getBookingConfigForSalon,
  getClientSession,
  getPublicPageContext,
  getServiceAddOnRulesBySalonId,
  getServicesBySalonId,
  isClientEligibleForFirstVisitDiscount,
  bookServiceClientSpy,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getActiveAddOnsBySalonId: vi.fn(),
  getActiveLocationsBySalonId: vi.fn(),
  getBookingConfigForSalon: vi.fn(),
  getClientSession: vi.fn(),
  getPublicPageContext: vi.fn(),
  getServiceAddOnRulesBySalonId: vi.fn(),
  getServicesBySalonId: vi.fn(),
  isClientEligibleForFirstVisitDiscount: vi.fn(),
  bookServiceClientSpy: vi.fn(),
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

vi.mock('@/libs/queries', () => ({
  getActiveAddOnsBySalonId,
  getActiveLocationsBySalonId,
  getServiceAddOnRulesBySalonId,
  getServicesBySalonId,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
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

import BookServicePage from './page';

describe('BookServicePage first-visit offer visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    getActiveLocationsBySalonId.mockResolvedValue([]);
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
      showFirstVisitOffer: true,
    }));
    expect(isClientEligibleForFirstVisitDiscount).not.toHaveBeenCalled();
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
      showFirstVisitOffer: true,
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
      showFirstVisitOffer: false,
    }));
  });
});
