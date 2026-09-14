/**
 * P8a billing integrity check — G12 (plan §5 P8a; contract §19).
 *
 * Read-only. Every query below is a SELECT (the surrounding transaction is
 * used only for a single consistent snapshot, never for a write). This
 * module is deliberately independent of `@/libs/Env`, `@/libs/DB`, and every
 * live-mutation module (`creditGrants.ts`, `creditReservation.ts`,
 * `topupReconciliation.ts`) — it imports only `creditLedger.ts`'s pure
 * balance arithmetic (`computeAvailableBalance`) and the schema, so it is
 * safe to run in any environment, including CI, with no billing switches or
 * Stripe keys configured (`scripts/billing-integrity-check.ts`'s header
 * comment).
 *
 * `creditGrants.ts`/`creditLedger.ts`/`creditReservation.ts` themselves
 * carry ZERO Sentry/log/metric hooks by design (G12's live-module finding:
 * a suppressed duplicate starter claim there is expected behaviour, not an
 * anomaly). THIS module is the observer instead: it re-derives anomalies
 * from durable evidence after the fact, on a cadence an operator or CI job
 * controls, never inline with a live financial mutation. Item (v) below
 * mirrors `topupReconciliation.ts`'s `reconcileHeldTopups` CANDIDATE QUERY
 * only — it never calls `reconcileHeldTopups` itself, which resolves
 * candidates against live Stripe state and writes transitions.
 */

import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import {
  billingCheckoutAttemptSchema,
  smsCreditAccountSchema,
  smsCreditReservationSchema,
} from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';
import { computeAvailableBalance } from './creditLedger';

/** The minimal transaction-capable handle the CLI's real connection provides. */
export type IntegrityCheckDb = {
  transaction: <T>(callback: (tx: BillingDbTransaction) => Promise<T>) => Promise<T>;
};

export type BillingIntegrityViolationCode =
  | 'DUPLICATE_STARTER_GRANT_LOTS'
  | 'DUPLICATE_MONTHLY_WINDOW_GRANT_LOTS'
  | 'DUPLICATE_TOPUP_GRANT_LOTS'
  | 'NEGATIVE_AVAILABLE_BALANCE'
  | 'CACHED_BALANCE_DRIFT'
  | 'ORPHAN_RESERVATION'
  | 'HELD_TOPUP_ATTEMPT';

/** Ids and counts only — no PII (contract §7.3's raw-email-never-stored rule extends here). */
export type BillingIntegrityViolation = {
  code: BillingIntegrityViolationCode;
  salonId: string | null;
  detail: Record<string, unknown>;
};

export type BillingIntegrityCheckSummary = {
  checkedAt: Date;
  violationCount: number;
  byCode: Partial<Record<BillingIntegrityViolationCode, number>>;
  salonAccountsChecked: number;
  reservationsChecked: number;
  heldTopupAttemptsExamined: number;
};

export type BillingIntegrityCheckResult = {
  violations: BillingIntegrityViolation[];
  summary: BillingIntegrityCheckSummary;
};

type CountRow = Record<string, unknown>;

/**
 * (i) Duplicate ledger lots sharing an idempotency-key FAMILY that must be
 * unique. `idempotency_key` itself is a DB-level UNIQUE column, so a literal
 * duplicate can never exist; these three checks instead group on the
 * semantic identity each family is supposed to key on, catching drift where
 * two DIFFERENT idempotency-key strings nonetheless represent the same
 * real-world grant event (contract §7.3's once-per-business starter fence,
 * §6.5's once-per-window monthly fence, §7.8's once-per-purchase top-up
 * fence).
 */
async function findDuplicateGrantLots(
  tx: BillingDbTransaction,
): Promise<BillingIntegrityViolation[]> {
  const violations: BillingIntegrityViolation[] = [];

  // starter-grant:{businessIdentityId} — the once-per-business fence lives on
  // billing_starter_grant.business_identity_id (UNIQUE), not on the ledger.
  // Two starter-bucket grant lots for the SAME salon is the ledger-side
  // symptom of that fence having been bypassed.
  const starterDuplicates = await tx.execute(sql`
    SELECT salon_id, COUNT(*)::int AS lot_count
    FROM sms_credit_ledger
    WHERE bucket = 'starter' AND entry_type = 'grant' AND amount > 0
    GROUP BY salon_id
    HAVING COUNT(*) > 1
  `);
  for (const row of starterDuplicates.rows as CountRow[]) {
    violations.push({
      code: 'DUPLICATE_STARTER_GRANT_LOTS',
      salonId: String(row.salon_id),
      detail: { lotCount: Number(row.lot_count) },
    });
  }

  // monthly-grant:{subscriptionId}:{cycleIndex}:{planKey} — every monthly
  // WINDOW grant (reason = 'monthly_window_grant', distinct from an
  // upgrade-diff top-up) for one salon expires exactly at that window's end
  // (creditGrants.ts's applyUpgradeDiff comment). More than one such lot
  // sharing an expiry is two grants for one window — a plan-key change
  // between evaluations could mint a second idempotency key for the same
  // (subscription, cycle).
  const monthlyDuplicates = await tx.execute(sql`
    SELECT salon_id, expires_at, COUNT(*)::int AS lot_count
    FROM sms_credit_ledger
    WHERE bucket = 'monthly' AND entry_type = 'grant' AND reason = 'monthly_window_grant' AND amount > 0
    GROUP BY salon_id, expires_at
    HAVING COUNT(*) > 1
  `);
  for (const row of monthlyDuplicates.rows as CountRow[]) {
    violations.push({
      code: 'DUPLICATE_MONTHLY_WINDOW_GRANT_LOTS',
      salonId: String(row.salon_id),
      detail: {
        windowEnd: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
        lotCount: Number(row.lot_count),
      },
    });
  }

  // topup-grant:{stripeCheckoutSessionId} — fulfillTopupPurchase's own key.
  // A payment intent funding two distinct grant lots is the symptom worth
  // flagging here (the checkout session itself cannot literally duplicate:
  // idempotency_key is UNIQUE).
  const topupDuplicates = await tx.execute(sql`
    SELECT salon_id, stripe_ref, COUNT(*)::int AS lot_count
    FROM sms_credit_ledger
    WHERE bucket = 'purchased' AND entry_type = 'grant' AND reason = 'topup_fulfillment'
      AND stripe_ref IS NOT NULL AND amount > 0
    GROUP BY salon_id, stripe_ref
    HAVING COUNT(*) > 1
  `);
  for (const row of topupDuplicates.rows as CountRow[]) {
    violations.push({
      code: 'DUPLICATE_TOPUP_GRANT_LOTS',
      salonId: String(row.salon_id),
      detail: { stripeRef: String(row.stripe_ref), lotCount: Number(row.lot_count) },
    });
  }

  return violations;
}

/**
 * (ii) Negative available balance, and (iii) cached-balance vs ledger-sum
 * drift — one pass per salon account row so both checks share the single
 * `computeAvailableBalance` read. A negative balance is reported alongside
 * its dispute-reversal count rather than suppressed by one (§7.8: a dispute
 * MAY legitimately push availability negative) — an operator reads the
 * count to judge whether the negative is explained.
 */
async function checkAccountBalances(
  tx: BillingDbTransaction,
  now: Date,
): Promise<{ violations: BillingIntegrityViolation[]; accountsChecked: number }> {
  const violations: BillingIntegrityViolation[] = [];
  const accounts = await tx
    .select({
      salonId: smsCreditAccountSchema.salonId,
      cachedAvailable: smsCreditAccountSchema.cachedAvailable,
      cachedReserved: smsCreditAccountSchema.cachedReserved,
    })
    .from(smsCreditAccountSchema);

  for (const account of accounts) {
    const balance = await computeAvailableBalance(tx, account.salonId, now);

    if (balance.available < 0) {
      const disputeRows = await tx.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sms_credit_ledger
        WHERE salon_id = ${account.salonId}
          AND entry_type = 'purchase_reversal'
          AND reason = 'topup_dispute_reversal'
      `);
      const disputeReversalCount = Number((disputeRows.rows[0] as CountRow).count);
      violations.push({
        code: 'NEGATIVE_AVAILABLE_BALANCE',
        salonId: account.salonId,
        detail: { available: balance.available, disputeReversalCount },
      });
    }

    if (account.cachedAvailable !== balance.available || account.cachedReserved !== balance.reserved) {
      violations.push({
        code: 'CACHED_BALANCE_DRIFT',
        salonId: account.salonId,
        detail: {
          cachedAvailable: account.cachedAvailable,
          computedAvailable: balance.available,
          cachedReserved: account.cachedReserved,
          computedReserved: balance.reserved,
        },
      });
    }
  }

  return { violations, accountsChecked: accounts.length };
}

/**
 * (iv) Orphan reservations: rows still `held` past their lease with no
 * settlement (would be `settled`) and no release (would be `released`).
 * Mirrors `creditReservation.ts`'s `reapExpiredReservations` candidate
 * predicate at the status/expiry level, minus the reaper's own
 * `notification_delivery` ambiguity carve-out — a detector may flag rows the
 * reaper deliberately leaves alone (a possible in-flight send), which is the
 * conservative direction to err in for a READ-ONLY report.
 */
async function findOrphanReservations(
  tx: BillingDbTransaction,
  now: Date,
): Promise<{ violations: BillingIntegrityViolation[]; reservationsChecked: number }> {
  const totalRows = await tx.execute(sql`SELECT COUNT(*)::int AS count FROM sms_credit_reservation`);
  const reservationsChecked = Number((totalRows.rows[0] as CountRow).count);

  const orphans = await tx
    .select({
      id: smsCreditReservationSchema.id,
      salonId: smsCreditReservationSchema.salonId,
      expiresAt: smsCreditReservationSchema.expiresAt,
    })
    .from(smsCreditReservationSchema)
    .where(and(
      eq(smsCreditReservationSchema.status, 'held'),
      lt(smsCreditReservationSchema.expiresAt, now),
    ));

  const violations: BillingIntegrityViolation[] = orphans.map(row => ({
    code: 'ORPHAN_RESERVATION' as const,
    salonId: row.salonId,
    detail: { reservationId: row.id, expiresAt: row.expiresAt.toISOString() },
  }));

  return { violations, reservationsChecked };
}

/**
 * (v) Held top-up attempts: reuses `topupReconciliation.ts`'s
 * `reconcileHeldTopups` CANDIDATE QUERY read-only — same purpose/status
 * filter, same "more than one live row for a salon OR its TTL lapsed"
 * candidacy rule — but never calls the resolver, never retrieves a Stripe
 * session, never applies a transition. A candidate here is a report line,
 * not a repair.
 */
async function findHeldTopupAttempts(
  tx: BillingDbTransaction,
  now: Date,
): Promise<{ violations: BillingIntegrityViolation[]; examined: number }> {
  const heldRows = await tx
    .select({
      id: billingCheckoutAttemptSchema.id,
      salonId: billingCheckoutAttemptSchema.salonId,
      stripeCheckoutSessionId: billingCheckoutAttemptSchema.stripeCheckoutSessionId,
      expiresAt: billingCheckoutAttemptSchema.expiresAt,
    })
    .from(billingCheckoutAttemptSchema)
    .where(and(
      eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
      inArray(billingCheckoutAttemptSchema.status, ['creating', 'checkout_created']),
    ))
    .orderBy(billingCheckoutAttemptSchema.id);

  const countBySalon = new Map<string, number>();
  for (const row of heldRows) {
    countBySalon.set(row.salonId, (countBySalon.get(row.salonId) ?? 0) + 1);
  }

  const candidates = heldRows.filter(row => (
    (countBySalon.get(row.salonId) ?? 0) > 1
    || row.expiresAt.getTime() < now.getTime()
  ));

  const violations: BillingIntegrityViolation[] = candidates.map(row => ({
    code: 'HELD_TOPUP_ATTEMPT' as const,
    salonId: row.salonId,
    detail: {
      attemptId: row.id,
      sessionBound: row.stripeCheckoutSessionId !== null,
      expired: row.expiresAt.getTime() < now.getTime(),
      multipleLiveForSalon: (countBySalon.get(row.salonId) ?? 0) > 1,
    },
  }));

  return { violations, examined: candidates.length };
}

export async function runBillingIntegrityCheck(
  db: IntegrityCheckDb,
  input: { now?: Date } = {},
): Promise<BillingIntegrityCheckResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const violations: BillingIntegrityViolation[] = [];

    violations.push(...await findDuplicateGrantLots(tx));

    const balanceResult = await checkAccountBalances(tx, now);
    violations.push(...balanceResult.violations);

    const orphanResult = await findOrphanReservations(tx, now);
    violations.push(...orphanResult.violations);

    const heldTopupResult = await findHeldTopupAttempts(tx, now);
    violations.push(...heldTopupResult.violations);

    const byCode: Partial<Record<BillingIntegrityViolationCode, number>> = {};
    for (const violation of violations) {
      byCode[violation.code] = (byCode[violation.code] ?? 0) + 1;
    }

    return {
      violations,
      summary: {
        checkedAt: now,
        violationCount: violations.length,
        byCode,
        salonAccountsChecked: balanceResult.accountsChecked,
        reservationsChecked: orphanResult.reservationsChecked,
        heldTopupAttemptsExamined: heldTopupResult.examined,
      },
    };
  });
}
