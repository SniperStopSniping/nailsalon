import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { db } from '@/libs/DB';
import { customerPaymentCaptureSchema, customerPaymentFeeBindingSchema, customerPaymentFeeRefundSchema, customerPaymentRefundEventSchema, customerPaymentRefundSchema } from '@/models/customerPaymentSchema';
import { appointmentSchema } from '@/models/Schema';

import { isCustomerPaymentRefundTestEnabled } from '../refundTestGate';
import { customerPaymentFingerprint } from './preparationRepository';

const cents = z.number().int().nonnegative().max(MAX_SUPPORTED_MINOR_UNIT_AMOUNT);
const nonblankIdentity = z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Identity must not be blank');
const identity = z.object({
  captureId: z.string().uuid(),
  stripeAccountId: nonblankIdentity,
  paymentIntentId: nonblankIdentity,
  currency: z.literal('cad'),
  mode: z.literal('test'),
  source: z.literal('synthetic_test'),
  eventId: nonblankIdentity,
  amountCents: cents.refine(value => value > 0),
  occurredAt: z.date(),
});
const refundSchema = identity.extend({ refundId: nonblankIdentity, status: z.literal('succeeded'), principalCents: cents, tipCents: cents }).strict();
const bindingSchema = identity.extend({ applicationFeeId: nonblankIdentity }).strict();
const feeSchema = identity.extend({ applicationFeeId: nonblankIdentity, feeRefundId: nonblankIdentity, status: z.literal('succeeded') }).strict();
export type SyntheticCustomerRefund = z.infer<typeof refundSchema>;
export type SyntheticApplicationFeeBinding = z.infer<typeof bindingSchema>;
export type SyntheticApplicationFeeRefund = z.infer<typeof feeSchema>;
type Database = Pick<typeof db, 'select' | 'transaction'>;
type Kind = 'customer_refund' | 'fee_binding' | 'fee_refund';

/** No provider operations: accepts only explicitly successful synthetic facts. */
async function record(database: Database, kind: Kind, raw: SyntheticCustomerRefund | SyntheticApplicationFeeBinding | SyntheticApplicationFeeRefund) {
  if (!isCustomerPaymentRefundTestEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_TEST_DISABLED');
  }
  const evidence = kind === 'customer_refund' ? refundSchema.parse(raw) : kind === 'fee_binding' ? bindingSchema.parse(raw) : feeSchema.parse(raw);
  if (evidence.occurredAt.getTime() > Date.now()) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_FUTURE_TIMESTAMP');
  }
  const [identityCapture] = await database.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, evidence.captureId)).limit(1);
  if (!identityCapture || identityCapture.state !== 'posted' || identityCapture.currency !== 'cad'
    || identityCapture.source !== evidence.source || identityCapture.mode !== evidence.mode
    || identityCapture.stripeAccountId !== evidence.stripeAccountId || identityCapture.paymentIntentId !== evidence.paymentIntentId) {
    throw new Error('CUSTOMER_PAYMENT_REFUND_IDENTITY_MISMATCH');
  }
  const { eventId, ...facts } = evidence;
  const fingerprint = customerPaymentFingerprint({ kind, ...facts, occurredAt: evidence.occurredAt.toISOString() });
  return database.transaction(async (tx) => {
    const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, identityCapture.appointmentId), eq(appointmentSchema.salonId, identityCapture.salonId))).for('update').limit(1);
    if (!appointment) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_APPOINTMENT_NOT_FOUND');
    }
    const [capture] = await tx.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, evidence.captureId)).for('update').limit(1);
    if (!capture) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_IDENTITY_MISMATCH');
    }
    const [receipt] = await tx.select().from(customerPaymentRefundEventSchema).where(and(eq(customerPaymentRefundEventSchema.stripeAccountId, evidence.stripeAccountId), eq(customerPaymentRefundEventSchema.mode, 'test'), eq(customerPaymentRefundEventSchema.eventId, eventId))).limit(1);
    if (receipt && (receipt.fingerprint !== fingerprint || receipt.kind !== kind || receipt.captureId !== capture.id)) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_EVENT_CONFLICT');
    }
    const base = { id: randomUUID(), captureId: capture.id, salonId: capture.salonId, appointmentId: capture.appointmentId, stripeAccountId: evidence.stripeAccountId, paymentIntentId: evidence.paymentIntentId, currency: evidence.currency, mode: evidence.mode, source: evidence.source, amountCents: evidence.amountCents, occurredAt: evidence.occurredAt, fingerprint };
    let movement: { id: string; fingerprint: string; state?: string } | undefined;
    let replayed = false;
    if (kind === 'customer_refund') {
      const value = evidence as SyntheticCustomerRefund;
      const [existing] = await tx.select().from(customerPaymentRefundSchema).where(and(eq(customerPaymentRefundSchema.stripeAccountId, value.stripeAccountId), eq(customerPaymentRefundSchema.mode, 'test'), eq(customerPaymentRefundSchema.refundId, value.refundId))).limit(1);
      if (existing) {
        movement = existing;
        replayed = true;
      } else {
        const prior = await tx.select().from(customerPaymentRefundSchema).where(eq(customerPaymentRefundSchema.captureId, capture.id));
        const applied = prior.filter(row => row.state === 'applied');
        const principal = applied.reduce((sum, row) => sum + row.principalCents, 0);
        const tip = applied.reduce((sum, row) => sum + row.tipCents, 0);
        const invalid = value.amountCents !== value.principalCents + value.tipCents || principal + value.principalCents > capture.principalCents
          || tip + value.tipCents > capture.tipCents || prior.some(row => row.state === 'held_review') || value.occurredAt < capture.capturedAt;
        [movement] = await tx.insert(customerPaymentRefundSchema).values({ ...base, refundId: value.refundId, principalCents: value.principalCents, tipCents: value.tipCents, state: invalid ? 'held_review' : 'applied', reviewReason: invalid ? 'REFUND_ALLOCATION_REVIEW_REQUIRED' : null }).returning();
      }
    } else if (kind === 'fee_binding') {
      const value = evidence as SyntheticApplicationFeeBinding;
      const [existing] = await tx.select().from(customerPaymentFeeBindingSchema).where(eq(customerPaymentFeeBindingSchema.captureId, capture.id)).limit(1);
      if (existing) {
        movement = existing;
        replayed = true;
      } else {
        if (value.amountCents !== capture.applicationFeeCents) {
          throw new Error('CUSTOMER_PAYMENT_FEE_BINDING_INVALID');
        }
        [movement] = await tx.insert(customerPaymentFeeBindingSchema).values({ ...base, applicationFeeId: value.applicationFeeId }).returning();
      }
    } else {
      const value = evidence as SyntheticApplicationFeeRefund;
      const [existing] = await tx.select().from(customerPaymentFeeRefundSchema).where(and(eq(customerPaymentFeeRefundSchema.stripeAccountId, value.stripeAccountId), eq(customerPaymentFeeRefundSchema.mode, 'test'), eq(customerPaymentFeeRefundSchema.feeRefundId, value.feeRefundId))).limit(1);
      if (existing) {
        movement = existing;
        replayed = true;
      } else {
        const [binding] = await tx.select().from(customerPaymentFeeBindingSchema).where(eq(customerPaymentFeeBindingSchema.captureId, capture.id)).limit(1);
        const prior = await tx.select().from(customerPaymentFeeRefundSchema).where(eq(customerPaymentFeeRefundSchema.captureId, capture.id));
        const refunded = prior.filter(row => row.state === 'applied').reduce((sum, row) => sum + row.amountCents, 0);
        const customerRefunds = await tx.select().from(customerPaymentRefundSchema).where(eq(customerPaymentRefundSchema.captureId, capture.id));
        const customerReturned = customerRefunds.filter(row => row.state === 'applied').reduce((sum, row) => sum + row.amountCents, 0);
        const target = Number(BigInt(capture.applicationFeeCents) * BigInt(customerReturned) / BigInt(capture.amountCents));
        const invalid = !binding || binding.applicationFeeId !== value.applicationFeeId || refunded + value.amountCents > binding.amountCents || refunded + value.amountCents > target
          || prior.some(row => row.state === 'held_review') || value.occurredAt < capture.capturedAt;
        [movement] = await tx.insert(customerPaymentFeeRefundSchema).values({ ...base, applicationFeeId: value.applicationFeeId, feeRefundId: value.feeRefundId, bindingId: binding?.applicationFeeId === value.applicationFeeId ? binding.id : null, state: invalid ? 'held_review' : 'applied', reviewReason: invalid ? 'FEE_REFUND_REVIEW_REQUIRED' : null }).returning();
      }
    }
    if (!movement || movement.fingerprint !== fingerprint) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_IDENTITY_CONFLICT');
    }
    const receiptMovement = receipt?.refundId ?? receipt?.bindingId ?? receipt?.feeRefundId;
    if (receipt && receiptMovement !== movement.id) {
      throw new Error('CUSTOMER_PAYMENT_REFUND_EVENT_CONFLICT');
    }
    if (!receipt) {
      await tx.insert(customerPaymentRefundEventSchema).values({ id: randomUUID(), captureId: capture.id, stripeAccountId: evidence.stripeAccountId, mode: 'test', eventId, kind, fingerprint, refundId: kind === 'customer_refund' ? movement.id : null, bindingId: kind === 'fee_binding' ? movement.id : null, feeRefundId: kind === 'fee_refund' ? movement.id : null });
    }
    return { movementId: movement.id, state: movement.state ?? 'bound', replayed, collectionHold: kind === 'customer_refund' ? 'refund_reconciliation_required' as const : undefined };
  });
}
export const recordSyntheticCustomerRefund = (database: Database, evidence: SyntheticCustomerRefund) => record(database, 'customer_refund', evidence);
export const bindSyntheticApplicationFee = (database: Database, evidence: SyntheticApplicationFeeBinding) => record(database, 'fee_binding', evidence);
export const recordSyntheticApplicationFeeRefund = (database: Database, evidence: SyntheticApplicationFeeRefund) => record(database, 'fee_refund', evidence);
