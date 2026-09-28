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
// UNIVERSAL PORTFOLIO CAPACITY
// ---------------------------------------------------------------------------
//
// Every legacy plan receives the historical highest supported photo capacity.
// Billing may change SMS allowance, but it does not reduce this built feature.
// Explicit operational overrides remain handled below.

export const PORTFOLIO_PHOTO_LIMITS: Record<SalonPlan, number> = {
  free: 200,
  single_salon: 200,
  multi_salon: 200,
  enterprise: 200,
};

/**
 * Founding salons carry the growth allowance regardless of the plan row they
 * sit on, which is usually `free`.
 *
 * Founding status is read from `salon.freeSoloEnabled` — the flag the Luster
 * onboarding invite path sets — and never inferred from billing state.
 */
export const FOUNDING_PORTFOLIO_PHOTO_LIMIT = 200;

export const UNLIMITED_PORTFOLIO_PHOTOS = -1;

export type PortfolioLimitSource = 'plan' | 'founding' | 'override';

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
  freeSoloEnabled = false,
}: {
  plan: SalonPlan | null | undefined;
  maxPortfolioPhotos: number | null | undefined;
  /** Founding/free-solo salon, from `salon.freeSoloEnabled`. Never billing. */
  freeSoloEnabled?: boolean | null;
}): PortfolioAllowance {
  const resolvedPlan = (plan || 'free') as SalonPlan;

  // An explicit per-salon number is the final word, above both the founding
  // default and the plan row — it is how a specific promise is kept.
  if (typeof maxPortfolioPhotos === 'number') {
    return { plan: resolvedPlan, max: maxPortfolioPhotos, source: 'override' };
  }

  if (freeSoloEnabled) {
    return { plan: resolvedPlan, max: FOUNDING_PORTFOLIO_PHOTO_LIMIT, source: 'founding' };
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
