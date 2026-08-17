/**
 * Canonical Luster plan definitions — Founding Plans v1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §4–§5.
 *
 * A PlanDefinition is PRODUCT IDENTITY only: family, included monthly SMS
 * allowance, display name, feature-bundle identity and active/retired state.
 * Billing cadence and price live on BillingOffer; discounts live on
 * PromotionDefinition; SMS top-ups live on TopupOffer. Keeping these separate
 * is a binding contract decision — do not fold price or cadence in here.
 *
 * Keys are IMMUTABLE forever once shipped: they are referenced by ledger
 * idempotency keys and billing subscription state. Repricing or reshaping a
 * plan means adding a NEW versioned key, flipping the old one to
 * `active: false`, and pointing `successorKey` at the replacement.
 *
 * This module is pure data + lookups. It performs no I/O, touches no
 * database, and activates no billing behavior. Legacy feature access
 * (salon.plan / salon.features) is entirely unaffected — see
 * legacyPlanAdapter.ts.
 */

import 'server-only';

export const PLAN_FAMILIES = ['free', 'starter', 'pro', 'elite'] as const;
export type PlanFamily = (typeof PLAN_FAMILIES)[number];

export type PlanDefinitionKey =
  | 'free_2026_08'
  | 'starter_2026_08'
  | 'pro_2026_08'
  | 'elite_2026_08';

export type PlanDefinition = {
  key: PlanDefinitionKey;
  family: PlanFamily;
  displayName: string;
  /** Included SMS credits granted per internal monthly credit window. */
  monthlySmsCredits: number;
  /** One-time business-level starter credits (granted once per durable business identity, never per plan). */
  starterCreditsOneTime: number;
  /**
   * Identity of the non-communications feature bundle. Feature access is
   * still resolved exclusively by the legacy resolvers (salon.plan /
   * salon.features); this key is carried for the future approved feature
   * matrix and MUST NOT be interpreted by application code in Gate A.
   */
  featureBundleKey: string;
  /** false = retired: grandfathered subscribers only, never purchasable. */
  active: boolean;
  successorKey: PlanDefinitionKey | null;
};

export const PLAN_DEFINITIONS: Record<PlanDefinitionKey, PlanDefinition> = {
  free_2026_08: {
    key: 'free_2026_08',
    family: 'free',
    displayName: 'Free',
    monthlySmsCredits: 0,
    starterCreditsOneTime: 100,
    featureBundleKey: 'legacy_v1',
    active: true,
    successorKey: null,
  },
  starter_2026_08: {
    key: 'starter_2026_08',
    family: 'starter',
    displayName: 'Starter',
    monthlySmsCredits: 200,
    starterCreditsOneTime: 100,
    featureBundleKey: 'legacy_v1',
    active: true,
    successorKey: null,
  },
  pro_2026_08: {
    key: 'pro_2026_08',
    family: 'pro',
    displayName: 'Pro',
    monthlySmsCredits: 400,
    starterCreditsOneTime: 100,
    featureBundleKey: 'legacy_v1',
    active: true,
    successorKey: null,
  },
  elite_2026_08: {
    key: 'elite_2026_08',
    family: 'elite',
    displayName: 'Elite',
    monthlySmsCredits: 800,
    starterCreditsOneTime: 100,
    featureBundleKey: 'legacy_v1',
    active: true,
    successorKey: null,
  },
};

export function getPlanDefinition(key: string): PlanDefinition | null {
  return Object.prototype.hasOwnProperty.call(PLAN_DEFINITIONS, key)
    ? PLAN_DEFINITIONS[key as PlanDefinitionKey]
    : null;
}

export function getActivePlanDefinitions(): PlanDefinition[] {
  return Object.values(PLAN_DEFINITIONS).filter(plan => plan.active);
}

export function getActivePlanDefinitionForFamily(family: PlanFamily): PlanDefinition | null {
  return getActivePlanDefinitions().find(plan => plan.family === family) ?? null;
}

/**
 * Public-safe projection for pricing surfaces. Contains no Stripe
 * identifiers by construction (Stripe mappings live only in
 * stripePriceMap.ts, which is server-only and never feeds this shape).
 */
export type PublicPlanProjection = {
  key: PlanDefinitionKey;
  family: PlanFamily;
  displayName: string;
  monthlySmsCredits: number;
  starterCreditsOneTime: number;
  transactionalEmailIncluded: true;
};

export function getPublicPlanCatalog(): PublicPlanProjection[] {
  return getActivePlanDefinitions().map(plan => ({
    key: plan.key,
    family: plan.family,
    displayName: plan.displayName,
    monthlySmsCredits: plan.monthlySmsCredits,
    starterCreditsOneTime: plan.starterCreditsOneTime,
    transactionalEmailIncluded: true,
  }));
}

Object.freeze(PLAN_DEFINITIONS);
Object.values(PLAN_DEFINITIONS).forEach(Object.freeze);
