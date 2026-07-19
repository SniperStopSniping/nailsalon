import { sql } from 'drizzle-orm';

import { appointmentSchema } from '@/models/Schema';

/**
 * The ONE revenue expression for completed appointments: the final (net-of-tax,
 * post-discount) price where a checkout recorded one, the booked total for
 * legacy/pre-completion rows, and zero for complimentary appointments.
 *
 * Reporting policy (see checkoutTotals.ts): revenue counts completed
 * appointments regardless of collection state; tax is reported separately
 * (sum tax_amount_cents), tips separately (sum tip_cents). Client spending /
 * loyalty additionally require payment_status='paid'.
 */
export function revenueCentsSql() {
  return sql`CASE WHEN ${appointmentSchema.paymentStatus} = 'comp' THEN 0 ELSE COALESCE(${appointmentSchema.finalPriceCents}, ${appointmentSchema.totalPrice}) END`;
}
