/**
 * Read-only adapter between the legacy salon plan and the new billing
 * catalogue — Founding Plans v1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §5.
 *
 * BINDING INVARIANTS:
 * - Feature access continues to flow EXCLUSIVELY through the legacy
 *   resolvers (salon.plan / salon.features via featureGating,
 *   featureEntitlements and planLimits). This module never interprets a
 *   billing plan family as a feature tier — billing `PlanFamily`
 *   ('starter'|'pro'|'elite') and the legacy `FeatureTier` vocabulary
 *   overlap textually but are deliberately distinct TypeScript types with
 *   no cross-assignment.
 * - This module is strictly read-only: it never writes salon.plan,
 *   salon.features, module settings, limits or any legacy Stripe column,
 *   and it performs no database access at all (pure projection over its
 *   inputs).
 * - `billing_subscription` does not exist until Gate B (Migration A), so
 *   the versioned-billing side of the projection is always null in Gate A.
 *   A salon may later be simultaneously e.g. `starter_2026_08` (billing)
 *   and legacy `single_salon` (features) — that combination is expected
 *   and must not be "corrected" by either system.
 */

import 'server-only';

import { SALON_PLANS, type SalonPlan } from '@/models/Schema';

import type { PlanDefinitionKey } from './planDefinitions';
import type { TopupAudience } from './topupOffers';

export type LegacyBillingState = {
  /** The legacy plan, normalized fail-closed: unknown/missing -> 'free'. */
  legacyPlan: SalonPlan;
  /**
   * The versioned billing plan, once a live billing_subscription exists
   * (Gate B+). Always null in Gate A.
   */
  billingPlanDefinitionKey: PlanDefinitionKey | null;
};

function normalizeLegacyPlan(plan: string | null | undefined): SalonPlan {
  if (plan && (SALON_PLANS as readonly string[]).includes(plan)) {
    return plan as SalonPlan;
  }
  return 'free';
}

export function describeLegacyBillingState(salon: {
  plan: string | null;
}): LegacyBillingState {
  return {
    legacyPlan: normalizeLegacyPlan(salon.plan),
    billingPlanDefinitionKey: null,
  };
}

/**
 * Which top-up price tier a salon on a LEGACY plan sees before it ever has
 * a versioned billing subscription: legacy 'free' buys at free-plan prices,
 * every legacy paid plan buys at paid-plan prices.
 */
export function resolveTopupAudienceForLegacyPlan(plan: string | null): TopupAudience {
  return normalizeLegacyPlan(plan) === 'free' ? 'free_plan' : 'paid_plan';
}
