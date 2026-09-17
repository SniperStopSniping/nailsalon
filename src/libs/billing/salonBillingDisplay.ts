/**
 * Owner-facing billing display — D19c companion (Rev 2.3 §5, ratified 2026-09-16).
 *
 * The legacy webhook route's §5 isolation exception stops it flipping
 * `salon.billingMode` for a new-track Checkout Session. Without this helper that
 * correctness fix would read, to a paying new-track subscriber, as a regression:
 * both settings routes derive the billing display from the legacy columns alone,
 * so the owner would see "Cash / Offline billing enabled" and lose the
 * Manage-billing button (`SettingsModal.tsx`, testid `manage-billing-button`).
 *
 * The rule is read-only and one-directional: a LIVE `billing_subscription` row
 * wins for DISPLAY; the legacy column itself is never rewritten by the new
 * track, `canEditBillingMode` stays false, `billingMode` stays in the admin
 * route's FORBIDDEN_FIELDS, and the super-admin PATCH keeps writing the legacy
 * column. `billingSource` tells the caller which side answered.
 *
 * The live predicate and its ordering are the ones the usage route already
 * encodes (`src/app/api/admin/salon/communications/usage/route.ts`) and the
 * partial unique index `billing_subscription_live_salon_uniq` excludes, so the
 * owner surfaces cannot drift apart: prefer a row whose status is not
 * `canceled`/`incomplete_expired`, and among ties the most recently updated.
 */

import 'server-only';

import { desc, eq, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { billingSubscriptionSchema } from '@/models/Schema';

/**
 * Statuses that are history rather than a live subscription. Mirrors the usage
 * route's ordering predicate and the partial unique index's WHERE clause.
 */
const NON_LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ['canceled', 'incomplete_expired'];

export type SalonBillingDisplay = {
  /**
   * The existing owner-facing vocabulary — `'STRIPE'` or `'NONE'` today. Left
   * open so any other legacy column value passes through unchanged.
   */
  billingMode: string;
  subscriptionStatus: string | null;
  billingSource: 'billing_subscription' | 'legacy';
};

type SalonBillingColumns = {
  id: string;
  billingMode: string | null;
  stripeSubscriptionStatus: string | null;
};

/**
 * Resolves what the owner and super-admin surfaces should SHOW for a salon.
 *
 * Accepts the shared `db` or a transaction (both satisfy the `select` shape).
 */
export async function resolveSalonBillingDisplay(
  dbOrTx: Pick<typeof db, 'select'>,
  salon: SalonBillingColumns,
): Promise<SalonBillingDisplay> {
  const [row] = await dbOrTx
    .select({
      status: billingSubscriptionSchema.status,
      updatedAt: billingSubscriptionSchema.updatedAt,
    })
    .from(billingSubscriptionSchema)
    .where(eq(billingSubscriptionSchema.salonId, salon.id))
    // Live row first, then most recently updated — the usage route's ordering.
    .orderBy(
      sql`(${billingSubscriptionSchema.status} not in ('canceled', 'incomplete_expired')) desc`,
      desc(billingSubscriptionSchema.updatedAt),
    )
    .limit(1);

  // LIMIT 1 still returns a history row when a salon has only history, so the
  // liveness test is repeated here rather than inferred from "a row exists".
  if (row !== undefined && !NON_LIVE_SUBSCRIPTION_STATUSES.includes(row.status)) {
    return {
      billingMode: 'STRIPE',
      subscriptionStatus: row.status,
      billingSource: 'billing_subscription',
    };
  }

  // Today's legacy expressions, byte-for-byte.
  return {
    billingMode: salon.billingMode ?? 'NONE',
    subscriptionStatus: salon.billingMode === 'STRIPE' ? salon.stripeSubscriptionStatus : null,
    billingSource: 'legacy',
  };
}
