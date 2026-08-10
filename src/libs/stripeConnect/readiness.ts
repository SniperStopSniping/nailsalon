import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db } from '@/libs/DB';
// THE SINGLE PRODUCER of expected livemode for this entire programme. This is
// the only import of it under `src/libs/stripeConnect/`, and there is no second
// derivation anywhere in D2 — no `resolveRuntimeEnvironment` call, no `sk_live_`
// literal. Two later PRs import the same producer and may respond differently to
// an indeterminate result, but they never re-derive the value.
import { computeExpectedLivemode } from '@/libs/environmentIsolation';
import { stripe } from '@/libs/stripe';
import {
  type SalonStripeAccount,
  salonStripeAccountSchema,
  type StripeAccountRequirementsJson,
} from '@/models/Schema';

// =============================================================================
// PINNED PUBLIC INTERFACE — later PRs compile against these exact shapes.
// =============================================================================

export type StripeAccountRequirements = {
  currentlyDue: string[];
  eventuallyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  currentDeadline: Date | null;
  futureCurrentDeadline: Date | null;
};

export type SalonStripeBinding = {
  id: string;
  salonId: string;
  stripeAccountId: string;
  livemode: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements: StripeAccountRequirements;
  disabledReason: string | null;
  connectedAt: Date;
  revokedAt: Date | null;
  revocationCause: 'revoked_local' | 'deauthorized' | null;
  lastSyncedAt: Date | null;
};

export type ConnectStatus =
  | 'not_connected'
  | 'onboarding_incomplete'
  | 'action_needed_soon'
  | 'charge_ready'
  | 'restricted'
  | 'blocked_needs_support'
  | 'revoked'
  | 'mode_mismatch';

/**
 * PINNED THRESHOLD. `action_needed_soon` is entered when `requirements.eventuallyDue`
 * is non-empty OR `requirements.currentDeadline` falls within this many days.
 *
 * Rationale for 14 and not something else: Stripe moves unresolved `currently_due`
 * fields into `past_due` at `current_deadline`, at which point the account is
 * already `restricted` — so the warning is only useful if it leaves an owner
 * enough time to collect documents and complete a hosted-onboarding session. Two
 * weeks is the smallest window that survives one weekend plus one round of
 * document rejection. It is display-only (this derived status gates no money), so
 * being wrong is a copy problem, not a money problem.
 *
 * Read the const; do not inline the number and do not pick your own.
 */
export const ACTION_SOON_DAYS = 14;

export type ReadinessDecision =
  | {
    chargeReady: true;
    status: 'charge_ready';
    payoutsPending: boolean;
    binding: SalonStripeBinding;
  }
  | {
    chargeReady: false;
    status: Exclude<ConnectStatus, 'charge_ready'>;
    binding: SalonStripeBinding | null;
  };

export class StripeConnectUnavailableError extends Error {
  readonly code:
    | 'PROVIDER_UNREACHABLE'
    | 'PROVIDER_PERMANENT'
    | 'SCHEMA_NOT_PROVISIONED'
    | 'NOT_CONFIGURED'
    | 'MODE_INDETERMINATE';

  constructor(code: StripeConnectUnavailableError['code']) {
    super(`Stripe Connect unavailable: ${code}`);
    this.name = 'StripeConnectUnavailableError';
    this.code = code;
  }
}

/**
 * The `stripe=` query value the admin redirect carries. Deliberately NOT a
 * `ConnectStatus`: `sync_failed`, `link_expired`, `forbidden` and `error` have no
 * `ConnectStatus` member and would otherwise fall silently through the modal's
 * switch. Pinned here so the routes and the modal's copy map agree.
 */
export const CONNECT_REDIRECT_STATUSES = [
  'link_expired',
  'forbidden',
  'error',
  'sync_failed',
  'not_connected',
  'onboarding_incomplete',
  'action_needed_soon',
  'charge_ready',
  'restricted',
  'blocked_needs_support',
  'revoked',
  'mode_mismatch',
] as const;

export type ConnectRedirectStatus = (typeof CONNECT_REDIRECT_STATUSES)[number];

// =============================================================================
// EXPECTED LIVEMODE — the throwing wrapper over the one pure producer
// =============================================================================

/**
 * Evaluated ONCE at module scope, deliberately. Re-reading `process.env` per call
 * would let two calls inside one request disagree about which mode we are in.
 */
export const EXPECTED_LIVEMODE = computeExpectedLivemode(process.env);

/**
 * Throwing wrapper. `'unknown'` runtime environments are already rejected at boot
 * by `assertProviderEnvironmentIsolation`, so this is defence in depth rather
 * than the primary control — but it fails CLOSED and never guesses a default.
 */
export function expectedLivemode(): boolean {
  if (!EXPECTED_LIVEMODE.ok) {
    throw new StripeConnectUnavailableError('MODE_INDETERMINATE');
  }
  return EXPECTED_LIVEMODE.livemode;
}

// =============================================================================
// ROW ↔ DOMAIN MAPPING
// =============================================================================

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}

export function toRequirements(
  stored: StripeAccountRequirementsJson | null | undefined,
): StripeAccountRequirements {
  return {
    currentlyDue: stored?.currently_due ?? [],
    eventuallyDue: stored?.eventually_due ?? [],
    pastDue: stored?.past_due ?? [],
    pendingVerification: stored?.pending_verification ?? [],
    currentDeadline: toDate(stored?.current_deadline),
    futureCurrentDeadline: toDate(stored?.future_current_deadline),
  };
}

export function toBinding(row: SalonStripeAccount): SalonStripeBinding {
  return {
    id: row.id,
    salonId: row.salonId,
    stripeAccountId: row.stripeAccountId,
    livemode: row.livemode,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    requirements: toRequirements(row.requirementsDue),
    disabledReason: row.disabledReason,
    connectedAt: row.connectedAt,
    revokedAt: row.revokedAt,
    revocationCause: row.revocationCause ?? null,
    lastSyncedAt: row.lastSyncedAt,
  };
}

/**
 * Private live-binding read.
 *
 * `binding.ts` imports the throwing `expectedLivemode()` from this module, so
 * this module must not import `binding.ts` back — a runtime import cycle would
 * leave `EXPECTED_LIVEMODE` partially initialized depending on which module the
 * bundler evaluated first. The duplicated five-line query is the cheap half of
 * that trade.
 */
async function loadLiveBinding(salonId: string): Promise<SalonStripeBinding | null> {
  const rows = await db
    .select()
    .from(salonStripeAccountSchema)
    .where(and(
      eq(salonStripeAccountSchema.salonId, salonId),
      isNull(salonStripeAccountSchema.revokedAt),
    ))
    .limit(1);

  return rows[0] ? toBinding(rows[0]) : null;
}

// =============================================================================
// DERIVED STATUS
// =============================================================================

/**
 * PURE. The DISPLAY vocabulary.
 *
 * The expected livemode is passed in rather than read, so this stays pure and
 * testable as a table; the throwing wrapper lives at the call sites.
 */
export function deriveConnectStatus(
  binding: SalonStripeBinding | null,
  expected: boolean,
): ConnectStatus {
  if (!binding) {
    return 'not_connected';
  }
  if (binding.livemode !== expected) {
    return 'mode_mismatch';
  }
  if (binding.revokedAt) {
    return 'revoked';
  }
  if (binding.disabledReason) {
    return 'restricted';
  }
  if (
    !binding.chargesEnabled
    && binding.detailsSubmitted
    && binding.requirements.currentlyDue.length === 0
  ) {
    // Dead end: everything was submitted, nothing is outstanding, and Stripe
    // still will not enable charges. "Resume onboarding" would be a loop.
    return 'blocked_needs_support';
  }
  if (binding.chargesEnabled) {
    const deadline = binding.requirements.currentDeadline;
    const soonCutoff = Date.now() + ACTION_SOON_DAYS * 24 * 60 * 60 * 1000;
    if (
      binding.requirements.eventuallyDue.length > 0
      || (deadline !== null && deadline.getTime() <= soonCutoff)
    ) {
      return 'action_needed_soon';
    }
    return 'charge_ready';
  }
  return 'onboarding_incomplete';
}

/**
 * The MONEY answer, as distinct from the display answer.
 *
 * `chargeReady` is `charges_enabled && not revoked && livemode agrees`. It is
 * deliberately NOT narrowed by `action_needed_soon`: an account with a non-empty
 * `eventually_due` is the ordinary steady state of a healthy Stripe account, and
 * treating it as un-chargeable would refuse deposits for very nearly every
 * salon. `action_needed_soon` is a display refinement of `charge_ready` and gates
 * nothing — which is exactly why the pinned union admits `chargeReady: true` only
 * alongside the literal `'charge_ready'`.
 */
function toDecision(
  binding: SalonStripeBinding | null,
  expected: boolean,
): ReadinessDecision {
  if (!binding) {
    return { chargeReady: false, status: 'not_connected', binding: null };
  }
  if (binding.livemode !== expected) {
    return { chargeReady: false, status: 'mode_mismatch', binding };
  }
  if (binding.revokedAt) {
    return { chargeReady: false, status: 'revoked', binding };
  }
  if (binding.chargesEnabled) {
    return {
      chargeReady: true,
      status: 'charge_ready',
      payoutsPending: !binding.payoutsEnabled,
      binding,
    };
  }
  const status = deriveConnectStatus(binding, expected);
  return {
    chargeReady: false,
    status: status === 'charge_ready' ? 'onboarding_incomplete' : status,
    binding,
  };
}

// =============================================================================
// PROVIDER FAILURE CLASSIFICATION
// =============================================================================

/**
 * Permanent means "retrying cannot change the answer": the account is gone, or
 * the platform may no longer act on it. Everything else is transient and must
 * stay retryable — defaulting an unrecognised error to permanent would silently
 * swallow a recoverable outage.
 *
 * VERIFY-AT-IMPLEMENTATION (V7): the exact error shape a *deauthorized* account
 * returns from `accounts.retrieve` is not settled from the docs and needs one
 * test-mode deauthorization to confirm. Defaulting it to transient is the safe
 * side here: a deauthorization also revokes the binding via the
 * `account.application.deauthorized` handler, after which the webhook's
 * "rows exist but none is live" arm terminal-ignores further deliveries, so the
 * unknown shape cannot produce a three-day retry storm.
 */
function classifyProviderError(error: unknown): 'permanent' | 'transient' {
  const candidate = error as { type?: string; code?: string; statusCode?: number };
  if (candidate?.type === 'StripePermissionError') {
    return 'permanent';
  }
  if (candidate?.code === 'resource_missing' || candidate?.code === 'permission_error') {
    return 'permanent';
  }
  if (candidate?.type === 'StripeInvalidRequestError' && candidate?.statusCode === 404) {
    return 'permanent';
  }
  return 'transient';
}

function requirementsFromAccount(
  account: Stripe.Account,
): StripeAccountRequirementsJson {
  const requirements = account.requirements;
  return {
    currently_due: requirements?.currently_due ?? [],
    eventually_due: requirements?.eventually_due ?? [],
    past_due: requirements?.past_due ?? [],
    pending_verification: requirements?.pending_verification ?? [],
    current_deadline: requirements?.current_deadline ?? null,
    future_current_deadline: account.future_requirements?.current_deadline ?? null,
    disabled_reason: requirements?.disabled_reason ?? null,
  };
}

// =============================================================================
// SYNC
// =============================================================================

/**
 * One `accounts.retrieve` followed by exactly one self-guarding CAS. No provider
 * call ever runs inside a transaction or while holding a lock.
 */
export async function syncAccountReadiness(
  binding: SalonStripeBinding,
): Promise<ReadinessDecision> {
  const expected = expectedLivemode();

  // Mode mismatch short-circuits with NO provider call: the key we hold cannot
  // meaningfully act on an account from the other mode.
  if (binding.livemode !== expected) {
    Sentry.captureMessage('stripe_connect_mode_mismatch', {
      level: 'error',
      tags: { integration: 'stripe-connect' },
      extra: { bindingId: binding.id, salonId: binding.salonId },
    });
    return { chargeReady: false, status: 'mode_mismatch', binding };
  }

  // Captured BEFORE the provider call so the staleness guard compares the moment
  // the data was true, not the moment the write happened.
  const fetchedAt = new Date();

  let account: Stripe.Account;
  try {
    // Platform key, no `Stripe-Account` header — none is needed anywhere in D2.
    account = await stripe.accounts.retrieve(binding.stripeAccountId);
  } catch (error) {
    throw new StripeConnectUnavailableError(
      classifyProviderError(error) === 'permanent'
        ? 'PROVIDER_PERMANENT'
        : 'PROVIDER_UNREACHABLE',
    );
  }

  // Log-only integrity cross-check. `metadata.salonId` is NEVER an authority for
  // tenant resolution; only the DB binding is.
  const metadataSalonId = account.metadata?.salonId;
  if (metadataSalonId && metadataSalonId !== binding.salonId) {
    Sentry.captureMessage('stripe_connect_metadata_salon_mismatch', {
      level: 'error',
      tags: { integration: 'stripe-connect' },
      extra: { bindingId: binding.id, salonId: binding.salonId },
    });
  }

  const requirementsDue = requirementsFromAccount(account);
  const disabledReason = requirementsDue.disabled_reason ?? null;

  // Addressing the row by its surrogate id makes the account-equality guard
  // implicit: a re-bind creates a DIFFERENT row, so old-account data can never
  // land on a new binding. `revoked_at IS NULL` stops a routine `account.updated`
  // — or an in-flight sync that started before a revocation — from writing
  // `charges_enabled = true` back onto a revoked binding (Luster's "disconnect"
  // is a local unlink, so Stripe legitimately still reports the account as
  // charge-enabled). The `last_synced_at` guard makes concurrent webhook and
  // on-demand syncs order-safe.
  await db
    .update(salonStripeAccountSchema)
    .set({
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      requirementsDue,
      disabledReason,
      lastSyncedAt: fetchedAt,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(salonStripeAccountSchema.id, binding.id),
      isNull(salonStripeAccountSchema.revokedAt),
      or(
        isNull(salonStripeAccountSchema.lastSyncedAt),
        lt(salonStripeAccountSchema.lastSyncedAt, fetchedAt),
      ),
    ));

  const refreshed = await loadLiveBinding(binding.salonId);
  // The binding disappeared from `live` between the retrieve and the read-back,
  // i.e. it was revoked concurrently. Report the revocation, not the readiness.
  if (!refreshed || refreshed.id !== binding.id) {
    return { chargeReady: false, status: 'revoked', binding };
  }

  return toDecision(refreshed, expected);
}

// =============================================================================
// THE TWO PINNED ENTRY POINTS
// =============================================================================

/**
 * DECISION-TIME GATE. ALWAYS performs `stripe.accounts.retrieve` — never returns
 * a cached value. THROWS `StripeConnectUnavailableError` on any provider/config
 * failure.
 *
 * Callers MUST call `refreshAccountReadiness` AT THE DECISION, OUTSIDE ANY
 * DATABASE TRANSACTION, and MUST fail closed on its throw AND on a resolved
 * `chargeReady:false`. The returned `ReadinessDecision` is an immutable snapshot
 * and MAY then be carried into a transaction and read there.
 * `getAccountReadinessForDisplay` is display-only and MUST NOT gate anything.
 *
 * Three cases resolve normally with `chargeReady:false` and do NOT throw, all
 * decided locally with no provider call: no binding row, a revoked binding, and
 * a stored `livemode` that disagrees with the expected one. A throw means "we
 * could not learn the truth"; a resolved `chargeReady:false` means "we learned it
 * and the answer is no". Only the throw is retryable.
 */
export async function refreshAccountReadiness(
  salonId: string,
): Promise<ReadinessDecision> {
  const expected = expectedLivemode();
  const binding = await loadLiveBinding(salonId);

  if (!binding) {
    return { chargeReady: false, status: 'not_connected', binding: null };
  }
  if (binding.revokedAt) {
    return { chargeReady: false, status: 'revoked', binding };
  }
  if (binding.livemode !== expected) {
    return { chargeReady: false, status: 'mode_mismatch', binding };
  }

  return syncAccountReadiness(binding);
}

/**
 * DISPLAY ONLY. Never throws. MUST NOT gate anything.
 *
 * The cached row may be arbitrarily stale — D2 ships no scheduled refresher on
 * purpose, because a freshness-bounded cached read is strictly weaker on the
 * money path than a proof taken in the decision itself. That staleness is
 * surfaced here rather than hidden, via `stale` and `lastSyncedAt`.
 */
export async function getAccountReadinessForDisplay(
  salonId: string,
  opts?: { maxAgeMs?: number },
): Promise<{
    decision: ReadinessDecision;
    stale: boolean;
    lastSyncedAt: Date | null;
  }> {
  let expected: boolean;
  try {
    expected = expectedLivemode();
  } catch {
    const cached = await loadLiveBinding(salonId).catch(() => null);
    return {
      decision: { chargeReady: false, status: 'mode_mismatch', binding: cached },
      stale: true,
      lastSyncedAt: cached?.lastSyncedAt ?? null,
    };
  }

  const cached = await loadLiveBinding(salonId);
  if (!cached) {
    return {
      decision: { chargeReady: false, status: 'not_connected', binding: null },
      stale: false,
      lastSyncedAt: null,
    };
  }

  const maxAgeMs = opts?.maxAgeMs;
  const withinMaxAge = maxAgeMs !== undefined
    && cached.lastSyncedAt !== null
    && Date.now() - cached.lastSyncedAt.getTime() <= maxAgeMs;

  if (withinMaxAge) {
    return {
      decision: toDecision(cached, expected),
      stale: false,
      lastSyncedAt: cached.lastSyncedAt,
    };
  }

  try {
    const decision = await syncAccountReadiness(cached);
    const refreshed = decision.binding ?? cached;
    return { decision, stale: false, lastSyncedAt: refreshed.lastSyncedAt };
  } catch {
    // Provider unreachable or permanently failing: fall back to what we last
    // knew and say plainly that it is unconfirmed.
    //
    // `chargeReady` FAILS CLOSED on this path even when the cached row says
    // charges were enabled. Nothing here gates money — but reporting
    // `chargeReady: true` from a value we could not confirm is exactly the trap
    // a future caller would fall into, and the flag costs nothing to get right.
    // `action_needed_soon` is the honest surviving literal: as far as we know the
    // account charges, and the thing needing attention is that we could not
    // confirm it.
    const cachedStatus = deriveConnectStatus(cached, expected);
    return {
      decision: {
        chargeReady: false,
        status: cachedStatus === 'charge_ready' ? 'action_needed_soon' : cachedStatus,
        binding: cached,
      },
      stale: true,
      lastSyncedAt: cached.lastSyncedAt,
    };
  }
}

export { toDecision };
