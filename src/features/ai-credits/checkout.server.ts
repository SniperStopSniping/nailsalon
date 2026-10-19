import 'server-only';

import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';

import { setupAiExpenseAvailable } from '@/features/business-setup/ai-trial.server';
import { lockSetupSalon, type SetupActor } from '@/features/business-setup/drafts.server';
import { resolveBillingAppOrigin } from '@/libs/billing/billingAppOrigin';
import { resolveOrCreateBillingCustomer } from '@/libs/billing/billingCustomer';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import { aiCreditPurchaseSchema as purchases } from '@/models/Schema';

import { AI_CREDIT_PACKS, type AiCreditPackKey, type AiCreditPlanEnv } from './catalog';
import { aiCreditPlanEnv, aiCreditPurchasesEnabled, aiCreditStripePrice } from './config.server';
import { AiCreditError, type AiCreditPaymentEvidence, attachAiCreditCheckout, beginAiCreditPurchase, expireAiCreditPurchase, fulfillAiCreditPurchase, reverseAiCreditPurchase } from './wallet.server';

function stripeId(value: string | { id: string } | null) {
  return typeof value === 'string' ? value : value?.id ?? '';
}

export async function aiCreditPurchasesAvailable() {
  return aiCreditPurchasesEnabled() && await setupAiExpenseAvailable(aiCreditPlanEnv() === 'prod');
}

/** Reads authoritative Stripe evidence; a success URL/session ID never grants by itself. */
export async function reconcileAiCreditSession(purchaseId: string, planEnv: AiCreditPlanEnv) {
  let [purchase] = await db.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.planEnv, planEnv)));
  if (purchase && !purchase.stripeSessionId && purchase.status === 'creating') {
    // A lost create response is recoverable through Stripe, even after its
    // idempotency window. No second payable session is created by recovery.
    const recovered = await recoverAiCreditCheckout(purchase);
    if (recovered) {
      [purchase] = await db.select().from(purchases).where(eq(purchases.id, purchaseId));
    }
  }
  if (!purchase?.stripeSessionId) {
    return { status: 'pending' as const };
  }
  const session = await stripe.checkout.sessions.retrieve(purchase.stripeSessionId, { expand: ['line_items', 'payment_intent.latest_charge'] });
  return applyVerifiedAiCreditSession(session, planEnv);
}

async function recoverAiCreditCheckout(purchase: typeof purchases.$inferSelect) {
  let after: string | undefined;
  const found: Stripe.Checkout.Session[] = [];
  for (let page = 0; page < 3; page++) {
    const result = await stripe.checkout.sessions.list({ customer: purchase.stripeCustomerId, created: { gte: Math.floor(purchase.createdAt.getTime() / 1000) - 300, lte: Math.ceil(purchase.expiresAt.getTime() / 1000) + 300 }, limit: 100, ...(after ? { starting_after: after } : {}) });
    found.push(...result.data.filter(session => session.metadata?.purpose === 'ai_credit_topup' && session.metadata.purchaseId === purchase.id));
    if (found.length > 1) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'This purchase needs a payment review. Please avoid starting another payment.');
    }
    if (!result.has_more) {
      const session = found[0];
      if (!session) {
        return false;
      }
      // Full retrieved evidence is checked before attaching any recovered ID.
      const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items', 'payment_intent.latest_charge'] });
      await applyVerifiedAiCreditSession(full, purchase.planEnv);
      if (full.status === 'open') {
        await attachAiCreditCheckout({ salonId: purchase.salonId, adminId: purchase.actorId }, purchase.planEnv, purchase.id, full.id);
      }
      return true;
    }
    after = result.data.at(-1)?.id;
    if (!after) {
      break;
    }
  }
  return false; // Incomplete scans never authorize a fresh payment attempt.
}

/** Only receives a session retrieved by this server under its environment-specific key. */
export async function applyVerifiedAiCreditSession(session: Stripe.Checkout.Session, planEnv: AiCreditPlanEnv) {
  const metadata = session.metadata ?? {};
  if (metadata.purpose !== 'ai_credit_topup' || metadata.planEnv !== planEnv || !metadata.purchaseId || !metadata.salonId) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'This payment does not belong to AI credits.');
  }
  if (Env.BILLING_DEPLOYMENT_MARKER && metadata.luster_deployment !== Env.BILLING_DEPLOYMENT_MARKER) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'This payment belongs to another environment.');
  }
  const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const charge = typeof intent?.latest_charge === 'object' ? intent.latest_charge : null;
  if (session.payment_status === 'paid' && (!intent || !charge)) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'Payment confirmation is still being checked.');
  }
  const items = session.line_items?.data ?? [];
  if (items.length !== 1 || session.line_items?.has_more) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'This payment does not match one AI credit pack.');
  }
  const evidence: AiCreditPaymentEvidence = {
    purchaseId: metadata.purchaseId,
    salonId: metadata.salonId,
    planEnv,
    packKey: metadata.packKey ?? '',
    sessionId: session.id,
    paymentIntentId: stripeId(session.payment_intent),
    customerId: stripeId(session.customer),
    priceId: items[0]?.price?.id ?? '',
    amountSubtotal: session.amount_subtotal ?? -1,
    amountTotal: session.amount_total ?? -1,
    taxCents: session.total_details?.amount_tax ?? 0,
    quantity: items[0]?.quantity ?? 0,
    currency: session.currency ?? '',
    paymentStatus: session.payment_status,
    livemode: session.livemode,
    amountRefundedCents: charge?.amount_refunded ?? 0,
    disputed: charge?.disputed ?? false,
  };
  const fulfilled = await fulfillAiCreditPurchase(evidence);
  if (fulfilled.fulfilled) {
    if (charge?.disputed) {
      // A dispute can close before checkout fulfillment arrives. Re-read its
      // present state so a won dispute does not leave an indefinite credit hold.
      await reconcileAiCreditCharge(charge.id, planEnv);
    }
    return { status: 'paid' as const, purchaseId: fulfilled.purchaseId };
  }
  if (session.status === 'expired') {
    await expireAiCreditPurchase(metadata.purchaseId, session.id, planEnv);
    return { status: 'expired' as const, purchaseId: metadata.purchaseId };
  }
  return { status: 'pending' as const, purchaseId: metadata.purchaseId };
}

export async function createAiCreditCheckout(actor: SetupActor, input: { packKey: AiCreditPackKey; operationId: string; locale: 'en' | 'fr' }) {
  if (!await aiCreditPurchasesAvailable()) {
    throw new AiCreditError('NOT_CONFIGURED', 'AI credit purchases are not available yet.');
  }
  const planEnv = aiCreditPlanEnv();
  const pack = AI_CREDIT_PACKS[input.packKey];
  const priceId = aiCreditStripePrice(input.packKey, planEnv);
  const origin = resolveBillingAppOrigin();
  const salon = await db.transaction(tx => lockSetupSalon(tx, actor));
  const price = await stripe.prices.retrieve(priceId);
  if (!price.active || price.type !== 'one_time' || price.currency !== 'cad' || price.unit_amount !== pack.priceCents || price.livemode !== (planEnv === 'prod')) {
    throw new AiCreditError('NOT_CONFIGURED', 'This credit pack could not be verified. No payment has been started.');
  }
  const customer = await resolveOrCreateBillingCustomer({ salonId: salon.id, email: salon.ownerEmail, name: salon.name });
  const purchase = await beginAiCreditPurchase(actor, { ...input, planEnv, stripePriceId: priceId, stripeCustomerId: customer.stripeCustomerId });
  if (purchase.status === 'paid') {
    return { status: 'paid' as const, purchaseId: purchase.id };
  }
  if (purchase.status === 'expired' || purchase.status === 'failed') {
    return { status: 'expired' as const, purchaseId: purchase.id };
  }
  if (purchase.stripeSessionId) {
    const resolved = await reconcileAiCreditSession(purchase.id, planEnv);
    if (resolved.status !== 'pending') {
      return resolved;
    }
    const session = await stripe.checkout.sessions.retrieve(purchase.stripeSessionId);
    if (session.url && session.status === 'open') {
      return { status: 'ready' as const, url: session.url, purchaseId: purchase.id };
    }
    return { status: 'pending' as const, purchaseId: purchase.id };
  }
  // After Stripe's idempotency window, an uncertain create needs reconciliation,
  // never another session under a key whose provider-side record may have expired.
  if (Date.now() - purchase.createdAt.getTime() > 23 * 3600_000 || purchase.expiresAt.getTime() - Date.now() < 31 * 60_000) {
    return { ...await reconcileAiCreditSession(purchase.id, planEnv), purchaseId: purchase.id };
  }
  const metadata = { purpose: 'ai_credit_topup', salonId: actor.salonId, purchaseId: purchase.id, planEnv, packKey: purchase.packKey, ...(Env.BILLING_DEPLOYMENT_MARKER ? { luster_deployment: Env.BILLING_DEPLOYMENT_MARKER } : {}) };
  const path = `/${input.locale}/admin/business-setup?salon=${encodeURIComponent(salon.slug)}`;
  const session = await stripe.checkout.sessions.create({
    customer: purchase.stripeCustomerId,
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price: purchase.stripePriceId, quantity: 1 }],
    automatic_tax: { enabled: Env.BILLING_TAX_COLLECTION_ENABLED === 'true' },
    customer_update: { address: 'auto' },
    expires_at: Math.floor(purchase.expiresAt.getTime() / 1000),
    success_url: `${origin}${path}&credits=success&purchase=${purchase.id}`,
    cancel_url: `${origin}${path}&credits=cancelled&purchase=${purchase.id}`,
    metadata,
    payment_intent_data: { metadata },
  }, { idempotencyKey: `ai-credit-checkout:${planEnv}:${purchase.id}:v1` });
  // Do not turn ambiguous network failures into "failed" or mint another attempt.
  await attachAiCreditCheckout(actor, planEnv, purchase.id, session.id);
  if (session.url && session.status === 'open') {
    return { status: 'ready' as const, url: session.url, purchaseId: purchase.id };
  }
  return { status: 'pending' as const, purchaseId: purchase.id };
}

/** Shares the existing Stripe client; never creates refunds or takes payments. */
export async function reconcileAiCreditCharge(chargeId: string, planEnv: AiCreditPlanEnv) {
  const charge = await stripe.charges.retrieve(chargeId);
  if (charge.livemode !== (planEnv === 'prod')) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'Wrong payment environment.');
  }
  if (charge.disputed) {
    const disputes = await stripe.disputes.list({ charge: charge.id, limit: 2 });
    if (disputes.data.length !== 1 || disputes.has_more) {
      throw new AiCreditError('PAYMENT_MISMATCH', 'This dispute needs a payment review.');
    }
    return reconcileAiCreditDispute(disputes.data[0]!.id, planEnv);
  }
  return reverseAiCreditPurchase({ paymentIntentId: stripeId(charge.payment_intent), planEnv, amountRefundedCents: charge.amount_refunded, disputed: false });
}

export async function reconcileAiCreditDispute(disputeId: string, planEnv: AiCreditPlanEnv) {
  const dispute = await stripe.disputes.retrieve(disputeId);
  const charge = await stripe.charges.retrieve(stripeId(dispute.charge));
  if (dispute.livemode !== (planEnv === 'prod') || charge.livemode !== (planEnv === 'prod') || stripeId(charge.payment_intent) !== stripeId(dispute.payment_intent)) {
    throw new AiCreditError('PAYMENT_MISMATCH', 'This dispute does not match the credit payment.');
  }
  return reverseAiCreditPurchase({ paymentIntentId: stripeId(charge.payment_intent), planEnv, amountRefundedCents: charge.amount_refunded, disputed: dispute.status !== 'won', disputeId: dispute.id, ...(dispute.status === 'won' || dispute.status === 'lost' ? { disputeResolution: dispute.status } : {}) });
}

export async function cancelAiCreditCheckout(actor: SetupActor, purchaseId: string, planEnv: AiCreditPlanEnv) {
  const purchase = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const [row] = await tx.select().from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.salonId, actor.salonId), eq(purchases.planEnv, planEnv)));
    if (!row || row.actorId !== actor.adminId) {
      throw new AiCreditError('NOT_FOUND', 'This credit purchase is unavailable.');
    }
    return row;
  });
  if (!purchase.stripeSessionId) {
    return { status: 'pending' as const };
  }
  const session = await stripe.checkout.sessions.retrieve(purchase.stripeSessionId, { expand: ['line_items', 'payment_intent.latest_charge'] });
  if (session.status !== 'open') {
    return applyVerifiedAiCreditSession(session, planEnv);
  }
  const expired = await stripe.checkout.sessions.expire(session.id, {}, { idempotencyKey: `ai-credit-cancel:${purchase.id}` });
  if (expired.status === 'expired') {
    await expireAiCreditPurchase(purchase.id, session.id, planEnv);
    return { status: 'expired' as const, purchaseId: purchase.id };
  }
  return { status: 'pending' as const, purchaseId: purchase.id };
}
