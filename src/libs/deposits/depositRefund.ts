import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db } from '@/libs/DB';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import { stripe } from '@/libs/stripe';
import {
  appointmentDepositSchema,
  stripeWebhookEventSchema,
} from '@/models/Schema';

import {
  applyRefundObservation,
  checkDepositSnapshotAccount,
  type DepositStatus,
  incrementRefundReconcileAttempts,
  mapStripeRefundErrorCode,
  openSystemRefundIntent,
  recordListedRefundCorpses,
  restoreRefundReconcileAttempt,
  retireStoredRefund,
  stampDepositRefund,
} from './depositLifecycle';

/** Every Stripe call on the refund path is explicitly bounded. */
export const DEPOSIT_STRIPE_CALL_TIMEOUT_MS = 10_000;
export const PARTIAL_REFUND_OBSERVED_NOTE
  = 'DEPOSIT_PARTIALLY_REFUNDED_EXTERNALLY' as const;

export type RefundTrigger = 'system' | 'owner' | 'external';
type KnownPersistedRefundTrigger = 'owner' | 'system_late_payment' | 'external';
export type PersistedRefundTrigger = KnownPersistedRefundTrigger;
export type DepositRow = typeof appointmentDepositSchema.$inferSelect;

export type RecoveryDisposition
  = | 'restored'
  | 'refunded'
  | 'already_confirmed'
  | 'already_confirmed_late_refund'
  | 'refund_failed_unreconciled'
  | 'orphan_unresolved'
  | 'noop';

export type RecoveryResult = {
  disposition: RecoveryDisposition;
  depositId: string;
  refundId?: string;
  note?: string;
};

export type RefundVariant = 'slot_lost' | 'waiver' | 'owner';

type RefundLike = Pick<Stripe.Refund, 'id' | 'status' | 'amount' | 'currency'> & {
  failure_reason?: string | null;
  metadata?: Stripe.Metadata | null;
};

export type RefundWorkClaim = {
  id: string;
  eventId: string;
  attempts: number;
};

type RefundWorkDisposition
  = { kind: 'claimed'; claim: RefundWorkClaim }
  | { kind: 'busy' | 'terminal' };

const LIVE_REFUND_STATUSES = new Set(['pending', 'succeeded', 'requires_action']);
const CORPSE_REFUND_STATUSES = new Set(['failed', 'canceled']);
const REFUND_WORK_STALE_MS = 15 * 60_000;

/**
 * The source-status set has one producer. The status disjunct is deliberate:
 * an externally-adopted or previously stamped refund rests at `refunded`, and
 * must still be retryable even when its historical trigger was not `owner`.
 */
export function resolveAllowedSourceStatuses(deposit: {
  status: string;
  refundTrigger?: PersistedRefundTrigger | null;
}): DepositStatus[] {
  if (deposit.status === 'paid' || deposit.status === 'refunded') {
    return ['paid', 'refunded'];
  }

  const trigger = deposit.refundTrigger;
  if (!isKnownPersistedRefundTrigger(trigger)) {
    const exhaustive: never = trigger;
    throw new Error(`unhandled refund trigger: ${String(exhaustive)}`);
  }

  switch (trigger) {
    case 'owner':
      return ['paid', 'refunded'];
    case 'system_late_payment':
    case 'external':
    case null:
    case undefined:
      return ['expired', 'canceled', 'checkout_created', 'waived'];
  }
}

function isKnownPersistedRefundTrigger(
  value: PersistedRefundTrigger | null | undefined,
): value is KnownPersistedRefundTrigger | null | undefined {
  return value === 'owner'
    || value === 'system_late_payment'
    || value === 'external'
    || value === null
    || value === undefined;
}

/** The single producer of both the refund-intent type and dedupe id. */
export function deriveRefundIntentIdentity(
  trigger: RefundTrigger,
  depositId: string,
  epoch: number,
): { type: 'luster.refund_intent' | 'luster.owner_refund_intent'; eventId: string } {
  const type = trigger === 'owner' ? 'luster.owner_refund_intent' : 'luster.refund_intent';
  return { type, eventId: `luster:${type}:${depositId}:e${epoch}` };
}

/** The refund key is derived only from persisted columns. */
export function buildRefundIdempotencyKey(deposit: {
  id: string;
  refundKeyEpoch: number;
  refundTerminalFailureCount: number;
}): string {
  return `deposit:${deposit.id}:auto-refund:v${deposit.refundKeyEpoch}:${deposit.refundTerminalFailureCount}`;
}

/**
 * The only path that may create a refund. Provider work is protected by the
 * epoch-scoped write-ahead row, and no database transaction spans a Stripe call.
 */
export async function createOrAdoptDepositRefund(
  inputDeposit: DepositRow,
  variant: RefundVariant,
  options: {
    trigger?: RefundTrigger;
    allowedSourceStatuses?: readonly DepositStatus[];
    /** A fenced claim already acquired by the stored-event dispatcher. */
    workClaim?: RefundWorkClaim;
  } = {},
): Promise<RecoveryResult> {
  const trigger = options.trigger ?? normalizeTrigger(inputDeposit.refundTrigger);
  const allowedSourceStatuses = options.allowedSourceStatuses
    ?? resolveAllowedSourceStatuses(inputDeposit);

  if (
    inputDeposit.refundRequestedEnv !== null
    && inputDeposit.refundRequestedEnv !== resolveRuntimeEnvironment()
  ) {
    return {
      disposition: 'noop',
      depositId: inputDeposit.id,
      note: 'environment_mismatch',
    };
  }

  // Step 0 precedes both TX-A0 and the provider-work lease.
  if (!allowedSourceStatuses.includes(inputDeposit.status as DepositStatus)) {
    return {
      disposition: 'noop',
      depositId: inputDeposit.id,
      note: `outside_entry_set:${inputDeposit.status}`,
    };
  }

  let deposit = inputDeposit;
  if (deposit.refundStatus === null) {
    const opened = await openSystemRefundIntent(deposit, allowedSourceStatuses);
    if (!opened) {
      return { disposition: 'noop', depositId: deposit.id, note: 'intent_cas_lost' };
    }
    deposit = opened;
  }

  if (options.workClaim) {
    const expectedIdentity = deriveRefundIntentIdentity(
      trigger,
      deposit.id,
      deposit.refundKeyEpoch,
    );
    if (options.workClaim.eventId !== expectedIdentity.eventId) {
      await finalizeNoCallWork(options.workClaim, 'refund_intent_identity_mismatch');
      return {
        disposition: 'noop',
        depositId: deposit.id,
        note: 'refund_intent_identity_mismatch',
      };
    }
  }

  const work: RefundWorkDisposition = options.workClaim
    ? { kind: 'claimed', claim: options.workClaim }
    : await acquireRefundWork(deposit, trigger);
  if (work.kind !== 'claimed') {
    return readLocalRefundResult(deposit, `write_ahead_${work.kind}`);
  }

  const accountState = await checkDepositSnapshotAccount(deposit);
  if (accountState !== 'ready') {
    await applyRefundObservation({
      deposit,
      refund: null,
      origin: 'account_preflight',
      errorCode: accountState,
      accountRefusal: accountState,
    });
    await finalizeNoCallWork(work.claim, accountState);
    return {
      disposition: 'noop',
      depositId: deposit.id,
      note: 'ACCOUNT_NOT_CHARGE_READY',
    };
  }

  const stripeAccount = requireSnapshotAccount(deposit);
  const corpseIdsObserved = new Set<string>();
  let providerReached = false;
  let attemptIncremented = false;

  try {
    if (deposit.stripeRefundId) {
      const stored = await retrieveRefund(deposit.stripeRefundId, stripeAccount);
      providerReached = true;
      if (stored && isAdoptableRefund(stored, deposit)) {
        return stampAndFinalize(deposit, stored, allowedSourceStatuses, variant, work.claim);
      }
      if (stored && isCorpse(stored)) {
        const retired = await retireStoredRefund(deposit, stored.id);
        if (!retired) {
          await finalizeProviderRetryable(work.claim, 'deposit_vanished');
          return { disposition: 'noop', depositId: deposit.id, note: 'deposit_vanished' };
        }
        deposit = retired;
        corpseIdsObserved.add(stored.id);
      }
    }

    let paymentIntentId = deposit.stripePaymentIntentId;
    if (!paymentIntentId && deposit.stripeCheckoutSessionId) {
      paymentIntentId = await retrieveSessionPaymentIntent(deposit, stripeAccount);
      providerReached = true;
    }

    if (!paymentIntentId) {
      if (providerReached) {
        await finalizeProviderRetryable(
          work.claim,
          'payment_intent_unresolved',
          'deferred_no_deposit',
        );
      } else {
        await finalizeNoCallWork(work.claim, 'payment_intent_unresolved');
      }
      return { disposition: 'noop', depositId: deposit.id, note: 'payment_intent_unresolved' };
    }

    // TX-C3 belongs immediately before the first list call and is unconditional.
    const countedAttempt = await incrementRefundReconcileAttempts(deposit);
    if (!countedAttempt) {
      if (providerReached) {
        await finalizeProviderRetryable(work.claim, 'deposit_vanished');
      } else {
        await finalizeNoCallWork(work.claim, 'deposit_vanished');
      }
      return { disposition: 'noop', depositId: deposit.id, note: 'deposit_vanished' };
    }
    deposit = countedAttempt;
    attemptIncremented = true;

    const existing = await listRefunds(paymentIntentId, stripeAccount);
    providerReached = true;
    const adoptable = existing.find(refund => isAdoptableRefund(refund, deposit));
    const partial = existing.find(refund => isPartialRefund(refund, deposit));
    existing.filter(isCorpse).forEach(refund => corpseIdsObserved.add(refund.id));

    if (partial) {
      await applyRefundObservation({
        deposit,
        refund: toObservation(partial),
        origin: 'listing',
        eventMetadataDepositId: partial.metadata?.luster_deposit_id ?? null,
      });
      await finalizeTerminalWork(
        work.claim,
        'refund_failed_unreconciled',
        'partial_refund_observed',
      );
      return {
        disposition: 'noop',
        depositId: deposit.id,
        note: PARTIAL_REFUND_OBSERVED_NOTE,
      };
    }

    if (adoptable) {
      return stampAndFinalize(deposit, adoptable, allowedSourceStatuses, variant, work.claim);
    }

    const counted = await recordListedRefundCorpses(
      deposit,
      corpseIdsObserved.size,
      [...corpseIdsObserved],
    );
    if (!counted) {
      await finalizeProviderRetryable(work.claim, 'deposit_vanished');
      return { disposition: 'noop', depositId: deposit.id, note: 'deposit_vanished' };
    }
    deposit = counted;

    const idempotencyKey = buildRefundIdempotencyKey(deposit);

    let created: Stripe.Response<Stripe.Refund>;
    try {
      created = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          metadata: {
            luster_deposit_id: deposit.id,
            luster_key_epoch: String(deposit.refundKeyEpoch),
          },
        },
        {
          stripeAccount,
          idempotencyKey,
          timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
        },
      );
    } catch (error) {
      return handleCreateFailure({
        error,
        deposit,
        paymentIntentId,
        stripeAccount,
        allowedSourceStatuses,
        variant,
        claim: work.claim,
      });
    }

    return stampAndFinalize(deposit, created, allowedSourceStatuses, variant, work.claim);
  } catch (error) {
    // Listing/retrieve failures are fail-closed: a create is never attempted
    // after an indeterminate listing result.
    const code = mapStripeRefundErrorCode(error);
    await recordTransientError(deposit, code);
    if (isTransportFailure(error)) {
      if (attemptIncremented) {
        await restoreRefundReconcileAttempt(deposit);
      }
      await finalizeNoCallWork(work.claim, code);
    } else {
      await finalizeProviderRetryable(work.claim, code);
    }
    Sentry.captureException(error, {
      tags: { surface: 'deposit-refund' },
      extra: { depositId: deposit.id },
    });
    return { disposition: 'noop', depositId: deposit.id, note: 'provider_retryable' };
  }
}

/** Compatibility name retained for D5's moved caller-free core. */
export const runRefundCore = createOrAdoptDepositRefund;

/**
 * List-only discovery. This function is structurally incapable of reaching the
 * sole `refunds.create` call site above.
 */
export async function discoverAndAdoptDepositRefunds(
  deposit: DepositRow,
): Promise<RecoveryResult> {
  const accountState = await checkDepositSnapshotAccount(deposit);
  if (accountState !== 'ready') {
    await applyRefundObservation({
      deposit,
      refund: null,
      origin: 'discovery_account_preflight',
      errorCode: accountState,
      accountRefusal: accountState,
    });
    return { disposition: 'noop', depositId: deposit.id, note: 'ACCOUNT_NOT_CHARGE_READY' };
  }

  const stripeAccount = requireSnapshotAccount(deposit);
  const paymentIntentId = deposit.stripePaymentIntentId
    ?? await retrieveSessionPaymentIntent(deposit, stripeAccount);

  if (!paymentIntentId) {
    return { disposition: 'noop', depositId: deposit.id, note: 'payment_intent_unresolved' };
  }

  let refunds: RefundLike[];
  try {
    refunds = await listRefunds(paymentIntentId, stripeAccount);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { surface: 'deposit-refund', operation: 'discovery' },
      extra: { depositId: deposit.id },
    });
    return { disposition: 'noop', depositId: deposit.id, note: 'listing_failed' };
  }

  const partial = refunds.find(refund => isPartialRefund(refund, deposit));
  if (partial) {
    await applyRefundObservation({
      deposit,
      refund: toObservation(partial),
      origin: 'external_discovery',
      eventMetadataDepositId: partial.metadata?.luster_deposit_id ?? null,
    });
  }

  const live = refunds.find(refund => isAdoptableRefund(refund, deposit));
  if (!live) {
    return { disposition: 'noop', depositId: deposit.id, note: 'no_adoptable_refund' };
  }

  const applied = await applyRefundObservation({
    deposit,
    refund: toObservation(live),
    origin: 'external_discovery',
    eventMetadataDepositId: live.metadata?.luster_deposit_id ?? null,
  });

  return applied.applied
    ? { disposition: 'refunded', depositId: deposit.id, refundId: live.id }
    : { disposition: 'noop', depositId: deposit.id, note: applied.outcome ?? 'observation_noop' };
}

async function handleCreateFailure(input: {
  error: unknown;
  deposit: DepositRow;
  paymentIntentId: string;
  stripeAccount: string;
  allowedSourceStatuses: readonly DepositStatus[];
  variant: RefundVariant;
  claim: RefundWorkClaim;
}): Promise<RecoveryResult> {
  const code = mapStripeRefundErrorCode(input.error);
  const providerCode = rawProviderCode(input.error);

  Sentry.captureException(input.error, {
    tags: { surface: 'deposit-refund' },
    extra: { depositId: input.deposit.id },
  });

  if (providerCode === 'platform_api_key_expired') {
    const accountState = await checkDepositSnapshotAccount(input.deposit);
    if (accountState !== 'ready') {
      await applyRefundObservation({
        deposit: input.deposit,
        refund: null,
        origin: 'account_preflight',
        errorCode: accountState,
        accountRefusal: accountState,
      });
      await restoreRefundReconcileAttempt(input.deposit);
      await finalizeNoCallWork(input.claim, accountState);
      return {
        disposition: 'noop',
        depositId: input.deposit.id,
        note: 'ACCOUNT_NOT_CHARGE_READY',
      };
    }
    await recordTransientError(input.deposit, code);
    await finalizeProviderRetryable(input.claim, code);
    return { disposition: 'noop', depositId: input.deposit.id, note: 'provider_retryable' };
  }

  if (providerCode === 'charge_already_refunded') {
    try {
      const relisted = await listRefunds(input.paymentIntentId, input.stripeAccount);
      const adopted = relisted.find(refund => isAdoptableRefund(refund, input.deposit));
      if (adopted) {
        return stampAndFinalize(
          input.deposit,
          adopted,
          input.allowedSourceStatuses,
          input.variant,
          input.claim,
        );
      }
    } catch (relistError) {
      const relistCode = mapStripeRefundErrorCode(relistError);
      await recordTransientError(input.deposit, relistCode);
      if (isTransportFailure(relistError)) {
        await restoreRefundReconcileAttempt(input.deposit);
        await finalizeNoCallWork(input.claim, relistCode);
      } else {
        await finalizeProviderRetryable(input.claim, relistCode);
      }
      return { disposition: 'noop', depositId: input.deposit.id, note: 'listing_failed' };
    }

    await applyRefundObservation({
      deposit: input.deposit,
      refund: null,
      origin: 'create_refused',
      errorCode: code,
    });
    await finalizeTerminalWork(input.claim, 'refund_create_refused', code);
    return { disposition: 'refund_failed_unreconciled', depositId: input.deposit.id, note: 'DEPOSIT_NOT_REFUNDABLE' };
  }

  if (isTransportFailure(input.error)) {
    await recordTransientError(input.deposit, code);
    await restoreRefundReconcileAttempt(input.deposit);
    await finalizeNoCallWork(input.claim, code);
    return { disposition: 'noop', depositId: input.deposit.id, note: 'provider_retryable' };
  }

  if (isTransientApiFailure(input.error)) {
    await recordTransientError(input.deposit, code);
    await finalizeProviderRetryable(input.claim, code);
    return { disposition: 'noop', depositId: input.deposit.id, note: 'provider_retryable' };
  }

  await applyRefundObservation({
    deposit: input.deposit,
    refund: null,
    origin: 'create_refused',
    errorCode: code,
  });
  await finalizeTerminalWork(input.claim, 'refund_create_refused', code);

  const note = code === 'charge_disputed' || code === 'refund_disputed_payment'
    ? 'DEPOSIT_CHARGE_DISPUTED'
    : 'provider_terminal';
  return { disposition: 'refund_failed_unreconciled', depositId: input.deposit.id, note };
}

async function stampAndFinalize(
  deposit: DepositRow,
  refund: RefundLike,
  allowedSourceStatuses: readonly DepositStatus[],
  variant: RefundVariant,
  claim: RefundWorkClaim,
): Promise<RecoveryResult> {
  const result = await stampDepositRefund({
    deposit,
    refund: toObservation(refund),
    allowedSourceStatuses,
    variant,
    workClaim: claim,
  });

  if (!result.ok) {
    if (result.leaveWorkOpen) {
      return { disposition: 'noop', depositId: deposit.id, note: 'write_ahead_fence_lost' };
    }
    await finalizeTerminalWork(claim, 'refund_failed_unreconciled', result.code);
    return { disposition: 'noop', depositId: deposit.id, note: result.code };
  }

  const outcome = result.disposition === 'already_confirmed_late_refund'
    ? 'already_confirmed_late_refund'
    : 'refunded';
  const finalized = result.eventFinalized
    || await finalizeTerminalWork(claim, outcome);
  if (!finalized) {
    return { disposition: 'noop', depositId: deposit.id, note: 'write_ahead_fence_lost' };
  }

  return {
    disposition: result.disposition === 'already_confirmed_late_refund'
      ? 'already_confirmed_late_refund'
      : 'refunded',
    depositId: result.deposit.id,
    refundId: result.refundId,
  };
}

async function acquireRefundWork(
  deposit: DepositRow,
  trigger: RefundTrigger,
): Promise<RefundWorkDisposition> {
  const identity = deriveRefundIntentIdentity(trigger, deposit.id, deposit.refundKeyEpoch);
  const now = new Date();
  const inserted = await db
    .insert(stripeWebhookEventSchema)
    .values({
      id: `swe_${crypto.randomUUID()}`,
      eventId: identity.eventId,
      type: identity.type,
      account: deposit.stripeAccountId,
      livemode: false,
      salonId: deposit.salonId,
      status: 'processing',
      attempts: 1,
      sessionId: deposit.stripeCheckoutSessionId,
      paymentIntentId: deposit.stripePaymentIntentId,
      metadataDepositId: deposit.id,
      projectionStatus: 'ok',
      receivedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: stripeWebhookEventSchema.eventId })
    .returning();

  if (inserted[0]) {
    return {
      kind: 'claimed',
      claim: { id: inserted[0].id, eventId: identity.eventId, attempts: inserted[0].attempts },
    };
  }

  const [stored] = await db
    .select()
    .from(stripeWebhookEventSchema)
    .where(eq(stripeWebhookEventSchema.eventId, identity.eventId))
    .limit(1);

  if (!stored) {
    return { kind: 'busy' };
  }
  if (stored.status !== 'processing' && stored.status !== 'failed_retryable') {
    return { kind: 'terminal' };
  }

  const staleBefore = new Date(now.getTime() - REFUND_WORK_STALE_MS);
  const reclaimable = stored.status === 'processing'
    ? stored.updatedAt < staleBefore
    : stored.availableAt !== null && stored.availableAt <= now;

  if (!reclaimable) {
    return { kind: 'busy' };
  }

  const [reclaimed] = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'processing',
      attempts: sql`${stripeWebhookEventSchema.attempts} + 1`,
      availableAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, stored.id),
      eq(stripeWebhookEventSchema.status, stored.status),
      eq(stripeWebhookEventSchema.attempts, stored.attempts),
    ))
    .returning();

  return reclaimed
    ? {
        kind: 'claimed',
        claim: { id: reclaimed.id, eventId: identity.eventId, attempts: reclaimed.attempts },
      }
    : { kind: 'busy' };
}

async function finalizeTerminalWork(
  claim: RefundWorkClaim,
  outcome:
    | 'refunded'
    | 'already_confirmed_late_refund'
    | 'refund_failed_unreconciled'
    | 'refund_create_refused',
  lastError: string | null = null,
): Promise<boolean> {
  const rows = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'processed',
      outcome,
      lastError,
      availableAt: null,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, claim.id),
      eq(stripeWebhookEventSchema.status, 'processing'),
      eq(stripeWebhookEventSchema.attempts, claim.attempts),
    ))
    .returning();
  return rows.length === 1;
}

async function finalizeProviderRetryable(
  claim: RefundWorkClaim,
  lastError: string,
  outcome: 'deferred_no_deposit' | null = null,
): Promise<boolean> {
  const rows = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'failed_retryable',
      outcome,
      lastError,
      availableAt: new Date(Date.now() + retryBackoffMs(claim.attempts)),
      processedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, claim.id),
      eq(stripeWebhookEventSchema.status, 'processing'),
      eq(stripeWebhookEventSchema.attempts, claim.attempts),
    ))
    .returning();
  return rows.length === 1;
}

async function finalizeNoCallWork(claim: RefundWorkClaim, lastError: string): Promise<boolean> {
  const rows = await db
    .update(stripeWebhookEventSchema)
    .set({
      status: 'failed_retryable',
      attempts: Math.max(0, claim.attempts - 1),
      outcome: null,
      lastError,
      availableAt: new Date(Date.now() + retryBackoffMs(Math.max(1, claim.attempts - 1))),
      processedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, claim.id),
      eq(stripeWebhookEventSchema.status, 'processing'),
      eq(stripeWebhookEventSchema.attempts, claim.attempts),
    ))
    .returning();
  return rows.length === 1;
}

async function recordTransientError(deposit: DepositRow, code: ReturnType<typeof mapStripeRefundErrorCode>) {
  await db
    .update(appointmentDepositSchema)
    .set({ refundLastErrorCode: mapStripeRefundErrorCode({ code }), updatedAt: new Date() })
    .where(and(
      eq(appointmentDepositSchema.id, deposit.id),
      eq(appointmentDepositSchema.salonId, deposit.salonId),
      eq(appointmentDepositSchema.refundStatus, 'requested'),
    ));
}

function readLocalRefundResult(deposit: DepositRow, note: string): RecoveryResult {
  return deposit.refundStatus === 'succeeded' && deposit.stripeRefundId
    ? { disposition: 'refunded', depositId: deposit.id, refundId: deposit.stripeRefundId, note }
    : { disposition: 'noop', depositId: deposit.id, note };
}

function normalizeTrigger(trigger: string | null): RefundTrigger {
  return trigger === 'owner' || trigger === 'external' ? trigger : 'system';
}

function requireSnapshotAccount(deposit: DepositRow): string {
  if (!deposit.stripeAccountId) {
    throw new Error(`deposit ${deposit.id} has no connected-account snapshot`);
  }
  return deposit.stripeAccountId;
}

function isAdoptableRefund(refund: RefundLike, deposit: DepositRow): boolean {
  return LIVE_REFUND_STATUSES.has(refund.status ?? '')
    && refund.amount === deposit.amountCents
    && refund.currency === deposit.currency;
}

function isPartialRefund(refund: RefundLike, deposit: DepositRow): boolean {
  return LIVE_REFUND_STATUSES.has(refund.status ?? '')
    && refund.currency === deposit.currency
    && refund.amount > 0
    && refund.amount < deposit.amountCents;
}

function isCorpse(refund: Pick<RefundLike, 'status'>): boolean {
  return CORPSE_REFUND_STATUSES.has(refund.status ?? '');
}

async function retrieveRefund(refundId: string, stripeAccount: string): Promise<RefundLike | null> {
  try {
    return await stripe.refunds.retrieve(refundId, {
      stripeAccount,
      timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
    });
  } catch (error) {
    if (rawProviderCode(error) === 'resource_missing') {
      return null;
    }
    throw error;
  }
}

async function listRefunds(paymentIntentId: string, stripeAccount: string): Promise<RefundLike[]> {
  const pagePromise = stripe.refunds.list(
    { payment_intent: paymentIntentId, limit: 100 },
    { stripeAccount, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS },
  );

  const autoPaging = (pagePromise as typeof pagePromise & {
    autoPagingToArray?: (options: { limit: number }) => Promise<Stripe.Refund[]>;
  }).autoPagingToArray;
  if (typeof autoPaging === 'function') {
    return autoPaging.call(pagePromise, { limit: 10_000 });
  }
  const page = await pagePromise;
  return page.data;
}

async function retrieveSessionPaymentIntent(
  deposit: DepositRow,
  stripeAccount: string,
): Promise<string | null> {
  if (!deposit.stripeCheckoutSessionId) {
    return null;
  }
  const session = await stripe.checkout.sessions.retrieve(
    deposit.stripeCheckoutSessionId,
    { stripeAccount, timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS },
  );
  const paymentIntent = session.payment_intent;
  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id ?? null;
}

function toObservation(refund: RefundLike) {
  return {
    id: refund.id,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    failure_reason: refund.failure_reason ?? undefined,
    metadata: refund.metadata ?? {},
  };
}

function rawProviderCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isTransientCode(code: string | null): boolean {
  return code === 'rate_limit' || code === 'lock_timeout' || code === 'idempotency_key_in_use';
}

function isTransientApiFailure(error: unknown): boolean {
  if (isTransientCode(rawProviderCode(error))) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as {
    statusCode?: unknown;
    raw?: { statusCode?: unknown };
  };
  const statusCode = typeof candidate.statusCode === 'number'
    ? candidate.statusCode
    : candidate.raw?.statusCode;
  return typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600;
}

function isTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return true;
  }
  const name = (error as { name?: unknown }).name;
  const type = (error as { type?: unknown }).type;
  const code = rawProviderCode(error);
  if (
    name === 'StripeConnectionError'
    || name === 'StripeAPIConnectionError'
    || type === 'StripeConnectionError'
    || type === 'StripeAPIConnectionError'
  ) {
    return true;
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return true;
  }
  // The canonical split is by shape: a provider/API rejection carries a
  // provider code (listed or future), while an unclassifiable transport throw
  // does not. Never turn an unknown coded rejection into a retry loop merely
  // because a test double or SDK wrapper omitted its `type` field.
  if (code !== null) {
    return false;
  }
  return !type?.toString().startsWith('Stripe');
}

function retryBackoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}
