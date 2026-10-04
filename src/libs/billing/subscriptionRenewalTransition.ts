import 'server-only';

import { eq } from 'drizzle-orm';

import { logAuditEventTx } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import { billingSubscriptionSchema, salonSchema } from '@/models/Schema';

type SubscriptionBinding = { salonId: string; subscriptionId: string; customerId: string };

/** Only locally bound Luster subscriptions may have renewal changed. */
export function renewalTransitionDecision(binding: SubscriptionBinding, remote: {
  id: string;
  customer: string | { id: string } | null;
  status: string;
  cancel_at_period_end: boolean;
  livemode: boolean;
  metadata: Record<string, string>;
}, live: boolean): 'stop_renewal' | 'already_stopped' | 'binding_mismatch' {
  const customerId = typeof remote.customer === 'string' ? remote.customer : remote.customer?.id;
  if (remote.id !== binding.subscriptionId || customerId !== binding.customerId || remote.livemode !== live
    || remote.metadata.salonId !== binding.salonId) {
    return 'binding_mismatch';
  }
  if (remote.cancel_at_period_end || ['canceled', 'incomplete_expired'].includes(remote.status)) {
    return 'already_stopped';
  }
  return 'stop_renewal';
}

export async function transitionSalonSubscriptionRenewals(salonId: string, actorId: string, apply = false) {
  const [salon] = await db.select({
    stripeSubscriptionId: salonSchema.stripeSubscriptionId,
    stripeCustomerId: salonSchema.stripeCustomerId,
  }).from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
  const rows = await db.select({
    subscriptionId: billingSubscriptionSchema.stripeSubscriptionId,
    customerId: billingSubscriptionSchema.stripeCustomerId,
  }).from(billingSubscriptionSchema).where(eq(billingSubscriptionSchema.salonId, salonId));
  if (salon?.stripeSubscriptionId && salon.stripeCustomerId) {
    rows.push({ subscriptionId: salon.stripeSubscriptionId, customerId: salon.stripeCustomerId });
  }
  const unique = new Map(rows.map(row => [row.subscriptionId, row]));
  const results = [];
  for (const binding of unique.values()) {
    const remote = await stripe.subscriptions.retrieve(binding.subscriptionId);
    const decision = renewalTransitionDecision({ ...binding, salonId }, remote, Env.BILLING_PLAN_ENV === 'prod');
    if (decision === 'binding_mismatch') {
      results.push({ subscriptionId: binding.subscriptionId, status: decision });
      continue;
    }
    if (apply && decision === 'stop_renewal') {
      const updated = await stripe.subscriptions.update(binding.subscriptionId, { cancel_at_period_end: true }, {
        idempotencyKey: `free-model-stop-renewal:${salonId}:${binding.subscriptionId}`,
      });
      if (!updated.cancel_at_period_end || renewalTransitionDecision({ ...binding, salonId }, updated, Env.BILLING_PLAN_ENV === 'prod') !== 'already_stopped') {
        throw new Error('Subscription renewal transition was not confirmed');
      }
      await db.transaction(async (tx) => {
        await tx.update(billingSubscriptionSchema).set({ cancelAtPeriodEnd: true })
          .where(eq(billingSubscriptionSchema.stripeSubscriptionId, binding.subscriptionId));
        await logAuditEventTx(tx, {
          actorType: 'super_admin',
          actorId,
          action: 'free_model_subscription_renewal_stopped',
          salonId,
          entityType: 'salon',
          entityId: salonId,
          metadata: { subscriptionId: binding.subscriptionId, cancelAtPeriodEnd: true },
        });
      });
    } else if (apply && decision === 'already_stopped') {
      // Recover a provider-success/local-crash without renewing or changing paid coverage.
      await db.update(billingSubscriptionSchema).set({ cancelAtPeriodEnd: remote.cancel_at_period_end })
        .where(eq(billingSubscriptionSchema.stripeSubscriptionId, binding.subscriptionId));
    }
    results.push({ subscriptionId: binding.subscriptionId, status: apply && decision === 'stop_renewal' ? 'renewal_stopped' : decision });
  }
  return results;
}
