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
});
