import 'server-only';

import { createHash } from 'node:crypto';

import { and, asc, eq, gt, isNull } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import {
  appointmentAccessTokenSchema,
  appointmentAddOnSchema,
  appointmentDepositSchema,
  appointmentPaymentSchema,
  appointmentServicesSchema,
  salonSchema,
  salonStripeAccountSchema,
} from '@/models/Schema';

import { isCustomerPaymentPreparationEnabled } from '../preparationGate';
import { buildCustomerPaymentQuoteMaterial } from '../quoteMaterial';
import type { CustomerPaymentQuoteRequest } from '../quoteRequest';
import { customerPaymentQuoteRequestSchema } from '../quoteRequest';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from './preparationRepository';

type Database = Pick<typeof db, 'select' | 'transaction'>;

/**
 * Actual application-table preparation, not a provider/payment operation.
 * The capability identifies the tenant; body IDs and amounts cannot override it.
 * Initial lookup finds the appointment lock, then capability validation repeats
 * under that lock before any immutable, explicitly non-executable quote is saved.
 */
export async function prepareCustomerPaymentQuoteForToken(
  database: Database,
  token: string,
  request: CustomerPaymentQuoteRequest,
) {
  if (!isCustomerPaymentPreparationEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_PREPARATION_DISABLED');
  }
  const intent = customerPaymentQuoteRequestSchema.parse(request);
  if (!/^[\w-]{32,128}$/.test(token)) {
    throw new Error('CUSTOMER_PAYMENT_ACCESS_REQUIRED');
  }
  // Matches appointmentAccess.ts / hashOpaqueToken without importing Env or a
  // provider-bearing resolver. Raw capabilities never enter stored quote data.
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const [identity] = await database.select({
    id: appointmentAccessTokenSchema.id,
    salonId: appointmentAccessTokenSchema.salonId,
    appointmentId: appointmentAccessTokenSchema.appointmentId,
  }).from(appointmentAccessTokenSchema).where(and(
    eq(appointmentAccessTokenSchema.tokenHash, tokenHash),
    isNull(appointmentAccessTokenSchema.revokedAt),
    gt(appointmentAccessTokenSchema.expiresAt, new Date()),
  )).limit(1);
  if (!identity) {
    throw new Error('CUSTOMER_PAYMENT_ACCESS_REQUIRED');
  }
  const repository = createCustomerPaymentPreparationRepository(database);
  return repository.prepareCustomerPaymentQuote({
    salonId: identity.salonId,
    appointmentId: identity.appointmentId,
    requestId: intent.requestId,
    requestFingerprint: customerPaymentFingerprint({ version: 1, tokenId: identity.id, tipCents: intent.tipCents }),
  }, async (tx, appointment, policy, existing) => {
    const now = new Date();
    const [capability] = await tx.select({
      tokenId: appointmentAccessTokenSchema.id,
      salonId: appointmentAccessTokenSchema.salonId,
      appointmentId: appointmentAccessTokenSchema.appointmentId,
      expiresAt: appointmentAccessTokenSchema.expiresAt,
      revokedAt: appointmentAccessTokenSchema.revokedAt,
    }).from(appointmentAccessTokenSchema).where(and(
      eq(appointmentAccessTokenSchema.id, identity.id),
      eq(appointmentAccessTokenSchema.tokenHash, tokenHash),
      eq(appointmentAccessTokenSchema.salonId, appointment.salonId),
      eq(appointmentAccessTokenSchema.appointmentId, appointment.id),
      isNull(appointmentAccessTokenSchema.revokedAt),
      gt(appointmentAccessTokenSchema.expiresAt, now),
    )).for('update').limit(1);
    if (!capability) {
      throw new Error('CUSTOMER_PAYMENT_ACCESS_REQUIRED');
    }
    // Do not lock salon after policy: policy saves serialize on the salon first.
    // This quote is non-executable and execution would recheck every source.
    const [salon] = await tx.select({
      id: salonSchema.id,
      status: salonSchema.status,
      publicationStatus: salonSchema.publicationStatus,
      deletedAt: salonSchema.deletedAt,
    }).from(salonSchema).where(eq(salonSchema.id, appointment.salonId)).limit(1);
    const bindings = await tx.select().from(salonStripeAccountSchema).where(and(
      eq(salonStripeAccountSchema.salonId, appointment.salonId),
      isNull(salonStripeAccountSchema.revokedAt),
    )).for('share').limit(2);
    if (!salon || bindings.length !== 1) {
      throw new Error('CUSTOMER_PAYMENT_TEST_ACCOUNT_UNAVAILABLE');
    }
    const services = await tx.select().from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointment.id)).orderBy(asc(appointmentServicesSchema.id));
    const addOns = await tx.select().from(appointmentAddOnSchema)
      .where(eq(appointmentAddOnSchema.appointmentId, appointment.id)).orderBy(asc(appointmentAddOnSchema.id));
    // Include ALL history attached to this authorized appointment. Legacy
    // tenant-FK anomalies must block preparation, never be hidden as zero paid.
    const payments = await tx.select().from(appointmentPaymentSchema)
      .where(eq(appointmentPaymentSchema.appointmentId, appointment.id))
      .orderBy(asc(appointmentPaymentSchema.id));
    const deposits = await tx.select().from(appointmentDepositSchema)
      .where(eq(appointmentDepositSchema.appointmentId, appointment.id))
      .orderBy(asc(appointmentDepositSchema.id));
    return buildCustomerPaymentQuoteMaterial({
      appointment,
      salon,
      capability,
      binding: bindings[0]!,
      policy,
      services,
      addOns,
      payments,
      deposits,
      tipCents: intent.tipCents,
      ...(existing ? { existingExpiresAt: existing.expiresAt } : {}),
      now,
    });
  });
}
