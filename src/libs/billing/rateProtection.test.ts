/**
 * G15/§3.9 — founding rate-protection resolver proofs. Two facts pinned
 * separately: `resolveRateProtectedThrough` (the writer's arithmetic) and
 * `resolveOfferForServicePeriod` (the §3.9 vectors: monthly protected
 * through month 24, annual terms 1–2 protected / term 3 not, lapse walks
 * the successor chain, a retired current offer is kept during protection).
 *
 * No offer is retired in the committed catalogue today, so the successor-
 * walk and retired-offer vectors inject a synthetic retired plan/offer via
 * module mocks — the committed catalogue in billingOffers.ts/
 * planDefinitions.ts is never touched.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// vi.hoisted: vi.mock factories below are hoisted above ordinary top-level
// declarations, so these synthetic test keys must be reachable through the
// hoisted holder, not a plain `const`.
const fixture = vi.hoisted(() => ({
  RETIRED_PLAN_KEY: 'starter_2025_01_retired_test' as string,
  RETIRED_OFFER_KEY: 'starter_2025_01_retired_test_monthly' as string,
}));

vi.mock('@/libs/billing/planDefinitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/planDefinitions')>();
  const successor = actual.getPlanDefinition('starter_2026_08')!;
  const retiredPlan: import('@/libs/billing/planDefinitions').PlanDefinition = {
    ...successor,
    key: fixture.RETIRED_PLAN_KEY as typeof successor.key,
    active: false,
    successorKey: successor.key,
  };
  return {
    ...actual,
    getPlanDefinition: (key: string) => (key === fixture.RETIRED_PLAN_KEY ? retiredPlan : actual.getPlanDefinition(key)),
  };
});

vi.mock('@/libs/billing/billingOffers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/billingOffers')>();
  const base = actual.getBillingOffer('starter_2026_08_monthly')!;
  const retiredOffer: import('@/libs/billing/billingOffers').BillingOffer = {
    key: fixture.RETIRED_OFFER_KEY as typeof base.key,
    planDefinitionKey: fixture.RETIRED_PLAN_KEY as typeof base.planDefinitionKey,
    cadence: 'monthly',
    priceCents: base.priceCents,
    currency: 'cad',
    activeForNewSubscriptions: false,
  };
  return {
    ...actual,
    getBillingOffer: (key: string) => (key === fixture.RETIRED_OFFER_KEY ? retiredOffer : actual.getBillingOffer(key)),
    getOfferForPlanAndCadence: (planDefinitionKey: string, cadence: string) => (
      planDefinitionKey === fixture.RETIRED_PLAN_KEY && cadence === 'monthly'
        ? retiredOffer
        : actual.getOfferForPlanAndCadence(planDefinitionKey, cadence)
    ),
  };
});

const { resolveOfferForServicePeriod, resolveRateProtectedThrough } = await import('./rateProtection');
const { addMonthsClamped } = await import('./creditWindows');

const activation = new Date('2026-01-15T12:00:00.000Z');

describe('resolveRateProtectedThrough', () => {
  it('adds the promotion rateProtectionMonths using the SAME clamped-month arithmetic as the credit-window engine (§6.3)', () => {
    const through = resolveRateProtectedThrough(activation, { rateProtectionMonths: 24 });

    expect(through.getTime()).toBe(addMonthsClamped(activation, 24).getTime());
  });

  it('clamps a month-end activation the same way the engine does (never drifts)', () => {
    const monthEndActivation = new Date('2026-01-31T10:00:00.000Z');

    const through = resolveRateProtectedThrough(monthEndActivation, { rateProtectionMonths: 1 });

    expect(through.toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });
});

describe('resolveOfferForServicePeriod — §3.9 vectors', () => {
  const rateProtectedThrough = resolveRateProtectedThrough(activation, { rateProtectionMonths: 24 });

  it('a monthly founder is protected for every service period starting before month 24', () => {
    for (const monthsElapsed of [0, 1, 6, 12, 18, 23]) {
      const servicePeriodStart = addMonthsClamped(activation, monthsElapsed);
      const result = resolveOfferForServicePeriod({
        currentOfferKey: 'starter_2026_08_monthly',
        rateProtectedThrough,
        servicePeriodStart,
      });

      expect(result).toEqual({ offerKey: 'starter_2026_08_monthly', protected: true });
    }
  });

  it('a monthly founder is NOT protected at month 24 (the boundary itself is not "strictly before")', () => {
    const servicePeriodStart = addMonthsClamped(activation, 24);

    const result = resolveOfferForServicePeriod({
      currentOfferKey: 'starter_2026_08_monthly',
      rateProtectedThrough,
      servicePeriodStart,
    });

    // No successor exists for the active starter offer, so this resolves to
    // the SAME key — but unprotected: `protected: false` is the load-bearing
    // assertion (the offer identity alone can't distinguish the two cases).
    expect(result).toEqual({ offerKey: 'starter_2026_08_monthly', protected: false });
  });

  it('annual term 1 (month 0) and term 2 (month 12) are protected; term 3 (month 24) is not', () => {
    const term1 = resolveOfferForServicePeriod({
      currentOfferKey: 'starter_2026_08_annual',
      rateProtectedThrough,
      servicePeriodStart: addMonthsClamped(activation, 0),
    });
    const term2 = resolveOfferForServicePeriod({
      currentOfferKey: 'starter_2026_08_annual',
      rateProtectedThrough,
      servicePeriodStart: addMonthsClamped(activation, 12),
    });
    const term3 = resolveOfferForServicePeriod({
      currentOfferKey: 'starter_2026_08_annual',
      rateProtectedThrough,
      servicePeriodStart: addMonthsClamped(activation, 24),
    });

    expect(term1).toEqual({ offerKey: 'starter_2026_08_annual', protected: true });
    expect(term2).toEqual({ offerKey: 'starter_2026_08_annual', protected: true });
    expect(term3).toEqual({ offerKey: 'starter_2026_08_annual', protected: false });
  });

  it('lapse (rateProtectedThrough null) walks the plan successor chain to the active offer of the same cadence', () => {
    const result = resolveOfferForServicePeriod({
      currentOfferKey: fixture.RETIRED_OFFER_KEY,
      rateProtectedThrough: null,
      servicePeriodStart: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ offerKey: 'starter_2026_08_monthly', protected: false });
  });

  it('a retired current offer is KEPT while protection is active, even though it is no longer purchasable', () => {
    const result = resolveOfferForServicePeriod({
      currentOfferKey: fixture.RETIRED_OFFER_KEY,
      rateProtectedThrough,
      servicePeriodStart: activation, // strictly before rateProtectedThrough
    });

    expect(result).toEqual({ offerKey: fixture.RETIRED_OFFER_KEY, protected: true });
  });

  it('an offer whose plan has no successor resolves to itself', () => {
    const result = resolveOfferForServicePeriod({
      currentOfferKey: 'pro_2026_08_monthly',
      rateProtectedThrough: null,
      servicePeriodStart: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ offerKey: 'pro_2026_08_monthly', protected: false });
  });

  it('an unknown offer key resolves to itself rather than throwing', () => {
    const result = resolveOfferForServicePeriod({
      currentOfferKey: 'not_a_real_offer_key',
      rateProtectedThrough: null,
      servicePeriodStart: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ offerKey: 'not_a_real_offer_key', protected: false });
  });
});
