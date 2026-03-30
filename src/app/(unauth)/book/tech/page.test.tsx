import React from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  getTechniciansBySalonId,
  resolvePublicBookingSelection,
  technicianSupportsLocation,
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
  getTechniciansBySalonId: vi.fn(),
  resolvePublicBookingSelection: vi.fn(),
  technicianSupportsLocation: vi.fn(() => true),
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
  getTechniciansBySalonId,
}));

vi.mock('@/libs/publicBookingSelection', () => ({
  resolvePublicBookingSelection,
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/bookingPolicy', () => ({
  technicianSupportsLocation,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

import BookTechPage from './page';

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
    resolvePublicBookingSelection.mockResolvedValue({
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
    });
    getTechniciansBySalonId.mockResolvedValue([{
      id: 'tech_1',
      name: 'Daniela',
      avatarUrl: null,
      specialties: [],
      rating: '5.0',
      reviewCount: 0,
      enabledServiceIds: [],
      serviceIds: [],
      primaryLocationId: null,
    }]);

    render(await BookTechPage({
      searchParams: {
        baseServiceId: 'svc_combo',
        salonSlug: 'isla-nail-studio',
      },
    }));

    expect(screen.getByText(/"bookable":false/)).toBeInTheDocument();
    expect(screen.getByText(/"unavailableReason":"Not assigned to this service yet"/)).toBeInTheDocument();
    expect(resolvePublicBookingSelection).toHaveBeenCalledWith(expect.objectContaining({
      clientPhone: '+14165550123',
    }));
  });
});
