/**
 * Connect-scoped Stripe webhook endpoint.
 *
 * POST /api/webhooks/stripe-connect
 *
 * A sibling of the SaaS billing webhook that shares NO handler code with it.
 * That separation is not stylistic: the billing handler resolves its tenant from
 * `session.metadata.salonId` and never reads `event.account`, so a
 * Connect-scoped delivery arriving there would be a cross-tenant billing
 * takeover.
 *
 * D2 subscribes to `account.*` only. It creates no Checkout Session, charges no
 * customer, and writes no `appointment_deposit` row.
 *
 * TENANT-1: the salon is resolved ONLY by looking up `event.account` in
 * `salon_stripe_account`, matched across live AND revoked rows, with no fallback
 * chain. Payload metadata is never an authority.
 */
import * as Sentry from '@sentry/nextjs';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

import { Env } from '@/libs/Env';
import { stripe } from '@/libs/stripe';
import {
  getBindingsByStripeAccountId,
  revokeBinding,
} from '@/libs/stripeConnect/binding';
import {
  expectedLivemode,
  StripeConnectUnavailableError,
  syncAccountReadiness,
} from '@/libs/stripeConnect/readiness';
import {
  CLAIM_STALE_AFTER_MS,
  claimWebhookEvent,
  finalizeRetryable,
  finalizeTerminal,
  finalizeWebhookEvent,
  isTerminalStatus,
  readWebhookEvent,
  reclaimWebhookEvent,
  UNBOUND_MAX_ATTEMPTS,
  unboundBackoffMs,
} from '@/libs/stripeConnect/webhookEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A production Connect endpoint legitimately receives BOTH live and test
 * deliveries, because both kinds of activity can happen under one platform
 * account. So `ignored_livemode` rows are a normal operating state, not an
 * incident — but a sudden flood still deserves one look, so we alert once per
 * process rather than never or every time.
 */
let livemodeAlertEmitted = false;

function ok(): Response {
  return new Response('OK', { status: 200 });
}

function retryLater(): Response {
  // Deliberate 500: it keeps Stripe's own ≤3-day retry chain alive. D2 ships no
  // sweep of its own.
  return new Response('Retry', { status: 500 });
}

type Claim = { id: string; attempts: number };

export async function POST(request: NextRequest) {
  // 1. No secret → 503 and nothing is read. Stripe retries for up to 3 days, so
  //    a not-yet-provisioned endpoint loses nothing.
  const secret = Env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('Connect webhook not configured', { status: 503 });
  }

  // 2. Fail CLOSED on an indeterminate mode. Never guess a default.
  let expected: boolean;
  try {
    expected = expectedLivemode();
  } catch {
    Sentry.captureMessage('stripe_connect_mode_indeterminate', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
    });
    return new Response('Mode indeterminate', { status: 503 });
  }

  // 3. Raw body + real signature verification.
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? '', secret);
  } catch {
    // No row. Recording rows for unverified bodies would be an unbounded write
    // primitive; a counter is the right shape. This alert matters because a
    // wrong-mode endpoint secret produces NOTHING BUT signature failures.
    Sentry.captureMessage('stripe_connect_signature_verification_failed', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
    });
    return new Response('Signature verification failed', { status: 400 });
  }

  // 4. Fused claim. The row is born CLAIMED, so "recorded before any state
  //    mutation" holds literally on every path below.
  const claimResult = await claimWebhookEvent({
    eventId: event.id,
    type: event.type,
    account: event.account ?? null,
    livemode: event.livemode,
  });

  let claim: Claim;

  if (claimResult.claimed) {
    claim = { id: claimResult.id, attempts: claimResult.attempts };
  } else {
    // 5. Duplicate delivery.
    const stored = await readWebhookEvent(event.id);
    if (!stored) {
      // Raced with a delete that does not exist in this codebase; treat as
      // retryable rather than inventing a state.
      return retryLater();
    }

    if ((stored.account ?? null) !== (event.account ?? null)) {
      Sentry.captureMessage('stripe_connect_event_account_mismatch', {
        level: 'error',
        tags: { webhook: 'stripe-connect' },
        extra: { eventId: event.id },
      });
      return ok();
    }

    if (isTerminalStatus(stored.status)) {
      return ok();
    }

    const now = new Date();
    const staleCutoff = new Date(now.getTime() - CLAIM_STALE_AFTER_MS);
    const dueRetry = stored.status === 'failed_retryable'
      && stored.availableAt !== null
      && stored.availableAt.getTime() <= now.getTime();
    const staleClaim = stored.status === 'processing'
      && stored.updatedAt.getTime() < staleCutoff.getTime();

    if (!dueRetry && !staleClaim) {
      // Fresh `processing`, or a retry that is not yet due.
      return retryLater();
    }

    const reclaimedAttempts = await reclaimWebhookEvent({
      id: stored.id,
      now,
      staleCutoff,
    });
    if (reclaimedAttempts === null) {
      // Another worker won the reclaim. Do not dispatch.
      return retryLater();
    }
    // The fencing token for THIS delivery is the value the reclaim returned —
    // never recomputed, never assumed to be 1.
    claim = { id: stored.id, attempts: reclaimedAttempts };
  }

  // 6. This delivery owns the event. Dispatch.
  try {
    return await dispatch(event, claim, expected);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { webhook: 'stripe-connect', event_type: event.type },
      extra: { eventId: event.id },
    });
    // Transient by default, with NO attempts cap and no D2-side terminal: these
    // rows converge when Stripe abandons the delivery, and afterwards on a later
    // PR's reconcile sweep, which owns the generic escalation.
    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: null,
      lastError: 'handler_exception',
      availableAt: new Date(Date.now() + unboundBackoffMs(claim.attempts)),
    });
    return retryLater();
  }
}

async function dispatch(
  event: Stripe.Event,
  claim: Claim,
  expected: boolean,
): Promise<Response> {
  // Safe disable. This REPLACES "blank the secret to disable": the receipt layer
  // must never be switchable off, because Stripe never redelivers a 2xx-acked
  // event and events older than 3 days are simply gone. Here the event stays
  // verified, persisted and retryable, and re-dispatches when re-enabled.
  if (Env.DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED === 'false') {
    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'disabled_by_flag',
      availableAt: new Date(Date.now() + 60 * 60_000),
    });
    return ok();
  }

  // Event-level mode gate.
  if (event.livemode !== expected) {
    if (!livemodeAlertEmitted) {
      livemodeAlertEmitted = true;
      Sentry.captureMessage('stripe_connect_ignored_livemode', {
        level: 'warning',
        tags: { webhook: 'stripe-connect' },
        extra: { eventId: event.id },
      });
    }
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_livemode',
    });
    return ok();
  }

  const account = event.account;
  if (!account) {
    // Without this guard the binding lookup would execute with `undefined`.
    Sentry.captureMessage('stripe_connect_non_connect_scope', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId: event.id, eventType: event.type },
    });
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_non_connect_scope',
    });
    return ok();
  }

  if (event.type === 'account.updated') {
    return handleAccountUpdated(event, claim, account, expected);
  }

  if (event.type === 'account.application.deauthorized') {
    return handleDeauthorized(event, claim, account);
  }

  await finalizeTerminal({
    id: claim.id,
    attempts: claim.attempts,
    outcome: 'ignored_unhandled',
  });
  return ok();
}

async function handleAccountUpdated(
  event: Stripe.Event,
  claim: Claim,
  account: string,
  expected: boolean,
): Promise<Response> {
  const bindings = await getBindingsByStripeAccountId(account);

  if (bindings.length === 0) {
    // A REAL window inside D2: `accounts.create` returns at t0 and the binding
    // INSERT lands at t0+Δ. Never terminal-ignore this on the first delivery.
    if (claim.attempts >= UNBOUND_MAX_ATTEMPTS) {
      Sentry.captureMessage('stripe_connect_unbound_unresolved', {
        level: 'error',
        tags: { webhook: 'stripe-connect' },
        extra: { eventId: event.id, account },
      });
      await finalizeTerminal({
        id: claim.id,
        attempts: claim.attempts,
        outcome: 'unbound_unresolved',
      });
      return ok();
    }
    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'unbound_account',
      availableAt: new Date(Date.now() + unboundBackoffMs(claim.attempts)),
    });
    return retryLater();
  }

  const live = bindings.find(binding => binding.revokedAt === null);

  if (!live) {
    // Without this arm an `account.updated` arriving after a deauthorization
    // would drive `accounts.retrieve` against an account we can no longer read →
    // exception → 500 → three days of retries with no cap and no alert.
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_revoked_binding',
    });
    return ok();
  }

  if (live.livemode !== expected) {
    // ROW-level discriminator. The event-level gate above compares
    // `event.livemode` and has already passed. `failed_retryable` is the one
    // wrong answer here: a retry cannot change a stored column, so it would buy
    // three days of pointless redeliveries on an event that can never converge.
    // The literal is REUSED, not minted; `last_error` is what lets a runbook
    // separate this population from the event-level gate.
    Sentry.captureMessage('stripe_connect_mode_mismatch', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId: event.id, bindingId: live.id },
    });
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_livemode',
      lastError: 'binding_livemode_mismatch',
    });
    return ok();
  }

  try {
    await syncAccountReadiness(live);
  } catch (error) {
    if (
      error instanceof StripeConnectUnavailableError
      && error.code === 'PROVIDER_PERMANENT'
    ) {
      // Retrying cannot help: we can no longer act on this account. The audit
      // row and the owner alert fire inside `revokeBinding`, and only when its
      // CAS affects exactly one row (rule W-SE), so a redelivery cannot re-emit
      // them.
      await revokeBinding(live.id, 'deauthorized', {
        actorId: 'system:stripe-connect-webhook',
        viaSuperAdminWithoutMembership: false,
        salonId: live.salonId,
        stripeAccountId: live.stripeAccountId,
        matchStripeAccountId: account,
      });
      await finalizeTerminal({
        id: claim.id,
        attempts: claim.attempts,
        outcome: 'permanent_provider_error',
      });
      return ok();
    }
    // Transient. No cap: bounded by Stripe's retry horizon, not by D2.
    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: null,
      lastError: 'provider_unreachable',
      availableAt: new Date(Date.now() + unboundBackoffMs(claim.attempts)),
    });
    return retryLater();
  }

  await finalizeWebhookEvent({
    id: claim.id,
    attempts: claim.attempts,
    status: 'processed',
    outcome: 'processed',
    processedAt: new Date(),
  });
  return ok();
}

async function handleDeauthorized(
  event: Stripe.Event,
  claim: Claim,
  account: string,
): Promise<Response> {
  // Resolve ALL rows first, then branch THREE ways. Do not collapse the last two.
  const bindings = await getBindingsByStripeAccountId(account);

  if (bindings.length === 0) {
    // No binding — revoked or otherwise — exists. Terminal, and deliberately NOT
    // `ignored_revoked_binding`: conflating the two populations poisons exactly
    // the runbook query the tenant-anomaly hunt cares about, "events for accounts
    // we have no record of". The asymmetry with `account.updated` is intended:
    // that event's payload becomes applicable the moment a binding INSERT lands,
    // whereas a deauthorization has nothing to apply and nothing to recover.
    Sentry.captureMessage('stripe_connect_unbound_unresolved', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId: event.id, account },
    });
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'unbound_unresolved',
    });
    return ok();
  }

  const live = bindings.find(binding => binding.revokedAt === null);

  if (!live) {
    // There IS a binding and it is already revoked. Nothing to revoke, nothing
    // to retry toward.
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_revoked_binding',
    });
    return ok();
  }

  // Rule W-SE: `revokeBinding` writes the audit row and emits the owner alert
  // ONLY when the CAS affects exactly one row, so every Stripe retry and
  // duplicate delivery after the first is side-effect-free.
  await revokeBinding(live.id, 'deauthorized', {
    actorId: 'system:stripe-connect-webhook',
    viaSuperAdminWithoutMembership: false,
    salonId: live.salonId,
    stripeAccountId: live.stripeAccountId,
    matchStripeAccountId: account,
  });

  await finalizeWebhookEvent({
    id: claim.id,
    attempts: claim.attempts,
    status: 'processed',
    outcome: 'processed',
    processedAt: new Date(),
  });
  return ok();
}
