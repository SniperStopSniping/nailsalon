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

import type { ConfirmDisposition } from '@/libs/deposits/confirmDepositPayment';
import { confirmDepositPayment } from '@/libs/deposits/confirmDepositPayment';
import {
  evaluateProvenance,
  isOverAdmissionCap,
  projectStripeEvent,
} from '@/libs/deposits/depositWebhookEvents';
import { runLateDepositRecovery } from '@/libs/deposits/lateDepositRecovery';
import { Env } from '@/libs/Env';
import { EXPECTED_STRIPE_API_VERSION, stripe } from '@/libs/stripe';
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

/**
 * `refund.failed` / `refund.updated` postdate the pinned SDK's event union, so
 * they are matched as strings rather than through it. The pin is deliberate:
 * a webhook endpoint's `api_version` is fixed at creation and not updatable.
 */
const REFUND_FAILED_EVENT = 'refund.failed';
const REFUND_UPDATED_EVENT = 'refund.updated';

function isRefundEventType(type: string): boolean {
  return type === REFUND_FAILED_EVENT || type === REFUND_UPDATED_EVENT;
}

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
    // TYPE-SCOPED and total by construction: `account.*` deliveries store a
    // NULL projection and never a payload, `checkout.session.*` and `luster.*`
    // store the normalized columns the deposit processors read.
    projection: projectStripeEvent(event, new Date()),
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

  // API VERSION — warn only, never reject. A drifted endpoint version is an
  // operational finding; refusing the event would lose real money over it.
  if (event.api_version && event.api_version !== EXPECTED_STRIPE_API_VERSION) {
    Sentry.captureMessage('stripe_connect_api_version_drift', {
      level: 'warning',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId: event.id, observed: event.api_version },
    });
  }

  if (event.type === 'checkout.session.completed') {
    return handleCheckoutSession(event, claim, account, { expiredEvent: false });
  }

  if (event.type === 'checkout.session.expired') {
    // ONLY a paid payload is evidence here. `no_payment_required` is what a
    // salon's own expired setup, trial and Payment-Link sessions carry, and
    // they must never enter the retry pipeline.
    return handleCheckoutSession(event, claim, account, { expiredEvent: true });
  }

  // Compared as strings: `refund.*` postdates the SDK version this programme
  // pins, and the pin is deliberate (a webhook endpoint's `api_version` is
  // fixed at creation and not updatable), so the union does not name them yet.
  if (isRefundEventType(event.type)) {
    return handleRefundEvent(event, claim);
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

/**
 * The deposit money path: provenance gate, then routine A, then a fenced
 * finalize carrying the disposition into BOTH `status` and `outcome`.
 *
 * The gate that runs first is ADMISSION, not authorization. It answers "is this
 * event plausibly about a Luster deposit on an account we know", and nothing it
 * returns can reach a refund: only a resolved `appointment_deposit` row
 * authorizes an outflow.
 */
async function handleCheckoutSession(
  event: Stripe.Event,
  claim: Claim,
  account: string,
  options: { expiredEvent: boolean },
): Promise<Response> {
  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = session.metadata ?? {};

  // A projection we could not read is RETRYABLE, never foreign. The sweep
  // re-extracts it before anything is allowed to classify it, so a payload we
  // failed to parse is never mistaken for a payload that was not ours.
  const projection = projectStripeEvent(event, new Date());
  if (projection?.projectionStatus === 'failed') {
    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: null,
      lastError: 'projection_failed',
      availableAt: new Date(Date.now() + 60_000),
    });
    return retryLater();
  }

  if (options.expiredEvent && session.payment_status !== 'paid') {
    // Informational. An expired session nobody paid for is the normal end of a
    // lapsed hold, and D4's reaper — not this route — releases the slot.
    await finalizeD5Terminal(claim, 'processed', 'session_expired');
    return ok();
  }

  const provenance = await evaluateProvenance({
    account,
    metadataSalonId: typeof metadata.salon_id === 'string' ? metadata.salon_id : null,
    clientReferenceId: session.client_reference_id ?? null,
  });

  if (!provenance.admitted) {
    // Not ours. Terminal on the FIRST delivery, no retry, no alert, and above
    // all NO REFUND: `client_reference_id` is a documented Payment-Link URL
    // parameter and session metadata is tenant-writable, so anything reachable
    // from here is remotely triggerable by a stranger.
    await finalizeD5Terminal(claim, 'ignored_foreign_session', 'ignored_foreign_session');
    return ok();
  }

  const result = await confirmDepositPayment({
    source: 'webhook',
    connectedAccountId: account,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null,
    paymentStatus: session.payment_status ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    metadataAppointmentId: typeof metadata.appointment_id === 'string' ? metadata.appointment_id : null,
    metadataSalonId: typeof metadata.salon_id === 'string' ? metadata.salon_id : null,
    metadataDepositId: typeof metadata.deposit_id === 'string' ? metadata.deposit_id : null,
  });

  if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
    // OUTSIDE the confirm transaction, by construction: recovery takes the
    // technician advisory lock and may call Stripe.
    const recovery = await runLateDepositRecovery({
      depositId: result.depositId,
      salonId: result.salonId,
    });
    await finalizeD5Terminal(claim, 'processed', recoveryOutcome(recovery.disposition));
    return ok();
  }

  return finalizeConfirmResult(claim, result.disposition, account);
}

/**
 * OBSERVABILITY ONLY, and deliberately so. A refund that reached `failed`
 * against a deposit we already marked `refunded` is money that did not go back;
 * naming it as a terminal makes it queryable, while changing state from here
 * would be guessing at a reconciliation a later packet owns.
 *
 * A later packet REPLACES this handler with its own — two handlers on one event
 * type is a collision, so that packet deletes this one in the same change.
 */
async function handleRefundEvent(event: Stripe.Event, claim: Claim): Promise<Response> {
  const refund = event.data.object as Stripe.Refund;
  const paymentIntentId = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;

  const matched = await findDepositForRefund({ refundId: refund.id, paymentIntentId });

  if (!matched) {
    // A refund on a payment intent that is not ours. Not an incident.
    await finalizeD5Terminal(claim, 'processed', 'ignored_unhandled');
    return ok();
  }

  // `event.type` is widened here for the same reason as above: the pinned
  // SDK's union names `refund.updated` but not yet `refund.failed`.
  if ((event.type as string) === REFUND_FAILED_EVENT || refund.status === 'failed') {
    Sentry.captureMessage('deposit_refund_failed_unreconciled', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId: event.id, depositId: matched },
    });
    await finalizeD5Terminal(claim, 'processed', 'refund_failed_unreconciled');
    return ok();
  }

  await finalizeD5Terminal(claim, 'processed', 'ignored_unhandled');
  return ok();
}

async function findDepositForRefund(input: {
  refundId: string;
  paymentIntentId: string | null;
}): Promise<string | null> {
  const { db } = await import('@/libs/DB');
  const { appointmentDepositSchema } = await import('@/models/Schema');
  const { eq, or } = await import('drizzle-orm');

  const [row] = await db
    .select({ id: appointmentDepositSchema.id })
    .from(appointmentDepositSchema)
    .where(or(
      eq(appointmentDepositSchema.stripeRefundId, input.refundId),
      input.paymentIntentId
        ? eq(appointmentDepositSchema.stripePaymentIntentId, input.paymentIntentId)
        : undefined,
    ))
    .limit(1);

  return row?.id ?? null;
}

/**
 * Maps a confirm disposition onto the event row and the HTTP answer.
 *
 * The two retryable dispositions get DIFFERENT schedules because they are
 * different waits: an unbound account is waiting on a human re-authorizing,
 * measured in hours; a missing deposit row is waiting on a write that is
 * probably already in flight, measured in minutes.
 */
async function finalizeConfirmResult(
  claim: Claim,
  disposition: ConfirmDisposition,
  account: string,
): Promise<Response> {
  switch (disposition) {
    case 'confirmed':
    case 'already_confirmed':
    case 'healed_deposit':
    case 'healed_deposit_late':
      await finalizeD5Terminal(claim, 'processed', disposition);
      return ok();

    case 'unbound_account':
      if (claim.attempts >= UNBOUND_MAX_ATTEMPTS) {
        await finalizeD5Terminal(claim, 'unbound_unresolved', 'unbound_unresolved');
        return ok();
      }
      await finalizeRetryable({
        id: claim.id,
        attempts: claim.attempts,
        outcome: 'unbound_account',
        availableAt: new Date(Date.now() + unboundBackoffMs(claim.attempts)),
      });
      return retryLater();

    case 'deferred_no_deposit': {
      // THE ADMISSION CAP, applied before this account is allowed one more live
      // deposit-less row. Without it one account's flood of unresolvable
      // sessions fills every sweep batch and starves every other tenant.
      if (await isOverAdmissionCap(account)) {
        await finalizeD5Terminal(claim, 'ignored_over_cap', 'ignored_over_cap');
        return ok();
      }
      await finalizeRetryable({
        id: claim.id,
        attempts: claim.attempts,
        outcome: 'deferred_no_deposit',
        availableAt: new Date(Date.now() + 60_000),
      });
      return retryLater();
    }

    case 'account_mismatch':
    case 'held_mismatch':
    case 'held_duplicate_session':
    case 'ignored_unpaid':
      // The three manual money terminals plus the unpaid ignore. Each mirrors
      // its literal into BOTH columns, because a cross-route disposition query
      // reads `outcome` and this route's siblings land theirs on `processed`.
      await finalizeD5Terminal(claim, disposition, disposition);
      return ok();

    case 'poisoned':
      await finalizeD5Terminal(claim, 'poisoned', 'poisoned');
      return ok();

    case 'late_recovery_required':
      // Handled by the caller before reaching here.
      await finalizeD5Terminal(claim, 'processed', 'refunded');
      return ok();

    default: {
      const exhaustive: never = disposition;
      throw new Error(`unhandled confirm disposition: ${String(exhaustive)}`);
    }
  }
}

function recoveryOutcome(disposition: string): string {
  switch (disposition) {
    case 'restored':
      return 'restored';
    case 'refunded':
      return 'refunded';
    case 'already_confirmed':
      return 'already_confirmed';
    case 'already_confirmed_late_refund':
      return 'already_confirmed_late_refund';
    default:
      return 'deferred_no_deposit';
  }
}

/**
 * A fenced finalize that writes the SAME literal into `status` and `outcome`
 * for D5's terminals, and the business outcome on a `processed` row.
 *
 * EVERY TERMINAL ROW CARRIES A NON-NULL `outcome`. That mirror is the only
 * reason the disposition vocabulary is complete across both writers of this
 * table: this route's account handlers land every disposition on
 * `status='processed'`, so a query keyed on `status` returns none of them.
 */
async function finalizeD5Terminal(
  claim: Claim,
  status: string,
  outcome: string,
): Promise<void> {
  await finalizeWebhookEvent({
    id: claim.id,
    attempts: claim.attempts,
    status: status as Parameters<typeof finalizeWebhookEvent>[0]['status'],
    outcome: outcome as Parameters<typeof finalizeWebhookEvent>[0]['outcome'],
    processedAt: new Date(),
  });
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
