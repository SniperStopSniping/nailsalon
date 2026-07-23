import { sql } from 'drizzle-orm';

import { appointmentSchema } from '@/models/Schema';

/**
 * Legacy-compatible per-row revenue expression.
 *
 * This intentionally preserves the existing behavior for callers that already
 * supply their own status/deletion predicates. New reporting should use
 * `completedAppointmentRevenueCentsSql` and
 * `completedAppointmentRevenueAggregateSql`, which also expose data provenance.
 */
export function revenueCentsSql() {
  return sql`CASE WHEN ${appointmentSchema.paymentStatus} = 'comp' THEN 0 ELSE COALESCE(${appointmentSchema.finalPriceCents}, ${appointmentSchema.totalPrice}) END`;
}

function completedRevenueEligibleSql() {
  return sql`${appointmentSchema.status} = 'completed'
    AND ${appointmentSchema.deletedAt} IS NULL
    AND ${appointmentSchema.paymentStatus} IS DISTINCT FROM 'comp'`;
}

function finalizedRevenueRowSql() {
  return sql`${completedRevenueEligibleSql()}
    AND ${appointmentSchema.finalPriceCents} IS NOT NULL
    AND ${appointmentSchema.finalPriceCents} >= 0`;
}

function legacyRevenueRowSql() {
  return sql`${completedRevenueEligibleSql()}
    AND ${appointmentSchema.finalPriceCents} IS NULL
    AND ${appointmentSchema.totalPrice} IS NOT NULL
    AND ${appointmentSchema.totalPrice} >= 0`;
}

/**
 * Canonical completed appointment revenue for one row.
 *
 * Revenue is net of checkout discounts and tax, excludes tips, and does not
 * depend on collection state. Legacy rows use their booked total, while
 * invalid/unresolved and ineligible rows contribute zero.
 */
export function completedAppointmentRevenueCentsSql() {
  return sql<number>`CASE
    WHEN ${finalizedRevenueRowSql()} THEN ${appointmentSchema.finalPriceCents}
    WHEN ${legacyRevenueRowSql()} THEN ${appointmentSchema.totalPrice}
    ELSE 0
  END`;
}

/**
 * Aggregate SQL fragments for a Drizzle select. The split counts and amounts
 * let callers build `ReportingProvenance` without silently merging finalized
 * checkout snapshots with legacy booked-total fallbacks.
 */
export function completedAppointmentRevenueAggregateSql() {
  const finalized = finalizedRevenueRowSql();
  const legacy = legacyRevenueRowSql();
  const unresolved = sql`${completedRevenueEligibleSql()}
    AND NOT (${finalized} OR ${legacy})`;

  return {
    totalCents: sql<number>`COALESCE(SUM(${completedAppointmentRevenueCentsSql()}), 0)::int`,
    finalizedAppointmentCount: sql<number>`COUNT(*) FILTER (WHERE ${finalized})::int`,
    legacyAppointmentCount: sql<number>`COUNT(*) FILTER (WHERE ${legacy})::int`,
    unresolvedAppointmentCount: sql<number>`COUNT(*) FILTER (WHERE ${unresolved})::int`,
    finalizedAmountCents: sql<number>`COALESCE(
      SUM(${appointmentSchema.finalPriceCents}) FILTER (WHERE ${finalized}),
      0
    )::int`,
    legacyFallbackAmountCents: sql<number>`COALESCE(
      SUM(${appointmentSchema.totalPrice}) FILTER (WHERE ${legacy}),
      0
    )::int`,
  };
}
