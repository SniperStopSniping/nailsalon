import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { recordBillingEventSalonId } from '@/libs/billing/billingStripeEvents';
import { db } from '@/libs/DB';
import { stripe } from '@/libs/stripe';
import { aiCreditPurchaseSchema as purchases } from '@/models/Schema';

import { applyVerifiedAiCreditSession, reconcileAiCreditCharge, reconcileAiCreditDispute } from './checkout.server';
import { aiCreditPlanEnv } from './config.server';
import { AiCreditError } from './wallet.server';

/** Runs only after the existing billing route verifies signature, mode and event lease. */
export async function handleAiCreditBillingEvent(event: Stripe.Event): Promise<{ status: 'processed' | 'ignored_foreign' | 'held_anomaly'; detail?: string } | null> {
  if (event.type.startsWith('checkout.session.')) {
    const incoming = event.data.object as Stripe.Checkout.Session;
    if (incoming.metadata?.purpose !== 'ai_credit_topup') {
      return null;
    }
    const planEnv = aiCreditPlanEnv();
    const [purchase] = await db.select().from(purchases).where(and(eq(purchases.id, incoming.metadata.purchaseId ?? ''), eq(purchases.planEnv, planEnv)));
    if (!purchase) {
      return { status: 'ignored_foreign', detail: 'FOREIGN_AI_PURCHASE' };
    }
    if (incoming.metadata.salonId !== purchase.salonId || (purchase.stripeSessionId && purchase.stripeSessionId !== incoming.id)) {
      return { status: 'held_anomaly', detail: 'AI_PAYMENT_MISMATCH' };
    }
    await recordBillingEventSalonId(event.id, purchase.salonId);
    try {
      const session = await stripe.checkout.sessions.retrieve(incoming.id, { expand: ['line_items', 'payment_intent.latest_charge'] });
      await applyVerifiedAiCreditSession(session, planEnv);
      return { status: 'processed' };
    } catch (error) {
      if (error instanceof AiCreditError && error.code === 'PAYMENT_MISMATCH') {
        return { status: 'held_anomaly', detail: 'AI_PAYMENT_MISMATCH' };
      }
      throw error; // Real provider/DB failures retain the existing retryable lease.
    }
  }
  if (event.type !== 'charge.refunded' && event.type !== 'charge.dispute.created' && event.type !== 'charge.dispute.closed') {
    return null;
  }
  // Keep older billing deployments usable before this additive migration, and
  // continue refund processing when the AI entry/purchase flags are disabled.
  const relation = await db.execute(sql`SELECT to_regclass('public.ai_credit_purchase') AS relation`);
  if (!relation.rows[0]?.relation) {
    return null;
  }
  const object = event.data.object as Stripe.Charge | Stripe.Dispute;
  const intentId = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
  if (!intentId) {
    return null;
  }
  const planEnv = aiCreditPlanEnv();
  const [purchase] = await db.select().from(purchases).where(and(eq(purchases.stripePaymentIntentId, intentId), eq(purchases.planEnv, planEnv)));
  if (!purchase) {
    return null;
  }
  await recordBillingEventSalonId(event.id, purchase.salonId);
  try {
    if (event.type === 'charge.refunded') {
      await reconcileAiCreditCharge(object.id, planEnv);
    } else {
      await reconcileAiCreditDispute(object.id, planEnv);
    }
  } catch (error) {
    if (error instanceof AiCreditError && error.code === 'PAYMENT_MISMATCH') {
      return { status: 'held_anomaly', detail: 'AI_PAYMENT_MISMATCH' };
    }
    throw error;
  }
  return { status: 'processed' };
}
