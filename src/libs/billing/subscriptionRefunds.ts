/**
 * Durable §6.7 exclusions, stored with the refund transition in audit_log.
 * These financial facts must remain for the subscription's lifetime; payload
 * purging never removes them. All callers hold the subscription row lock.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { auditLogSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

export type SubscriptionRefund = { invoiceId: string; start: Date; end: Date };

export async function readSubscriptionRefunds(
  tx: BillingDbTransaction,
  subscription: { id: string; salonId: string },
): Promise<{ refunds: SubscriptionRefund[]; incomplete: boolean }> {
  const rows = await tx.select({ metadata: auditLogSchema.metadata }).from(auditLogSchema).where(and(
    eq(auditLogSchema.salonId, subscription.salonId),
    eq(auditLogSchema.entityType, 'billing_subscription'),
    eq(auditLogSchema.entityId, subscription.id),
    eq(auditLogSchema.action, 'billing_subscription_refund_applied'),
  ));
  const refunds: SubscriptionRefund[] = [];
  let incomplete = false;
  for (const row of rows) {
    const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    const start = new Date(typeof metadata?.refundedPeriodStart === 'string' ? metadata.refundedPeriodStart : '');
    const end = new Date(typeof metadata?.refundedPeriodEnd === 'string' ? metadata.refundedPeriodEnd : '');
    if (typeof metadata?.invoiceId !== 'string' || !metadata.invoiceId
      || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      incomplete = true; // Historical/invalid evidence requires operator review, never silent re-grant.
    } else {
      refunds.push({ invoiceId: metadata.invoiceId, start, end });
    }
  }
  return { refunds, incomplete };
}

export function overlapsRefund(
  evidence: Awaited<ReturnType<typeof readSubscriptionRefunds>>,
  period: { start: Date; end: Date },
): boolean {
  return evidence.incomplete || evidence.refunds.some(refund => period.start < refund.end && period.end > refund.start);
}
