import 'server-only';

import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { createDepositCheckoutSession, getDepositStripeClient } from '@/libs/depositCheckout';
import { appointmentDepositSchema, appointmentSchema, appointmentServicesSchema } from '@/models/Schema';

import { authorizeDepositRecoveryRetrieval } from './recoveryBudget';

/** Caller must first authenticate the durable operation's salon/appointment. */
export async function resumeCustomerDepositCheckout(args: { salonId: string; appointmentId: string }): Promise<string | null> {
  const [row] = await db.select({
    id: appointmentDepositSchema.id,
    salonId: appointmentDepositSchema.salonId,
    appointmentId: appointmentDepositSchema.appointmentId,
    amountCents: appointmentDepositSchema.amountCents,
    stripeAccountId: appointmentDepositSchema.stripeAccountId,
    checkoutSuccessUrl: appointmentDepositSchema.checkoutSuccessUrl,
    checkoutCancelUrl: appointmentDepositSchema.checkoutCancelUrl,
    sessionId: appointmentDepositSchema.stripeCheckoutSessionId,
    checkoutUrl: appointmentDepositSchema.stripeCheckoutUrl,
    holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
    appointmentStartTime: appointmentSchema.startTime,
  }).from(appointmentDepositSchema).innerJoin(appointmentSchema, and(
    eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
    eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
  )).where(and(
    eq(appointmentDepositSchema.salonId, args.salonId),
    eq(appointmentDepositSchema.appointmentId, args.appointmentId),
    eq(appointmentDepositSchema.status, 'checkout_created'),
    eq(appointmentSchema.status, 'awaiting_payment'),
    isNull(appointmentSchema.deletedAt),
    gt(appointmentSchema.depositHoldExpiresAt, new Date()),
  )).limit(1);
  if (!row?.holdExpiresAt || !row.checkoutSuccessUrl || !row.checkoutCancelUrl) {
    return null;
  }
  if (row.checkoutUrl) {
    return safeCheckoutUrl(row.checkoutUrl);
  }
  // Share the existing durable lifetime/window budget with return-page polling.
  if (!await authorizeDepositRecoveryRetrieval(row.id, row.salonId)) {
    return null;
  }
  const names = await db.select({ name: appointmentServicesSchema.nameSnapshot })
    .from(appointmentServicesSchema).innerJoin(appointmentSchema, eq(appointmentSchema.id, appointmentServicesSchema.appointmentId))
    .where(and(eq(appointmentSchema.id, row.appointmentId), eq(appointmentSchema.salonId, row.salonId)));
  // The original key, amount, account, URLs and deadline are immutable. This
  // retrieves/replays the existing attempt; it never extends the hold.
  const created = row.sessionId
    ? { ok: true as const, session: await getDepositStripeClient().checkout.sessions.retrieve(row.sessionId, {}, { stripeAccount: row.stripeAccountId }) }
    : await createDepositCheckoutSession({ deposit: { ...row, holdExpiresAt: row.holdExpiresAt, checkoutSuccessUrl: row.checkoutSuccessUrl, checkoutCancelUrl: row.checkoutCancelUrl, serviceNameSnapshots: names.map(item => item.name ?? '') } });
  if (!created.ok) {
    return null;
  }
  const session = created.session;
  const url = safeCheckoutUrl(session.url);
  if (session.metadata?.appointment_id !== row.appointmentId || session.metadata?.salon_id !== row.salonId
    || session.metadata?.deposit_id !== row.id || session.amount_total !== row.amountCents
    || session.currency !== 'cad' || session.expires_at !== Math.floor(row.holdExpiresAt.getTime() / 1000)) {
    return null;
  }
  const learnedPaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const updated = await db.update(appointmentDepositSchema).set({
    stripeCheckoutSessionId: session.id,
    stripeCheckoutUrl: url,
    stripePaymentIntentId: sql`COALESCE(${appointmentDepositSchema.stripePaymentIntentId}, ${learnedPaymentIntentId})`,
    updatedAt: new Date(),
  }).where(and(
    eq(appointmentDepositSchema.id, row.id),
    eq(appointmentDepositSchema.salonId, row.salonId),
    or(isNull(appointmentDepositSchema.stripeCheckoutSessionId), eq(appointmentDepositSchema.stripeCheckoutSessionId, session.id)),
    ...(learnedPaymentIntentId ? [or(isNull(appointmentDepositSchema.stripePaymentIntentId), eq(appointmentDepositSchema.stripePaymentIntentId, learnedPaymentIntentId))] : []),
    sql`EXISTS (SELECT 1 FROM ${appointmentSchema} WHERE ${appointmentSchema.id} = ${row.appointmentId}
      AND ${appointmentSchema.salonId} = ${row.salonId} AND ${appointmentSchema.deletedAt} IS NULL)`,
  )).returning();
  if (session.payment_status === 'paid') {
    const { confirmDepositPayment } = await import('./confirmDepositPayment');
    const result = await confirmDepositPayment({
      source: 'poll',
      connectedAccountId: row.stripeAccountId,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      metadataAppointmentId: session.metadata?.appointment_id ?? null,
      metadataSalonId: session.metadata?.salon_id ?? null,
      metadataDepositId: session.metadata?.deposit_id ?? null,
    });
    if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
      const { runLateDepositRecovery } = await import('./lateDepositRecovery');
      await runLateDepositRecovery({ depositId: result.depositId, salonId: result.salonId });
    }
  }
  if (!updated.length || session.status !== 'open' || session.payment_status === 'paid') {
    return null;
  }
  const [live] = await db.select({ id: appointmentSchema.id }).from(appointmentSchema).where(and(
    eq(appointmentSchema.id, row.appointmentId),
    eq(appointmentSchema.salonId, row.salonId),
    eq(appointmentSchema.status, 'awaiting_payment'),
    isNull(appointmentSchema.deletedAt),
    gt(appointmentSchema.depositHoldExpiresAt, new Date()),
  )).limit(1);
  return live ? url : null;
}

function safeCheckoutUrl(value: string | null): string | null {
  try {
    if (!value) {
      return null;
    }
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'checkout.stripe.com' || url.hostname.endsWith('.checkout.stripe.com'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
