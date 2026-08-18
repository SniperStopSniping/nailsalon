import type { SalonPlan } from '@/models/Schema';

/**
 * Portfolio photo limit — stored capacity, not exposure.
 *
 * The limit counts EVERY non-deleted portfolio photo a business stores.
 * Hidden photos, Discover-excluded photos and photos retained over allowance
 * after a downgrade all consume a slot; fully deleted rows and failed/expired
 * pending uploads do not. Deleting a photo frees capacity immediately.
 *
 * This is deliberately NOT an "exposure allowance", a "Discover allowance" or
 * a ranking input. A larger portfolio lets a business match more searches
 * naturally; it never buys placement. Nothing in Discover may read this value
 * to order or weight results.
 *
 * ENTITLEMENT AUTHORITY. Feature access in this repository is owned by the
 * LEGACY plan system (`salon.plan` → `@/libs/featureTiers` /
 * `@/libs/planLimits`). The billing domain added by the billing &
 * communications track is deliberately separate: per §5 of
 * `docs/luster-billing-communications-rev-2-2.md` it must not write
 * `salon.plan` or feature entitlements, and a salon may be `starter_2026_08`
 * for billing while remaining legacy `single_salon` for features. This module
 * therefore never reads `billing_subscription`.
 */

// ---------------------------------------------------------------------------
// LEGACY PLAN → PORTFOLIO LIMIT MAPPING — OWNER REVIEW REQUIRED
// ---------------------------------------------------------------------------
//
// `docs/DISCOVER_V1_BRIEF.md` §25 proposes limits by commercial plan family
// (Free 10 / Starter 30 / Pro 75 / Elite 200) and states that the exact
// mapping onto the real legacy plan family must be ratified in PR1 review.
// The two vocabularies do not line up one-to-one, so two decisions below are
// PROVISIONAL and are flagged for the owner rather than silently baked in:
//
//   1. The brief's "Starter / solo paid: 30" row has NO legacy equivalent.
//      The legacy family is free | single_salon | multi_salon | enterprise,
//      and `free` is the only plan mapping to the `starter` feature tier
//      (see PLAN_TO_FEATURE_TIER in `@/libs/planLimits`). The values below
//      follow that existing bridge — free→starter, single_salon→pro,
//      multi_salon→elite, enterprise→elite — rather than inventing a second
//      plan↔tier mapping. Consequence: the commercial Starter tier (30) has
//      no legacy home yet, and a paid `single_salon` salon receives the Pro
//      allowance of 75.
//
//   2. `enterprise` is unlimited (-1) here, matching how `PLAN_LIMITS` already
//      treats enterprise for technicians and locations. The brief's table
//      stops at Elite/200 and does not describe enterprise at all.
//
// Changing either decision is a one-line edit to this table. Until the owner
// ratifies it, treat these numbers as provisional defaults, not policy.
export const PORTFOLIO_PHOTO_LIMITS: Record<SalonPlan, number> = {
  free: 10,
  single_salon: 75,
  multi_salon: 200,
  enterprise: -1, // -1 = unlimited, consistent with PLAN_LIMITS
};

export const UNLIMITED_PORTFOLIO_PHOTOS = -1;

export type PortfolioLimitSource = 'plan' | 'override';

export type PortfolioAllowance = {
  plan: SalonPlan;
  /** Effective allowance; -1 means unlimited. */
  max: number;
  source: PortfolioLimitSource;
};

export function portfolioLimitForPlan(plan: SalonPlan): number {
  return PORTFOLIO_PHOTO_LIMITS[plan] ?? PORTFOLIO_PHOTO_LIMITS.free;
}

/**
 * Resolve a salon's effective allowance.
 *
 * A per-salon numeric override wins over the plan default, mirroring how
 * `salon.maxLocations` overrides the plan's location limit. This is the
 * supported route for founding/promotional businesses — it keeps the promise
 * on the salon row with an auditable source rather than special-casing plan
 * names throughout the codebase.
 */
export function resolvePortfolioAllowance({
  plan,
  maxPortfolioPhotos,
}: {
  plan: SalonPlan | null | undefined;
  maxPortfolioPhotos: number | null | undefined;
}): PortfolioAllowance {
  const resolvedPlan = (plan || 'free') as SalonPlan;

  if (typeof maxPortfolioPhotos === 'number') {
    return { plan: resolvedPlan, max: maxPortfolioPhotos, source: 'override' };
  }

  return {
    plan: resolvedPlan,
    max: portfolioLimitForPlan(resolvedPlan),
    source: 'plan',
  };
}

export class PortfolioLimitError extends Error {
  readonly code = 'PORTFOLIO_PHOTO_LIMIT_REACHED';
  readonly stored: number;
  readonly max: number;
  readonly plan: SalonPlan;

  constructor({ stored, max, plan }: { stored: number; max: number; plan: SalonPlan }) {
    super(`Portfolio photo limit reached (${stored}/${max}) on the ${plan} plan`);
    this.name = 'PortfolioLimitError';
    this.stored = stored;
    this.max = max;
    this.plan = plan;
  }
}
