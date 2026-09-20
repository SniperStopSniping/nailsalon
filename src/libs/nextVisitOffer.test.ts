import { describe, expect, it } from 'vitest';

import {
  calculateNextVisitOfferDiscount,
  chooseNextVisitOrExistingDiscount,
  DEFAULT_NEXT_VISIT_OFFER_SETTINGS,
  evaluateNextVisitOfferEligibility,
  getNextVisitOfferDeadline,
  nextVisitMutationFailure,
  nextVisitOfferSettingsSchema,
  resolveNextVisitOfferSettings,
} from './nextVisitOffer';

const settings = { ...DEFAULT_NEXT_VISIT_OFFER_SETTINGS, enabled: true };
const source = {
  status: 'completed',
  completedAt: new Date('2026-03-01T18:00:00.000Z'),
  deletedAt: null,
  finalPriceCents: 4000,
};
const service = [{ id: 'gel', priceCents: 4000 }];

describe('next visit offer policy', () => {
  it('uses salon-local calendar deadlines inclusively, including DST transitions', () => {
    const deadline = getNextVisitOfferDeadline({
      completedAt: new Date('2026-03-08T05:30:00.000Z'),
      windowDays: 30,
      timeZone: 'America/Toronto',
    });

    expect(deadline).toEqual({
      deadlineDate: '2026-04-07',
      expiresAt: new Date('2026-04-08T04:00:00.000Z'),
    });

    const eligible = evaluateNextVisitOfferEligibility({
      settings,
      source,
      nextAppointmentStart: new Date('2026-03-31T16:00:00.000Z'),
      services: service,
      timeZone: 'America/Toronto',
      now: new Date('2026-03-31T15:00:00.000Z'),
    });

    expect(eligible).toMatchObject({ eligible: true, deadlineDate: '2026-03-31', discountAmountCents: 200 });

    const outside = evaluateNextVisitOfferEligibility({
      settings,
      source,
      nextAppointmentStart: new Date('2026-04-01T13:00:00.000Z'),
      services: service,
      timeZone: 'America/Toronto',
      now: new Date('2026-03-31T15:00:00.000Z'),
    });

    expect(outside.reason).toBe('NEXT_APPOINTMENT_OUTSIDE_WINDOW');
  });

  it('requires a positive-value retained completed source and an appointment after it', () => {
    const common = {
      settings,
      source,
      nextAppointmentStart: new Date('2026-03-15T16:00:00.000Z'),
      services: service,
      timeZone: 'America/Toronto',
      now: new Date('2026-03-10T15:00:00.000Z'),
    };

    for (const status of ['no_show', 'cancelled', 'pending', 'confirmed', 'in_progress', 'awaiting_payment']) {
      expect(evaluateNextVisitOfferEligibility({ ...common, source: { ...source, status } }).reason).toBe('SOURCE_NOT_COMPLETED');
    }

    expect(evaluateNextVisitOfferEligibility({ ...common, source: { ...source, deletedAt: new Date() } }).reason).toBe('SOURCE_DELETED');
    expect(evaluateNextVisitOfferEligibility({ ...common, source: { ...source, finalPriceCents: 0 } }).reason).toBe('SOURCE_NO_VALUE');
    expect(evaluateNextVisitOfferEligibility({ ...common, nextAppointmentStart: source.completedAt! }).reason).toBe('NEXT_APPOINTMENT_NOT_AFTER_SOURCE');
    expect(evaluateNextVisitOfferEligibility({ ...common, enabledAt: new Date('2026-03-02T00:00:00.000Z') }).reason).toBe('SOURCE_BEFORE_ENABLED');
  });

  it('validates bounded settings and leaves malformed stored settings safely off', () => {
    expect(nextVisitOfferSettingsSchema.safeParse({ ...settings, windowDays: 91 }).success).toBe(false);
    expect(nextVisitOfferSettingsSchema.safeParse({ ...settings, value: 101 }).success).toBe(false);
    expect(nextVisitOfferSettingsSchema.safeParse({ ...settings, discountType: 'fixed', value: 1_000_001 }).success).toBe(false);
    expect(nextVisitOfferSettingsSchema.safeParse({ ...settings, eligibleServiceIds: ['gel', 'gel'] }).success).toBe(false);
    expect(resolveNextVisitOfferSettings({ enabled: true })).toEqual(DEFAULT_NEXT_VISIT_OFFER_SETTINGS);
  });

  it('uses the shared eligible-base-service discount calculation for percent and fixed caps', () => {
    expect(calculateNextVisitOfferDiscount({ settings, services: service })).toEqual({ eligibleSubtotalCents: 4000, discountAmountCents: 200 });
    expect(calculateNextVisitOfferDiscount({
      settings: { ...settings, discountType: 'fixed', value: 9000, eligibleServiceIds: ['gel'] },
      services: service,
    })).toEqual({ eligibleSubtotalCents: 4000, discountAmountCents: 4000 });
  });

  it('never stacks over an existing discount and preserves an existing tie or manual replacement', () => {
    expect(chooseNextVisitOrExistingDiscount({ nextVisitDiscountCents: 200, existingDiscountCents: 300 }))
      .toEqual({ source: 'existing', discountAmountCents: 300 });
    expect(chooseNextVisitOrExistingDiscount({ nextVisitDiscountCents: 200, existingDiscountCents: 200 }))
      .toEqual({ source: 'existing', discountAmountCents: 200 });
    expect(chooseNextVisitOrExistingDiscount({ nextVisitDiscountCents: 200, existingDiscountCents: 0 }))
      .toEqual({ source: 'next_visit', discountAmountCents: 200 });
  });
});

describe('Next Visit mutation feedback', () => {
  it('exposes only safe retry or recovery copy from wrapped database failures', () => {
    expect(nextVisitMutationFailure({ cause: { code: '23514', message: 'NEXT_VISIT_OFFER_CHANGED: private tenant details' } })).toMatchObject({ code: 'NEXT_VISIT_OFFER_CHANGED' });
    expect(nextVisitMutationFailure({ cause: { code: '23514', message: 'another constraint' } })).toBeNull();
    expect(nextVisitMutationFailure({ cause: { code: '55P03', message: 'private row details' } })).toEqual({ code: 'APPOINTMENT_BUSY', message: 'This appointment or client is being updated. Refresh and try again.' });
  });
});
