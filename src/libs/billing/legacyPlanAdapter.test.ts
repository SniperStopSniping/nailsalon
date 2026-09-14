import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { describeBillingState, describeLegacyBillingState, resolveTopupAudienceForLegacyPlan }
  = await import('./legacyPlanAdapter');

describe('legacyPlanAdapter', () => {
  it('passes every known legacy plan through unchanged', () => {
    for (const plan of ['free', 'single_salon', 'multi_salon', 'enterprise'] as const) {
      expect(describeLegacyBillingState({ plan }).legacyPlan).toBe(plan);
    }
  });

  it('fails closed to free for unknown or missing plans', () => {
    expect(describeLegacyBillingState({ plan: 'premium' }).legacyPlan).toBe('free');
    expect(describeLegacyBillingState({ plan: null }).legacyPlan).toBe('free');
    expect(describeLegacyBillingState({ plan: '' }).legacyPlan).toBe('free');
  });

  it('reports no versioned billing plan in Gate A (billing_subscription does not exist yet)', () => {
    for (const plan of ['free', 'single_salon', 'multi_salon', 'enterprise', null]) {
      expect(describeLegacyBillingState({ plan }).billingPlanDefinitionKey).toBeNull();
    }
  });

  it('maps legacy free to free-plan top-up pricing and every legacy paid plan to paid pricing', () => {
    expect(resolveTopupAudienceForLegacyPlan('free')).toBe('free_plan');
    expect(resolveTopupAudienceForLegacyPlan('single_salon')).toBe('paid_plan');
    expect(resolveTopupAudienceForLegacyPlan('multi_salon')).toBe('paid_plan');
    expect(resolveTopupAudienceForLegacyPlan('enterprise')).toBe('paid_plan');
    expect(resolveTopupAudienceForLegacyPlan('bogus')).toBe('free_plan');
    expect(resolveTopupAudienceForLegacyPlan(null)).toBe('free_plan');
  });
});

describe('describeBillingState (G16)', () => {
  const now = new Date('2026-09-14T00:00:00.000Z');

  it('reports null billing status/entitlement when there is no billing_subscription row', () => {
    const state = describeBillingState({ salon: { plan: 'single_salon' }, subscription: null, now });

    expect(state).toEqual({
      legacyPlan: 'single_salon',
      billingPlanDefinitionKey: null,
      billingStatus: null,
      entitlement: null,
    });
  });

  it('joins the legacy plan with the versioned billing subscription and its §6.5a entitlement', () => {
    const state = describeBillingState({
      salon: { plan: 'free' },
      subscription: {
        planDefinitionKey: 'pro_2026_08',
        status: 'past_due',
        paidThrough: new Date('2026-10-01T00:00:00.000Z'),
      },
      now,
    });

    // A salon MAY simultaneously be on a versioned billing plan and a
    // different legacy plan (§5) — neither system "corrects" the other.
    expect(state.legacyPlan).toBe('free');
    expect(state.billingPlanDefinitionKey).toBe('pro_2026_08');
    expect(state.billingStatus).toBe('past_due');
    expect(state.entitlement).toEqual({
      status: 'past_due',
      paidThrough: '2026-10-01T00:00:00.000Z',
      grantsEligible: true,
      label: 'Payment past due — prepaid credits continue until Oct 1, 2026',
    });
  });

  it('describeLegacyBillingState stays a thin wrapper with no billing-subscription join', () => {
    for (const plan of ['free', 'single_salon', 'multi_salon', 'enterprise', null]) {
      const wrapped = describeLegacyBillingState({ plan });
      const direct = describeBillingState({ salon: { plan }, subscription: null });

      expect(wrapped.legacyPlan).toBe(direct.legacyPlan);
      expect(wrapped.billingPlanDefinitionKey).toBeNull();
    }
  });
});
