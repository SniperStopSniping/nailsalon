import React from 'react';

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizePhone } from '@/libs/phone';

const {
  bookConfirmClientSpy,
  bookTimeClientSpy,
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
  getClientSession,
  getLocationById,
  getPrimaryLocation,
  getPublicPageContext,
  getTechnicianById,
  resolvePublicBookingSelection,
} = vi.hoisted(() => ({
  bookConfirmClientSpy: vi.fn(),
  bookTimeClientSpy: vi.fn(),
  buildTenantRedirectPath: vi.fn((path: string | null) => path),
  checkFeatureEnabled: vi.fn(),
  checkSalonStatus: vi.fn(),
  getClientSession: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getPublicPageContext: vi.fn(),
  getTechnicianById: vi.fn(),
  resolvePublicBookingSelection: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/libs/clientAuth', () => ({
  getClientSession,
}));

vi.mock('@/libs/publicBookingSelection', () => ({
  resolvePublicBookingSelection,
}));

vi.mock('@/libs/queries', () => ({
  getLocationById,
  getPrimaryLocation,
  getTechnicianById,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
  checkSalonStatus,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

vi.mock('./time/BookTimeClient', () => ({
  BookTimeClient: (props: unknown) => {
    bookTimeClientSpy(props);
    return <div>Book time client</div>;
  },
}));

vi.mock('./confirm/BookConfirmClient', () => ({
  BookConfirmClient: (props: unknown) => {
    bookConfirmClientSpy(props);
    return <div>Book confirm client</div>;
  },
}));

import BookConfirmPage from './confirm/page';
import BookTimePage from './time/page';

function createResolvedSelection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mode: 'base-service',
    baseServiceId: 'svc_1',
    selectedAddOns: [],
    requestedServices: [{
      id: 'svc_1',
      name: 'BIAB',
      price: 5000,
      durationMinutes: 75,
    }],
    services: [{
      id: 'svc_1',
      name: 'BIAB',
      description: null,
      descriptionItems: [],
      priceCents: 5000,
      priceDisplayText: null,
      durationMinutes: 75,
      category: 'builder_gel',
      imageUrl: null,
      resolvedIntroPriceLabel: null,
    }],
    addOns: [],
    subtotalBeforeDiscountCents: 5000,
    discountAmountCents: 0,
    totalPriceCents: 5000,
    firstVisitDiscountPreview: null,
    visibleDurationMinutes: 75,
    blockedDurationMinutes: 85,
    bufferMinutes: 10,
    ...overrides,
  };
}

async function renderParityScenario(args: {
  clientSession: { phone: string } | null;
  resolvedSelection?: ReturnType<typeof createResolvedSelection>;
  baseServiceId?: string;
  selectedAddOns?: string;
}) {
  getClientSession.mockResolvedValue(args.clientSession);
  if (args.resolvedSelection) {
    resolvePublicBookingSelection.mockResolvedValue(args.resolvedSelection);
  }

  const searchParams = {
    salonSlug: 'salon-a',
    baseServiceId: args.baseServiceId ?? 'svc_1',
    selectedAddOns: args.selectedAddOns,
    techId: 'tech_1',
    locationId: '',
  };

  render(await BookTimePage({
    searchParams,
  }));
  render(await BookConfirmPage({
    searchParams: {
      ...searchParams,
      date: '2026-04-01',
      time: '10:00',
    },
  }));

  const timeProps = bookTimeClientSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  const confirmProps = bookConfirmClientSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;

  return {
    timeProps,
    confirmProps,
    resolveCalls: resolvePublicBookingSelection.mock.calls.map(call => call[0]),
  };
}

describe('booking pricing parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTenantRedirectPath.mockImplementation((path: string | null) => path);
    getPublicPageContext.mockResolvedValue({
      appearance: null,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        name: 'Salon A',
        address: '123 Beauty Lane',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5V 1A1',
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
    checkSalonStatus.mockResolvedValue({});
    checkFeatureEnabled.mockResolvedValue({});
    getPrimaryLocation.mockResolvedValue(null);
    getLocationById.mockResolvedValue(null);
    getTechnicianById.mockResolvedValue({
      id: 'tech_1',
      name: 'Daniela',
      avatarUrl: null,
    });
  });

  it.each([
    {
      label: 'first-visit eligible',
      clientSession: { phone: '+14165550123' },
      resolvedSelection: createResolvedSelection({
        subtotalBeforeDiscountCents: 5000,
        discountAmountCents: 1250,
        totalPriceCents: 3750,
        firstVisitDiscountPreview: {
          label: 'First visit discount',
          percent: 25,
          amountCents: 1250,
        },
      }),
    },
    {
      label: 'logged-in returning client',
      clientSession: { phone: '+14165550999' },
      resolvedSelection: createResolvedSelection({
        totalPriceCents: 5000,
      }),
    },
    {
      label: 'missing phone',
      clientSession: null,
      resolvedSelection: createResolvedSelection({
        totalPriceCents: 5000,
      }),
    },
    {
      label: 'promo disabled tenant',
      clientSession: { phone: '+14165550777' },
      resolvedSelection: createResolvedSelection({
        totalPriceCents: 6200,
        subtotalBeforeDiscountCents: 6200,
      }),
    },
    {
      label: 'combo with add-on',
      clientSession: { phone: '+14165550666' },
      selectedAddOns: JSON.stringify([{ addOnId: 'addon_1', quantity: 1 }]),
      resolvedSelection: createResolvedSelection({
        baseServiceId: 'svc_combo',
        services: [{
          id: 'svc_combo',
          name: 'BIAB + Classic Pedicure',
          description: null,
          descriptionItems: [],
          priceCents: 8500,
          priceDisplayText: null,
          durationMinutes: 110,
          category: 'combo',
          imageUrl: null,
          resolvedIntroPriceLabel: null,
        }],
        addOns: [{
          id: 'addon_1',
          name: 'Simple Nail Art',
          descriptionItems: [],
          category: 'nail_art',
          pricingType: 'fixed',
          unitLabel: null,
          maxQuantity: 1,
          quantity: 1,
          unitPriceCents: 1000,
          lineTotalCents: 1000,
          unitDurationMinutes: 15,
          lineDurationMinutes: 15,
          priceDisplayText: null,
        }],
        subtotalBeforeDiscountCents: 9500,
        totalPriceCents: 9500,
        visibleDurationMinutes: 125,
      }),
    },
    {
      label: 'tenant-specific pricing',
      clientSession: { phone: '+14165550444' },
      resolvedSelection: createResolvedSelection({
        subtotalBeforeDiscountCents: 7300,
        totalPriceCents: 7300,
        services: [{
          id: 'svc_1',
          name: 'BIAB',
          description: null,
          descriptionItems: [],
          priceCents: 7300,
          priceDisplayText: null,
          durationMinutes: 75,
          category: 'builder_gel',
          imageUrl: null,
          resolvedIntroPriceLabel: null,
        }],
      }),
    },
  ])('passes the same canonical pricing to time and confirm for $label', async ({
    clientSession,
    resolvedSelection,
    selectedAddOns,
  }) => {
    const { timeProps, confirmProps, resolveCalls } = await renderParityScenario({
      clientSession,
      resolvedSelection,
      selectedAddOns,
      baseServiceId: String(resolvedSelection.baseServiceId ?? 'svc_1'),
    });

    expect(timeProps.totalPrice).toBe(confirmProps.totalPrice);
    expect(timeProps.totalDuration).toBe(confirmProps.totalDuration);
    expect(timeProps.services).toEqual(confirmProps.services);
    expect(timeProps.addOns).toEqual(confirmProps.addOns);
    expect(resolveCalls).toHaveLength(2);
    expect(resolveCalls[0]).toEqual(expect.objectContaining({
      salonId: 'salon_1',
      baseServiceId: resolvedSelection.baseServiceId,
      clientPhone: clientSession?.phone ?? null,
      technicianId: 'tech_1',
    }));
    expect(resolveCalls[1]).toEqual(expect.objectContaining({
      salonId: 'salon_1',
      baseServiceId: resolvedSelection.baseServiceId,
      clientPhone: clientSession?.phone ?? null,
      technicianId: 'tech_1',
    }));
  });

  it('resolves the same canonical pricing when the client phone formatting differs', async () => {
    resolvePublicBookingSelection.mockImplementation(async ({ clientPhone }: { clientPhone?: string | null }) => {
      const normalizedPhone = normalizePhone(clientPhone ?? '');
      const eligible = normalizedPhone === '4165550123';
      const discountAmountCents = eligible ? 1250 : 0;

      return createResolvedSelection({
        subtotalBeforeDiscountCents: 5000,
        discountAmountCents,
        totalPriceCents: 5000 - discountAmountCents,
        firstVisitDiscountPreview: eligible
          ? {
              label: 'First visit discount',
              percent: 25,
              amountCents: discountAmountCents,
            }
          : null,
      });
    });

    const formatted = await renderParityScenario({
      clientSession: { phone: '+1 (416) 555-0123' },
    });
    const compact = await renderParityScenario({
      clientSession: { phone: '4165550123' },
    });

    expect(formatted.timeProps.totalPrice).toBe(37.5);
    expect(formatted.confirmProps.totalPrice).toBe(37.5);
    expect(compact.timeProps.totalPrice).toBe(37.5);
    expect(compact.confirmProps.totalPrice).toBe(37.5);
  });
});
