import 'server-only';

import { createHash } from 'node:crypto';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { closedCheckoutOperationSchema } from '@/models/customerPaymentClosedCheckoutSchema';
import { customerPaymentPolicySchema, customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';
import { appointmentAccessTokenSchema, appointmentAddOnSchema, appointmentDepositSchema, appointmentFinalItemSchema, appointmentPaymentSchema, appointmentSchema, appointmentServicesSchema, salonSchema, salonStripeAccountSchema } from '@/models/Schema';

import { buildCustomerPaymentQuoteMaterial } from '../quoteMaterial';
import type { CustomerPaymentTransaction } from '../server/preparationRepository';
import { customerPaymentFingerprint } from '../server/preparationRepository';
import { customerPaymentDraftResponse } from '../settings';
import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { buildInactiveStripeCheckoutOperation, checkoutAdapterError, freezeCheckoutValue, requireInactiveStripeCheckoutRuntime, stripeAccountIdSchema } from './checkoutContract';

const identifier = z.string().min(1).max(200).regex(/^[\w-]+$/);
const accessSchema = z.object({ token: z.string().regex(/^[\w-]{32,128}$/), salonId: identifier, appointmentId: identifier });
export const sdkCheckoutReserveSchema = accessSchema.extend({ quoteId: z.string().uuid(), operationId: z.string().uuid(), requestId: z.string().uuid(), platformAccountId: stripeAccountIdSchema }).strict();
export const sdkCheckoutResumeSchema = accessSchema.extend({ operationId: z.string().uuid() }).strict();
export type SdkCheckoutReserveInput = z.infer<typeof sdkCheckoutReserveSchema>;
export type SdkCheckoutResumeInput = z.infer<typeof sdkCheckoutResumeSchema>;
type OperationRow = typeof closedCheckoutOperationSchema.$inferSelect;
type Quote = typeof customerPaymentPreparedQuoteSchema.$inferSelect;
const sourceIds = z.object({ capability: z.object({ tokenId: identifier }), binding: z.object({ id: identifier }) });
const revisionsSchema = z.record(z.number().int().min(0).max(2147483646));
export const SDK_CHECKOUT_RECONSTRUCTION = Object.freeze({ version: 1 as const, returnTemplate: 'closed_invalid_v1' as const });

/** No customer/private URL, bearer or token digest is part of the reconstructible envelope. */
export function reconstructSdkCheckoutOperation(row: Pick<OperationRow, 'id' | 'requestId' | 'salonId' | 'appointmentId' | 'quoteId' | 'platformAccountId' | 'connectedAccountId' | 'contextHash' | 'operationCreatedAt' | 'quoteExpiresAt' | 'sessionExpiresAt'>, quote: Quote): InactiveStripeCheckoutOperation {
  const s = quote.snapshot;
  if (quote.id !== row.quoteId || quote.salonId !== row.salonId || quote.appointmentId !== row.appointmentId
    || quote.stripeAccountId !== row.connectedAccountId || quote.fingerprint !== row.contextHash || quote.mode !== 'test' || quote.executable !== false
    || quote.createdAt.getTime() !== row.operationCreatedAt.getTime() || quote.expiresAt.getTime() !== row.quoteExpiresAt.getTime()
    || s.collection !== 'full') {
    checkoutAdapterError('SDK_RECONSTRUCTION_REJECTED');
  }
  return buildInactiveStripeCheckoutOperation({
    operationId: row.id,
    requestId: row.requestId,
    salonId: row.salonId,
    appointmentId: row.appointmentId,
    quoteId: row.quoteId,
    contextHash: row.contextHash,
    createdAt: row.operationCreatedAt.getTime(),
    quoteExpiresAt: row.quoteExpiresAt.getTime(),
    sessionExpiresAt: row.sessionExpiresAt.getTime(),
    successUrl: 'https://closed.invalid/success',
    cancelUrl: 'https://closed.invalid/cancel',
    quote: { currency: 'cad', collection: 'full', servicesCents: s.servicesCents, discountCents: s.discountCents, taxCents: s.taxCents, tipCents: s.tipCents, feePolicy: { payer: 'salon', feeCents: s.configuredFeeCents, taxTreatment: 'not_collected_in_test_mode' } },
  }, { platformAccountId: row.platformAccountId, connectedAccountId: row.connectedAccountId, mode: 'test', returnOrigin: 'https://closed.invalid' });
}

/** Cheap authentication must precede even collision/replay inspection; repeat under locks below. */
export async function assertSdkCheckoutBearer(tx: CustomerPaymentTransaction, input: Pick<SdkCheckoutResumeInput, 'token' | 'salonId' | 'appointmentId'>, now: Date) {
  requireInactiveStripeCheckoutRuntime();
  const checked = accessSchema.safeParse(input);
  if (!checked.success) {
    return checkoutAdapterError('SDK_ACCESS_REQUIRED');
  }
  const tokenHash = createHash('sha256').update(checked.data.token, 'utf8').digest('hex');
  const [capability] = await tx.select({ id: appointmentAccessTokenSchema.id, expiresAt: appointmentAccessTokenSchema.expiresAt, revokedAt: appointmentAccessTokenSchema.revokedAt })
    .from(appointmentAccessTokenSchema).where(and(eq(appointmentAccessTokenSchema.tokenHash, tokenHash), eq(appointmentAccessTokenSchema.salonId, input.salonId), eq(appointmentAccessTokenSchema.appointmentId, input.appointmentId))).limit(1);
  if (!capability || capability.revokedAt !== null || capability.expiresAt <= now) {
    return checkoutAdapterError('SDK_ACCESS_REQUIRED');
  }
  return { capabilityId: capability.id, tokenHash };
}

export async function lockSdkCheckoutSources(tx: CustomerPaymentTransaction, input: { salonId: string; appointmentId: string; quoteId: string }, bearer?: { capabilityId: string; tokenHash: string }) {
  const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, input.appointmentId), eq(appointmentSchema.salonId, input.salonId))).for('update').limit(1);
  const [quote] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(eq(customerPaymentPreparedQuoteSchema.id, input.quoteId)).for('share').limit(1);
  if (!appointment || !quote || quote.salonId !== input.salonId || quote.appointmentId !== input.appointmentId) {
    return checkoutAdapterError('SDK_QUOTE_SCOPE_REJECTED');
  }
  const ids = sourceIds.safeParse(quote.context);
  if (!ids.success) {
    return checkoutAdapterError('SDK_QUOTE_SOURCE_REJECTED');
  }
  const [policyRow] = await tx.select().from(customerPaymentPolicySchema).where(eq(customerPaymentPolicySchema.salonId, input.salonId)).for('update').limit(1);
  const [capability] = await tx.select({ tokenId: appointmentAccessTokenSchema.id, salonId: appointmentAccessTokenSchema.salonId, appointmentId: appointmentAccessTokenSchema.appointmentId, expiresAt: appointmentAccessTokenSchema.expiresAt, revokedAt: appointmentAccessTokenSchema.revokedAt })
    .from(appointmentAccessTokenSchema).where(and(eq(appointmentAccessTokenSchema.id, ids.data.capability.tokenId), eq(appointmentAccessTokenSchema.salonId, input.salonId), eq(appointmentAccessTokenSchema.appointmentId, input.appointmentId), ...(bearer ? [eq(appointmentAccessTokenSchema.tokenHash, bearer.tokenHash), eq(appointmentAccessTokenSchema.id, bearer.capabilityId)] : []))).for('update').limit(1);
  const [clock] = await tx.select({ now: sql<string>`floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint` }).from(sql`(SELECT 1) AS sdk_access_clock`);
  if (bearer && (!capability || capability.revokedAt !== null || capability.expiresAt.getTime() <= Number(clock!.now))) {
    return checkoutAdapterError('SDK_ACCESS_REQUIRED');
  }
  await tx.select({ id: salonStripeAccountSchema.id }).from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, input.salonId), isNull(salonStripeAccountSchema.revokedAt))).for('share');
  const [salon] = await tx.select({ id: salonSchema.id, status: salonSchema.status, publicationStatus: salonSchema.publicationStatus, deletedAt: salonSchema.deletedAt }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).for('share', { noWait: true }).limit(1);
  if (bearer) {
    const [finalClock] = await tx.select({ now: sql<string>`floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint` }).from(sql`(SELECT 1) AS sdk_final_access_clock`);
    if (!capability || capability.expiresAt.getTime() <= Number(finalClock!.now)) {
      return checkoutAdapterError('SDK_ACCESS_REQUIRED');
    }
  }
  return { appointment, quote, policyRow, capability, salon, ids: ids.data };
}

export async function readSdkCheckoutSourceRevisions(tx: CustomerPaymentTransaction, scope: { salonId: string; capabilityId: string; bindingId: string }) {
  const keys = [`salon:${scope.salonId}`, `policy:${scope.salonId}`, `capability:${scope.capabilityId}`, `binding:${scope.bindingId}`, `binding_set:${scope.salonId}`].sort();
  const [row] = await tx.select({ revisions: sql<unknown>`customer_payment_checkout_source_snapshot(ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::text[])` }).from(sql`(SELECT 1) AS sdk_source_snapshot`);
  const parsed = revisionsSchema.safeParse(row?.revisions);
  if (!parsed.success || Object.keys(parsed.data).length !== keys.length || keys.some(key => parsed.data[key] === undefined)) {
    return checkoutAdapterError('SDK_SOURCE_REVISIONS_REQUIRED');
  }
  return freezeCheckoutValue(parsed.data);
}

/** Appointment administrative fields remain writable without altering financial authority. */
export function financialContextSnapshot(appointment: typeof appointmentSchema.$inferSelect, services: unknown[], addOns: unknown[]) {
  const allowed = new Set(['clientName', 'clientEmail', 'notes', 'techNotes', 'dayBeforeReminderSentAt', 'dayBeforeReminderChannel', 'sameDayReminderSentAt', 'sameDayReminderChannel', 'arrivedAt', 'wasLate', 'googleCalendarEventId', 'googleCalendarSyncStatus', 'googleCalendarSyncedAt', 'googleCalendarSyncError', 'reviewFollowupAction', 'reviewFollowupSentAt', 'reviewFollowupSentBy', 'createdAt', 'updatedAt']);
  // Only the digest is persisted. This detached projection never enters the reconstruction envelope.
  // clientPhone is frozen identity; clientName/clientEmail are administrative display fields.
  return JSON.parse(JSON.stringify({ appointment: Object.fromEntries(Object.entries(appointment).filter(([key]) => !allowed.has(key))), services, addOns })) as Record<string, unknown>;
}

/** Caller owns journal admission and source locks. Snapshot watermarks before rereading the set. */
export async function validateSdkCheckoutSources(tx: CustomerPaymentTransaction, sources: Awaited<ReturnType<typeof lockSdkCheckoutSources>>, operation: InactiveStripeCheckoutOperation, now: Date, admitted?: { sourceRevisions: Record<string, number> | null; financialContextHash: string | null; capabilityId: string | null; bindingId: string | null }) {
  const { appointment, quote, policyRow, capability, salon, ids } = sources;
  const sourceRevisions = await readSdkCheckoutSourceRevisions(tx, { salonId: operation.material.salonId, capabilityId: ids.capability.tokenId, bindingId: ids.binding.id });
  if (admitted && (admitted.capabilityId !== ids.capability.tokenId || admitted.bindingId !== ids.binding.id || customerPaymentFingerprint(admitted.sourceRevisions) !== customerPaymentFingerprint(sourceRevisions))) {
    return checkoutAdapterError('SDK_SOURCE_INVALIDATED');
  }
  // Required reread after the binding-set watermark is held: pinning new revision
  // beside an old binding-set snapshot would miss a just-committed insertion.
  const bindings = await tx.select().from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, operation.material.salonId), isNull(salonStripeAccountSchema.revokedAt))).orderBy(asc(salonStripeAccountSchema.id));
  if (!policyRow || policyRow.mode !== 'test' || policyRow.collectionEnabled !== false || policyRow.revision !== quote.policyRevision
    || !capability || !salon || bindings.length !== 1 || bindings[0]!.id !== ids.binding.id || bindings[0]!.stripeAccountId !== quote.stripeAccountId) {
    return checkoutAdapterError('SDK_SOURCE_CONTEXT_REJECTED');
  }
  const services = await tx.select().from(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, appointment.id)).orderBy(asc(appointmentServicesSchema.id));
  const addOns = await tx.select().from(appointmentAddOnSchema).where(eq(appointmentAddOnSchema.appointmentId, appointment.id)).orderBy(asc(appointmentAddOnSchema.id));
  const payments = await tx.select().from(appointmentPaymentSchema).where(eq(appointmentPaymentSchema.appointmentId, appointment.id));
  const deposits = await tx.select().from(appointmentDepositSchema).where(eq(appointmentDepositSchema.appointmentId, appointment.id));
  const finals = await tx.select({ id: appointmentFinalItemSchema.id }).from(appointmentFinalItemSchema).where(eq(appointmentFinalItemSchema.appointmentId, appointment.id)).limit(1);
  if (finals.length || appointment.actualStartAt !== null || appointment.actualEndAt !== null) {
    return checkoutAdapterError('SDK_FINAL_INVOICE_UNSUPPORTED');
  }
  const policy = customerPaymentDraftResponse(policyRow.revision, policyRow.settings);
  const rebuilt = buildCustomerPaymentQuoteMaterial({ appointment, salon, capability, binding: bindings[0]!, policy, services, addOns, payments, deposits, tipCents: quote.snapshot.tipCents, existingExpiresAt: quote.expiresAt, now });
  const financialContextHash = customerPaymentFingerprint(financialContextSnapshot(appointment, services, addOns));
  if (customerPaymentFingerprint(rebuilt.snapshot) !== customerPaymentFingerprint(operation.snapshot) || quote.expiresAt.getTime() !== operation.material.quoteExpiresAt || quote.createdAt.getTime() !== operation.material.createdAt) {
    return checkoutAdapterError('SDK_QUOTE_MISMATCH');
  }
  if (admitted) {
    if (financialContextHash !== admitted.financialContextHash) {
      return checkoutAdapterError('SDK_FINANCIAL_CONTEXT_CHANGED');
    }
  } else {
    const fingerprint = customerPaymentFingerprint({ salonId: appointment.salonId, appointmentId: appointment.id, policyRevision: policy.revision, stripeAccountId: rebuilt.stripeAccountId, snapshot: rebuilt.snapshot, context: rebuilt.context, expiresAt: rebuilt.expiresAt.toISOString(), mode: 'test', executable: false });
    if (fingerprint !== quote.fingerprint) {
      return checkoutAdapterError('SDK_QUOTE_CONTEXT_STALE');
    }
  }
  return { sourceRevisions, financialContextHash, capabilityId: ids.capability.tokenId, bindingId: ids.binding.id, reconstruction: SDK_CHECKOUT_RECONSTRUCTION };
}
