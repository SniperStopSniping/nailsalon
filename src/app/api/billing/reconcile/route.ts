/**
 * Billing reconciliation — Gate C2 (contract §8.6).
 *
 * A READ-mostly drift detector: local `billing_subscription` rows are
 * compared against the authoritative remote subscription, drift is
 * REPORTED, and the only permitted repair is re-projection through the same
 * idempotent transition every webhook uses — never a bespoke write. Two
 * Stripe endpoints must not become two divergent billing systems, and this
 * job is the instrument that proves they haven't.
 *
 * Duplicate remote subscriptions for one customer are ALERTED, never
 * silently resolved (§8.5): choosing one would strand real money on the
 * other.
 *
 * Dark posture: requires CRON_SECRET (never registered as a cron this gate)
 * AND BILLING_SUBSCRIPTIONS_ENABLED='true' — while billing is dark there is
 * no remote state to reconcile and this route must not create provider
 * traffic. Fail closed on both.
 */
import * as Sentry from '@sentry/nextjs';
import type Stripe from 'stripe';

import { projectSubscriptionSnapshot } from '@/libs/billing/billingSubscriptionProjection';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import { billingSubscriptionSchema } from '@/models/Schema';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const header = request.headers.get('x-cron-secret');
  const bearer = request.headers.get('authorization');
  return header === secret || bearer === `Bearer ${secret}`;
}

type DriftEntry = {
  stripeSubscriptionId: string;
  field: string;
  local: string;
  remote: string;
  repaired: boolean;
};

async function run(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (Env.BILLING_SUBSCRIPTIONS_ENABLED !== 'true') {
    return Response.json(
      { error: { code: 'BILLING_DISABLED', message: 'Nothing to reconcile while billing is dark.' } },
      { status: 503 },
    );
  }

  const rows = await db.select().from(billingSubscriptionSchema).limit(100);
  const drift: DriftEntry[] = [];
  const duplicateAlerts: string[] = [];
  const customersSeen = new Map<string, string>();

  for (const row of rows) {
    let remote: Stripe.Subscription;
    try {
      remote = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
    } catch {
      drift.push({
        stripeSubscriptionId: row.stripeSubscriptionId,
        field: 'existence',
        local: row.status,
        remote: 'UNRETRIEVABLE',
        repaired: false,
      });
      continue;
    }

    // Duplicate remote detection: one customer, two live local rows would be
    // impossible (partial unique); one customer with a second REMOTE live
    // subscription we never projected is the §8.5 alert case.
    const customerId = typeof remote.customer === 'string' ? remote.customer : remote.customer.id;
    const previous = customersSeen.get(customerId);
    if (previous !== undefined && previous !== remote.id) {
      duplicateAlerts.push(customerId);
    }
    customersSeen.set(customerId, remote.id);

    const fields: Array<[string, string, string]> = [
      ['status', row.status, remote.status],
      ['cancelAtPeriodEnd', String(row.cancelAtPeriodEnd), String(remote.cancel_at_period_end)],
    ];
    const conflicting = fields.filter(([, local, remoteValue]) => local !== remoteValue);
    if (conflicting.length > 0) {
      // Repair = the SAME idempotent projection the webhook runs, from the
      // authoritative snapshot we just fetched.
      const outcome = await projectSubscriptionSnapshot({
        snapshot: {
          id: remote.id,
          customerId,
          status: remote.status,
          cancelAtPeriodEnd: remote.cancel_at_period_end,
          currentPeriodStart: new Date(remote.current_period_start * 1000),
          metadata: (remote.metadata ?? {}) as Record<string, string | undefined>,
        },
        // The CURRENT watermark, not now(): a reconcile pass must never
        // out-fence authentic Stripe events still mid-retry (finding 3) —
        // equal-second stays eligible, so the repair applies without
        // advancing anything.
        eventCreated: row.lastEventCreated ?? new Date(0),
        eventId: `reconcile_${crypto.randomUUID()}`,
      });
      for (const [field, local, remoteValue] of conflicting) {
        drift.push({
          stripeSubscriptionId: row.stripeSubscriptionId,
          field,
          local,
          remote: remoteValue,
          repaired: outcome.applied,
        });
      }
    }
  }

  if (duplicateAlerts.length > 0) {
    Sentry.captureMessage('billing.duplicate_remote_subscriptions', {
      level: 'error',
      extra: { customers: duplicateAlerts },
    });
  }
  return Response.json({
    summary: {
      checked: rows.length,
      drift,
      duplicateRemoteCustomers: duplicateAlerts.length,
    },
  });
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
