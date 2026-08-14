import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { confirmDepositPayment, type ConfirmDisposition } from '@/libs/deposits/confirmDepositPayment';
import {
  applyRefundObservation,
  checkDepositSnapshotAccount,
  claimRefundReconcileLease,
} from '@/libs/deposits/depositLifecycle';
import {
  createOrAdoptDepositRefund,
  type DepositRow,
  discoverAndAdoptDepositRefunds,
  type RefundTrigger,
  resolveAllowedSourceStatuses,
} from '@/libs/deposits/depositRefund';
import {
  claimLusterWorkRow,
  claimOrRearmPollEvidenceWorkRow,
  depositIdsWithExcludingEventRows,
  evaluateProvenance,
  isPastOrphanHorizon,
  isStuckPastExpiry,
  pollEvidenceEventId,
  resolveVerifiedOrphanCandidate,
  shouldStripProjection,
  stuckAlertEventId,
} from '@/libs/deposits/depositWebhookEvents';
import {
  DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
  isSweepRetryableRecoveryResult,
  type RecoveryResult,
  runLateDepositRecovery,
} from '@/libs/deposits/lateDepositRecovery';
import { Env } from '@/libs/Env';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import { stripe } from '@/libs/stripe';
import { dispatchAccountWebhook } from '@/libs/stripeConnect/accountWebhookDispatch';
import { expectedLivemode } from '@/libs/stripeConnect/readiness';
import { finalizeRetryable, finalizeWebhookEvent } from '@/libs/stripeConnect/webhookEvents';
import {
  appointmentDepositSchema,
  appointmentSchema,
  stripeWebhookEventSchema,
} from '@/models/Schema';

/**
 * THE RECONCILE SWEEP — the convergence path that does not depend on Stripe
 * redelivering anything.
 *
 * Stripe abandons a delivery after roughly three days and never redelivers an
 * event the endpoint 2xx-acked, so the webhook is a fast path, not a guarantee.
 * Two of the drivers here are STATE-driven rather than event-driven for exactly
 * that reason: they start from Luster's own deposit rows and ask the provider,
 * which is the only question that still works when no event ever arrived.
 *
 * THIS ROUTE IS SHARED. A later packet adds refund passes to it and adds no
 * cron entry of its own, so the per-invocation budget is shared and the batch
 * sizes here are chosen against `maxDuration`, not against comfort.
 */

/** Per-pass batch size. Chosen against the budget below, not independently. */
export const RECONCILE_BATCH = 25;

/**
 * `maxDuration` for the shared route, adopting D4's reaper value and rationale
 * rather than inventing a second number.
 *
 * The arithmetic that must hold is
 * `(this packet's batch + later packets' batches) × stripe_timeout < maxDuration`.
 * With a 10 s per-call timeout and passes that make at most one provider call
 * per row, 25 rows is 250 s worst case against 300 s — which is why raising
 * either number without the other is a mistake.
 */
export const RECONCILE_MAX_DURATION_SECONDS = 300;

/** Grace after a hold lapses before the deposit-side scan picks it up. */
const STEP_0_GRACE_MS = 10 * 60_000;

/** A claim older than this belonged to a worker that is not coming back. */
const CLAIM_STALE_MS = 15 * 60_000;

/** Retry exhaustion. */
const POISON_ATTEMPTS = 8;

/** Human re-authorization gets the chartered roughly-three-day hourly lane. */
const UNBOUND_WORK_MAX_ATTEMPTS = 72;

/** Payload retention horizon. */
const PURGE_HORIZON_MS = 14 * 24 * 60 * 60_000;

/** Stored wrong-mode rows are expected occasionally; warn at most hourly. */
const LIVEMODE_ALERT_INTERVAL_MS = 60 * 60_000;
let storedLivemodeAlertedAt = 0;

/** D6 refund-pass maxima. The invocation deadline is the hard shared budget. */
const REFUND_PASS_1_BATCH = 25;
const REFUND_PASS_2_BATCH = 25;
const REFUND_PASS_3_BATCH = 10;
const REFUND_PASS_5_BATCH = 10;
const REFUND_PASS_LEASE_MS = 15 * 60_000;
const REFUND_PASS_PROVIDER_BUDGET_MS = 285 * 1000;

export type ReconcileSummary = {
  step0Scanned: number;
  step0Confirmed: number;
  step0Parked: number;
  step0bScanned: number;
  step0bRecovered: number;
  stuckAlerts: number;
  eventsReclaimed: number;
  eventsRedispatched: number;
  eventsPoisoned: number;
  projectionsPurged: number;
  refundPass1Processed: number;
  refundPass2Processed: number;
  refundPass3Processed: number;
  refundPass5Processed: number;
};

/**
 * Runs every pass, ERROR-ISOLATED.
 *
 * A throw in one pass must not kill the rest: these are independent
 * convergence mechanisms, and losing all of them because one had a bad row is
 * how a backlog becomes permanent.
 */
export async function runDepositReconcile(): Promise<ReconcileSummary> {
  const invocationStartedAt = Date.now();
  const summary: ReconcileSummary = {
    step0Scanned: 0,
    step0Confirmed: 0,
    step0Parked: 0,
    step0bScanned: 0,
    step0bRecovered: 0,
    stuckAlerts: 0,
    eventsReclaimed: 0,
    eventsRedispatched: 0,
    eventsPoisoned: 0,
    projectionsPurged: 0,
    refundPass1Processed: 0,
    refundPass2Processed: 0,
    refundPass3Processed: 0,
    refundPass5Processed: 0,
  };

  await isolate('step0', () => runDepositSideReconcile(summary));
  await isolate('step0b', () => runLateCheck(summary));
  await isolate('stuck', () => alertStuckDeposits(summary));
  await isolate('events', () => runEventRowSteps(summary));
  await runRefundPasses(
    summary,
    invocationStartedAt + REFUND_PASS_PROVIDER_BUDGET_MS,
  );
  await isolate('retention', () => applyRetention(summary));

  // EXACTLY ONE liveness check-in per run, through a mockable seam. The cron
  // guard returns a `Response.json` rather than throwing, so a 401 or a 500
  // reaches no error pipeline — every alarm this sweep owns lives inside the
  // process that would be the thing that stalled.
  emitLivenessCheckIn();

  return summary;
}

async function isolate(pass: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    Sentry.captureException(error, {
      tags: { deposits: 'reconcile', pass },
    });
  }
}

/** The out-of-band monitor's in-band half. Mockable so a test can count it. */
export function emitLivenessCheckIn(): void {
  Sentry.captureMessage('deposit_reconcile_run', {
    level: 'info',
    tags: { deposits: 'reconcile' },
  });
}

// =============================================================================
// STEP 0 — THE DEPOSIT-SIDE DRIVER
// =============================================================================

/**
 * Deposits still `checkout_created` past their hold expiry, whose event row
 * never arrived or was terminal-ignored.
 *
 * SCOPE: there is deliberately no `salon_id` term in this scan. It is a
 * platform-wide cron pass with no salon context to bind — satisfying a phantom
 * salon term would force per-salon iteration and break the global oldest-first
 * fairness. Tenant scope holds the way it does everywhere else in this route:
 * platform-wide discovery, and every per-row statement carries that row's own
 * `salon_id`.
 */
async function runDepositSideReconcile(summary: ReconcileSummary): Promise<void> {
  const candidates = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
      sessionId: appointmentDepositSchema.stripeCheckoutSessionId,
      account: appointmentDepositSchema.stripeAccountId,
      holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
    })
    .from(appointmentDepositSchema)
    .innerJoin(appointmentSchema, and(
      eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
      eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
    ))
    .where(and(
      eq(appointmentDepositSchema.status, 'checkout_created'),
      isNotNull(appointmentDepositSchema.stripeCheckoutSessionId),
      lt(appointmentSchema.depositHoldExpiresAt, new Date(Date.now() - STEP_0_GRACE_MS)),
    ))
    .orderBy(asc(appointmentSchema.depositHoldExpiresAt))
    .limit(RECONCILE_BATCH);

  // EXCLUSION: a LIVE row means the event machinery owns this deposit on its
  // own schedule; a MANUAL terminal means it has concluded and re-entry is an
  // operator decision. `processed` and `ignored_*` deliberately do NOT exclude
  // — rescuing those is this scan's entire purpose.
  const excluded = await depositIdsWithExcludingEventRows(
    candidates.map(row => ({ depositId: row.id, sessionId: row.sessionId })),
  );

  for (const candidate of candidates) {
    if (excluded.has(candidate.id) || !candidate.sessionId) {
      continue;
    }
    summary.step0Scanned += 1;
    await reconcileOneDeposit(candidate, summary);
  }
}

async function reconcileOneDeposit(
  candidate: {
    id: string;
    salonId: string;
    sessionId: string | null;
    account: string;
  },
  summary: ReconcileSummary,
): Promise<void> {
  if (!candidate.sessionId) {
    return;
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(candidate.sessionId, {
      // The SNAPSHOT. This row is Luster's own, so it needs no event, no
      // provenance and no metadata to be trusted.
      stripeAccount: candidate.account,
      timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
    });
  } catch (error) {
    await parkRetrievalFailure(candidate, error, summary);
    return;
  }

  if (session.payment_status !== 'paid') {
    if (session.status === 'complete') {
      // A COMPLETE session that is not paid — an async payment method still
      // settling. "Leave it for the reaper" does not work: the reaper never
      // touches a complete session, so this deposit would be re-retrieved every
      // five minutes forever. Park it on a work row so the exclusion applies.
      await parkWorkRow(candidate, {
        outcome: 'awaiting_async_payment',
        availableAt: new Date(Date.now() + 60 * 60_000),
      }, sessionProjection(session));
      summary.step0Parked += 1;
    }
    // `open` and `expired` sessions are D4's reaper's business, not ours.
    return;
  }

  const projection = sessionProjection(session);
  const result = await confirmDepositPayment({
    source: 'sweep_deposit',
    connectedAccountId: candidate.account,
    sessionId: candidate.sessionId,
    ...projection,
  });

  if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
    const recovery = await runLateDepositRecovery({ depositId: result.depositId, salonId: result.salonId });
    if (isSweepRetryableRecoveryResult(recovery)) {
      await parkWorkRow(candidate, recoveryRetrySchedule(recovery), projection);
      summary.step0Parked += 1;
    } else {
      summary.step0Confirmed += 1;
    }
    return;
  }

  if (isConvergedDisposition(result.disposition)) {
    summary.step0Confirmed += 1;
    return;
  }

  // NON-CONVERGING. Park it on a durable work row so it does not re-drive at
  // cron frequency, on the schedule its class deserves.
  await parkWorkRow(candidate, dispositionSchedule(result.disposition), projection);
  summary.step0Parked += 1;
}

function sessionProjection(
  session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>,
) {
  const metadata = session.metadata ?? {};
  return {
    paymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null,
    paymentStatus: session.payment_status ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    metadataAppointmentId: metadata.appointment_id ?? null,
    metadataSalonId: metadata.salon_id ?? null,
    metadataDepositId: metadata.deposit_id ?? null,
    clientReferenceId: session.client_reference_id ?? null,
  };
}

function isConvergedDisposition(disposition: ConfirmDisposition): boolean {
  return disposition === 'confirmed'
    || disposition === 'already_confirmed'
    || disposition === 'healed_deposit'
    || disposition === 'healed_deposit_late'
    || disposition === 'ignored_unpaid';
}

function dispositionSchedule(disposition: ConfirmDisposition): {
  outcome: string;
  availableAt?: Date;
  terminalStatus?: string;
} {
  switch (disposition) {
    case 'unbound_account':
      // Hourly, because what it waits on is a human re-authorizing.
      return { outcome: 'unbound_account', availableAt: new Date(Date.now() + 60 * 60_000) };
    case 'held_mismatch':
    case 'account_mismatch':
      // MANUAL money terminals. Durable so the runbook query returns them, and
      // so this deposit leaves the scan instead of re-alerting every five
      // minutes.
      return { outcome: disposition, terminalStatus: disposition };
    default:
      return { outcome: 'deferred_no_deposit', availableAt: new Date(Date.now() + 60_000) };
  }
}

function recoveryRetrySchedule(recovery: RecoveryResult): {
  outcome: string;
  availableAt: Date;
  lastError: string;
} {
  return {
    outcome: 'deferred_no_deposit',
    availableAt: new Date(Date.now() + 60_000),
    lastError: recovery.note ?? 'recovery_retryable',
  };
}

/**
 * Classifies every retrieval failure onto a durable lane. Leaving transient
 * failures rowless would return the deposit to Step 0 on every cron run and
 * create an unbounded provider loop; the poll row instead supplies backoff,
 * fencing and the ordinary poison ceiling.
 */
async function parkRetrievalFailure(
  candidate: { id: string; salonId: string; sessionId: string | null; account: string },
  error: unknown,
  summary: ReconcileSummary,
): Promise<void> {
  const failure = classifyRetrievalFailure(error);
  await parkWorkRow(candidate, failure === 'unbound_account'
    ? {
        outcome: 'unbound_account',
        lastError: failure,
        availableAt: new Date(Date.now() + 60 * 60_000),
      }
    : {
        outcome: 'deferred_no_deposit',
        lastError: failure,
        availableAt: new Date(Date.now() + 60_000),
      });
  summary.step0Parked += 1;
}

/**
 * The synthetic work row. ALWAYS carries `session_id` and the deposit id, even
 * when the retrieval returned nothing: the exclusion join matches on exactly
 * those two columns, so a row missing them fails to suppress the rescan it
 * exists to suppress.
 */
async function parkWorkRow(
  candidate: { id: string; salonId: string; sessionId: string | null; account: string },
  schedule: { outcome: string; availableAt?: Date; terminalStatus?: string; lastError?: string },
  projection?: ReturnType<typeof sessionProjection>,
): Promise<void> {
  if (!candidate.sessionId) {
    return;
  }

  const claim = await claimOrRearmPollEvidenceWorkRow({
    eventId: pollEvidenceEventId(candidate.id),
    account: candidate.account,
    livemode: false,
    salonId: candidate.salonId,
    sessionId: candidate.sessionId,
    depositId: candidate.id,
    projection,
  });

  if (!claim.claimed) {
    // A concurrent poll or an earlier run already owns the lease.
    return;
  }

  if (schedule.terminalStatus) {
    await finalizeWebhookEvent({
      id: claim.id,
      attempts: claim.attempts,
      status: schedule.terminalStatus as Parameters<typeof finalizeWebhookEvent>[0]['status'],
      outcome: schedule.outcome as Parameters<typeof finalizeWebhookEvent>[0]['outcome'],
      processedAt: new Date(),
    });
    return;
  }

  await finalizeRetryable({
    id: claim.id,
    attempts: claim.attempts,
    outcome: schedule.outcome as Parameters<typeof finalizeRetryable>[0]['outcome'],
    lastError: schedule.lastError,
    availableAt: schedule.availableAt ?? new Date(Date.now() + 60_000),
  });
}

// =============================================================================
// STEP 0b — THE ONE-SHOT LATE CHECK
// =============================================================================

/**
 * Deposits the reaper already finalize-expired, probed EXACTLY ONCE.
 *
 * NO RECENCY HORIZON. `late_check_done_at` is the bound, and it is a marker
 * rather than a window on purpose: a shared seven-day horizon would age a row
 * out of this scan and out of the manual runbook query at the same instant, so
 * a sweep outage would silently delete its own follow-up work.
 */
async function runLateCheck(summary: ReconcileSummary): Promise<void> {
  const candidates = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
      sessionId: appointmentDepositSchema.stripeCheckoutSessionId,
      account: appointmentDepositSchema.stripeAccountId,
    })
    .from(appointmentDepositSchema)
    .where(and(
      inArray(appointmentDepositSchema.status, ['expired', 'canceled']),
      isNotNull(appointmentDepositSchema.stripeCheckoutSessionId),
      isNull(appointmentDepositSchema.stripeRefundId),
      isNull(appointmentDepositSchema.lateCheckDoneAt),
    ))
    .orderBy(asc(appointmentDepositSchema.updatedAt))
    .limit(RECONCILE_BATCH);

  const excluded = await depositIdsWithExcludingEventRows(
    candidates.map(row => ({ depositId: row.id, sessionId: row.sessionId })),
  );

  for (const candidate of candidates) {
    if (excluded.has(candidate.id) || !candidate.sessionId) {
      continue;
    }
    summary.step0bScanned += 1;

    let paid = false;
    let retrievedSession: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>> | null = null;
    try {
      retrievedSession = await stripe.checkout.sessions.retrieve(candidate.sessionId, {
        stripeAccount: candidate.account,
        timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
      });
      paid = retrievedSession.payment_status === 'paid';
    } catch (error) {
      await parkRetrievalFailure(candidate, error, summary);
      continue;
    }

    if (paid) {
      const recovery = await runLateDepositRecovery({ depositId: candidate.id, salonId: candidate.salonId });
      if (isSweepRetryableRecoveryResult(recovery)) {
        await parkWorkRow(
          candidate,
          recoveryRetrySchedule(recovery),
          retrievedSession ? sessionProjection(retrievedSession) : undefined,
        );
      } else {
        summary.step0bRecovered += 1;
      }
      continue;
    }

    // Nobody paid. Mark it and never probe again — this is the whole point of
    // a one-shot check.
    await db
      .update(appointmentDepositSchema)
      .set({ lateCheckDoneAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(appointmentDepositSchema.id, candidate.id),
        eq(appointmentDepositSchema.salonId, candidate.salonId),
      ));
  }
}

// =============================================================================
// STUCK-DEPOSIT TRIPWIRE
// =============================================================================

/**
 * One alert per stuck deposit, EVER, via a durable marker.
 *
 * Each cron invocation is a fresh process, so an in-memory set would alert
 * every five minutes forever. The marker row is terminal at insert, is never
 * dispatched, and deliberately does NOT exclude the deposit from the scans —
 * alerting and reconciling are different jobs.
 */
async function alertStuckDeposits(summary: ReconcileSummary): Promise<void> {
  const stuck = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
      account: appointmentDepositSchema.stripeAccountId,
      sessionId: appointmentDepositSchema.stripeCheckoutSessionId,
      holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
    })
    .from(appointmentDepositSchema)
    .innerJoin(appointmentSchema, and(
      eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
      eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
    ))
    .where(and(
      eq(appointmentDepositSchema.status, 'checkout_created'),
      eq(appointmentSchema.status, 'awaiting_payment'),
      lt(appointmentSchema.depositHoldExpiresAt, new Date(Date.now() - 2 * 60 * 60_000)),
    ))
    .limit(RECONCILE_BATCH);

  for (const deposit of stuck) {
    if (!isStuckPastExpiry(deposit.holdExpiresAt)) {
      continue;
    }
    const claim = await claimLusterWorkRow({
      eventId: stuckAlertEventId(deposit.id),
      type: 'luster.stuck_alert',
      account: deposit.account,
      livemode: false,
      salonId: deposit.salonId,
      sessionId: deposit.sessionId,
      depositId: deposit.id,
      bornTerminal: { status: 'processed', outcome: 'deferred_no_deposit' },
    });

    if (claim.claimed) {
      Sentry.captureMessage('deposit_stuck_past_expiry', {
        level: 'error',
        tags: { deposits: 'reconcile' },
        extra: { depositId: deposit.id, salonId: deposit.salonId },
      });
      summary.stuckAlerts += 1;
    }
  }
}

// =============================================================================
// EVENT-ROW STEPS
// =============================================================================

/**
 * Reclaim abandoned claims, then re-run due retries with PER-ACCOUNT FAIR SHARE.
 *
 * There is NO `received` reclaim clause: `received` is not a status, and
 * 0065's named CHECK makes the literal unwritable, so a writer of it would get
 * a 23514 at insert time.
 *
 * Fair share exists because global oldest-first lets one account's flood of
 * unresolvable rows fill every batch and starve every other tenant's
 * convergence indefinitely.
 */
async function runEventRowSteps(summary: ReconcileSummary): Promise<void> {
  const reclaimed = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'failed_retryable',
      lastError: 'WORKER_INTERRUPTED',
      availableAt: new Date(),
      // Written EXPLICITLY. Under an app-maintained `updated_at` election
      // nothing else in this packet writes that column on this table, and the
      // reclaim's single-winner property IS `updated_at` moving past the
      // cutoff. Redundant under the trigger election, load-bearing under the
      // other, and harmless either way.
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(stripeWebhookEventSchema.status, 'processing'),
      lt(stripeWebhookEventSchema.updatedAt, new Date(Date.now() - CLAIM_STALE_MS)),
    ))
    .returning();

  summary.eventsReclaimed = reclaimed.length;

  const due = await db
    .select()
    .from(stripeWebhookEventSchema)
    .where(and(
      eq(stripeWebhookEventSchema.status, 'failed_retryable'),
      lte(stripeWebhookEventSchema.availableAt, new Date()),
    ))
    .orderBy(asc(stripeWebhookEventSchema.receivedAt))
    .limit(RECONCILE_BATCH * 4);

  const accounts = new Set(due.map(row => row.account ?? 'platform'));
  const perAccount = Math.max(1, Math.ceil(RECONCILE_BATCH / Math.max(1, accounts.size)));
  const taken = new Map<string, number>();
  const selected: typeof due = [];

  for (const row of due) {
    const key = row.account ?? 'platform';
    const used = taken.get(key) ?? 0;
    if (used >= perAccount || selected.length >= RECONCILE_BATCH) {
      continue;
    }
    taken.set(key, used + 1);
    selected.push(row);
  }

  for (const row of selected) {
    await redispatch(row, summary);
  }
}

async function redispatch(
  row: typeof stripeWebhookEventSchema.$inferSelect,
  summary: ReconcileSummary,
): Promise<void> {
  const claimed = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'processing',
      attempts: sql`${stripeWebhookEventSchema.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, row.id),
      eq(stripeWebhookEventSchema.status, 'failed_retryable'),
    ))
    .returning();

  const claim = claimed[0];
  if (!claim) {
    return;
  }

  // D2 owns `account.*` for its entire lifetime, including retries driven by
  // this sweep. It deliberately has no generic poison cap; sending its NULL
  // Checkout projection into routine A changes both the owner and the backoff.
  if (row.type.startsWith('account.')) {
    // Preserve D2's receipt-layer safe disable. A disabled account event stays
    // owned by its original retry lane and is not reclassified by routine A.
    if (Env.DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED === 'false') {
      await finalizeRetryable({
        id: row.id,
        attempts: claim.attempts,
        outcome: 'disabled_by_flag',
        availableAt: new Date(Date.now() + 60 * 60_000),
      });
      return;
    }
    let expected: boolean;
    try {
      expected = expectedLivemode();
    } catch {
      await finalizeRetryable({
        id: row.id,
        attempts: claim.attempts,
        outcome: row.outcome as Parameters<typeof finalizeRetryable>[0]['outcome'],
        lastError: 'mode_indeterminate',
        availableAt: new Date(Date.now() + 60_000),
      });
      return;
    }
    // This is the stored equivalent of D2's event-level mode gate. It must run
    // before the row-level binding discriminator and before any provider call.
    if (row.livemode !== expected) {
      const now = Date.now();
      if (now - storedLivemodeAlertedAt >= LIVEMODE_ALERT_INTERVAL_MS) {
        storedLivemodeAlertedAt = now;
        Sentry.captureMessage('stripe_connect_ignored_livemode', {
          level: 'warning',
          tags: { webhook: 'stripe-connect', source: 'reconcile' },
          extra: { eventId: row.eventId },
        });
      }
      await finalizeWebhookEvent({
        id: row.id,
        attempts: claim.attempts,
        status: 'processed',
        outcome: 'ignored_livemode',
        processedAt: new Date(),
      });
      return;
    }
    if (!row.account) {
      Sentry.captureMessage('stripe_connect_non_connect_scope', {
        level: 'error',
        tags: { webhook: 'stripe-connect', source: 'reconcile' },
        extra: { eventId: row.eventId, eventType: row.type },
      });
      await finalizeWebhookEvent({
        id: row.id,
        attempts: claim.attempts,
        status: 'processed',
        outcome: 'ignored_non_connect_scope',
        processedAt: new Date(),
      });
      return;
    }
    const result = await dispatchAccountWebhook({
      type: row.type,
      eventId: row.eventId,
      account: row.account,
      claim: { id: row.id, attempts: claim.attempts },
      expectedLivemode: expected,
    });
    if (result === 'ok') {
      summary.eventsRedispatched += 1;
    } else if (result === 'unhandled') {
      await finalizeWebhookEvent({
        id: row.id,
        attempts: claim.attempts,
        status: 'processed',
        outcome: 'ignored_unhandled',
        processedAt: new Date(),
      });
      summary.eventsRedispatched += 1;
    }
    return;
  }

  const longUnboundLane = row.outcome === 'unbound_account';
  if (longUnboundLane && claim.attempts >= UNBOUND_WORK_MAX_ATTEMPTS) {
    Sentry.captureMessage('deposit_event_unbound_unresolved', {
      level: 'error',
      tags: { deposits: 'reconcile' },
      extra: { eventId: row.eventId, attempts: claim.attempts },
    });
    await finalizeWebhookEvent({
      id: row.id,
      attempts: claim.attempts,
      status: 'unbound_unresolved',
      outcome: 'unbound_unresolved',
      processedAt: new Date(),
    });
    return;
  }

  if (!longUnboundLane && claim.attempts >= POISON_ATTEMPTS) {
    if (await finalizeExhaustedDeferredOrphan(row, claim.attempts, summary)) {
      return;
    }
    await poisonEvent(row, claim.attempts, summary);
    return;
  }

  // RE-DISPATCHED BY STORED TYPE through the same routing table live deliveries
  // use, never straight into the confirm routine. A stale owner-refund intent
  // dispatched into the default-gated procedure would see `paid`, finalize
  // `already_confirmed`, and PERMANENTLY consume its event id — after which
  // that refund can never be retried.
  if (row.type === 'luster.refund_intent' || row.type === 'luster.owner_refund_intent') {
    if (!row.metadataDepositId || !row.salonId) {
      await finalizeRetryable({
        id: row.id,
        attempts: claim.attempts,
        outcome: 'deferred_no_deposit',
        lastError: 'refund_intent_context_missing',
        availableAt: new Date(Date.now() + 60_000),
      });
      return;
    }
    const [deposit] = await db
      .select()
      .from(appointmentDepositSchema)
      .where(and(
        eq(appointmentDepositSchema.id, row.metadataDepositId),
        eq(appointmentDepositSchema.salonId, row.salonId),
      ))
      .limit(1);
    if (!deposit) {
      await finalizeRetryable({
        id: row.id,
        attempts: claim.attempts,
        outcome: 'deferred_no_deposit',
        lastError: 'refund_intent_deposit_missing',
        availableAt: new Date(Date.now() + 60_000),
      });
      return;
    }
    const trigger = normalizeRefundTrigger(deposit.refundTrigger);
    await createOrAdoptDepositRefund(
      deposit,
      trigger === 'owner' ? 'owner' : 'slot_lost',
      {
        trigger,
        allowedSourceStatuses: resolveAllowedSourceStatuses(deposit),
        workClaim: {
          id: row.id,
          eventId: row.eventId,
          attempts: claim.attempts,
        },
      },
    );
    summary.eventsRedispatched += 1;
    return;
  }

  if (row.type === 'luster.poll_evidence') {
    await redispatchPollEvidence(row, claim.attempts, summary);
    return;
  }

  if (!row.sessionId || !row.account) {
    await finalizeRetryable({
      id: row.id,
      attempts: claim.attempts,
      outcome: 'deferred_no_deposit',
      availableAt: new Date(Date.now() + 60_000),
    });
    return;
  }

  await finalizeConfirmWorkResult(
    row,
    claim.attempts,
    await confirmFromStoredEvent(row),
    summary,
  );
}

async function confirmFromStoredEvent(row: typeof stripeWebhookEventSchema.$inferSelect) {
  if (!row.sessionId || !row.account) {
    return { disposition: 'deferred_no_deposit' as const };
  }
  return confirmDepositPayment({
    // The STORED account column, never the deposit snapshot: sourcing it from
    // the snapshot collapses the four-leg match into a self-comparison.
    source: 'sweep_event',
    connectedAccountId: row.account,
    sessionId: row.sessionId,
    paymentIntentId: row.paymentIntentId,
    paymentStatus: row.paymentStatus,
    amountTotal: row.amountTotal,
    currency: row.currency,
    metadataAppointmentId: row.metadataAppointmentId,
    metadataSalonId: row.metadataSalonId,
    metadataDepositId: row.metadataDepositId,
  });
}

async function finalizeExhaustedDeferredOrphan(
  row: typeof stripeWebhookEventSchema.$inferSelect,
  attempts: number,
  summary: ReconcileSummary,
): Promise<boolean> {
  if (
    !row.type.startsWith('checkout.session.')
    || row.outcome !== 'deferred_no_deposit'
    || row.projectionStatus !== 'ok'
    || !row.account
  ) {
    return false;
  }

  const provenance = await evaluateProvenance({
    account: row.account,
    metadataSalonId: row.metadataSalonId,
    clientReferenceId: row.clientReferenceId,
  });

  if (!provenance.admitted) {
    // Admission is re-evaluated at the money-dark boundary. A foreign Session
    // is not a poisoned Luster payment and must not fire a critical.
    await finalizeWebhookEvent({
      id: row.id,
      attempts,
      status: 'ignored_foreign_session',
      outcome: 'ignored_foreign_session',
      processedAt: new Date(),
    });
    return true;
  }

  if (!isPastOrphanHorizon(row.receivedAt)) {
    await finalizeRetryable({
      id: row.id,
      attempts,
      outcome: 'deferred_no_deposit',
      lastError: 'orphan_horizon_pending',
      availableAt: new Date(Math.max(
        Date.now() + 60_000,
        row.receivedAt.getTime() + 90 * 60_000 + 1,
      )),
    });
    return true;
  }

  // One final ordinary dispatch: a deposit that appeared at the boundary must
  // converge normally rather than being labelled an orphan.
  const result = await confirmFromStoredEvent(row);
  if (result.disposition !== 'deferred_no_deposit') {
    await finalizeConfirmWorkResult(row, attempts, result, summary);
    return true;
  }

  const candidate = await resolveVerifiedOrphanCandidate({
    metadataDepositId: row.metadataDepositId,
    provenanceSalonId: provenance.salonId,
    account: row.account,
  });
  Sentry.captureMessage('deposit_orphan_unresolved', {
    level: 'error',
    tags: { deposits: 'reconcile' },
    extra: {
      eventId: row.eventId,
      sessionId: row.sessionId,
      ...(candidate ? { candidateDepositId: candidate.depositId } : {}),
    },
  });
  await finalizeWebhookEvent({
    id: row.id,
    attempts,
    status: 'orphan_unresolved',
    outcome: 'orphan_unresolved',
    processedAt: new Date(),
  });
  summary.eventsRedispatched += 1;
  return true;
}

async function redispatchPollEvidence(
  row: typeof stripeWebhookEventSchema.$inferSelect,
  attempts: number,
  summary: ReconcileSummary,
): Promise<void> {
  if (!row.metadataDepositId || !row.salonId) {
    await finalizeRetryable({
      id: row.id,
      attempts,
      outcome: 'deferred_no_deposit',
      lastError: 'poll_deposit_context_missing',
      availableAt: new Date(Date.now() + 60_000),
    });
    return;
  }

  const [deposit] = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
      account: appointmentDepositSchema.stripeAccountId,
      sessionId: appointmentDepositSchema.stripeCheckoutSessionId,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, row.metadataDepositId),
      eq(appointmentDepositSchema.salonId, row.salonId),
    ))
    .limit(1);

  if (!deposit?.sessionId) {
    await finalizeRetryable({
      id: row.id,
      attempts,
      outcome: 'deferred_no_deposit',
      lastError: 'poll_deposit_absent',
      availableAt: new Date(Date.now() + 60_000),
    });
    return;
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(deposit.sessionId, {
      stripeAccount: deposit.account,
      timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
    });
  } catch (error) {
    const failure = classifyRetrievalFailure(error);
    await finalizeRetryable({
      id: row.id,
      attempts,
      outcome: failure === 'unbound_account' ? 'unbound_account' : 'deferred_no_deposit',
      lastError: failure,
      availableAt: new Date(Date.now() + (
        failure === 'unbound_account' ? 60 * 60_000 : 60_000
      )),
    });
    return;
  }

  if (session.payment_status !== 'paid') {
    // Keep ownership on the durable hourly lane. Finalizing this `processed`
    // would return the deposit to Step 0 and recreate a five-minute loop while
    // the stable event id prevents a new lease from being inserted.
    await finalizeRetryable({
      id: row.id,
      attempts,
      outcome: 'awaiting_async_payment',
      availableAt: new Date(Date.now() + 60 * 60_000),
    });
    return;
  }

  const projection = sessionProjection(session);
  const result = await confirmDepositPayment({
    source: 'sweep_deposit',
    connectedAccountId: deposit.account,
    sessionId: deposit.sessionId,
    ...projection,
  });
  await finalizeConfirmWorkResult(row, attempts, result, summary);
}

function classifyRetrievalFailure(error: unknown): 'provider_transient' | 'unbound_account' | 'provider_permanent' {
  const code = (error as { code?: string })?.code;
  const statusCode = (error as { statusCode?: number })?.statusCode ?? 0;
  if (statusCode === 429 || statusCode >= 500 || !code) {
    return 'provider_transient';
  }
  if (code === 'account_invalid' || code === 'application_not_authorized') {
    return 'unbound_account';
  }
  return 'provider_permanent';
}

async function finalizeConfirmWorkResult(
  row: typeof stripeWebhookEventSchema.$inferSelect,
  attempts: number,
  result: Awaited<ReturnType<typeof confirmDepositPayment>>,
  summary: ReconcileSummary,
): Promise<void> {
  if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
    const recovery = await runLateDepositRecovery({
      depositId: result.depositId,
      salonId: result.salonId,
    });
    await finalizeRecoveryWorkResult(row, attempts, recovery, summary);
    return;
  }

  if (isConvergedDisposition(result.disposition)) {
    await finalizeWebhookEvent({
      id: row.id,
      attempts,
      status: 'processed',
      outcome: result.disposition as Parameters<typeof finalizeWebhookEvent>[0]['outcome'],
      processedAt: new Date(),
    });
    summary.eventsRedispatched += 1;
    return;
  }

  const schedule = dispositionSchedule(result.disposition);
  if (schedule.terminalStatus) {
    await finalizeWebhookEvent({
      id: row.id,
      attempts,
      status: schedule.terminalStatus as Parameters<typeof finalizeWebhookEvent>[0]['status'],
      outcome: schedule.outcome as Parameters<typeof finalizeWebhookEvent>[0]['outcome'],
      processedAt: new Date(),
    });
    return;
  }

  await finalizeRetryable({
    id: row.id,
    attempts,
    outcome: schedule.outcome as Parameters<typeof finalizeRetryable>[0]['outcome'],
    availableAt: schedule.availableAt ?? new Date(Date.now() + 60_000),
  });
}

async function finalizeRecoveryWorkResult(
  row: typeof stripeWebhookEventSchema.$inferSelect,
  attempts: number,
  recovery: RecoveryResult,
  summary: ReconcileSummary,
): Promise<void> {
  if (isSweepRetryableRecoveryResult(recovery)) {
    const schedule = recoveryRetrySchedule(recovery);
    await finalizeRetryable({
      id: row.id,
      attempts,
      outcome: 'deferred_no_deposit',
      lastError: schedule.lastError,
      availableAt: schedule.availableAt,
    });
    return;
  }

  let outcome: Parameters<typeof finalizeWebhookEvent>[0]['outcome'];
  switch (recovery.disposition) {
    case 'restored':
    case 'refunded':
    case 'already_confirmed':
    case 'already_confirmed_late_refund':
    case 'refund_failed_unreconciled':
    case 'orphan_unresolved':
      outcome = recovery.disposition;
      break;
    case 'noop':
      // Preserve the pre-existing idempotent refund-intent behaviour for the
      // terminal noop notes; only `payment_intent_unresolved` is retryable.
      outcome = 'refunded';
      break;
    default: {
      const exhaustive: never = recovery.disposition;
      throw new Error(`unhandled recovery disposition: ${String(exhaustive)}`);
    }
  }

  await finalizeWebhookEvent({
    id: row.id,
    attempts,
    status: recovery.disposition === 'orphan_unresolved' ? 'orphan_unresolved' : 'processed',
    outcome,
    processedAt: new Date(),
  });
  summary.eventsRedispatched += 1;
}

async function poisonEvent(
  row: typeof stripeWebhookEventSchema.$inferSelect,
  attempts: number,
  summary: ReconcileSummary,
  lastError?: string,
): Promise<void> {
  Sentry.captureMessage('deposit_event_poisoned', {
    level: 'error',
    tags: { deposits: 'reconcile' },
    extra: { eventId: row.eventId, attempts },
  });
  await finalizeWebhookEvent({
    id: row.id,
    attempts,
    status: 'poisoned',
    outcome: 'poisoned',
    lastError,
    processedAt: new Date(),
  });
  summary.eventsPoisoned += 1;
}

// =============================================================================
// D6 REFUND CONVERGENCE PASSES — ORDINAL 4 IS DELIBERATELY RETIRED
// =============================================================================

type RefundPass = {
  ordinal: 1 | 2 | 3 | 5;
  run: (summary: ReconcileSummary, deadline: number) => Promise<void>;
};

/**
 * Rotate the first pass every five-minute epoch, isolate each pass, and stop
 * admitting provider work before the shared invocation budget is exhausted.
 * A call admitted immediately before the 285 s deadline still has the shared
 * 10 s Stripe timeout, leaving 5 s beneath the route's 300 s ceiling.
 */
async function runRefundPasses(
  summary: ReconcileSummary,
  deadline: number,
): Promise<void> {
  const passes: readonly RefundPass[] = [
    { ordinal: 1, run: runRefundPass1 },
    { ordinal: 2, run: runRefundPass2 },
    { ordinal: 3, run: runRefundPass3 },
    { ordinal: 5, run: runRefundPass5 },
  ];
  const first = Math.floor(Date.now() / (5 * 60_000)) % passes.length;

  for (let offset = 0; offset < passes.length; offset += 1) {
    if (Date.now() >= deadline) {
      break;
    }
    const pass = passes[(first + offset) % passes.length];
    if (!pass) {
      continue;
    }
    await isolate(`refund-pass-${pass.ordinal}`, () => pass.run(summary, deadline));
  }
}

/** Pass 1: stale requested intents. This is the only pass that may create. */
async function runRefundPass1(
  summary: ReconcileSummary,
  deadline: number,
): Promise<void> {
  if (Date.now() >= deadline) {
    return;
  }
  const runtimeEnvironment = resolveRuntimeEnvironment();
  const candidates = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.refundStatus, 'requested'),
      lt(
        appointmentDepositSchema.refundStatusChangedAt,
        new Date(Date.now() - REFUND_PASS_LEASE_MS),
      ),
      or(
        isNull(appointmentDepositSchema.refundRequestedEnv),
        eq(appointmentDepositSchema.refundRequestedEnv, runtimeEnvironment),
      ),
      sql`${appointmentDepositSchema.refundReconcileAttempts} < 3`,
      sql`NOT (
        ${appointmentDepositSchema.refundStatusChangedAt} < now() - interval '14 days'
        AND COALESCE(${appointmentDepositSchema.refundLastErrorCode}, '')
          IN ('ACCOUNT_DISCONNECTED', 'ACCOUNT_REBOUND')
      )`,
    ))
    .orderBy(asc(appointmentDepositSchema.refundStatusChangedAt))
    .limit(REFUND_PASS_1_BATCH);

  for (const candidate of candidates) {
    if (Date.now() >= deadline) {
      break;
    }
    const claimed = await claimRefundReconcileLease({
      depositId: candidate.id,
      salonId: candidate.salonId,
      expectedStatus: 'requested',
    });
    if (!claimed) {
      continue;
    }

    summary.refundPass1Processed += 1;
    const trigger = normalizeRefundTrigger(claimed.refundTrigger);
    await createOrAdoptDepositRefund(
      claimed,
      trigger === 'owner' ? 'owner' : 'slot_lost',
      {
        trigger,
        allowedSourceStatuses: resolveAllowedSourceStatuses(claimed),
      },
    );
  }
}

/** Pass 2: pending refunds, including every D5 backfill row. */
async function runRefundPass2(
  summary: ReconcileSummary,
  deadline: number,
): Promise<void> {
  if (Date.now() >= deadline) {
    return;
  }
  const runtimeEnvironment = resolveRuntimeEnvironment();
  const candidates = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.refundStatus, 'pending'),
      lt(
        appointmentDepositSchema.refundStatusChangedAt,
        new Date(Date.now() - REFUND_PASS_LEASE_MS),
      ),
      or(
        isNull(appointmentDepositSchema.refundRequestedEnv),
        eq(appointmentDepositSchema.refundRequestedEnv, runtimeEnvironment),
      ),
    ))
    .orderBy(asc(appointmentDepositSchema.refundStatusChangedAt))
    .limit(REFUND_PASS_2_BATCH);

  for (const candidate of candidates) {
    if (Date.now() >= deadline) {
      break;
    }
    const claimed = await claimRefundReconcileLease({
      depositId: candidate.id,
      salonId: candidate.salonId,
      expectedStatus: 'pending',
    });
    if (!claimed) {
      continue;
    }
    summary.refundPass2Processed += 1;
    await retrieveAndApplyRefund(claimed);
  }
}

/** Pass 3: monitor succeeded refunds for reversals during Stripe's 30-day horizon. */
async function runRefundPass3(
  summary: ReconcileSummary,
  deadline: number,
): Promise<void> {
  if (Date.now() >= deadline) {
    return;
  }
  const runtimeEnvironment = resolveRuntimeEnvironment();
  const candidates = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
    })
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.refundStatus, 'succeeded'),
      or(
        isNull(appointmentDepositSchema.refundRequestedEnv),
        eq(appointmentDepositSchema.refundRequestedEnv, runtimeEnvironment),
      ),
      sql`COALESCE(
        ${appointmentDepositSchema.refundedAt},
        ${appointmentDepositSchema.refundStatusChangedAt}
      ) > now() - interval '30 days'`,
      or(
        isNull(appointmentDepositSchema.refundReconcileClaimedAt),
        lt(
          appointmentDepositSchema.refundReconcileClaimedAt,
          new Date(Date.now() - 6 * 60 * 60_000),
        ),
      ),
    ))
    .orderBy(asc(sql`COALESCE(
      ${appointmentDepositSchema.refundedAt},
      ${appointmentDepositSchema.refundStatusChangedAt}
    )`))
    .limit(REFUND_PASS_3_BATCH);

  for (const candidate of candidates) {
    if (Date.now() >= deadline) {
      break;
    }
    const claimed = await claimRefundReconcileLease({
      depositId: candidate.id,
      salonId: candidate.salonId,
      expectedStatus: 'succeeded',
      leaseBefore: new Date(Date.now() - 6 * 60 * 60_000),
    });
    if (!claimed) {
      continue;
    }
    summary.refundPass3Processed += 1;
    await retrieveAndApplyRefund(claimed);
  }
}

/** Pass 5: webhook-independent, list-only discovery. It cannot reach create. */
async function runRefundPass5(
  summary: ReconcileSummary,
  deadline: number,
): Promise<void> {
  if (Date.now() >= deadline) {
    return;
  }
  const runtimeEnvironment = resolveRuntimeEnvironment();
  const candidates = await db
    .select({
      id: appointmentDepositSchema.id,
      salonId: appointmentDepositSchema.salonId,
      refundStatus: appointmentDepositSchema.refundStatus,
    })
    .from(appointmentDepositSchema)
    .innerJoin(appointmentSchema, and(
      eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
      eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
    ))
    .where(and(
      or(
        isNull(appointmentDepositSchema.refundRequestedEnv),
        eq(appointmentDepositSchema.refundRequestedEnv, runtimeEnvironment),
      ),
      sql`COALESCE(
        ${appointmentDepositSchema.updatedAt},
        ${appointmentDepositSchema.createdAt}
      ) < now() - interval '6 hours'`,
      or(
        and(
          inArray(appointmentDepositSchema.status, ['paid', 'refunded']),
          or(
            isNull(appointmentDepositSchema.refundStatus),
            and(
              eq(appointmentDepositSchema.refundStatus, 'requested'),
              isNull(appointmentDepositSchema.stripeRefundId),
            ),
          ),
        ),
        eq(appointmentDepositSchema.refundStatus, 'failed'),
        and(
          eq(appointmentDepositSchema.refundStatus, 'requested'),
          or(
            sql`${appointmentDepositSchema.refundReconcileAttempts} >= 3`,
            lt(
              appointmentDepositSchema.refundStatusChangedAt,
              new Date(Date.now() - 6 * 60 * 60_000),
            ),
          ),
        ),
      ),
    ))
    .orderBy(
      sql`CASE WHEN ${appointmentSchema.status} IN ('cancelled', 'no_show') THEN 0 ELSE 1 END`,
      asc(sql`COALESCE(
        ${appointmentDepositSchema.updatedAt},
        ${appointmentDepositSchema.createdAt}
      )`),
    )
    .limit(REFUND_PASS_5_BATCH);

  for (const candidate of candidates) {
    if (Date.now() >= deadline) {
      break;
    }
    const expectedStatus = candidate.refundStatus === null
      ? null
      : candidate.refundStatus === 'requested'
        || candidate.refundStatus === 'pending'
        || candidate.refundStatus === 'succeeded'
        || candidate.refundStatus === 'failed'
        ? candidate.refundStatus
        : undefined;
    const claimed = await claimRefundReconcileLease({
      depositId: candidate.id,
      salonId: candidate.salonId,
      expectedStatus,
    });
    if (!claimed) {
      continue;
    }
    summary.refundPass5Processed += 1;
    await discoverAndAdoptDepositRefunds(claimed);
  }
}

async function retrieveAndApplyRefund(deposit: DepositRow): Promise<void> {
  if (!deposit.stripeRefundId) {
    return;
  }
  const accountState = await checkDepositSnapshotAccount(deposit);
  if (accountState !== 'ready') {
    await applyRefundObservation({
      deposit,
      refund: null,
      origin: 'reconciler',
      errorCode: accountState,
      accountRefusal: accountState,
    });
    return;
  }

  try {
    const refund = await stripe.refunds.retrieve(deposit.stripeRefundId, {
      stripeAccount: deposit.stripeAccountId,
      timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
    });
    await applyRefundObservation({
      deposit,
      refund: {
        id: refund.id,
        status: refund.status,
        amount: refund.amount,
        currency: refund.currency,
        failure_reason: refund.failure_reason,
        metadata: refund.metadata,
        payment_intent: refund.payment_intent,
      },
      origin: 'reconciler',
      eventMetadataDepositId: refund.metadata?.luster_deposit_id ?? null,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { surface: 'deposit-refund', operation: 'reconcile-retrieve' },
      extra: { depositId: deposit.id },
    });
  }
}

function normalizeRefundTrigger(value: string | null): RefundTrigger {
  switch (value) {
    case 'owner':
    case 'external':
      return value;
    case 'system_late_payment':
    case null:
      return 'system';
    default:
      return 'system';
  }
}

// =============================================================================
// RETENTION
// =============================================================================

/**
 * ONE predicate, two rules.
 *
 * Rows that did NOT resolve a deposit keep only their identity columns —
 * `event_id`, `type`, `account`, `livemode`, `received_at`, `outcome`. Rows
 * that DID keep their projection, because that is the money record an operator
 * works the manual terminal from. The raw payload goes on both paths past the
 * purge horizon, in EVERY state including `poisoned`: a payload we could never
 * parse is not a reason to keep customer data forever.
 */
async function applyRetention(summary: ReconcileSummary): Promise<void> {
  const nonResolving = await db
    .select({ id: stripeWebhookEventSchema.id, outcome: stripeWebhookEventSchema.outcome })
    .from(stripeWebhookEventSchema)
    .where(and(
      isNotNull(stripeWebhookEventSchema.outcome),
      isNotNull(stripeWebhookEventSchema.sessionId),
      sql`${stripeWebhookEventSchema.status} NOT IN ('processing', 'failed_retryable')`,
    ))
    .limit(200);

  const strippable = nonResolving.filter(row => shouldStripProjection(row.outcome));

  if (strippable.length > 0) {
    await db
      .update(stripeWebhookEventSchema)
      .set({
        sessionId: null,
        paymentIntentId: null,
        paymentStatus: null,
        amountTotal: null,
        currency: null,
        metadataAppointmentId: null,
        metadataSalonId: null,
        metadataDepositId: null,
        clientReferenceId: null,
        rawPayload: null,
        updatedAt: sql`now()`,
      })
      .where(inArray(stripeWebhookEventSchema.id, strippable.map(row => row.id)));
    summary.projectionsPurged += strippable.length;
  }

  // The purge horizon, applied in EVERY state.
  await db
    .update(stripeWebhookEventSchema)
    .set({ rawPayload: null, updatedAt: sql`now()` })
    .where(and(
      isNotNull(stripeWebhookEventSchema.rawPayload),
      or(
        lt(stripeWebhookEventSchema.payloadPurgeAfter, new Date()),
        lt(stripeWebhookEventSchema.receivedAt, new Date(Date.now() - PURGE_HORIZON_MS)),
      ),
    ));
}
