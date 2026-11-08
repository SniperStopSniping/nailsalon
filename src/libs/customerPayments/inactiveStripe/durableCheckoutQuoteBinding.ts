import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { customerPaymentPolicySchema, customerPaymentPreparedQuoteSchema } from '@/models/customerPaymentSchema';
import {
  appointmentAccessTokenSchema,
  appointmentAddOnSchema,
  appointmentDepositSchema,
  appointmentPaymentSchema,
  appointmentSchema,
  appointmentServicesSchema,
  salonSchema,
  salonStripeAccountSchema,
} from '@/models/Schema';

import { buildCustomerPaymentQuoteMaterial } from '../quoteMaterial';
import type { CustomerPaymentTransaction } from '../server/preparationRepository';
import { customerPaymentFingerprint } from '../server/preparationRepository';
import { customerPaymentDraftResponse } from '../settings';
import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { assertInactiveStripeCheckoutOperation, checkoutAdapterError, freezeCheckoutValue, requireInactiveStripeCheckoutRuntime } from './checkoutContract';

const sourceIdentitySchema = z.object({
  capability: z.object({ tokenId: z.string().min(1).max(255) }),
  binding: z.object({ id: z.string().min(1).max(255) }),
});

/**
 * Revalidate a prepared quote for the closed fixture only. The caller supplies
 * database clock time and keeps this transaction open through its local fence.
 * Appointment-first ordering matches preparation. This does not reserve a
 * booking, authenticate a capability bearer, or authorize any provider call.
 * Some source writers do not take these locks; live execution remains absent.
 */
export async function assertDurableCheckoutQuoteBinding(
  tx: CustomerPaymentTransaction,
  operation: InactiveStripeCheckoutOperation,
  now: Date,
): Promise<void> {
  requireInactiveStripeCheckoutRuntime();
  operation = freezeCheckoutValue(structuredClone(operation));
  assertInactiveStripeCheckoutOperation(operation);
  const material = operation.material;
  if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime())) {
    checkoutAdapterError('INVALID_DATABASE_CLOCK');
  }
  now = new Date(now.getTime());
  const [appointment] = await tx.select().from(appointmentSchema).where(and(
    eq(appointmentSchema.id, material.appointmentId),
    eq(appointmentSchema.salonId, material.salonId),
  )).for('update').limit(1);
  const [quote] = await tx.select().from(customerPaymentPreparedQuoteSchema).where(
    eq(customerPaymentPreparedQuoteSchema.id, material.quoteId),
  ).for('share').limit(1);
  if (!appointment || !quote || quote.salonId !== material.salonId || quote.appointmentId !== material.appointmentId
    || quote.mode !== 'test' || quote.executable !== false || quote.stripeAccountId !== operation.binding.connectedAccountId
    || quote.fingerprint !== material.contextHash || quote.createdAt.getTime() !== material.createdAt
    || quote.expiresAt.getTime() !== material.quoteExpiresAt || quote.createdAt > now || quote.expiresAt <= now
    || quote.snapshot.collection !== 'full' || operation.snapshot.collection !== 'full'
    || customerPaymentFingerprint(quote.snapshot) !== customerPaymentFingerprint(operation.snapshot)) {
    checkoutAdapterError('PREPARED_QUOTE_MISMATCH');
  }
  const sources = sourceIdentitySchema.safeParse(quote.context);
  if (!sources.success) {
    checkoutAdapterError('PREPARED_QUOTE_SOURCE_MISMATCH');
  }
  const [policyRow] = await tx.select().from(customerPaymentPolicySchema).where(
    eq(customerPaymentPolicySchema.salonId, material.salonId),
  ).for('update').limit(1);
  if (!policyRow || policyRow.mode !== 'test' || policyRow.collectionEnabled !== false
    || policyRow.revision !== quote.policyRevision) {
    checkoutAdapterError('PREPARED_QUOTE_POLICY_MISMATCH');
  }
  const policy = customerPaymentDraftResponse(policyRow.revision, policyRow.settings);
  const [capability] = await tx.select({
    tokenId: appointmentAccessTokenSchema.id,
    salonId: appointmentAccessTokenSchema.salonId,
    appointmentId: appointmentAccessTokenSchema.appointmentId,
    expiresAt: appointmentAccessTokenSchema.expiresAt,
    revokedAt: appointmentAccessTokenSchema.revokedAt,
  }).from(appointmentAccessTokenSchema).where(and(
    eq(appointmentAccessTokenSchema.id, sources.data.capability.tokenId),
    eq(appointmentAccessTokenSchema.salonId, material.salonId),
    eq(appointmentAccessTokenSchema.appointmentId, material.appointmentId),
  )).for('update').limit(1);
  // Do not lock the salon after policy: policy writers lock salon first.
  const [salon] = await tx.select({
    id: salonSchema.id,
    status: salonSchema.status,
    publicationStatus: salonSchema.publicationStatus,
    deletedAt: salonSchema.deletedAt,
  }).from(salonSchema).where(eq(salonSchema.id, material.salonId)).limit(1);
  const bindings = await tx.select().from(salonStripeAccountSchema).where(and(
    eq(salonStripeAccountSchema.salonId, material.salonId),
    isNull(salonStripeAccountSchema.revokedAt),
  )).for('share').limit(2);
  if (!capability || !salon || bindings.length !== 1 || bindings[0]!.id !== sources.data.binding.id
    || bindings[0]!.stripeAccountId !== quote.stripeAccountId) {
    checkoutAdapterError('PREPARED_QUOTE_SOURCE_MISMATCH');
  }
  const services = await tx.select().from(appointmentServicesSchema)
    .where(eq(appointmentServicesSchema.appointmentId, material.appointmentId)).orderBy(asc(appointmentServicesSchema.id));
  const addOns = await tx.select().from(appointmentAddOnSchema)
    .where(eq(appointmentAddOnSchema.appointmentId, material.appointmentId)).orderBy(asc(appointmentAddOnSchema.id));
  // Read all history, including anomalous tenant rows, exactly as preparation.
  const payments = await tx.select().from(appointmentPaymentSchema)
    .where(eq(appointmentPaymentSchema.appointmentId, material.appointmentId)).orderBy(asc(appointmentPaymentSchema.id));
  const deposits = await tx.select().from(appointmentDepositSchema)
    .where(eq(appointmentDepositSchema.appointmentId, material.appointmentId)).orderBy(asc(appointmentDepositSchema.id));
  const rebuilt = buildCustomerPaymentQuoteMaterial({
    appointment,
    salon,
    capability,
    binding: bindings[0]!,
    policy,
    services,
    addOns,
    payments,
    deposits,
    tipCents: quote.snapshot.tipCents,
    existingExpiresAt: quote.expiresAt,
    now,
  });
  const fingerprint = customerPaymentFingerprint({
    salonId: material.salonId,
    appointmentId: material.appointmentId,
    policyRevision: policy.revision,
    stripeAccountId: rebuilt.stripeAccountId,
    snapshot: rebuilt.snapshot,
    context: rebuilt.context,
    expiresAt: rebuilt.expiresAt.toISOString(),
    mode: 'test',
    executable: false,
  });
  if (fingerprint !== quote.fingerprint) {
    checkoutAdapterError('PREPARED_QUOTE_CONTEXT_STALE');
  }
}
