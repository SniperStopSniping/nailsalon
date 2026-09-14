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
import { resolveTopupOfferFromStripePriceId } from '@/libs/billing/stripePriceMap';
import { db } from '@/libs/DB';
import { billingCheckoutAttemptSchema, salonSchema, smsTopupPurchaseSchema } from '@/models/Schema';

/**
 * Evidence the ROUTE retrieved directly from Stripe (`sessions.retrieve`
 * with `expand: ['line_items', 'payment_intent']`) for a session whose
 * `payment_status` is 'paid' — the checkout-session event body alone has no
 * line items (§4/G02). Verified here, inside the SAME locked transaction
 * that fulfils, so a TOCTOU window between the route's read and this write
 * cannot slip a mismatched session through.
 */
export type TopupVerifiedEvidence = {
  amountTotal: number | null;
  currency: string | null;
  metadataSalonId: string | null;
  metadataPurchaseId: string | null;
  metadataAttemptId: string | null;
  priceId: string | null;
};

/** Reasons `applyTopupSessionCompleted` can return that mean "verified evidence disagreed with the persisted purchase" — the route classifies these as `held_anomaly`, never as a plain unfulfilled wait. */
export const TOPUP_EVIDENCE_MISMATCH_REASONS = new Set([
  'TOPUP_AMOUNT_MISMATCH',
  'TOPUP_CURRENCY_MISMATCH',
  'TOPUP_SALON_MISMATCH',
  'TOPUP_PURCHASE_ID_MISMATCH',
  'TOPUP_ATTEMPT_ID_MISMATCH',
  'TOPUP_OFFER_PRICE_MISMATCH',
]);

export function isTopupEvidenceMismatchReason(reason: string | undefined): boolean {
  return reason !== undefined && TOPUP_EVIDENCE_MISMATCH_REASONS.has(reason);
}

// G02: logged AT MOST ONCE per process — see the identical rationale on the
// subscription side in billingSubscriptionProjection.ts.
let topupPriceCrossCheckUnconfiguredLogged = false;

function logTopupPriceCrossCheckSkippedOnce(): void {
  if (topupPriceCrossCheckUnconfiguredLogged) {
    return;
  }
  topupPriceCrossCheckUnconfiguredLogged = true;
  // eslint-disable-next-line no-console
  console.info('[billing] topup price cross-check skipped: price map unconfigured for this environment (G02)');
}

/**
 * Compare verified Stripe evidence against the LOCKED purchase row (and its
 * bound checkout attempt, when one is found). Returns the first mismatch
 * reason found, or null when the evidence is consistent. The offer/price
 * check is skipped (never a mismatch) when the reverse lookup cannot
 * identify an offer for the price id — see the module-level rationale.
 */
function checkTopupEvidence(
  evidence: TopupVerifiedEvidence,
  purchase: { id: string; salonId: string | null; amountCents: number; topupOfferKey: string },
  attemptId: string | null,
): string | null {
  if (evidence.amountTotal !== purchase.amountCents) {
    return 'TOPUP_AMOUNT_MISMATCH';
  }
  if (evidence.currency !== 'cad') {
    return 'TOPUP_CURRENCY_MISMATCH';
  }
  if (evidence.metadataSalonId !== purchase.salonId) {
    return 'TOPUP_SALON_MISMATCH';
  }
  if (evidence.metadataPurchaseId !== purchase.id) {
    return 'TOPUP_PURCHASE_ID_MISMATCH';
  }
  if (attemptId !== null && evidence.metadataAttemptId !== attemptId) {
    return 'TOPUP_ATTEMPT_ID_MISMATCH';
  }
  if (evidence.priceId !== null) {
    const resolvedOfferKey = resolveTopupOfferFromStripePriceId(evidence.priceId);
    if (resolvedOfferKey === null) {
      logTopupPriceCrossCheckSkippedOnce();
    } else if (resolvedOfferKey !== purchase.topupOfferKey) {
      return 'TOPUP_OFFER_PRICE_MISMATCH';
    }
  }
  return null;
}

/**
 * checkout.session.completed (or async_payment_succeeded) with purpose
 * sms_topup. Paid evidence moves the purchase to 'paid' exactly once (CAS
 * from checkout_created) and fulfills; an unpaid async completion records
 * the payment intent and waits — a later paid event fulfills through the
 * same CAS. `verifiedEvidence`, when supplied, is cross-checked against the
 * locked purchase BEFORE the CAS status write — a mismatch fulfils NOTHING
 * and leaves the purchase exactly as it was (PR #195's CAS/status logic is
 * otherwise untouched).
 */
export async function applyTopupSessionCompleted(input: {
  sessionId: string;
  paymentStatus: string;
  paymentIntentId: string | null;
  verifiedEvidence?: TopupVerifiedEvidence | null;
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
    if (input.verifiedEvidence) {
      const [attempt] = await tx
        .select({ id: billingCheckoutAttemptSchema.id })
        .from(billingCheckoutAttemptSchema)
        .where(and(
          eq(billingCheckoutAttemptSchema.stripeCheckoutSessionId, input.sessionId),
          eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
        ))
        .limit(1);
      const mismatch = checkTopupEvidence(input.verifiedEvidence, purchase, attempt?.id ?? null);
      if (mismatch !== null) {
        return { fulfilled: false, reason: mismatch };
      }
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
