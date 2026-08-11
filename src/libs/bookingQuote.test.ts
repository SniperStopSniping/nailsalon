import { describe, expect, it } from 'vitest';

import {
  buildBookingQuote,
  calculateAppointmentDuration,
  calculateAppointmentPrice,
  evaluateRequiredAddOnRules,
  getBlockedEndTimeWithBuffer,
  getPublicTechnicianCompatibility,
  mergeSelectedAddOns,
} from '@/libs/bookingQuote';

describe('bookingQuote helpers', () => {
  it('merges duplicate add-ons by id', () => {
    expect(mergeSelectedAddOns([
      { addOnId: 'repair', quantity: 2 },
      { addOnId: 'repair', quantity: 1 },
      { addOnId: 'art' },
    ])).toEqual([
      { addOnId: 'repair', quantity: 3 },
      { addOnId: 'art', quantity: 1 },
    ]);
  });

  it('calculates total price and duration from line items', () => {
    expect(calculateAppointmentPrice({
      basePriceCents: 5000,
      addOns: [{ lineTotalCents: 1500 }, { lineTotalCents: 500 }],
    })).toBe(7000);

    expect(calculateAppointmentDuration({
      baseDurationMinutes: 75,
      addOns: [{ lineDurationMinutes: 15 }, { lineDurationMinutes: 20 }],
    })).toBe(110);
  });

  it('builds a single raw booking quote with visible and blocked durations', () => {
    const quote = buildBookingQuote({
      baseService: {
        id: 'svc_biab',
        salonId: 'salon_1',
        name: 'BIAB',
        slug: 'biab',
        category: 'builder_gel',
        descriptionItems: ['Strengthening overlay'],
        priceCents: 5000,
        priceDisplayText: null,
        durationMinutes: 75,
        isIntroPrice: true,
        introPriceLabel: 'Founding Client Price',
        introPriceExpiresAt: null,
        isActive: true,
      },
      addOns: [
        {
          id: 'addon_repair',
          salonId: 'salon_1',
          name: 'Nail Repair',
          slug: 'nail-repair',
          category: 'repair',
          descriptionItems: ['Per nail repair'],
          priceCents: 500,
          priceDisplayText: '$5 per nail',
          durationMinutes: 10,
          pricingType: 'per_unit',
          unitLabel: 'per nail',
          maxQuantity: 10,
          isActive: true,
          quantity: 2,
        },
      ],
      bufferMinutes: 10,
      resolvedIntroPriceLabel: 'Founding Client Price',
    });

    expect(quote.subtotalCents).toBe(6000);
    expect(quote.baseDurationMinutes).toBe(75);
    expect(quote.addOnsDurationMinutes).toBe(20);
    expect(quote.visibleDurationMinutes).toBe(95);
    expect(quote.blockedDurationMinutes).toBe(105);
  });

  it('computes blocked end time from the blocked duration', () => {
    expect(getBlockedEndTimeWithBuffer(
      new Date('2026-03-27T10:00:00.000Z'),
      105,
    ).toISOString()).toBe('2026-03-27T11:45:00.000Z');
  });

  it('requires explicit service assignments for base-service technician compatibility', () => {
    expect(getPublicTechnicianCompatibility({
      selectionMode: 'base-service',
      technician: {
        enabledServiceIds: [],
        serviceIds: [],
        specialties: ['BIAB'],
      },
      requestedServices: [{
        id: 'svc_combo',
        name: 'BIAB + Classic Pedicure',
        category: 'combo',
      }],
    })).toEqual({
      bookable: false,
      reason: 'service_unsupported',
    });

    expect(getPublicTechnicianCompatibility({
      selectionMode: 'base-service',
      technician: {
        enabledServiceIds: ['svc_combo'],
        serviceIds: ['svc_combo'],
        specialties: [],
      },
      requestedServices: [{
        id: 'svc_combo',
        name: 'BIAB + Classic Pedicure',
        category: 'combo',
      }],
    })).toEqual({
      bookable: true,
      reason: null,
    });
  });
});

describe('evaluateRequiredAddOnRules', () => {
  it('is satisfied when there are no rules for the service', () => {
    expect(evaluateRequiredAddOnRules({ rules: [], selectedAddOnIds: [] })).toEqual({
      satisfied: true,
      missingRequiredAddOnIds: [],
    });
  });

  it('is satisfied when every required add-on was selected', () => {
    expect(evaluateRequiredAddOnRules({
      rules: [
        { addOnId: 'removal', selectionMode: 'required' },
        { addOnId: 'chrome', selectionMode: 'optional' },
      ],
      selectedAddOnIds: ['removal', 'chrome'],
    })).toEqual({
      satisfied: true,
      missingRequiredAddOnIds: [],
    });
  });

  it('reports a required add-on that was not selected', () => {
    expect(evaluateRequiredAddOnRules({
      rules: [{ addOnId: 'removal', selectionMode: 'required' }],
      selectedAddOnIds: [],
    })).toEqual({
      satisfied: false,
      missingRequiredAddOnIds: ['removal'],
    });
  });

  it('reports only the required add-ons that are missing, not optional or conditional ones', () => {
    expect(evaluateRequiredAddOnRules({
      rules: [
        { addOnId: 'removal', selectionMode: 'required' },
        { addOnId: 'long_length', selectionMode: 'required' },
        { addOnId: 'chrome', selectionMode: 'optional' },
        { addOnId: 'inspiration_photo', selectionMode: 'conditional' },
      ],
      selectedAddOnIds: ['long_length'],
    })).toEqual({
      satisfied: false,
      missingRequiredAddOnIds: ['removal'],
    });
  });

  it('never reports an optional or conditional rule as missing, however unselected', () => {
    expect(evaluateRequiredAddOnRules({
      rules: [
        { addOnId: 'chrome', selectionMode: 'optional' },
        { addOnId: 'inspiration_photo', selectionMode: 'conditional' },
      ],
      selectedAddOnIds: [],
    })).toEqual({
      satisfied: true,
      missingRequiredAddOnIds: [],
    });
  });
});
