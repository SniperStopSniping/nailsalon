import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { logAuditEvent, logAuditEventOrThrow } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { signOAuthState } from '@/libs/lusterSecurity';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { stripe } from '@/libs/stripe';
import { salonStripeAccountSchema } from '@/models/Schema';

import {
  expectedLivemode,
  type SalonStripeBinding,
  StripeConnectUnavailableError,
  toBinding,
} from './readiness';

/**
 * Account-identity plumbing: bind a salon to exactly one live Stripe account,
 * mint Stripe-hosted onboarding links, and revoke.
 *
 * BIND-3: `stripe_account_id` is NEVER updated in place. A re-bind INSERTs a new
 * row and the superseded row is retained with `revoked_at` + `revocation_cause`.
 * There is no UPDATE of that column and no DELETE anywhere in this module.
 */

export type ConnectActor = {
  actorId: string;
  viaSuperAdminWithoutMembership: boolean;
};

export type EnsureConnectedAccountResult =
  | { ok: true; binding: SalonStripeBinding; created: boolean }
  | {
    ok: false;
    code:
      | 'CONNECT_CREATE_REPLAYED'
      | 'CONNECT_ACCOUNT_SHAPE_REJECTED'
      | 'CONNECT_BINDING_INTEGRITY'
      | 'CONNECT_CREATE_IN_PROGRESS'
      | 'CONNECT_CREATE_PARAMS_CHANGED'
      | 'STRIPE_UNAVAILABLE';
  };

// =============================================================================
// READS
// =============================================================================

/** Every binding row for a salon, live and revoked, newest first. */
export async function getSalonBindings(
  salonId: string,
): Promise<SalonStripeBinding[]> {
  const rows = await db
    .select()
    .from(salonStripeAccountSchema)
    .where(eq(salonStripeAccountSchema.salonId, salonId));

  return rows.map(toBinding);
}

export async function getLiveBinding(
  salonId: string,
): Promise<SalonStripeBinding | null> {
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

/**
 * TENANT-1: resolution across live AND revoked rows. An old salon's genuine
 * in-flight events must resolve to that salon, not be classified as foreign.
 */
export async function getBindingsByStripeAccountId(
  stripeAccountId: string,
): Promise<SalonStripeBinding[]> {
  const rows = await db
    .select()
    .from(salonStripeAccountSchema)
    .where(eq(salonStripeAccountSchema.stripeAccountId, stripeAccountId));

  return rows.map(toBinding);
}

// =============================================================================
// IDEMPOTENCY KEY
// =============================================================================

/**
 * BIND-4. The key embeds the runtime environment and the salon's binding
 * GENERATION, and neither component is decorative:
 *
 * - A create that succeeded while the INSERT failed leaves the row count
 *   unchanged, so the retry sends the SAME key and Stripe replays the same
 *   account. That is the crash self-heal.
 * - After a revocation the row count is higher, so the key DIFFERS and Stripe
 *   creates a genuinely new account. That is what makes "re-bind" re-bind.
 * - A stable per-salon key would instead make re-bind a no-op for 24 hours and a
 *   real re-bind after that — one button with two behaviours selected by wall
 *   clock — and would re-bind a deauthorized salon to the very account the
 *   platform can no longer act on.
 * - The environment component stops a preview create from silently returning the
 *   dev account when dev and preview share one test-mode platform account.
 */
export function buildConnectIdempotencyKey(input: {
  runtimeEnvironment: string;
  salonId: string;
  generation: number;
}): string {
  return `luster:connect:acct:v1:${input.runtimeEnvironment}:${input.salonId}:${input.generation}`;
}

// =============================================================================
// CREATE / BIND
// =============================================================================

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

/**
 * Post-create shape assertion. The controller configuration is a product
 * commitment and is IMMUTABLE per account, so an account that came back shaped
 * differently must never be persisted — a binding row is the only thing that
 * makes an account chargeable, so refusing to write one leaves the stray account
 * inert.
 *
 * NOTE: `livemode` is deliberately NOT asserted here. Stripe's `Account` object
 * carries no `livemode` field (confirmed against the installed
 * `stripe@16.12.0` type definitions), so there is nothing provider-derived to
 * compare against; the binding row is stamped from `expectedLivemode()`, which is
 * the mode of the platform key that created the account and therefore its true
 * mode by construction.
 */
function accountShapeIsAcceptable(account: Stripe.Account): boolean {
  return account.controller?.stripe_dashboard?.type === 'full'
    && account.controller?.losses?.payments === 'stripe'
    && account.controller?.fees?.payer === 'account'
    && account.controller?.requirement_collection === 'stripe'
    && account.country === 'CA';
}

function classifyCreateFailure(
  error: unknown,
): 'CONNECT_CREATE_IN_PROGRESS' | 'CONNECT_CREATE_PARAMS_CHANGED' | 'STRIPE_UNAVAILABLE' {
  const candidate = error as { type?: string; code?: string; statusCode?: number };
  // Our deploy changed the create parameters while a 24h idempotency key was
  // still live. That is our fault, not Stripe's, and must never be reported as
  // an availability problem.
  if (candidate?.type === 'idempotency_error' || candidate?.code === 'idempotency_key_in_use') {
    return candidate?.code === 'idempotency_key_in_use'
      ? 'CONNECT_CREATE_IN_PROGRESS'
      : 'CONNECT_CREATE_PARAMS_CHANGED';
  }
  if (candidate?.statusCode === 409) {
    return 'CONNECT_CREATE_IN_PROGRESS';
  }
  return 'STRIPE_UNAVAILABLE';
}

/**
 * Idempotent bind. Rate limiting, `requireAdmin`, the salon-existence check and
 * the exposure gate all happen in the route, before this is ever called.
 *
 * `runtimeEnvironment` is passed in rather than resolved here on purpose: this
 * module must contain no second derivation of environment or mode. There is one
 * producer of expected livemode (`computeExpectedLivemode`) and the route owns
 * the runtime-environment lookup.
 *
 * No provider call runs inside a transaction or while holding a lock. The
 * sequence is: DB read → Stripe call → one self-guarding INSERT.
 */
export async function ensureConnectedAccount(params: {
  salonId: string;
  runtimeEnvironment: string;
  actor: ConnectActor;
}): Promise<EnsureConnectedAccountResult> {
  const { salonId, runtimeEnvironment, actor } = params;

  // Stamped from the one producer. Throws MODE_INDETERMINATE rather than
  // guessing, and the route converts that into a 503.
  const livemode = expectedLivemode();

  const existing = await getSalonBindings(salonId);
  const live = existing.find(row => row.revokedAt === null);
  if (live) {
    // Resume, never re-create.
    return { ok: true, binding: live, created: false };
  }

  const generation = existing.length;
  const idempotencyKey = buildConnectIdempotencyKey({
    runtimeEnvironment,
    salonId,
    generation,
  });

  let account: Stripe.Account;
  try {
    account = await stripe.accounts.create({
      country: 'CA',
      // Passed EXPLICITLY, never left to defaults. `stripe_dashboard.type` is
      // immutable per account, and `losses.payments: 'application'` would put
      // the PLATFORM on the hook for negative balances and chargebacks — the
      // exact inverse of the product decision. No `type`, no `capabilities`, and
      // no `application_fee_amount` (the pilot fee is 0%, and a positive value
      // is required whenever that parameter is present at all).
      controller: {
        losses: { payments: 'stripe' },
        fees: { payer: 'account' },
        requirement_collection: 'stripe',
        stripe_dashboard: { type: 'full' },
      },
      metadata: { salonId, luster_env: runtimeEnvironment },
    }, { idempotencyKey });
  } catch (error) {
    const code = classifyCreateFailure(error);
    if (code === 'CONNECT_CREATE_PARAMS_CHANGED') {
      Sentry.captureException(error, {
        tags: { integration: 'stripe-connect', stage: 'accounts.create' },
        extra: { salonId, generation },
      });
    }
    // Nothing persisted. The idempotency key makes a retry safe.
    return { ok: false, code };
  }

  if (!accountShapeIsAcceptable(account)) {
    void logAuditEvent({
      salonId,
      actorType: 'admin',
      actorId: actor.actorId,
      action: 'stripe_connect_account_shape_rejected',
      entityType: 'salon_stripe_account',
      metadata: {
        viaSuperAdminWithoutMembership: actor.viaSuperAdminWithoutMembership,
        controllerDashboardType: account.controller?.stripe_dashboard?.type ?? null,
        controllerLossesPayments: account.controller?.losses?.payments ?? null,
        controllerFeesPayer: account.controller?.fees?.payer ?? null,
        controllerRequirementCollection: account.controller?.requirement_collection ?? null,
        country: account.country ?? null,
      },
    });
    Sentry.captureMessage('stripe_connect_account_shape_rejected', {
      level: 'error',
      tags: { integration: 'stripe-connect' },
      extra: { salonId },
    });
    // Persist nothing. The created account is orphaned and inert: with no
    // binding row, no code path can charge on it.
    return { ok: false, code: 'CONNECT_ACCOUNT_SHAPE_REJECTED' };
  }

  // Replay guard: the idempotency key returned an account we have already seen
  // on ANY row for this salon (live or revoked). Persist nothing.
  if (existing.some(row => row.stripeAccountId === account.id)) {
    Sentry.captureMessage('stripe_connect_create_replayed', {
      level: 'error',
      tags: { integration: 'stripe-connect' },
      extra: { salonId, generation },
    });
    return { ok: false, code: 'CONNECT_CREATE_REPLAYED' };
  }

  try {
    const [inserted] = await db
      .insert(salonStripeAccountSchema)
      .values({
        id: `sacct_${crypto.randomUUID()}`,
        salonId,
        stripeAccountId: account.id,
        livemode,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      })
      .returning();

    if (!inserted) {
      return { ok: false, code: 'CONNECT_BINDING_INTEGRITY' };
    }

    if (generation === 0) {
      void logAuditEvent({
        salonId,
        actorType: 'admin',
        actorId: actor.actorId,
        action: 'stripe_connect_account_created',
        entityType: 'salon_stripe_account',
        entityId: inserted.id,
        metadata: {
          viaSuperAdminWithoutMembership: actor.viaSuperAdminWithoutMembership,
          newStripeAccountId: account.id,
          generation,
        },
      });
    } else {
      // Recovery-critical: a human reconstructing which account a salon was
      // bound to, and when, cannot do it from a swallowed audit write.
      await logAuditEventOrThrow({
        salonId,
        actorType: 'admin',
        actorId: actor.actorId,
        action: 'stripe_connect_account_rebound',
        entityType: 'salon_stripe_account',
        entityId: inserted.id,
        metadata: {
          viaSuperAdminWithoutMembership: actor.viaSuperAdminWithoutMembership,
          previousStripeAccountIds: existing.map(row => row.stripeAccountId),
          newStripeAccountId: account.id,
          generation,
        },
      });
    }

    return { ok: true, binding: toBinding(inserted), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // Classify by RE-READING OBSERVED STATE, never by constraint name: both
    // partial unique indexes can be violated by one ordinary double-click, so
    // which name Postgres reports is undetermined, and `error.constraint`
    // surfacing through the PGlite driver is itself unverified.
    const after = await getSalonBindings(salonId);
    const liveAfter = after.find(row => row.revokedAt === null);

    if (liveAfter && liveAfter.stripeAccountId === account.id) {
      // Our own create landed twice. Idempotent success: no orphan audit, no
      // error.
      return { ok: true, binding: liveAfter, created: false };
    }

    if (liveAfter) {
      // A concurrent request won the race with a DIFFERENT account. Never
      // overwrite — record the account we created and abandoned, and continue
      // with the winner.
      await logAuditEventOrThrow({
        salonId,
        actorType: 'admin',
        actorId: actor.actorId,
        action: 'stripe_connect_orphan_account',
        entityType: 'salon_stripe_account',
        entityId: liveAfter.id,
        metadata: {
          viaSuperAdminWithoutMembership: actor.viaSuperAdminWithoutMembership,
          orphanedStripeAccountId: account.id,
          winningStripeAccountId: liveAfter.stripeAccountId,
        },
      });
      return { ok: true, binding: liveAfter, created: false };
    }

    // No live row for THIS salon, yet the insert conflicted: the account is
    // bound live to ANOTHER salon. Fail closed. Any other 23505 shape lands
    // here too, deliberately.
    Sentry.captureException(error, {
      tags: { integration: 'stripe-connect', stage: 'binding-insert' },
      extra: { salonId, generation },
    });
    void logAuditEvent({
      salonId,
      actorType: 'admin',
      actorId: actor.actorId,
      action: 'stripe_connect_orphan_account',
      entityType: 'salon_stripe_account',
      metadata: {
        viaSuperAdminWithoutMembership: actor.viaSuperAdminWithoutMembership,
        orphanedStripeAccountId: account.id,
        integrityFailure: true,
      },
    });
    return { ok: false, code: 'CONNECT_BINDING_INTEGRITY' };
  }
}

// =============================================================================
// ONBOARDING LINK
// =============================================================================

/**
 * Links are single-use and minutes-lived: minted on demand, NEVER stored, NEVER
 * logged, NEVER emailed. An `account_update` link is unavailable for
 * full-dashboard accounts, so every resume re-mints an `account_onboarding` one.
 *
 * The signed state names a salon by ID and carries NO privilege by itself —
 * `requireAdmin(state.salonId)` still authorizes on the way back. The slug is
 * deliberately absent: admin cookies are `sameSite: 'lax'`, there is no Origin
 * check in middleware, and super-admins short-circuit the membership check, so a
 * single cross-site top-level GET carrying `?salon=<victim-slug>` would otherwise
 * mint a live onboarding link for another tenant and drop the wrong human into
 * identity and bank-account collection. A slug is also mutable, so a rename
 * mid-onboarding would 404 the return URL.
 */
export async function createOnboardingLink(
  binding: SalonStripeBinding,
  salon: { id: string },
): Promise<string> {
  const base = getCanonicalAppOrigin();
  // 24h, not the 600s default: an owner may legitimately spend twenty minutes
  // inside Stripe-hosted onboarding.
  const state = signOAuthState(
    { provider: 'stripe_connect', salonId: salon.id },
    86_400,
  );

  try {
    const link = await stripe.accountLinks.create({
      account: binding.stripeAccountId,
      type: 'account_onboarding',
      return_url: `${base}/api/integrations/stripe-connect/return?s=${state}`,
      refresh_url: `${base}/api/integrations/stripe-connect/refresh?s=${state}`,
    });
    return link.url;
  } catch (error) {
    const candidate = error as { type?: string; statusCode?: number };
    throw new StripeConnectUnavailableError(
      candidate?.type === 'StripePermissionError' || candidate?.statusCode === 404
        ? 'PROVIDER_PERMANENT'
        : 'PROVIDER_UNREACHABLE',
    );
  }
}

// =============================================================================
// REVOKE
// =============================================================================

/**
 * Operational alert for a binding that just went away.
 *
 * D2 ships this as a Sentry-level alert rather than an owner email: D2 enables no
 * deposits, so nothing customer-facing is interrupted yet, and adding a new
 * outbound email path is scope this PR does not own. The PR that turns deposits
 * on should upgrade this to reach the salon owner directly.
 */
export function emitConnectOwnerAlert(input: {
  salonId: string;
  stripeAccountId: string;
  cause: 'revoked_local' | 'deauthorized';
}): void {
  Sentry.captureMessage('stripe_connect_binding_revoked', {
    level: 'warning',
    tags: { integration: 'stripe-connect', cause: input.cause },
    extra: { salonId: input.salonId, stripeAccountId: input.stripeAccountId },
  });
}

/**
 * Rule W-SE: the audit row and the owner alert fire ONLY when the CAS reports
 * exactly one affected row, so a Stripe retry or a duplicate delivery cannot
 * re-emit them.
 *
 * Local unlink only. The platform cannot reject a Standard-equivalent account —
 * the salon keeps its Stripe account, its dashboard and its funds.
 */
export async function revokeBinding(
  bindingId: string,
  cause: 'revoked_local' | 'deauthorized',
  actor: ConnectActor & {
    salonId: string;
    stripeAccountId: string;
    reason?: string;
    /**
     * Supplied only by the webhook's deauthorization path, which must prove the
     * row it is revoking is the very account the event named. The owner-driven
     * disconnect reads its own live binding first and does not need it.
     */
    matchStripeAccountId?: string;
  },
): Promise<boolean> {
  const predicates = [
    eq(salonStripeAccountSchema.id, bindingId),
    isNull(salonStripeAccountSchema.revokedAt),
  ];
  if (actor.matchStripeAccountId) {
    predicates.push(
      eq(salonStripeAccountSchema.stripeAccountId, actor.matchStripeAccountId),
    );
  }

  const affected = await db
    .update(salonStripeAccountSchema)
    .set({
      revokedAt: sql`now()`,
      revocationCause: cause,
      chargesEnabled: false,
      payoutsEnabled: false,
      updatedAt: sql`now()`,
    })
    .where(and(...predicates))
    .returning();

  if (affected.length !== 1) {
    return false;
  }

  await logAuditEventOrThrow({
    salonId: actor.salonId,
    actorType: cause === 'deauthorized' ? 'webhook' : 'admin',
    actorId: actor.actorId,
    action: 'stripe_connect_account_revoked',
    entityType: 'salon_stripe_account',
    entityId: bindingId,
    metadata: {
      viaSuperAdminWithoutMembership: actor.viaSuperAdminWithoutMembership,
      previousStripeAccountId: actor.stripeAccountId,
      cause,
      reason: actor.reason ?? null,
    },
  });

  emitConnectOwnerAlert({
    salonId: actor.salonId,
    stripeAccountId: actor.stripeAccountId,
    cause,
  });

  return true;
}
