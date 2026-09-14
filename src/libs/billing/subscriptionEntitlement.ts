/**
 * Subscription-status entitlement projection — contract §6.5a.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §6.5a.
 *
 * §6.5a is normative for "what does this Stripe subscription status mean
 * for credit grants, right now, in plain English." This module is the ONE
 * place that table is encoded so the owner usage API (G18) and
 * `describeBillingState` (G16) can never drift from each other or from the
 * credit-window scheduler's own eligibility check.
 *
 * Pure: no Env, no database, no I/O.
 */

import type { BillingSubscriptionStatus } from '@/models/Schema';

/**
 * Mirrors the PRIVATE `GRANT_ELIGIBLE_STATUSES` set in
 * `src/libs/billing/creditGrants.ts` (not exported there). `creditGrants.ts`
 * is a LIVE module — it grants real credits from this set today — and this
 * dark-only phase (P5a) is explicitly forbidden from editing it, so the set
 * cannot simply be imported. It is reproduced here instead, byte-for-byte.
 * `subscriptionEntitlement.test.ts` asserts textual equality against
 * `creditGrants.ts`'s own source so the two sets can never silently drift
 * apart — if a future change touches one without the other, that test
 * fails.
 */
export const GRANT_ELIGIBLE_STATUSES: ReadonlySet<BillingSubscriptionStatus> = new Set([
  'active',
  'past_due',
  'canceled',
]);

export type SubscriptionEntitlement = {
  status: BillingSubscriptionStatus;
  /** ISO instant, or null only when there is no subscription at all. */
  paidThrough: string | null;
  /** Same eligibility the credit-window scheduler uses (§6.4/§6.5a). */
  grantsEligible: boolean;
  /** Owner-facing, plain English, no Stripe vocabulary. */
  label: string;
};

function formatOwnerDate(date: Date): string {
  // UTC explicitly: paidThrough is a stored instant, and the owner's local
  // rendering (this route/adapter's caller has no salon timezone in scope
  // here) must not drift a day depending on the SERVER's local clock.
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** §6.5a owner-facing status label. */
function describeLabel(
  status: BillingSubscriptionStatus,
  paidThrough: Date,
  now: Date,
): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'past_due':
      return `Payment past due — prepaid credits continue until ${formatOwnerDate(paidThrough)}`;
    case 'unpaid':
      return 'Payment failed — no new monthly credits';
    case 'incomplete':
      return 'Setup not finished — no monthly credits yet';
    case 'incomplete_expired':
      return 'Setup expired — no subscription';
    case 'paused':
      return 'Paused — no new monthly credits';
    case 'canceled':
      return paidThrough.getTime() > now.getTime()
        ? `Cancelled — credits continue until ${formatOwnerDate(paidThrough)}`
        : 'Cancelled';
    case 'trialing':
      // Founding v1 has no trial product (§6.5a): trialing is ALWAYS an
      // anomaly, never a normal state, and grants nothing.
      return 'Needs review';
    default:
      // Exhaustive per BillingSubscriptionStatus; kept as a fail-safe for
      // any future status value added to the CHECK before this table is.
      return 'Needs review';
  }
}

/**
 * Project a `billing_subscription` row into the owner-facing entitlement
 * shape. Returns null only when there is no subscription row at all — every
 * status the row can hold gets a real label (§6.5a covers all eight).
 */
export function describeSubscriptionEntitlement(
  subscription: { status: BillingSubscriptionStatus; paidThrough: Date } | null,
  now: Date = new Date(),
): SubscriptionEntitlement | null {
  if (subscription === null) {
    return null;
  }
  return {
    status: subscription.status,
    paidThrough: subscription.paidThrough.toISOString(),
    grantsEligible: GRANT_ELIGIBLE_STATUSES.has(subscription.status),
    label: describeLabel(subscription.status, subscription.paidThrough, now),
  };
}
