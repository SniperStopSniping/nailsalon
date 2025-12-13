/**
 * Stripe Webhook Handler
 *
 * Handles Stripe events for subscription billing:
 * - checkout.session.completed
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 *
 * CRITICAL: Uses raw body + signature verification for security.
 * Single source of truth: syncSubscription() handles all subscription updates.
 */
/* eslint-disable no-console -- Webhook logging is intentional for operational visibility */
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

import { logBillingModeChange, logSubscriptionStatusChange } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { BILLING_MODE } from '@/libs/featureGating';
import { stripe } from '@/libs/stripe';
import { salonSchema } from '@/models/Schema';

// =============================================================================
// SYNC SUBSCRIPTION - Single Source of Truth
// =============================================================================

/**
 * Syncs subscription data from Stripe to our database.
 * This is the ONLY function that updates subscription-related fields.
 *
 * @param subscriptionId - Stripe subscription ID
 */
async function syncSubscription(subscriptionId: string): Promise<void> {
  // 1. Retrieve subscription from Stripe with expanded customer
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['customer', 'items.data.price'],
  });

  // 2. Extract data
  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  const stripeSubscriptionStatus = subscription.status;
  const stripePriceId = subscription.items.data[0]?.price?.id || null;
  const stripeCurrentPeriodEnd = subscription.current_period_end; // Unix timestamp

  // 3. Determine salonId - prefer metadata, then fallback chain
  let salonId = subscription.metadata?.salonId;

  // Fallback 1: find salon by subscriptionId (covers metadata missing, customer mismatch)
  if (!salonId) {
    const [bySub] = await db
      .select({ id: salonSchema.id })
      .from(salonSchema)
      .where(eq(salonSchema.stripeSubscriptionId, subscription.id))
      .limit(1);

    salonId = bySub?.id;
  }

  // Fallback 2: find salon by customerId (covers older records, race conditions)
  if (!salonId && stripeCustomerId) {
    const [byCustomer] = await db
      .select({ id: salonSchema.id })
      .from(salonSchema)
      .where(eq(salonSchema.stripeCustomerId, stripeCustomerId))
      .limit(1);

    salonId = byCustomer?.id;
  }

  if (!salonId) {
    console.warn(`[Stripe Webhook] syncSubscription: No salonId found for subscription ${subscriptionId}`);
    return;
  }

  // 4. Get old status for audit log
  const [oldSalon] = await db
    .select({ status: salonSchema.stripeSubscriptionStatus })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  const oldStatus = oldSalon?.status ?? null;

  // 5. Update salon with subscription data
  // Note: We don't force billingMode here - that's set on checkout.session.completed
  await db
    .update(salonSchema)
    .set({
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus,
      stripePriceId,
      stripeCurrentPeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(salonSchema.id, salonId));

  // 6. Audit log if status changed
  if (oldStatus !== stripeSubscriptionStatus) {
    void logSubscriptionStatusChange(salonId, oldStatus, stripeSubscriptionStatus, subscription.id);
  }

  console.log(`[Stripe Webhook] Synced subscription ${subscriptionId} for salon ${salonId}, status: ${stripeSubscriptionStatus}`);
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handle checkout.session.completed
 * This is when we enable Stripe billing for the salon
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const salonId = session.metadata?.salonId;
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  if (!salonId) {
    console.warn('[Stripe Webhook] checkout.session.completed: Missing salonId in metadata');
    return;
  }

  // Guard: don't enable Stripe mode without at least a subscriptionId or customerId
  if (!subscriptionId && !customerId) {
    console.warn('[Stripe Webhook] checkout.session.completed: Missing both subscription and customer IDs, skipping');
    return;
  }

  // Update salon to enable Stripe billing
  const updateData: Record<string, unknown> = {
    billingMode: BILLING_MODE.STRIPE,
    updatedAt: new Date(),
  };

  if (customerId) {
    updateData.stripeCustomerId = customerId;
  }

  if (subscriptionId) {
    updateData.stripeSubscriptionId = subscriptionId;
  }

  // Get customer email if available
  if (session.customer_email) {
    updateData.stripeCustomerEmail = session.customer_email;
  } else if (session.customer_details?.email) {
    updateData.stripeCustomerEmail = session.customer_details.email;
  }

  await db
    .update(salonSchema)
    .set(updateData)
    .where(eq(salonSchema.id, salonId));

  // Audit log: billing mode changed to STRIPE
  void logBillingModeChange(salonId, 'NONE', BILLING_MODE.STRIPE, 'webhook');

  console.log(`[Stripe Webhook] Enabled Stripe billing for salon ${salonId}`);

  // Sync full subscription details
  if (subscriptionId) {
    await syncSubscription(subscriptionId);
  }
}

/**
 * Handle subscription events (created, updated, deleted)
 */
async function handleSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  await syncSubscription(subscription.id);
}

/**
 * Handle invoice events
 * Extract subscription ID and sync
 */
async function handleInvoiceEvent(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;

  if (subscriptionId) {
    await syncSubscription(subscriptionId);
  }
}

// =============================================================================
// WEBHOOK ENDPOINT
// =============================================================================

export async function POST(request: NextRequest) {
  // 1. Read raw body for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    console.error('[Stripe Webhook] Missing stripe-signature header');
    return new Response('Missing signature', { status: 400 });
  }

  // 2. Verify webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      Env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Signature verification failed: ${message}`);
    return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
  }

  // 3. Route event to handler
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
        await handleInvoiceEvent(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Error processing ${event.type}: ${message}`);

    // Capture to Sentry with context (no secrets)
    Sentry.captureException(err, {
      tags: {
        webhook: 'stripe',
        event_type: event.type,
      },
      extra: {
        event_id: event.id,
        // Don't log full event data to avoid leaking sensitive info
      },
    });

    return new Response(`Webhook handler error: ${message}`, { status: 500 });
  }
}

// Webhook config: nodejs runtime + force-dynamic to prevent caching
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
