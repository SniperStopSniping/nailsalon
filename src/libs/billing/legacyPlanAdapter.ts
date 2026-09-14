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

import type { BillingSubscriptionStatus, SalonPlan } from '@/models/Schema';
import { SALON_PLANS } from '@/models/Schema';

import type { PlanDefinitionKey } from './planDefinitions';
import { describeSubscriptionEntitlement, type SubscriptionEntitlement } from './subscriptionEntitlement';
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

/**
 * §5 `describeBillingState()` — the read-only join of legacy plan (still
 * authoritative for feature access) and the new versioned billing_subscription
 * state (G16). `billingStatus`/`entitlement` are null exactly when the salon
 * has no billing_subscription row at all; every row, whatever its status,
 * gets a real §6.5a entitlement (see subscriptionEntitlement.ts).
 */
export type BillingState = {
  legacyPlan: SalonPlan;
  billingPlanDefinitionKey: PlanDefinitionKey | null;
  billingStatus: BillingSubscriptionStatus | null;
  entitlement: SubscriptionEntitlement | null;
};

function normalizeLegacyPlan(plan: string | null | undefined): SalonPlan {
  if (plan && (SALON_PLANS as readonly string[]).includes(plan)) {
    return plan as SalonPlan;
  }
  return 'free';
}

export function describeBillingState(input: {
  salon: { plan: string | null };
  subscription: {
    planDefinitionKey: PlanDefinitionKey;
    status: BillingSubscriptionStatus;
    paidThrough: Date;
  } | null;
  now?: Date;
}): BillingState {
  const legacyPlan = normalizeLegacyPlan(input.salon.plan);
  if (input.subscription === null) {
    return {
      legacyPlan,
      billingPlanDefinitionKey: null,
      billingStatus: null,
      entitlement: null,
    };
  }
  return {
    legacyPlan,
    billingPlanDefinitionKey: input.subscription.planDefinitionKey,
    billingStatus: input.subscription.status,
    entitlement: describeSubscriptionEntitlement(input.subscription, input.now),
  };
}

/**
 * Thin backwards-compatible wrapper kept for existing callers (none as of
 * P5a — verified by grep) that only need the legacy-plan/plan-key pair
 * without a `billing_subscription` row to join against.
 */
export function describeLegacyBillingState(salon: {
  plan: string | null;
}): LegacyBillingState {
  const state = describeBillingState({ salon, subscription: null });
  return {
    legacyPlan: state.legacyPlan,
    billingPlanDefinitionKey: state.billingPlanDefinitionKey,
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
