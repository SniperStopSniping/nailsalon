import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  getBookingConfigForSalon,
  getSalonClientByPhone,
  queryResults,
  db,
} = vi.hoisted(() => {
  const queryResults: unknown[] = [];
  const createQueryResult = <T,>(value: T) => {
    const promise = Promise.resolve(value) as Promise<T> & {
      limit: ReturnType<typeof vi.fn>;
    };
    promise.limit = vi.fn(async () => value);
    return promise;
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createQueryResult(queryResults.shift() ?? [])),
      })),
    })),
  };

  return {
    getBookingConfigForSalon: vi.fn(),
    getSalonClientByPhone: vi.fn(),
    queryResults,
    db,
  };
});

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  getSalonClientByPhone,
}));

import {
  FIRST_VISIT_DISCOUNT_TYPE,
  isClientEligibleForFirstVisitDiscount,
  resolveAutomaticBookingDiscount,
} from './firstVisitDiscount';

describe('resolveAutomaticBookingDiscount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResults.length = 0;
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: false,
    });
    getSalonClientByPhone.mockResolvedValue(null);
  });

  it('returns no discount when the salon first-visit offer is disabled', async () => {
    queryResults.push([]);

    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_1',
      services: [{ id: 'svc_1', name: 'Gel Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(result.kind).toBe('none');
    expect(result.finalTotalCents).toBe(4000);
  });

  it('preserves the first-visit discount across reschedules even if the setting is off', async () => {
    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_1',
      services: [{ id: 'svc_1', name: 'Gel Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
      salonClientId: 'client_1',
      preserveFirstVisitDiscount: true,
      now: new Date('2026-03-29T10:00:00.000Z'),
    });

    expect(result.kind).toBe('first_visit');
    expect(result.firstVisit?.discountType).toBe(FIRST_VISIT_DISCOUNT_TYPE);
    expect(result.discountAmountCents).toBe(1000);
    expect(result.finalTotalCents).toBe(3000);
  });

  it('lets an active reward win over the first-visit discount', async () => {
    queryResults.push([{
      id: 'reward_1',
      status: 'active',
      points: 25000,
      eligibleServiceName: 'gel manicure',
      expiresAt: null,
    }]);

    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_1',
      services: [{ id: 'svc_1', name: 'Gel Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(result.kind).toBe('reward');
    expect(result.discountAmountCents).toBe(4000);
    expect(result.finalTotalCents).toBe(0);
  });

  it('blocks the first-visit discount when a completed paid visit already exists', async () => {
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: true,
    });
    queryResults.push([], [{ id: 'appt_old' }]);

    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_1',
      services: [{ id: 'svc_1', name: 'Gel Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(result.kind).toBe('none');
  });

  it('blocks the first-visit discount when another active reserved discount exists', async () => {
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: true,
    });
    queryResults.push([], [], [{ id: 'appt_reserved' }]);

    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_1',
      services: [{ id: 'svc_1', name: 'Gel Manicure', price: 4000 }],
      subtotalBeforeDiscountCents: 4000,
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(result.kind).toBe('none');
  });

  it('applies a 25% first-visit discount for a fresh eligible client', async () => {
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: true,
    });
    queryResults.push([], [], []);

    const result = await resolveAutomaticBookingDiscount({
      salonId: 'salon_1',
      services: [{ id: 'svc_1', name: 'Gel Manicure', price: 4100 }],
      subtotalBeforeDiscountCents: 4100,
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(result.kind).toBe('first_visit');
    expect(result.discountAmountCents).toBe(1025);
    expect(result.finalTotalCents).toBe(3075);
  });

  it('does not permanently consume eligibility for a cancelled appointment', async () => {
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: true,
    });
    queryResults.push([], []);

    const eligible = await isClientEligibleForFirstVisitDiscount({
      salonId: 'salon_1',
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(eligible).toBe(true);
  });

  it('does not permanently consume eligibility for a no_show appointment', async () => {
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: true,
    });
    queryResults.push([], []);

    const eligible = await isClientEligibleForFirstVisitDiscount({
      salonId: 'salon_1',
      salonClientId: 'client_1',
      clientPhone: '1111111111',
    });

    expect(eligible).toBe(true);
  });
});
