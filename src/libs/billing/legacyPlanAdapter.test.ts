import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { describeLegacyBillingState, resolveTopupAudienceForLegacyPlan }
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
