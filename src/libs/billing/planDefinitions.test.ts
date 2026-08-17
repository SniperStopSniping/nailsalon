import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  getActivePlanDefinitionForFamily,
  getActivePlanDefinitions,
  getPlanDefinition,
  getPublicPlanCatalog,
  PLAN_DEFINITIONS,
  PLAN_FAMILIES,
} = await import('./planDefinitions');

describe('planDefinitions', () => {
  it('locks the monthly SMS allowances at 0/200/400/800', () => {
    expect(PLAN_DEFINITIONS.free_2026_08.monthlySmsCredits).toBe(0);
    expect(PLAN_DEFINITIONS.starter_2026_08.monthlySmsCredits).toBe(200);
    expect(PLAN_DEFINITIONS.pro_2026_08.monthlySmsCredits).toBe(400);
    expect(PLAN_DEFINITIONS.elite_2026_08.monthlySmsCredits).toBe(800);
  });

  it('grants the one-time starter credits as 100 on every plan (business-level, never per plan)', () => {
    for (const plan of Object.values(PLAN_DEFINITIONS)) {
      expect(plan.starterCreditsOneTime).toBe(100);
    }
  });

  it('has exactly one active definition per family', () => {
    for (const family of PLAN_FAMILIES) {
      const active = getActivePlanDefinitions().filter(plan => plan.family === family);

      expect(active).toHaveLength(1);
      expect(getActivePlanDefinitionForFamily(family)?.family).toBe(family);
    }
  });

  it('keeps record keys and definition keys in lockstep (unique, immutable identities)', () => {
    for (const [recordKey, plan] of Object.entries(PLAN_DEFINITIONS)) {
      expect(plan.key).toBe(recordKey);
    }
    const keys = Object.keys(PLAN_DEFINITIONS);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves any present successorKey to a real definition', () => {
    for (const plan of Object.values(PLAN_DEFINITIONS)) {
      if (plan.successorKey !== null) {
        expect(getPlanDefinition(plan.successorKey)).not.toBeNull();
      }
    }
  });

  it('returns null for unknown keys instead of guessing', () => {
    expect(getPlanDefinition('premium')).toBeNull();
    expect(getPlanDefinition('starter_2027_01')).toBeNull();
    expect(getPlanDefinition('')).toBeNull();
  });

  it('is deeply frozen — repricing means a new key, never mutation', () => {
    expect(Object.isFrozen(PLAN_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(PLAN_DEFINITIONS.starter_2026_08)).toBe(true);
    expect(() => {
      (PLAN_DEFINITIONS.starter_2026_08 as { monthlySmsCredits: number }).monthlySmsCredits = 999;
    }).toThrow(TypeError);
  });

  it('exposes a public catalog with email included and no Stripe identifiers anywhere', () => {
    const serialized = JSON.stringify(getPublicPlanCatalog());

    expect(getPublicPlanCatalog()).toHaveLength(4);

    for (const entry of getPublicPlanCatalog()) {
      expect(entry.transactionalEmailIncluded).toBe(true);
    }

    expect(serialized).not.toMatch(/price_|coupon|promo_|stripe/i);
  });
});
