/**
 * Top-up fulfillment and reversal wiring — Gate C3 (contract §7.8, §9).
 *
 * Fulfillment happens ONLY on verified Stripe payment evidence arriving
 * through the billing webhook: the success page never grants. The grant
 * itself is fulfillTopupPurchase (idempotent on topup-grant:{checkoutSessionId}'s
 * ledger key via the purchased-lot insert), and reversals are the
 * cumulative-evidence arithmetic repaired in #118 — refunds carry the
 * charge's CUMULATIVE amount_refunded, disputes reverse the residual G − C.
 */

import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';

import { deriveTopupPurchaseId } from '@/libs/billing/checkoutAttempts';
import { fulfillTopupPurchase, reverseTopup } from '@/libs/billing/creditGrants';
import { resolveStripePriceIdForTopup } from '@/libs/billing/stripePriceMap';
import { getTopupOffer } from '@/libs/billing/topupOffers';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { billingCheckoutAttemptSchema, smsTopupPurchaseSchema } from '@/models/Schema';

/**
 * Accept only authoritative, expanded Stripe evidence. The durable attempt
 * and purchase snapshot are both locked and validated before any mutation,
 * including recovery when checkout TX2 never recorded the provider session.
 */
export async function applyTopupSessionCompleted(input: {
  session: Stripe.Checkout.Session;
  now?: Date;
}): Promise<{ fulfilled: boolean; reason?: string }> {
  const { session } = input;
  const metadata = session.metadata;
  if (metadata?.purpose !== 'sms_topup' || !metadata.salonId || !metadata.attemptId
    || metadata.billingEnv !== Env.BILLING_PLAN_ENV
    || metadata.purchaseId !== deriveTopupPurchaseId(metadata.attemptId)) {
    return { fulfilled: false, reason: 'TOPUP_METADATA_MISMATCH' };
  }
  return db.transaction(async (tx) => {
    // Match TX2's lock order (attempt, then purchase).
    const [attempt] = await tx.select().from(billingCheckoutAttemptSchema)
      .where(and(
        eq(billingCheckoutAttemptSchema.id, metadata.attemptId!),
        eq(billingCheckoutAttemptSchema.salonId, metadata.salonId!),
        eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
      )).for('update');
    const [purchase] = await tx.select().from(smsTopupPurchaseSchema)
      .where(and(
        eq(smsTopupPurchaseSchema.id, metadata.purchaseId!),
        eq(smsTopupPurchaseSchema.salonId, metadata.salonId!),
      )).for('update');
    if (!attempt || !purchase) {
      return { fulfilled: false, reason: 'PURCHASE_NOT_FOUND' };
    }
    const offer = getTopupOffer(purchase.topupOfferKey);
    if (!offer || attempt.topupOfferKey !== purchase.topupOfferKey
      || metadata.topupOfferKey !== purchase.topupOfferKey
      || purchase.credits !== offer.credits || purchase.amountCents !== offer.priceCents
      || purchase.currency !== 'cad'
      || (attempt.stripeCheckoutSessionId !== null && attempt.stripeCheckoutSessionId !== session.id)
      || (purchase.stripeCheckoutSessionId !== null && purchase.stripeCheckoutSessionId !== session.id)
      || ['failed', 'superseded'].includes(attempt.status)) {
      return { fulfilled: false, reason: 'TOPUP_SNAPSHOT_MISMATCH' };
    }
    const priceId = resolveStripePriceIdForTopup(offer.key);
    const items = session.line_items;
    const item = items?.data[0];
    const price = item?.price;
    const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
    const expectLive = Env.BILLING_PLAN_ENV === 'prod';
    if (session.mode !== 'payment' || session.status !== 'complete'
      || session.livemode !== expectLive || session.currency !== purchase.currency
      || session.amount_subtotal !== purchase.amountCents || session.amount_total !== purchase.amountCents
      || session.payment_method_types.length !== 1 || session.payment_method_types[0] !== 'card'
      || !items || items.has_more || items.data.length !== 1 || item?.quantity !== 1
      || item.currency !== purchase.currency || item.amount_subtotal !== purchase.amountCents
      || item.amount_total !== purchase.amountCents
      || !price || price.id !== priceId || price.type !== 'one_time'
      || price.currency !== purchase.currency || price.unit_amount !== purchase.amountCents
      || price.livemode !== expectLive || price.recurring !== null
      || price.billing_scheme !== 'per_unit' || price.custom_unit_amount != null || price.transform_quantity != null
      || !intent || intent.livemode !== expectLive || intent.currency !== purchase.currency
      || intent.amount !== purchase.amountCents
      || ['purpose', 'billingEnv', 'salonId', 'topupOfferKey', 'purchaseId', 'attemptId']
        .some(key => intent.metadata?.[key] !== metadata[key])
        || intent.payment_method_types.length !== 1 || intent.payment_method_types[0] !== 'card'
        || (purchase.stripePaymentIntentId !== null && purchase.stripePaymentIntentId !== intent.id)) {
      return { fulfilled: false, reason: 'TOPUP_PAYMENT_MISMATCH' };
    }
    if (session.payment_status !== 'paid' || intent.status !== 'succeeded'
      || intent.amount_received !== purchase.amountCents) {
      return { fulfilled: false, reason: 'AWAITING_PAYMENT_EVIDENCE' };
    }
    // Reversals can arrive before completion has bound the payment intent.
    // Do not grant money already refunded/disputed while those early events
    // are held for review. Existing grants still use the reversal ledger.
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (purchase.grantLedgerId === null && (!charge || !charge.paid || !charge.captured
      || charge.livemode !== expectLive || charge.currency !== purchase.currency
      || charge.amount !== purchase.amountCents || charge.amount_captured !== purchase.amountCents
      || charge.amount_refunded !== 0 || charge.disputed)) {
      return { fulfilled: false, reason: 'TOPUP_CHARGE_MISMATCH' };
    }
    // All financial effects and both session bindings commit together.
    await tx.update(billingCheckoutAttemptSchema)
      .set({ status: 'completed', stripeCheckoutSessionId: session.id, stripePaymentIntentId: intent.id })
      .where(and(eq(billingCheckoutAttemptSchema.id, attempt.id), eq(billingCheckoutAttemptSchema.salonId, metadata.salonId!)));
    await tx.update(smsTopupPurchaseSchema)
      .set({
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: intent.id,
        ...(purchase.status === 'checkout_created' ? { status: 'paid' as const } : {}),
      })
      .where(and(eq(smsTopupPurchaseSchema.id, purchase.id), eq(smsTopupPurchaseSchema.salonId, metadata.salonId!)));
    const { fulfilled } = await fulfillTopupPurchase(tx, { topupPurchaseId: purchase.id, now: input.now });
    return { fulfilled };
  });
}

/** checkout.session.expired: an unfulfilled purchase row parks as expired. */
export async function applyTopupSessionExpired(sessionId: string): Promise<{ expired: boolean }> {
  const updated = await db
    .update(smsTopupPurchaseSchema)
    .set({ status: 'expired' })
    .where(and(
      eq(smsTopupPurchaseSchema.stripeCheckoutSessionId, sessionId),
      inArray(smsTopupPurchaseSchema.status, ['checkout_created']),
    ))
    .returning();
  return { expired: updated.length === 1 };
}

/**
 * charge.refunded for a top-up payment intent: the charge's CUMULATIVE
 * amount_refunded drives the #118 arithmetic. Returns null when the payment
 * intent belongs to no top-up purchase (a subscription charge — the caller
 * holds those for a human).
 */
export async function applyTopupChargeRefunded(input: {
  paymentIntentId: string;
  refundId: string;
  cumulativeRefundedCents: number;
  now?: Date;
}): Promise<{ reversed: number; shortfall: number; anomaly: string | null } | null> {
  const [purchase] = await db
    .select({ id: smsTopupPurchaseSchema.id })
    .from(smsTopupPurchaseSchema)
    .where(eq(smsTopupPurchaseSchema.stripePaymentIntentId, input.paymentIntentId))
    .limit(1);
  if (purchase === undefined) {
    return null;
  }
  return db.transaction(async tx => reverseTopup(tx, {
    topupPurchaseId: purchase.id,
    kind: 'refund',
    stripeRef: input.refundId,
    cumulativeRefundedCents: input.cumulativeRefundedCents,
    now: input.now,
  }));
}

/** charge.dispute.created for a top-up: full residual reversal, may go negative. */
export async function applyTopupDisputeCreated(input: {
  paymentIntentId: string;
  disputeId: string;
  now?: Date;
}): Promise<{ reversed: number } | null> {
  const [purchase] = await db
    .select({ id: smsTopupPurchaseSchema.id })
    .from(smsTopupPurchaseSchema)
    .where(eq(smsTopupPurchaseSchema.stripePaymentIntentId, input.paymentIntentId))
    .limit(1);
  if (purchase === undefined) {
    return null;
  }
  return db.transaction(async tx => reverseTopup(tx, {
    topupPurchaseId: purchase.id,
    kind: 'dispute',
    stripeRef: input.disputeId,
    now: input.now,
  }));
}
