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

import { fulfillTopupPurchase, reverseTopup } from '@/libs/billing/creditGrants';
import { db } from '@/libs/DB';
import { billingCheckoutAttemptSchema, salonSchema, smsTopupPurchaseSchema } from '@/models/Schema';

/**
 * checkout.session.completed with purpose sms_topup. Paid evidence moves the
 * purchase to 'paid' exactly once (CAS from checkout_created) and fulfills;
 * an unpaid async completion records the payment intent and waits — a later
 * paid event fulfills through the same CAS.
 */
export async function applyTopupSessionCompleted(input: {
  sessionId: string;
  paymentStatus: string;
  paymentIntentId: string | null;
  now?: Date;
}): Promise<{ fulfilled: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const [purchase] = await tx
      .select()
      .from(smsTopupPurchaseSchema)
      .where(eq(smsTopupPurchaseSchema.stripeCheckoutSessionId, input.sessionId))
      .for('update');
    if (purchase === undefined) {
      return { fulfilled: false, reason: 'PURCHASE_NOT_FOUND' };
    }
    if (input.paymentIntentId !== null && purchase.stripePaymentIntentId === null) {
      await tx.update(smsTopupPurchaseSchema)
        .set({ stripePaymentIntentId: input.paymentIntentId })
        .where(eq(smsTopupPurchaseSchema.id, purchase.id));
    }
    if (input.paymentStatus !== 'paid') {
      return { fulfilled: false, reason: 'AWAITING_PAYMENT_EVIDENCE' };
    }
    await tx.update(smsTopupPurchaseSchema)
      .set({ status: 'paid' })
      .where(and(
        eq(smsTopupPurchaseSchema.id, purchase.id),
        eq(smsTopupPurchaseSchema.status, 'checkout_created'),
      ));
    const { fulfilled } = await fulfillTopupPurchase(tx, {
      topupPurchaseId: purchase.id,
      now: input.now,
    });
    if (fulfilled) {
      await tx.update(billingCheckoutAttemptSchema).set({ status: 'completed' })
        .where(and(
          eq(billingCheckoutAttemptSchema.stripeCheckoutSessionId, input.sessionId),
          eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
          eq(billingCheckoutAttemptSchema.salonId, purchase.salonId!),
          inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
        ));
    }
    return { fulfilled };
  });
}

/** checkout.session.expired: an unfulfilled purchase row parks as expired. */
export async function applyTopupSessionExpired(sessionId: string): Promise<{ expired: boolean }> {
  return db.transaction(async (tx) => {
    const [binding] = await tx.select().from(smsTopupPurchaseSchema)
      .where(eq(smsTopupPurchaseSchema.stripeCheckoutSessionId, sessionId));
    if (!binding) {
      // Like completion, delivery can precede the checkout's binding commit.
      throw new Error('TOPUP_PURCHASE_NOT_FOUND');
    }
    if (binding.salonId === null) {
      return { expired: false };
    }
    await tx.select({ id: salonSchema.id }).from(salonSchema)
      .where(eq(salonSchema.id, binding.salonId)).for('no key update');
    const [purchase] = await tx.select().from(smsTopupPurchaseSchema)
      .where(eq(smsTopupPurchaseSchema.id, binding.id)).for('update');
    if (!purchase || purchase.grantLedgerId || !['checkout_created', 'expired'].includes(purchase.status)) {
      return { expired: false };
    }
    await tx.update(smsTopupPurchaseSchema).set({ status: 'expired' })
      .where(eq(smsTopupPurchaseSchema.id, purchase.id));
    await tx.update(billingCheckoutAttemptSchema).set({ status: 'expired' })
      .where(and(
        eq(billingCheckoutAttemptSchema.stripeCheckoutSessionId, sessionId),
        eq(billingCheckoutAttemptSchema.salonId, binding.salonId),
        eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
        inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
      ));
    return { expired: true };
  });
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
