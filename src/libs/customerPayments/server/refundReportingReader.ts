import 'server-only';

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { appointmentPaymentSchema, appointmentSchema } from '@/models/Schema';

import { CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED } from '../captureReporting';
import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { projectCustomerPaymentRefundReport } from '../refundReporting';

/** Refund period is independent of capture period; untagged salons read no new table. */
export async function readCustomerPaymentRefundReport(database: Pick<typeof db, 'select'>, input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
}) {
  const empty = (hasCustomerPaymentMarker = false) => ({ hasCustomerPaymentMarker, ...projectCustomerPaymentRefundReport({ ...input, captures: [], markers: [], refunds: [], bindings: [], feeRefunds: [] }), captureMarkers: [] as (typeof appointmentPaymentSchema.$inferSelect)[] });
  const [marker] = await database.select({ id: appointmentPaymentSchema.id }).from(appointmentPaymentSchema)
    .innerJoin(appointmentSchema, eq(appointmentSchema.id, appointmentPaymentSchema.appointmentId))
    .where(and(eq(appointmentSchema.salonId, input.salonId), sql`(left(${appointmentPaymentSchema.id}, 5) = 'cpay_' OR left(COALESCE(${appointmentPaymentSchema.reference}, ''), 25) = 'customer_payment_capture:')`)).limit(1);
  if (!marker) {
    return empty();
  }
  // Disabling new refund writes never erases already-observed financial facts.
  if (!isCustomerPaymentLedgerTestEnabled()) {
    throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
  }
  const { customerPaymentCaptureSchema, customerPaymentRefundSchema, customerPaymentFeeBindingSchema, customerPaymentFeeRefundSchema } = await import('@/models/customerPaymentSchema');
  const [refunds, feeRefunds] = await Promise.all([
    database.select().from(customerPaymentRefundSchema).where(and(eq(customerPaymentRefundSchema.salonId, input.salonId), gte(customerPaymentRefundSchema.occurredAt, input.start), lt(customerPaymentRefundSchema.occurredAt, input.end))),
    database.select().from(customerPaymentFeeRefundSchema).where(and(eq(customerPaymentFeeRefundSchema.salonId, input.salonId), gte(customerPaymentFeeRefundSchema.occurredAt, input.start), lt(customerPaymentFeeRefundSchema.occurredAt, input.end))),
  ]);
  const captureIds = [...new Set([...refunds, ...feeRefunds].map(row => row.captureId))];
  if (captureIds.length === 0) {
    return empty(true);
  }
  const [captures, bindings] = await Promise.all([
    database.select().from(customerPaymentCaptureSchema).where(and(eq(customerPaymentCaptureSchema.salonId, input.salonId), inArray(customerPaymentCaptureSchema.id, captureIds))),
    database.select().from(customerPaymentFeeBindingSchema).where(and(eq(customerPaymentFeeBindingSchema.salonId, input.salonId), inArray(customerPaymentFeeBindingSchema.captureId, captureIds))),
  ]);
  if (captures.length !== captureIds.length) {
    throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
  }
  const markers = await database.select().from(appointmentPaymentSchema).where(and(
    eq(appointmentPaymentSchema.salonId, input.salonId),
    inArray(appointmentPaymentSchema.id, captures.map(row => row.tenderId)),
  ));
  return { ...projectCustomerPaymentRefundReport({ ...input, captures, bindings, markers, refunds, feeRefunds }), captureMarkers: markers, hasCustomerPaymentMarker: true };
}
