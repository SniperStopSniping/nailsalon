import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { MAX_SUPPORTED_MINOR_UNIT_AMOUNT } from '@/libs/checkoutTotals';
import type { db } from '@/libs/DB';
import { customerPaymentCaptureSchema, type CustomerPaymentCreditDecision, customerPaymentCreditDecisionSchema, customerPaymentFeeBindingSchema, customerPaymentFeeRefundSchema, customerPaymentRefundSchema } from '@/models/customerPaymentSchema';
import { adminSalonMembershipSchema, appointmentDepositSchema, appointmentPaymentSchema, appointmentSchema } from '@/models/Schema';

import { buildCustomerPaymentCreditBasis, type CustomerPaymentCreditNote, projectResolvedCustomerPaymentCredit } from '../creditResolution';
import { isCustomerPaymentCreditReviewTestEnabled } from '../creditReviewTestGate';
import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { loadCustomerPaymentCreditEvidence } from './creditEvidence';
import { customerPaymentFingerprint } from './preparationRepository';

const identifier = z.string().min(1).max(200).refine(value => value.trim().length > 0);
const actorSchema = z.object({ adminId: identifier, authenticated: z.literal(true), impersonating: z.literal(false) }).strict();
/** Only a genuine server-auth guard may construct this context for an exposed API. */
export type TrustedCreditReviewActor = z.infer<typeof actorSchema>;
const scopeSchema = z.object({ salonId: identifier, appointmentId: identifier }).strict();
const cents = z.number().int().nonnegative().max(MAX_SUPPORTED_MINOR_UNIT_AMOUNT);
export const syntheticCreditDecisionRequestSchema = scopeSchema.extend({
  requestId: z.string().uuid(),
  expectedEvidenceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1).max(2000).refine(value => value.trim().length > 0),
  serviceCreditCents: cents,
  taxCreditCents: cents,
  tipCreditCents: cents,
}).strict();
export type SyntheticCreditDecisionRequest = z.infer<typeof syntheticCreditDecisionRequestSchema>;
type Database = Pick<typeof db, 'select' | 'transaction'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
function gate(actor: TrustedCreditReviewActor) {
  if (!isCustomerPaymentCreditReviewTestEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_CREDIT_REVIEW_TEST_DISABLED');
  }
  return actorSchema.parse(actor);
}
async function lockAppointment(tx: Transaction, scope: { salonId: string; appointmentId: string }) {
  const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, scope.appointmentId), eq(appointmentSchema.salonId, scope.salonId))).for('update').limit(1);
  if (!appointment) {
    throw new Error('CUSTOMER_PAYMENT_CREDIT_APPOINTMENT_NOT_FOUND');
  }
  return appointment;
}
async function verifyOwner(tx: Transaction, actorId: string, salonId: string) {
  const [membership] = await tx.select().from(adminSalonMembershipSchema).where(and(eq(adminSalonMembershipSchema.adminId, actorId), eq(adminSalonMembershipSchema.salonId, salonId), eq(adminSalonMembershipSchema.role, 'owner'))).for('share', { noWait: true }).limit(1);
  if (!membership) {
    throw new Error('CUSTOMER_PAYMENT_CREDIT_OWNER_REQUIRED');
  }
}
/** Sort by immutable parent links, never wall-clock order or cumulative sum. */
function chain(rows: CustomerPaymentCreditDecision[]) {
  const result: CustomerPaymentCreditDecision[] = [];
  let previous: string | null = null;
  while (result.length < rows.length) {
    const next = rows.filter(row => row.previousDecisionId === previous);
    if (next.length !== 1 || result.some(row => row.id === next[0]!.id)) {
      throw new Error('CUSTOMER_PAYMENT_CREDIT_HISTORY_CONFLICT');
    }
    result.push(next[0]!);
    previous = next[0]!.id;
  }
  return result;
}
export function customerPaymentDecisionNote(row: CustomerPaymentCreditDecision): CustomerPaymentCreditNote {
  return { id: row.id, salonId: row.salonId, appointmentId: row.appointmentId, captureId: row.captureId, currency: 'CAD', scope: 'customer_refund_credit', basisVersion: 1, evidenceFingerprint: row.projectionFingerprint, previousDecisionId: row.previousDecisionId, serviceCreditCents: row.serviceCreditCents, taxCreditCents: row.taxCreditCents, tipCreditCents: row.tipCreditCents, deltaServiceCreditCents: row.deltaServiceCreditCents, deltaTaxCreditCents: row.deltaTaxCreditCents, deltaTipCreditCents: row.deltaTipCreditCents };
}
function publicDecision(row: CustomerPaymentCreditDecision) {
  return { id: row.id, previousDecisionId: row.previousDecisionId, serviceCreditCents: row.serviceCreditCents, taxCreditCents: row.taxCreditCents, tipCreditCents: row.tipCreditCents, deltaServiceCreditCents: row.deltaServiceCreditCents, deltaTaxCreditCents: row.deltaTaxCreditCents, deltaTipCreditCents: row.deltaTipCreditCents, reason: row.reason, createdAt: row.createdAt };
}
async function load(tx: Transaction, appointment: typeof appointmentSchema.$inferSelect) {
  const appointmentId = appointment.id;
  const captures = await tx.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.appointmentId, appointmentId));
  const refunds = await tx.select().from(customerPaymentRefundSchema).where(eq(customerPaymentRefundSchema.appointmentId, appointmentId));
  const payments = await tx.select().from(appointmentPaymentSchema).where(eq(appointmentPaymentSchema.appointmentId, appointmentId));
  const deposits = await tx.select().from(appointmentDepositSchema).where(eq(appointmentDepositSchema.appointmentId, appointmentId));
  const feeBindings = await tx.select().from(customerPaymentFeeBindingSchema).where(eq(customerPaymentFeeBindingSchema.appointmentId, appointmentId));
  const feeRefunds = await tx.select().from(customerPaymentFeeRefundSchema).where(eq(customerPaymentFeeRefundSchema.appointmentId, appointmentId));
  const source = { appointment, captures, refunds, payments, deposits, feeBindings, feeRefunds };
  const basis = buildCustomerPaymentCreditBasis(source);
  const evidence = await loadCustomerPaymentCreditEvidence(tx, appointment.salonId, appointmentId);
  const history = chain(await tx.select().from(customerPaymentCreditDecisionSchema).where(and(eq(customerPaymentCreditDecisionSchema.salonId, appointment.salonId), eq(customerPaymentCreditDecisionSchema.appointmentId, appointmentId))));
  return { source, basis, ...evidence, history };
}
function publicPreview(data: Awaited<ReturnType<typeof load>>) {
  const latest = data.history.at(-1);
  const current = latest?.evidenceRevision === data.evidenceRevision && latest.projectionFingerprint === data.basis.evidenceFingerprint;
  const resolution = current ? projectResolvedCustomerPaymentCredit(data.source, customerPaymentDecisionNote(latest!), data.history.slice(0, -1).map(customerPaymentDecisionNote)) : null;
  return { testOnly: true as const, nonLegal: true as const, ordinaryActionsBlocked: true as const, evidenceRevision: data.evidenceRevision, original: data.basis.original, refunded: data.basis.refunded, netTenderCents: data.basis.netTenderCents, previousCredit: { serviceCreditCents: latest?.serviceCreditCents ?? 0, taxCreditCents: latest?.taxCreditCents ?? 0, tipCreditCents: latest?.tipCreditCents ?? 0 }, decision: latest ? publicDecision(latest) : null, resolution };
}
export async function previewSyntheticCreditReview(database: Database, context: TrustedCreditReviewActor, raw: { salonId: string; appointmentId: string }) {
  const actor = gate(context);
  const scope = scopeSchema.parse(raw);
  return database.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, scope);
    await verifyOwner(tx, actor.adminId, scope.salonId);
    return publicPreview(await load(tx, appointment));
  });
}
export async function recordSyntheticCreditDecision(database: Database, context: TrustedCreditReviewActor, raw: SyntheticCreditDecisionRequest) {
  const actor = gate(context);
  const input = syntheticCreditDecisionRequestSchema.parse(raw);
  const requestFingerprint = customerPaymentFingerprint({ actorId: actor.adminId, ...input });
  return database.transaction(async (tx) => {
    const appointment = await lockAppointment(tx, input);
    const [existing] = await tx.select().from(customerPaymentCreditDecisionSchema).where(and(eq(customerPaymentCreditDecisionSchema.salonId, input.salonId), eq(customerPaymentCreditDecisionSchema.requestId, input.requestId))).limit(1);
    if (existing) {
      if (existing.actorId !== actor.adminId || existing.requestFingerprint !== requestFingerprint || existing.appointmentId !== input.appointmentId) {
        throw new Error('CUSTOMER_PAYMENT_CREDIT_REQUEST_CONFLICT');
      }
      // Historical acknowledgement only; current membership/eligibility is not
      // inferred, and replay never grants a current resolution or new authority.
      const evidence = await loadCustomerPaymentCreditEvidence(tx, input.salonId, input.appointmentId);
      return { testOnly: true as const, nonLegal: true as const, ordinaryActionsBlocked: true as const, decision: publicDecision(existing), replayed: true, evidenceMatchesCurrent: existing.evidenceRevision === evidence.evidenceRevision };
    }
    await verifyOwner(tx, actor.adminId, input.salonId);
    const data = await load(tx, appointment);
    if (input.expectedEvidenceRevision !== data.evidenceRevision) {
      throw new Error('CUSTOMER_PAYMENT_CREDIT_STALE_EVIDENCE');
    }
    const prior = data.history.at(-1);
    if (prior?.evidenceRevision === data.evidenceRevision) {
      throw new Error('CUSTOMER_PAYMENT_CREDIT_ALREADY_RECORDED');
    }
    const row = { id: randomUUID(), salonId: input.salonId, appointmentId: input.appointmentId, captureId: data.basis.captureId, actorId: actor.adminId, previousDecisionId: prior?.id ?? null, requestId: input.requestId, requestFingerprint, evidenceRevision: data.evidenceRevision, projectionFingerprint: data.basis.evidenceFingerprint, evidence: data.evidence, reason: input.reason, serviceCreditCents: input.serviceCreditCents, taxCreditCents: input.taxCreditCents, tipCreditCents: input.tipCreditCents, deltaServiceCreditCents: input.serviceCreditCents - (prior?.serviceCreditCents ?? 0), deltaTaxCreditCents: input.taxCreditCents - (prior?.taxCreditCents ?? 0), deltaTipCreditCents: input.tipCreditCents - (prior?.tipCreditCents ?? 0), mode: 'test' as const, source: 'synthetic_test' as const, createdAt: new Date() };
    projectResolvedCustomerPaymentCredit(data.source, customerPaymentDecisionNote(row), data.history.map(customerPaymentDecisionNote));
    const [saved] = await tx.insert(customerPaymentCreditDecisionSchema).values(row).returning();
    if (!saved) {
      throw new Error('CUSTOMER_PAYMENT_CREDIT_WRITE_FAILED');
    }
    return { testOnly: true as const, nonLegal: true as const, ordinaryActionsBlocked: true as const, decision: publicDecision(saved), replayed: false, evidenceMatchesCurrent: true };
  });
}

/**
 * Internal reporting read. Existing history never disappears when write flags turn off.
 * Caller must supply its already-authorized tenant scope. The shared parent lock
 * fences capture/refund/credit writers for one consistent evidence snapshot.
 */
export async function readCurrentCustomerPaymentCreditResolution(database: Database, scope: { salonId: string; appointmentId: string }) {
  if (!isCustomerPaymentLedgerTestEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_CREDIT_READ_DISABLED');
  }
  const input = scopeSchema.parse(scope);
  return database.transaction(async (tx) => {
    const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, input.appointmentId), eq(appointmentSchema.salonId, input.salonId))).for('share').limit(1);
    if (!appointment) {
      throw new Error('CUSTOMER_PAYMENT_CREDIT_APPOINTMENT_NOT_FOUND');
    }
    return publicPreview(await load(tx, appointment));
  });
}
export type SyntheticCreditReviewPreview = Awaited<ReturnType<typeof previewSyntheticCreditReview>>;
