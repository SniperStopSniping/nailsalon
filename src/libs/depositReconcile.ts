import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { confirmDepositPayment, type ConfirmDisposition } from '@/libs/deposits/confirmDepositPayment';
import {
  claimLusterWorkRow,
  depositIdsWithExcludingEventRows,
  isStuckPastExpiry,
  pollEvidenceEventId,
  shouldStripProjection,
  stuckAlertEventId,
} from '@/libs/deposits/depositWebhookEvents';
import {
  DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
  runLateDepositRecovery,
} from '@/libs/deposits/lateDepositRecovery';
import { stripe } from '@/libs/stripe';
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

/** Payload retention horizon. */
const PURGE_HORIZON_MS = 14 * 24 * 60 * 60_000;

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
};

/**
 * Runs every pass, ERROR-ISOLATED.
 *
 * A throw in one pass must not kill the rest: these are independent
 * convergence mechanisms, and losing all of them because one had a bad row is
 * how a backlog becomes permanent.
 */
export async function runDepositReconcile(): Promise<ReconcileSummary> {
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
  };

  await isolate('step0', () => runDepositSideReconcile(summary));
  await isolate('step0b', () => runLateCheck(summary));
  await isolate('stuck', () => alertStuckDeposits(summary));
  await isolate('events', () => runEventRowSteps(summary));
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
      });
      summary.step0Parked += 1;
    }
    // `open` and `expired` sessions are D4's reaper's business, not ours.
    return;
  }

  const metadata = session.metadata ?? {};
  const result = await confirmDepositPayment({
    source: 'sweep_deposit',
    connectedAccountId: candidate.account,
    sessionId: candidate.sessionId,
    paymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null,
    paymentStatus: session.payment_status ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    metadataAppointmentId: metadata.appointment_id ?? null,
    metadataSalonId: metadata.salon_id ?? null,
    metadataDepositId: metadata.deposit_id ?? null,
  });

  if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
    await runLateDepositRecovery({ depositId: result.depositId, salonId: result.salonId });
    summary.step0Confirmed += 1;
    return;
  }

  if (isConvergedDisposition(result.disposition)) {
    summary.step0Confirmed += 1;
    return;
  }

  // NON-CONVERGING. Park it on a durable work row so it does not re-drive at
  // cron frequency, on the schedule its class deserves.
  await parkWorkRow(candidate, dispositionSchedule(result.disposition));
  summary.step0Parked += 1;
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

/**
 * Classifies a retrieval failure. A transient failure gets NO work row — a
 * network blip must not consume the escalation ladder that exists for real,
 * permanent problems.
 */
async function parkRetrievalFailure(
  candidate: { id: string; salonId: string; sessionId: string | null; account: string },
  error: unknown,
  summary: ReconcileSummary,
): Promise<void> {
  const code = (error as { code?: string })?.code;
  const statusCode = (error as { statusCode?: number })?.statusCode ?? 0;

  if (statusCode === 429 || statusCode >= 500 || !code) {
    // Transient. Skip and retry on the next run.
    return;
  }

  const deauthClass = code === 'account_invalid' || code === 'application_not_authorized';
  await parkWorkRow(candidate, deauthClass
    ? { outcome: 'unbound_account', availableAt: new Date(Date.now() + 60 * 60_000) }
    : { outcome: 'deferred_no_deposit', availableAt: new Date(Date.now() + 60_000) });
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
  schedule: { outcome: string; availableAt?: Date; terminalStatus?: string },
): Promise<void> {
  const claim = await claimLusterWorkRow({
    eventId: pollEvidenceEventId(candidate.id),
    type: 'luster.poll_evidence',
    account: candidate.account,
    livemode: false,
    salonId: candidate.salonId,
    sessionId: candidate.sessionId,
    depositId: candidate.id,
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
    try {
      const session = await stripe.checkout.sessions.retrieve(candidate.sessionId, {
        stripeAccount: candidate.account,
        timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
      });
      paid = session.payment_status === 'paid';
    } catch (error) {
      await parkRetrievalFailure(candidate, error, summary);
      continue;
    }

    if (paid) {
      await runLateDepositRecovery({ depositId: candidate.id, salonId: candidate.salonId });
      summary.step0bRecovered += 1;
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

  if (claim.attempts >= POISON_ATTEMPTS) {
    Sentry.captureMessage('deposit_event_poisoned', {
      level: 'error',
      tags: { deposits: 'reconcile' },
      extra: { eventId: row.eventId, attempts: claim.attempts },
    });
    await finalizeWebhookEvent({
      id: row.id,
      attempts: claim.attempts,
      status: 'poisoned',
      outcome: 'poisoned',
      processedAt: new Date(),
    });
    summary.eventsPoisoned += 1;
    return;
  }

  // RE-DISPATCHED BY STORED TYPE through the same routing table live deliveries
  // use, never straight into the confirm routine. A stale owner-refund intent
  // dispatched into the default-gated procedure would see `paid`, finalize
  // `already_confirmed`, and PERMANENTLY consume its event id — after which
  // that refund can never be retried.
  if (row.type === 'luster.refund_intent' || row.type === 'luster.owner_refund_intent') {
    if (row.metadataDepositId && row.salonId) {
      await runLateDepositRecovery({ depositId: row.metadataDepositId, salonId: row.salonId });
    }
    await finalizeWebhookEvent({
      id: row.id,
      attempts: claim.attempts,
      status: 'processed',
      outcome: 'refunded',
      processedAt: new Date(),
    });
    summary.eventsRedispatched += 1;
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

  const result = await confirmDepositPayment({
    // The STORED account column, never the deposit snapshot: sourcing it from
    // the snapshot collapses the four-leg match into a self-comparison, and an
    // event from another account would confirm this deposit.
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

  if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
    await runLateDepositRecovery({ depositId: result.depositId, salonId: result.salonId });
    await finalizeWebhookEvent({
      id: row.id,
      attempts: claim.attempts,
      status: 'processed',
      outcome: 'refunded',
      processedAt: new Date(),
    });
    summary.eventsRedispatched += 1;
    return;
  }

  if (isConvergedDisposition(result.disposition)) {
    await finalizeWebhookEvent({
      id: row.id,
      attempts: claim.attempts,
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
      attempts: claim.attempts,
      status: schedule.terminalStatus as Parameters<typeof finalizeWebhookEvent>[0]['status'],
      outcome: schedule.outcome as Parameters<typeof finalizeWebhookEvent>[0]['outcome'],
      processedAt: new Date(),
    });
    return;
  }

  await finalizeRetryable({
    id: row.id,
    attempts: claim.attempts,
    outcome: schedule.outcome as Parameters<typeof finalizeRetryable>[0]['outcome'],
    availableAt: schedule.availableAt ?? new Date(Date.now() + 60_000),
  });
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
