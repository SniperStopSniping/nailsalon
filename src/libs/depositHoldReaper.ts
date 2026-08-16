import 'server-only';

import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  buildDepositCheckoutIdempotencyKey,
  buildDepositCheckoutParams,
  classifyStripeFailure,
  type DepositCheckoutRow,
  type DepositStripeClient,
  getDepositStripeClient,
} from '@/libs/depositCheckout';
import { finalizeExpiredHold } from '@/libs/deposits/holdWriters';
import { appointmentDepositSchema, appointmentSchema, appointmentServicesSchema } from '@/models/Schema';

import { isRedisAvailable, redis } from '../core/redis/redisClient';

/**
 * Reaper eligibility floor: `deposit_hold_expires_at + 90 s`.
 *
 * An authorization submitted right at the boundary needs time to reach
 * `complete` before the reaper touches its session. Without the grace, the
 * reaper races a client who paid with two seconds to spare.
 */
export const DEPOSIT_SETTLE_GRACE_SECONDS = 90;

/**
 * HARD LOCAL BACKSTOP. Past this, the hold is finalised regardless of what
 * Stripe says or fails to say.
 *
 * This single rule closes every provider failure mode at once: a saved 5xx
 * replayed for >= 24 h, a deauthorized or restricted account, a stale account
 * snapshot after a re-bind, and total Stripe unreachability. Without it, the
 * only remedy for any of those is manual SQL on production.
 */
export const DEPOSIT_LOCAL_FORCE_RELEASE_MINUTES = 120;

/**
 * Batch size, DERIVED — and the derivation is the published artefact, not the
 * integer.
 *
 *   floor = DEPOSIT_REAP_BATCH x 3 worst-case Stripe round trips per row
 *           x the 6 s client timeout
 *
 * The three round trips are the NULL-session create probe, the `expire`, and the
 * mandatory re-`GET`. At a batch of 25 the floor is 25 x 3 x 6 s = 450 s.
 *
 * The route declares `maxDuration = 300`, the documented platform default, which
 * is BELOW that floor. The rule in that case is to reduce the batch — never the
 * 6 s timeout (pinned by BOOKING_POLL_WINDOW_MS) and never the re-GET:
 *
 *   floor(300 / (3 x 6)) = 16
 *
 * If the deployment's verified function ceiling is >= 450 s, this may return to
 * 25 together with `maxDuration`. Do not raise one without the other.
 */
export const DEPOSIT_REAP_BATCH = 16;

/** Matches the derivation above. Read the comment before changing either. */
export const DEPOSIT_REAP_MAX_DURATION_SECONDS = 300;

const REAP_LEASE_KEY = 'deposits:reap:lease';
const REAP_LEASE_TTL_SECONDS = 240;

export type ReapSummary = {
  scanned: number;
  finalized: number;
  leftStanding: number;
  healed: number;
  leaseAcquired: boolean;
};

type EligibleHold = {
  appointmentId: string;
  salonId: string;
  holdExpiresAt: Date;
  depositId: string;
  amountCents: number;
  stripeAccountId: string;
  stripeCheckoutSessionId: string | null;
  checkoutSuccessUrl: string | null;
  checkoutCancelUrl: string | null;
  appointmentStartTime: Date;
};

export async function reapExpiredDepositHolds(options?: {
  client?: DepositStripeClient;
  now?: Date;
}): Promise<ReapSummary> {
  const now = options?.now ?? new Date();
  const client = options?.client ?? getDepositStripeClient();

  // The lease is an OPTIMIZATION, not a safety property, and the reaper must run
  // without it: `isRedisAvailable()` is false whenever Redis is unconfigured or
  // down — and is hard-mocked to false in the real-Postgres suite — so a
  // lease-REQUIRED reaper would silently stop reaping in exactly the degraded
  // conditions where holds accumulate. Every mutation below is a status-guarded
  // CAS in one transaction, so overlapping runs are harmless; the lease only
  // avoids concurrent same-key probes.
  const leaseAcquired = await acquireReapLease();
  if (!leaseAcquired) {
    console.warn('[deposits] reap lease unavailable; proceeding without it');
  }

  const holds = await loadEligibleHolds(now);
  const summary: ReapSummary = {
    scanned: holds.length,
    finalized: 0,
    leftStanding: 0,
    healed: 0,
    leaseAcquired,
  };

  for (const hold of holds) {
    // Per-row try/catch: one salon's deauthorized account must not stop the
    // batch for every other salon.
    try {
      const outcome = await reapOneHold({ hold, client, now });
      if (outcome === 'finalized') {
        summary.finalized += 1;
      } else {
        summary.leftStanding += 1;
      }
    } catch (error) {
      summary.leftStanding += 1;
      console.error('[deposits] reap failed for a hold; leaving it standing', {
        appointmentId: hold.appointmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  summary.healed = await healStrandedDeposits(now);
  return summary;
}

async function reapOneHold(args: {
  hold: EligibleHold;
  client: DepositStripeClient;
  now: Date;
}): Promise<'finalized' | 'left_standing'> {
  const { hold, client, now } = args;
  const pastHardBackstop = now.getTime()
    > hold.holdExpiresAt.getTime() + DEPOSIT_LOCAL_FORCE_RELEASE_MINUTES * 60_000;

  let sessionId = hold.stripeCheckoutSessionId;
  let lastProviderError: string | null = null;

  // STEP 2 — session id NULL: best-effort probe with the SAME idempotency key
  // and the SAME params (all of which derive from the deposit row).
  if (!sessionId) {
    const probed = await probeForExistingSession({ hold, client });
    if (probed.sessionId) {
      sessionId = probed.sessionId;
      await persistProbedSessionId(hold, probed.sessionId);
    } else {
      lastProviderError = probed.error;
      // NEVER infer "no session exists" from any error: an idempotency_error
      // (parameter mismatch) or a replayed saved 5xx proves the OPPOSITE, and a
      // saved 500 is replayed for >= 24 h.
      //
      // Known cost, stated plainly: a hold whose create NEVER REACHED Stripe can
      // never be recovered by this probe. The probe re-POSTs identical params
      // including an `expires_at` that is by now in the PAST, so Stripe
      // validates it fresh and rejects it — identically on every run. Those
      // holds finalize ONLY at the hard backstop below.
      if (!pastHardBackstop) {
        return 'left_standing';
      }
    }
  }

  if (sessionId) {
    const verdict = await resolveSessionVerdict({ client, hold, sessionId });
    if (verdict.kind === 'paid') {
      // Payment landed; D5 owns this row. `expire` succeeding does NOT prove
      // non-payment — a form submitted moments before expires_at can still be
      // settling — which is exactly why the re-GET is mandatory.
      return 'left_standing';
    }
    if (verdict.kind === 'finalize') {
      await finalize(hold, verdict.note);
      return 'finalized';
    }
    lastProviderError = verdict.error;
    if (!pastHardBackstop) {
      await warnIfHoldIsOld(hold, now, lastProviderError);
      return 'left_standing';
    }
  }

  // STEP 3 — HARD BACKSTOP.
  if (pastHardBackstop) {
    await finalize(
      hold,
      `forced release past ${DEPOSIT_LOCAL_FORCE_RELEASE_MINUTES}m; last provider error: ${lastProviderError ?? 'none'}`,
    );
    return 'finalized';
  }

  return 'left_standing';
}

type SessionVerdict
  = | { kind: 'paid' }
  | { kind: 'finalize'; note: string | null }
  | { kind: 'retry'; error: string | null };

async function resolveSessionVerdict(args: {
  client: DepositStripeClient;
  hold: EligibleHold;
  sessionId: string;
}): Promise<SessionVerdict> {
  const { client, hold, sessionId } = args;
  const requestOptions = { stripeAccount: hold.stripeAccountId };

  try {
    await client.checkout.sessions.expire(sessionId, {}, requestOptions);
  } catch (error) {
    const failure = classifyStripeFailure(error);
    if (failure === 'permanent') {
      // Authentication / permission / deauthorized. The reaper only runs past
      // expires_at, by which point Stripe has already auto-expired the session,
      // so finalising now is safe and is the only way this hold ever resolves.
      return {
        kind: 'finalize',
        note: `permanent provider error on expire: ${errorMessage(error)}`,
      };
    }
    if (failure !== 'session_not_open') {
      return { kind: 'retry', error: errorMessage(error) };
    }
    // 'session_not_open' falls through to the GET below, which decides.
  }

  // MANDATORY re-GET, on both the success and the not-open paths.
  try {
    const session = await client.checkout.sessions.retrieve(sessionId, {}, requestOptions);
    if (session.status === 'complete') {
      return { kind: 'paid' };
    }
    return { kind: 'finalize', note: `session status ${session.status ?? 'unknown'}` };
  } catch (error) {
    if (classifyStripeFailure(error) === 'permanent') {
      return {
        kind: 'finalize',
        note: `permanent provider error on retrieve: ${errorMessage(error)}`,
      };
    }
    return { kind: 'retry', error: errorMessage(error) };
  }
}

async function probeForExistingSession(args: {
  hold: EligibleHold;
  client: DepositStripeClient;
}): Promise<{ sessionId: string | null; error: string | null }> {
  const { hold, client } = args;
  if (!hold.checkoutSuccessUrl || !hold.checkoutCancelUrl) {
    return { sessionId: null, error: 'deposit row has no stored redirect URLs' };
  }

  // Write-once snapshots, read back in any order — buildDepositCheckoutParams
  // canonicalises (sorts) them, so this probe rebuilds the booking path's
  // byte-identical parameters under the same idempotency key.
  const serviceNameSnapshots = (await db
    .select({ nameSnapshot: appointmentServicesSchema.nameSnapshot })
    .from(appointmentServicesSchema)
    .where(eq(appointmentServicesSchema.appointmentId, hold.appointmentId)))
    .map(row => row.nameSnapshot)
    .filter((name): name is string => typeof name === 'string');

  const row: DepositCheckoutRow = {
    id: hold.depositId,
    salonId: hold.salonId,
    appointmentId: hold.appointmentId,
    amountCents: hold.amountCents,
    stripeAccountId: hold.stripeAccountId,
    checkoutSuccessUrl: hold.checkoutSuccessUrl,
    checkoutCancelUrl: hold.checkoutCancelUrl,
    holdExpiresAt: hold.holdExpiresAt,
    appointmentStartTime: hold.appointmentStartTime,
    serviceNameSnapshots,
  };

  try {
    const session = await client.checkout.sessions.create(
      buildDepositCheckoutParams(row),
      {
        stripeAccount: hold.stripeAccountId,
        idempotencyKey: buildDepositCheckoutIdempotencyKey(hold.appointmentId),
      },
    );
    return { sessionId: session.id, error: null };
  } catch (error) {
    return { sessionId: null, error: errorMessage(error) };
  }
}

async function persistProbedSessionId(hold: EligibleHold, sessionId: string): Promise<void> {
  await db
    .update(appointmentDepositSchema)
    .set({ stripeCheckoutSessionId: sessionId, updatedAt: new Date() })
    .where(and(
      eq(appointmentDepositSchema.id, hold.depositId),
      eq(appointmentDepositSchema.salonId, hold.salonId),
      isNull(appointmentDepositSchema.stripeCheckoutSessionId),
    ));
}

async function finalize(hold: EligibleHold, note: string | null): Promise<void> {
  await finalizeExpiredHold({
    appointmentId: hold.appointmentId,
    salonId: hold.salonId,
    depositId: hold.depositId,
    resolutionNote: note,
  });
}

async function warnIfHoldIsOld(
  hold: EligibleHold,
  now: Date,
  lastError: string | null,
): Promise<void> {
  const ageMs = now.getTime() - hold.holdExpiresAt.getTime();
  if (ageMs < 2 * 60 * 60 * 1000) {
    return;
  }
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureMessage('Deposit hold has been unresolvable for over two hours', {
    level: 'warning',
    tags: { scope: 'deposit_hold_reap_stalled', salon_id: hold.salonId },
    extra: { appointmentId: hold.appointmentId, lastError },
  });
}

async function loadEligibleHolds(now: Date): Promise<EligibleHold[]> {
  const eligibleBefore = new Date(now.getTime() - DEPOSIT_SETTLE_GRACE_SECONDS * 1000);

  return db
    .select({
      appointmentId: appointmentSchema.id,
      salonId: appointmentSchema.salonId,
      holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
      depositId: appointmentDepositSchema.id,
      amountCents: appointmentDepositSchema.amountCents,
      stripeAccountId: appointmentDepositSchema.stripeAccountId,
      stripeCheckoutSessionId: appointmentDepositSchema.stripeCheckoutSessionId,
      checkoutSuccessUrl: appointmentDepositSchema.checkoutSuccessUrl,
      checkoutCancelUrl: appointmentDepositSchema.checkoutCancelUrl,
      appointmentStartTime: appointmentSchema.startTime,
    })
    .from(appointmentSchema)
    // The deposit-status join is a LOCAL, network-independent guarantee that a
    // `paid` deposit can never be cancelled by this module — for example when D5
    // crashes between its deposit write and its appointment CAS.
    .innerJoin(appointmentDepositSchema, and(
      eq(appointmentDepositSchema.salonId, appointmentSchema.salonId),
      eq(appointmentDepositSchema.appointmentId, appointmentSchema.id),
      eq(appointmentDepositSchema.status, 'checkout_created'),
    ))
    .where(and(
      eq(appointmentSchema.status, 'awaiting_payment'),
      isNull(appointmentSchema.deletedAt),
      isNotNull(appointmentSchema.depositHoldExpiresAt),
      lte(appointmentSchema.depositHoldExpiresAt, eligibleBefore),
    ))
    .orderBy(asc(appointmentSchema.depositHoldExpiresAt))
    .limit(DEPOSIT_REAP_BATCH)
    .then(rows => rows.flatMap(row => (row.holdExpiresAt
      ? [{ ...row, holdExpiresAt: row.holdExpiresAt }]
      : [])));
}

/**
 * Healing sweep — once per run, cheap and bounded.
 *
 * Terminalises any deposit row still `checkout_created` while its appointment is
 * already `cancelled` and the hold deadline has passed. Nothing else can find
 * these: every eligibility scan keys on the APPOINTMENT status, so a row
 * stranded by a crash between two loose statements would otherwise live forever.
 */
async function healStrandedDeposits(now: Date): Promise<number> {
  const healed = await db
    .update(appointmentDepositSchema)
    .set({
      status: 'expired',
      resolutionNote: 'healed: appointment already cancelled',
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentDepositSchema.status, 'checkout_created'),
      sql`EXISTS (
        SELECT 1 FROM ${appointmentSchema}
        WHERE ${appointmentSchema.id} = ${appointmentDepositSchema.appointmentId}
          AND ${appointmentSchema.salonId} = ${appointmentDepositSchema.salonId}
          AND ${appointmentSchema.status} = 'cancelled'
          AND ${appointmentSchema.depositHoldExpiresAt} IS NOT NULL
          AND ${appointmentSchema.depositHoldExpiresAt} <= ${now}
      )`,
    ))
    .returning();

  return healed.length;
}

async function acquireReapLease(): Promise<boolean> {
  try {
    if (!(await isRedisAvailable()) || !redis) {
      return false;
    }
    const acquired = await redis.set(REAP_LEASE_KEY, '1', 'EX', REAP_LEASE_TTL_SECONDS, 'NX');
    return acquired === 'OK';
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
