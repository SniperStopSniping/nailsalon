import 'server-only';

import * as Sentry from '@sentry/nextjs';
import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';

import type { AdminWithSalons } from '@/libs/adminAuth';
import type { AdminImpersonationSession } from '@/libs/adminImpersonation';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { resolveCheckoutActor } from '@/libs/appointmentCheckoutServer';
import { isSlotConstraintViolation } from '@/libs/bookingConflictGuard';
import { db } from '@/libs/DB';
import {
  classifyStripeFailure,
  DEPOSIT_HOLD_WINDOW_MINUTES,
  getDepositStripeClient,
} from '@/libs/depositCheckout';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import {
  enqueueDepositRefundAlertInTx,
  enqueueDepositRefundNotices,
  enqueueGoogleCalendarDeleteInTx,
} from '@/libs/integrationOutbox';
import { getPublicSentryRuntimeConfig } from '@/libs/sentry/runtime';
import { finalizeRetryable } from '@/libs/stripeConnect/webhookEvents';
import {
  appointmentAuditLogSchema,
  type AppointmentDeposit,
  appointmentDepositSchema,
  appointmentSchema,
  salonSchema,
  salonStripeAccountSchema,
  stripeWebhookEventSchema,
} from '@/models/Schema';

import { enqueueDepositConfirmationEffectsInTx } from './confirmDepositPayment';
import {
  depositsTransaction,
  type DepositsTransactionHandle,
} from './depositsTransaction';
import {
  claimOrRearmPollEvidenceWorkRow,
  pollEvidenceEventId,
} from './depositWebhookEvents';

export const DEPOSIT_REFUND_ERROR_CODES = [
  'charge_disputed',
  'refund_disputed_payment',
  'charge_already_refunded',
  'rate_limit',
  'lock_timeout',
  'idempotency_key_in_use',
  'platform_api_key_expired',
  'account_invalid',
  'livemode_mismatch',
  'ACCOUNT_DISCONNECTED',
  'ACCOUNT_REBOUND',
  'UNKNOWN_PROVIDER_ERROR',
] as const;

export const DEPOSIT_REFUND_FAILURE_REASONS = [
  'charge_for_pending_refund_disputed',
  'declined',
  'expired_or_canceled_card',
  'insufficient_funds',
  'lost_or_stolen_card',
  'merchant_request',
  'unknown',
] as const;

export const DEPOSIT_REFUND_STATUSES = [
  'requested',
  'pending',
  'succeeded',
  'failed',
] as const;

export type DepositRefundErrorCode = (typeof DEPOSIT_REFUND_ERROR_CODES)[number];
export type DepositRefundFailureReason = (typeof DEPOSIT_REFUND_FAILURE_REASONS)[number];
export type DepositRefundStatus = (typeof DEPOSIT_REFUND_STATUSES)[number];
export type DepositStatus =
  | 'checkout_created'
  | 'paid'
  | 'expired'
  | 'canceled'
  | 'refunded'
  | 'waived';
export type DepositRow = AppointmentDeposit;

const ERROR_CODE_SET: ReadonlySet<string> = new Set(DEPOSIT_REFUND_ERROR_CODES);
const FAILURE_REASON_SET: ReadonlySet<string> = new Set(DEPOSIT_REFUND_FAILURE_REASONS);
const TERMINAL_RETRY_ERROR_CODES: readonly DepositRefundErrorCode[] = [
  'charge_disputed',
  'refund_disputed_payment',
  'charge_already_refunded',
];
const SYSTEM_ACTOR: DepositActor = {
  recordedByType: 'admin',
  recordedById: 'system',
  recordedByName: null,
  performedBy: 'system',
  performedByRole: 'system',
  performedByName: null,
  requestedBy: 'system',
  requestedByRole: 'system',
  requestedByImpersonated: false,
  impersonated: false,
  superAdminUserId: null,
  impersonatedSalonId: null,
};

export type DepositActor = ReturnType<typeof resolveCheckoutActor> & {
  requestedBy: string;
  requestedByRole: 'admin' | 'system';
  requestedByImpersonated: boolean;
  impersonated: boolean;
  superAdminUserId: string | null;
  impersonatedSalonId: string | null;
};

export type RefundObservation = Pick<
  Stripe.Refund,
  'id' | 'status' | 'amount' | 'currency' | 'failure_reason' | 'metadata'
> & {
  payment_intent?: string | Stripe.PaymentIntent | null;
};

export type RefundObservationOrigin =
  | 'owner'
  | 'owner_retry'
  | 'webhook'
  | 'reconciler'
  | 'account_preflight'
  | 'discovery_account_preflight'
  | 'listing'
  | 'external_discovery'
  | 'create_refused'
  | 'luster_recovered'
  | 'external';

export type ApplyRefundObservationResult = {
  deposit: DepositRow | null;
  applied: boolean;
  eventFinalized?: boolean;
  outcome?:
    | 'ignored_same_state'
    | 'ignored_retired_refund'
    | 'ignored_amount_mismatch'
    | 'ignored_object_mismatch'
    | 'ignored_account_mismatch'
    | 'ignored_environment_mismatch'
    | 'ignored_unhandled'
    | 'ignored_unsupported_status';
};

export type DepositLifecycleFailureCode =
  | 'ACCOUNT_NOT_CHARGE_READY'
  | 'ACCOUNT_DISCONNECTED'
  | 'DEPOSIT_ALREADY_PAID'
  | 'DEPOSIT_CHARGE_DISPUTED'
  | 'DEPOSIT_NOT_FOUND'
  | 'DEPOSIT_NOT_REFUNDABLE'
  | 'DEPOSIT_PARTIALLY_REFUNDED_EXTERNALLY'
  | 'DEPOSIT_PAYMENT_PROCESSING'
  | 'HOLD_NOT_LIVE'
  | 'HOLD_SLOT_TAKEN'
  | 'REFUND_ALREADY_IN_FLIGHT'
  | 'REFUND_CONFLICT'
  | 'REFUND_RECONCILE_IN_FLIGHT';

export type DepositLifecycleResult =
  | {
    ok: true;
    disposition:
      | 'refund_requested'
      | 'refund_retried'
      | 'refund_updated'
      | 'refunded'
      | 'already_confirmed_late_refund'
      | 'waived'
      | 'released';
    deposit: DepositRow;
    refundId?: string;
    recovery?: unknown;
    eventFinalized?: boolean;
  }
  | {
    ok: false;
    status: 404 | 409;
    code: DepositLifecycleFailureCode;
    message: string;
    leaveWorkOpen?: boolean;
  };

export type DepositAuditMetadata = {
  depositId?: string;
  appointmentId?: string;
  refundId?: string;
  priorRefundId?: string;
  paymentIntentId?: string;
  stripeErrorCode?: DepositRefundErrorCode;
  failureReason?: DepositRefundFailureReason;
  terminalFailureCount?: number;
  keyEpoch?: number;
  trigger?: string;
  origin?: string;
  impersonated?: boolean;
  superAdminUserId?: string;
  impersonatedSalonId?: string;
};

export type RefundEventClaim = {
  id: string;
  attempts: number;
};

/**
 * The one total provider-error mapper. It never throws and never returns raw
 * provider text. In particular, balance_insufficient,
 * charge_not_refundable, and all future Stripe codes take the sentinel arm.
 */
export function mapStripeRefundErrorCode(error: unknown): DepositRefundErrorCode {
  try {
    const code = error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
    return typeof code === 'string' && ERROR_CODE_SET.has(code)
      ? code as DepositRefundErrorCode
      : 'UNKNOWN_PROVIDER_ERROR';
  } catch {
    return 'UNKNOWN_PROVIDER_ERROR';
  }
}

export function mapStripeRefundFailureReason(
  reason: unknown,
): DepositRefundFailureReason {
  return typeof reason === 'string' && FAILURE_REASON_SET.has(reason)
    ? reason as DepositRefundFailureReason
    : 'unknown';
}

export function buildDepositAuditMetadata(
  input: DepositAuditMetadata,
): DepositAuditMetadata {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as DepositAuditMetadata;
}

const DEPOSIT_AUDIT_METADATA_KEYS = [
  'depositId',
  'appointmentId',
  'refundId',
  'priorRefundId',
  'paymentIntentId',
  'stripeErrorCode',
  'failureReason',
  'terminalFailureCount',
  'keyEpoch',
  'trigger',
  'origin',
  'impersonated',
  'superAdminUserId',
  'impersonatedSalonId',
] as const;

/** Filters persisted jsonb before it reaches the admin audit response. */
export function filterDepositAuditMetadata(
  value: unknown,
): DepositAuditMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const filtered: Record<string, string | number | boolean> = {};
  for (const key of DEPOSIT_AUDIT_METADATA_KEYS) {
    const candidate = source[key];
    if (candidate === undefined || candidate === null) {
      continue;
    }
    if (key === 'stripeErrorCode') {
      if (typeof candidate === 'string' && ERROR_CODE_SET.has(candidate)) {
        filtered[key] = candidate;
      }
      continue;
    }
    if (key === 'failureReason') {
      if (typeof candidate === 'string' && FAILURE_REASON_SET.has(candidate)) {
        filtered[key] = candidate;
      }
      continue;
    }
    if (key === 'terminalFailureCount' || key === 'keyEpoch') {
      if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) {
        filtered[key] = candidate;
      }
      continue;
    }
    if (key === 'impersonated') {
      if (typeof candidate === 'boolean') {
        filtered[key] = candidate;
      }
      continue;
    }
    if (typeof candidate === 'string') {
      filtered[key] = candidate;
    }
  }
  return Object.keys(filtered).length > 0
    ? filtered as DepositAuditMetadata
    : null;
}

/**
 * Converts the admin-only guard shape to the shared checkout actor, then adds
 * the immutable impersonation facts needed by deposit rows and audit metadata.
 */
export function resolveDepositActor(access: {
  admin: AdminWithSalons;
  impersonation: AdminImpersonationSession | null;
  salonId: string;
}): DepositActor {
  if (access.admin.isSuperAdmin) {
    if (!access.impersonation || access.impersonation.salonId !== access.salonId) {
      throw new Error('SUPER_ADMIN_IMPERSONATION_CONTEXT_REQUIRED');
    }
  }

  const checkout = resolveCheckoutActor({
    actorRole: 'admin',
    admin: {
      id: access.admin.id,
      name: access.admin.name,
    },
  });
  const impersonated = Boolean(access.impersonation);

  return {
    ...checkout,
    requestedBy: access.admin.id,
    requestedByRole: 'admin',
    requestedByImpersonated: impersonated,
    impersonated,
    superAdminUserId: access.impersonation?.adminUserId ?? null,
    impersonatedSalonId: access.impersonation?.salonId ?? null,
  };
}

/**
 * I9 account-target preflight shared by every provider entry point.
 *
 * A live same-salon binding is ready. A same-salon revoked_local history row
 * remains ready only while no other salon has any binding for the account.
 * A same-pair deauthorization is disconnected. Every other shape is rebound.
 */
export async function checkDepositSnapshotAccount(
  deposit: Pick<DepositRow, 'salonId' | 'stripeAccountId'>,
): Promise<'ready' | 'ACCOUNT_DISCONNECTED' | 'ACCOUNT_REBOUND'> {
  const bindings = await db
    .select({
      salonId: salonStripeAccountSchema.salonId,
      revokedAt: salonStripeAccountSchema.revokedAt,
      revocationCause: salonStripeAccountSchema.revocationCause,
    })
    .from(salonStripeAccountSchema)
    .where(eq(salonStripeAccountSchema.stripeAccountId, deposit.stripeAccountId));

  const pairRows = bindings.filter(binding => binding.salonId === deposit.salonId);
  const hasOtherSalonBinding = bindings.some(binding =>
    binding.salonId !== deposit.salonId);
  if (hasOtherSalonBinding) {
    return 'ACCOUNT_REBOUND';
  }
  if (pairRows.some(binding => binding.revokedAt === null)) {
    return 'ready';
  }
  if (pairRows.some(binding =>
    binding.revokedAt !== null && binding.revocationCause === 'deauthorized')) {
    return 'ACCOUNT_DISCONNECTED';
  }

  const hasRevokedLocalPair = pairRows.some(binding =>
    binding.revokedAt !== null && binding.revocationCause === 'revoked_local');
  return hasRevokedLocalPair
    ? 'ready'
    : 'ACCOUNT_REBOUND';
}

function refundStatus(refund: RefundObservation): DepositRefundStatus | null {
  switch (refund.status) {
    case 'pending':
    case 'requires_action':
      return 'pending';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return null;
  }
}

function depositFailure(
  code: DepositLifecycleFailureCode,
  message: string,
  status: 404 | 409 = 409,
): Extract<DepositLifecycleResult, { ok: false }> {
  return { ok: false, status, code, message };
}

function actorAuditMetadata(
  actor: DepositActor,
  extra: DepositAuditMetadata,
): DepositAuditMetadata {
  return buildDepositAuditMetadata({
    ...extra,
    impersonated: actor.impersonated,
    ...(actor.superAdminUserId
      ? { superAdminUserId: actor.superAdminUserId }
      : {}),
    ...(actor.impersonatedSalonId
      ? { impersonatedSalonId: actor.impersonatedSalonId }
      : {}),
  });
}

async function insertDepositAudit(
  tx: DepositsTransactionHandle,
  input: {
    deposit: Pick<DepositRow, 'id' | 'appointmentId' | 'salonId'>;
    action:
      | 'deposit_refund_requested'
      | 'deposit_refund_retried'
      | 'deposit_refund_updated'
      | 'deposit_refund_succeeded'
      | 'deposit_refund_failed'
      | 'deposit_external_refund_observed'
      | 'deposit_waived'
      | 'deposit_hold_released';
    actor: DepositActor;
    reason: string;
    previousValue?: Record<string, unknown>;
    metadata: DepositAuditMetadata;
  },
): Promise<void> {
  await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
    appointmentId: input.deposit.appointmentId,
    salonId: input.deposit.salonId,
    action: input.action,
    performedBy: input.actor.performedBy,
    performedByRole: input.actor.performedByRole,
    performedByName: input.actor.performedByName ?? undefined,
    previousValue: input.previousValue,
    newValue: input.metadata,
    reason: input.reason,
  }));
}

class RefundEventFenceLostError extends Error {
  constructor() {
    super('REFUND_EVENT_FENCE_LOST');
  }
}

/**
 * Fenced completion used by TX-B and TX-E. Keeping this update on the caller's
 * transaction makes the deposit write, immutable audit row, durable notices,
 * and work-row completion one commit.
 */
async function finalizeRefundEventInTx(
  tx: DepositsTransactionHandle,
  claim: RefundEventClaim,
  outcome: 'refunded',
): Promise<void> {
  const [finalized] = await tx
    .update(stripeWebhookEventSchema)
    .set({
      status: 'processed',
      outcome,
      lastError: null,
      availableAt: null,
      processedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(stripeWebhookEventSchema.id, claim.id),
      eq(stripeWebhookEventSchema.status, 'processing'),
      eq(stripeWebhookEventSchema.attempts, claim.attempts),
    ))
    .returning();
  if (!finalized) {
    throw new RefundEventFenceLostError();
  }
}

/**
 * Runs an audited appointment+deposit mutation with the canonical lock order.
 * No retry wrapper is used: OD6-D-11 was explicitly declined.
 */
async function withAppointmentFirstDepositLock<T>(
  snapshot: Pick<DepositRow, 'id' | 'appointmentId' | 'salonId'>,
  operation: (
    tx: DepositsTransactionHandle,
    locked: DepositRow,
  ) => Promise<T>,
): Promise<T | null> {
  return depositsTransaction(db, async (tx) => {
    const [appointment] = await tx
      .select({ id: appointmentSchema.id })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, snapshot.appointmentId),
        eq(appointmentSchema.salonId, snapshot.salonId),
      ))
      .for('update')
      .limit(1);
    if (!appointment) {
      return null;
    }

    const [locked] = await tx
      .select()
      .from(appointmentDepositSchema)
      .where(and(
        eq(appointmentDepositSchema.id, snapshot.id),
        eq(appointmentDepositSchema.salonId, snapshot.salonId),
      ))
      .for('update')
      .limit(1);
    if (!locked) {
      return null;
    }

    return operation(tx, locked);
  });
}

/** TX-A0: the core opens a system intent before write-ahead work or Stripe. */
export async function openSystemRefundIntent(
  deposit: DepositRow,
  allowedSourceStatuses: readonly DepositStatus[],
): Promise<DepositRow | null> {
  return withAppointmentFirstDepositLock(deposit, async (tx, locked) => {
    const [opened] = await tx
      .update(appointmentDepositSchema)
      .set({
        refundStatus: 'requested',
        refundStatusChangedAt: sql`now()`,
        refundRequestedAt: sql`now()`,
        refundRequestedBy: 'system',
        refundRequestedByRole: 'system',
        refundRequestedImpersonated: false,
        refundTrigger: 'system_late_payment',
        refundRequestedEnv: resolveRuntimeEnvironment(),
        refundReconcileAttempts: 0,
        refundReconcileClaimedAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentDepositSchema.id, locked.id),
        eq(appointmentDepositSchema.salonId, locked.salonId),
        inArray(appointmentDepositSchema.status, [...allowedSourceStatuses]),
        isNull(appointmentDepositSchema.refundStatus),
        lt(appointmentDepositSchema.refundTerminalFailureCount, 3),
        isNull(appointmentDepositSchema.externalRefundObservedCents),
      ))
      .returning();
    if (!opened) {
      return null;
    }

    await insertDepositAudit(tx, {
      deposit: opened,
      action: 'deposit_refund_requested',
      actor: SYSTEM_ACTOR,
      reason: 'system_late_payment',
      previousValue: { refundStatus: locked.refundStatus },
      metadata: actorAuditMetadata(SYSTEM_ACTOR, {
        depositId: opened.id,
        appointmentId: opened.appointmentId,
        paymentIntentId: opened.stripePaymentIntentId ?? undefined,
        terminalFailureCount: opened.refundTerminalFailureCount,
        keyEpoch: opened.refundKeyEpoch,
        trigger: 'system_late_payment',
        origin: 'system',
      }),
    });
    return opened;
  });
}

/** TX-C3: committed immediately before refunds.list, never at lease claim. */
export async function incrementRefundReconcileAttempts(
  deposit: Pick<DepositRow, 'id' | 'salonId'>,
): Promise<DepositRow | null> {
  const [updated] = await db
    .update(appointmentDepositSchema)
    .set({
      refundReconcileAttempts: sql`${appointmentDepositSchema.refundReconcileAttempts} + 1`,
      refundLastErrorCode: sql`CASE
        WHEN ${appointmentDepositSchema.refundLastErrorCode}
          IN ('ACCOUNT_DISCONNECTED','ACCOUNT_REBOUND') THEN NULL
        ELSE ${appointmentDepositSchema.refundLastErrorCode}
      END`,
    })
    .where(and(
      eq(appointmentDepositSchema.id, deposit.id),
      eq(appointmentDepositSchema.salonId, deposit.salonId),
    ))
    .returning();
  return updated ?? null;
}

/** A transport/no-call bounce restores the TX-C3 budget it could not spend. */
export async function restoreRefundReconcileAttempt(
  deposit: Pick<DepositRow, 'id' | 'salonId'>,
): Promise<DepositRow | null> {
  const [updated] = await db
    .update(appointmentDepositSchema)
    .set({
      refundReconcileAttempts: sql`GREATEST(
        ${appointmentDepositSchema.refundReconcileAttempts} - 1,
        0
      )`,
    })
    .where(and(
      eq(appointmentDepositSchema.id, deposit.id),
      eq(appointmentDepositSchema.salonId, deposit.salonId),
      sql`${appointmentDepositSchema.refundReconcileAttempts} > 0`,
    ))
    .returning();
  return updated ?? null;
}

/** Sweep TX-C: lease only. It deliberately never spends the attempt budget. */
export async function claimRefundReconcileLease(args: {
  depositId: string;
  salonId: string;
  expectedStatus?: DepositRefundStatus | null;
  leaseBefore?: Date;
}): Promise<DepositRow | null> {
  const available = args.leaseBefore ?? new Date(Date.now() - 15 * 60_000);
  const statusPredicate = args.expectedStatus === null
    ? isNull(appointmentDepositSchema.refundStatus)
    : args.expectedStatus
      ? eq(appointmentDepositSchema.refundStatus, args.expectedStatus)
      : undefined;
  const [claimed] = await db
    .update(appointmentDepositSchema)
    .set({
      refundReconcileClaimedAt: sql`now()`,
    })
    .where(and(
      eq(appointmentDepositSchema.id, args.depositId),
      eq(appointmentDepositSchema.salonId, args.salonId),
      statusPredicate,
      or(
        isNull(appointmentDepositSchema.refundReconcileClaimedAt),
        lt(appointmentDepositSchema.refundReconcileClaimedAt, available),
      ),
    ))
    .returning();
  return claimed ?? null;
}

/**
 * Commits the set-derived corpse count before an idempotency key is derived.
 * The count is money state, so the update and its audit are one transaction.
 */
export async function recordListedRefundCorpses(
  deposit: DepositRow,
  count: number,
  refundIds: readonly string[] = [],
): Promise<DepositRow | null> {
  return withAppointmentFirstDepositLock(deposit, async (tx, locked) => {
    const newlyObservedIds = [...new Set(refundIds)]
      .filter(refundId => refundId && !locked.priorRefundIds.includes(refundId));
    const priorRefundIds = [...locked.priorRefundIds, ...newlyObservedIds];
    const observed = Math.max(0, Math.trunc(count), priorRefundIds.length);
    if (
      newlyObservedIds.length === 0
      && observed <= locked.refundTerminalFailureCount
    ) {
      return locked;
    }
    const [updated] = await tx
      .update(appointmentDepositSchema)
      .set({
        priorRefundIds,
        refundTerminalFailureCount: sql`GREATEST(${appointmentDepositSchema.refundTerminalFailureCount}, ${observed})`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentDepositSchema.id, locked.id),
        eq(appointmentDepositSchema.salonId, locked.salonId),
      ))
      .returning();
    if (!updated) {
      return locked;
    }

    await insertDepositAudit(tx, {
      deposit: updated,
      action: 'deposit_refund_failed',
      actor: SYSTEM_ACTOR,
      reason: 'listing',
      previousValue: {
        priorRefundIds: locked.priorRefundIds,
        terminalFailureCount: locked.refundTerminalFailureCount,
      },
      metadata: actorAuditMetadata(SYSTEM_ACTOR, {
        depositId: updated.id,
        appointmentId: updated.appointmentId,
        priorRefundId: newlyObservedIds[0],
        terminalFailureCount: updated.refundTerminalFailureCount,
        keyEpoch: updated.refundKeyEpoch,
        origin: 'listing',
      }),
    });
    return updated;
  });
}

/** Retires one stored corpse as a set member before the core continues. */
export async function retireStoredRefund(
  deposit: DepositRow,
  refundId: string,
): Promise<DepositRow | null> {
  return withAppointmentFirstDepositLock(deposit, async (tx, locked) => {
    if (locked.priorRefundIds.includes(refundId) && locked.stripeRefundId !== refundId) {
      return locked;
    }

    const [updated] = await tx
      .update(appointmentDepositSchema)
      .set({
        priorRefundIds: sql`CASE
          WHEN ${refundId} = ANY(COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'))
            THEN ${appointmentDepositSchema.priorRefundIds}
          ELSE array_append(
            COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'),
            ${refundId}
          )
        END`,
        stripeRefundId: sql`CASE
          WHEN ${appointmentDepositSchema.stripeRefundId} = ${refundId} THEN NULL
          ELSE ${appointmentDepositSchema.stripeRefundId}
        END`,
        refundAmountCents: sql`CASE
          WHEN ${appointmentDepositSchema.stripeRefundId} = ${refundId} THEN NULL
          ELSE ${appointmentDepositSchema.refundAmountCents}
        END`,
        refundTerminalFailureCount: sql`GREATEST(
          ${appointmentDepositSchema.refundTerminalFailureCount},
          COALESCE(array_length(${appointmentDepositSchema.priorRefundIds}, 1), 0) +
            CASE WHEN ${refundId} = ANY(COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'))
              THEN 0 ELSE 1 END
        )`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentDepositSchema.id, locked.id),
        eq(appointmentDepositSchema.salonId, locked.salonId),
        sql`(${appointmentDepositSchema.stripeRefundId} = ${refundId}
          OR NOT (${refundId} = ANY(COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'))))`,
      ))
      .returning();
    if (!updated) {
      return locked;
    }

    await insertDepositAudit(tx, {
      deposit: updated,
      action: 'deposit_refund_failed',
      actor: SYSTEM_ACTOR,
      reason: 'reconciler',
      previousValue: {
        refundId: locked.stripeRefundId,
        terminalFailureCount: locked.refundTerminalFailureCount,
      },
      metadata: actorAuditMetadata(SYSTEM_ACTOR, {
        depositId: updated.id,
        appointmentId: updated.appointmentId,
        priorRefundId: refundId,
        terminalFailureCount: updated.refundTerminalFailureCount,
        keyEpoch: updated.refundKeyEpoch,
        origin: 'reconciler',
      }),
    });
    return updated;
  });
}

async function loadDepositById(
  depositId: string,
  salonId: string,
): Promise<DepositRow | null> {
  const [deposit] = await db
    .select()
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, depositId),
      eq(appointmentDepositSchema.salonId, salonId),
    ))
    .limit(1);
  return deposit ?? null;
}

function requestedByValues(actor: DepositActor) {
  return {
    refundRequestedAt: sql`now()`,
    refundRequestedBy: actor.requestedBy,
    refundRequestedByRole: actor.requestedByRole,
    refundRequestedImpersonated: actor.requestedByImpersonated,
  } as const;
}

async function runOwnerRefundCore(deposit: DepositRow): Promise<DepositLifecycleResult> {
  const {
    createOrAdoptDepositRefund,
    PARTIAL_REFUND_OBSERVED_NOTE,
    resolveAllowedSourceStatuses,
  } = await import('./depositRefund');
  const allowedSourceStatuses = resolveAllowedSourceStatuses(deposit);
  const trigger = deposit.refundTrigger === 'owner'
    ? 'owner'
    : deposit.refundTrigger === 'external'
      ? 'external'
      : 'system';
  const recovery = await createOrAdoptDepositRefund(deposit, 'owner', {
    trigger,
    allowedSourceStatuses,
  });
  if (recovery.note === 'DEPOSIT_CHARGE_DISPUTED') {
    return depositFailure(
      'DEPOSIT_CHARGE_DISPUTED',
      'Stripe will not refund a disputed charge. Reconcile it in the salon Stripe Dashboard.',
    );
  }
  if (recovery.note === 'DEPOSIT_NOT_REFUNDABLE') {
    return depositFailure(
      'DEPOSIT_NOT_REFUNDABLE',
      'Stripe reports that this charge is not refundable. Reconcile it in the salon Stripe Dashboard.',
    );
  }
  if (recovery.note === PARTIAL_REFUND_OBSERVED_NOTE) {
    return depositFailure(
      'DEPOSIT_PARTIALLY_REFUNDED_EXTERNALLY',
      'This deposit was partly refunded in Stripe. Finish reconciling it in the salon Stripe Dashboard.',
    );
  }
  if (recovery.note === 'ACCOUNT_NOT_CHARGE_READY') {
    return depositFailure(
      'ACCOUNT_NOT_CHARGE_READY',
      'The charge belongs to a Stripe account the salon cannot currently use. No provider call was made.',
    );
  }
  if (recovery.disposition === 'refund_failed_unreconciled') {
    return depositFailure(
      'DEPOSIT_NOT_REFUNDABLE',
      'Stripe refused this refund. Reconcile it in the salon Stripe Dashboard.',
    );
  }
  const current = await loadDepositById(deposit.id, deposit.salonId);
  if (!current) {
    return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
  }
  return {
    ok: true,
    disposition: current.refundStatus === 'succeeded'
      ? 'refunded'
      : 'refund_updated',
    deposit: current,
    ...(current.stripeRefundId ? { refundId: current.stripeRefundId } : {}),
    recovery,
  };
}

/** Owner row 1 (TX-A), followed by the single refund core outside the tx. */
export async function requestDepositRefund(args: {
  depositId: string;
  salonId: string;
  actor: DepositActor;
}): Promise<DepositLifecycleResult> {
  const snapshot = await loadDepositById(args.depositId, args.salonId);
  if (!snapshot) {
    return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
  }

  const opened = await withAppointmentFirstDepositLock(snapshot, async (tx, locked) => {
    const [updated] = await tx
      .update(appointmentDepositSchema)
      .set({
        refundStatus: 'requested',
        refundStatusChangedAt: sql`now()`,
        ...requestedByValues(args.actor),
        refundTrigger: 'owner',
        refundRequestedEnv: resolveRuntimeEnvironment(),
        refundReconcileAttempts: 0,
        refundReconcileClaimedAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(appointmentDepositSchema.id, locked.id),
        eq(appointmentDepositSchema.salonId, locked.salonId),
        eq(appointmentDepositSchema.status, 'paid'),
        isNull(appointmentDepositSchema.refundStatus),
        lt(appointmentDepositSchema.refundTerminalFailureCount, 3),
        isNull(appointmentDepositSchema.externalRefundObservedCents),
      ))
      .returning();
    if (!updated) {
      return null;
    }

    await insertDepositAudit(tx, {
      deposit: updated,
      action: 'deposit_refund_requested',
      actor: args.actor,
      reason: 'owner',
      previousValue: { refundStatus: locked.refundStatus },
      metadata: actorAuditMetadata(args.actor, {
        depositId: updated.id,
        appointmentId: updated.appointmentId,
        paymentIntentId: updated.stripePaymentIntentId ?? undefined,
        terminalFailureCount: updated.refundTerminalFailureCount,
        keyEpoch: updated.refundKeyEpoch,
        trigger: 'owner',
        origin: 'owner',
      }),
    });
    return updated;
  });

  if (!opened) {
    const current = await loadDepositById(args.depositId, args.salonId);
    if (!current) {
      return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
    }
    if (current.externalRefundObservedCents !== null) {
      return depositFailure(
        'DEPOSIT_PARTIALLY_REFUNDED_EXTERNALLY',
        'This deposit was partly refunded in Stripe. Finish reconciling it in the salon Stripe Dashboard.',
      );
    }
    if (current.status !== 'paid') {
      return depositFailure('DEPOSIT_NOT_REFUNDABLE', 'Only a paid deposit can be refunded.');
    }
    if (current.refundTerminalFailureCount >= 3) {
      return depositFailure(
        'DEPOSIT_NOT_REFUNDABLE',
        'This deposit reached its refund attempt limit. Reconcile it in the salon Stripe Dashboard.',
      );
    }
    return depositFailure(
      'REFUND_ALREADY_IN_FLIGHT',
      'A refund has already been requested for this deposit.',
    );
  }

  return runOwnerRefundCore(opened);
}

/** Owner-only rows 8 and 9, each appointment-first and audit-coupled. */
export async function retryFailedDepositRefund(args: {
  depositId: string;
  salonId: string;
  actor: DepositActor;
}): Promise<DepositLifecycleResult> {
  const snapshot = await loadDepositById(args.depositId, args.salonId);
  if (!snapshot) {
    return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
  }

  const retried = await withAppointmentFirstDepositLock(snapshot, async (tx, locked) => {
    const leaseFree = or(
      isNull(appointmentDepositSchema.refundReconcileClaimedAt),
      lt(
        appointmentDepositSchema.refundReconcileClaimedAt,
        sql`now() - interval '15 minutes'`,
      ),
    );
    const common = [
      eq(appointmentDepositSchema.id, locked.id),
      eq(appointmentDepositSchema.salonId, locked.salonId),
      lt(appointmentDepositSchema.refundTerminalFailureCount, 3),
      lt(appointmentDepositSchema.refundKeyEpoch, 4),
      isNull(appointmentDepositSchema.externalRefundObservedCents),
      sql`COALESCE(${appointmentDepositSchema.refundLastErrorCode}, '')
        NOT IN ('charge_disputed','refund_disputed_payment','charge_already_refunded')`,
      leaseFree,
    ];

    const priorRefundId = locked.stripeRefundId;
    const failedBranch = locked.refundStatus === 'failed';
    const abandonedBranch = locked.refundStatus === 'requested';
    if (!failedBranch && !abandonedBranch) {
      return null;
    }

    const [updated] = await tx
      .update(appointmentDepositSchema)
      .set(failedBranch
        ? {
            refundStatus: 'requested',
            refundStatusChangedAt: sql`now()`,
            refundKeyEpoch: sql`${appointmentDepositSchema.refundKeyEpoch} + 1`,
            priorRefundIds: sql`CASE
              WHEN ${appointmentDepositSchema.stripeRefundId} IS NULL
                OR ${appointmentDepositSchema.stripeRefundId}
                  = ANY(COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'))
                THEN ${appointmentDepositSchema.priorRefundIds}
              ELSE array_append(
                COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'),
                ${appointmentDepositSchema.stripeRefundId}
              )
            END`,
            stripeRefundId: null,
            refundAmountCents: null,
            refundedAt: null,
            refundLastErrorCode: null,
            refundConflictFlag: false,
            refundReconcileAttempts: 0,
            refundReconcileClaimedAt: null,
            ...requestedByValues(args.actor),
            updatedAt: new Date(),
          }
        : {
            refundStatusChangedAt: sql`now()`,
            refundKeyEpoch: sql`${appointmentDepositSchema.refundKeyEpoch} + 1`,
            refundReconcileAttempts: 0,
            refundReconcileClaimedAt: null,
            refundLastErrorCode: null,
            refundConflictFlag: false,
            ...requestedByValues(args.actor),
            updatedAt: new Date(),
          })
      .where(and(
        ...common,
        failedBranch
          ? eq(appointmentDepositSchema.refundStatus, 'failed')
          : and(
            eq(appointmentDepositSchema.refundStatus, 'requested'),
            or(
              sql`${appointmentDepositSchema.refundReconcileAttempts} >= 3`,
              lt(
                appointmentDepositSchema.refundStatusChangedAt,
                sql`now() - interval '1 hour'`,
              ),
            ),
          ),
      ))
      .returning();
    if (!updated) {
      return null;
    }

    await insertDepositAudit(tx, {
      deposit: updated,
      action: 'deposit_refund_retried',
      actor: args.actor,
      reason: 'owner_retry',
      previousValue: {
        refundStatus: locked.refundStatus,
        refundId: locked.stripeRefundId,
        keyEpoch: locked.refundKeyEpoch,
      },
      metadata: actorAuditMetadata(args.actor, {
        depositId: updated.id,
        appointmentId: updated.appointmentId,
        priorRefundId: priorRefundId ?? undefined,
        paymentIntentId: updated.stripePaymentIntentId ?? undefined,
        terminalFailureCount: updated.refundTerminalFailureCount,
        keyEpoch: updated.refundKeyEpoch,
        trigger: updated.refundTrigger ?? undefined,
        origin: 'owner_retry',
      }),
    });
    return { deposit: updated, priorRefundId };
  });

  if (!retried) {
    const current = await loadDepositById(args.depositId, args.salonId);
    if (!current) {
      return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
    }
    if (current.externalRefundObservedCents !== null) {
      return depositFailure(
        'DEPOSIT_PARTIALLY_REFUNDED_EXTERNALLY',
        'This deposit was partly refunded in Stripe. Finish reconciling it in the salon Stripe Dashboard.',
      );
    }
    if (
      current.refundTerminalFailureCount >= 3
      || current.refundKeyEpoch >= 4
      || TERMINAL_RETRY_ERROR_CODES.includes(
        current.refundLastErrorCode as DepositRefundErrorCode,
      )
    ) {
      return depositFailure(
        'DEPOSIT_NOT_REFUNDABLE',
        'This refund cannot be retried in Luster. Reconcile it in the salon Stripe Dashboard.',
      );
    }
    if (
      current.refundReconcileClaimedAt
      && current.refundReconcileClaimedAt.getTime() > Date.now() - 15 * 60_000
    ) {
      return depositFailure(
        'REFUND_RECONCILE_IN_FLIGHT',
        'Refund reconciliation is already in progress. Try again shortly.',
      );
    }
    if (current.refundStatus === 'requested' || current.refundStatus === 'pending') {
      return depositFailure(
        'REFUND_ALREADY_IN_FLIGHT',
        'This refund is already in progress.',
      );
    }
    return depositFailure(
      'DEPOSIT_NOT_REFUNDABLE',
      'This refund is not currently eligible for retry.',
    );
  }

  const result = await runOwnerRefundCore(retried.deposit);
  return result.ok
    ? { ...result, disposition: 'refund_retried' }
    : result;
}

export async function applyRefundObservation(args: {
  deposit: DepositRow;
  refund: RefundObservation | null;
  origin: RefundObservationOrigin;
  /** The provider error itself, never a raw code destined for persistence. */
  errorCode?: unknown;
  accountRefusal?: 'ACCOUNT_DISCONNECTED' | 'ACCOUNT_REBOUND';
  eventMetadataDepositId?: string | null;
  noticeVariant?: 'slot_lost' | 'waiver';
  /** TX-B only: fence a first object stamp to the core caller's source set. */
  allowedSourceStatuses?: readonly DepositStatus[];
  /** TX-B/TX-E: finalize this exact claimed event in the state-write tx. */
  eventClaim?: RefundEventClaim;
}): Promise<ApplyRefundObservationResult> {
  if (!args.refund && args.accountRefusal) {
    // Row 4c: no provider call happened. This is deliberately audit-exempt and
    // does not re-stamp the state timestamp or consume any bound.
    const mappedCode = mapStripeRefundErrorCode({ code: args.accountRefusal });
    const updated = await depositsTransaction(db, async (tx) => {
      const [changed] = await tx
        .update(appointmentDepositSchema)
        .set({
          refundLastErrorCode: mappedCode,
        })
        .where(and(
          eq(appointmentDepositSchema.id, args.deposit.id),
          eq(appointmentDepositSchema.salonId, args.deposit.salonId),
          eq(appointmentDepositSchema.refundStatus, 'requested'),
          sql`${appointmentDepositSchema.refundLastErrorCode}
            IS DISTINCT FROM ${mappedCode}`,
        ))
        .returning();
      if (changed) {
        await enqueueDepositRefundAlertInTx(tx, {
          salonId: changed.salonId,
          appointmentId: changed.appointmentId,
          event: 'refundAccountDisconnected',
          refund: {
            errorCode: changed.refundLastErrorCode,
            failureReason: changed.refundFailureReason,
            keyEpoch: changed.refundKeyEpoch,
            terminalFailureCount: changed.refundTerminalFailureCount,
          },
        });
      }
      return changed ?? null;
    });
    return {
      deposit: updated ?? args.deposit,
      applied: Boolean(updated),
      ...(!updated ? { outcome: 'ignored_same_state' as const } : {}),
    };
  }

  if (!args.refund) {
    // Row 4b: the provider refused create, so there is no Refund object from
    // which to set-derive the count. The from-state makes the +1 once-only for
    // this logical attempt.
    return (await withAppointmentFirstDepositLock(args.deposit, async (tx, locked) => {
      const mappedCode = mapStripeRefundErrorCode(args.errorCode);
      const [updated] = await tx
        .update(appointmentDepositSchema)
        .set({
          refundStatus: 'failed',
          refundStatusChangedAt: sql`now()`,
          refundLastErrorCode: mappedCode,
          refundFailureReason: null,
          refundTerminalFailureCount: sql`${appointmentDepositSchema.refundTerminalFailureCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(appointmentDepositSchema.id, locked.id),
          eq(appointmentDepositSchema.salonId, locked.salonId),
          eq(appointmentDepositSchema.refundStatus, 'requested'),
          sql`${appointmentDepositSchema.refundStatus} IS DISTINCT FROM 'failed'`,
        ))
        .returning();
      if (!updated) {
        return {
          deposit: locked,
          applied: false,
          outcome: 'ignored_same_state' as const,
        };
      }

      await insertDepositAudit(tx, {
        deposit: updated,
        action: 'deposit_refund_failed',
        actor: SYSTEM_ACTOR,
        reason: args.origin,
        previousValue: {
          refundStatus: locked.refundStatus,
          terminalFailureCount: locked.refundTerminalFailureCount,
        },
        metadata: actorAuditMetadata(SYSTEM_ACTOR, {
          depositId: updated.id,
          appointmentId: updated.appointmentId,
          stripeErrorCode: mappedCode,
          terminalFailureCount: updated.refundTerminalFailureCount,
          keyEpoch: updated.refundKeyEpoch,
          trigger: updated.refundTrigger ?? undefined,
          origin: args.origin,
        }),
      });
      await enqueueDepositRefundAlertInTx(tx, {
        salonId: updated.salonId,
        appointmentId: updated.appointmentId,
        event: 'refundFailed',
        refund: {
          errorCode: updated.refundLastErrorCode,
          failureReason: updated.refundFailureReason,
          keyEpoch: updated.refundKeyEpoch,
          terminalFailureCount: updated.refundTerminalFailureCount,
        },
      });
      return { deposit: updated, applied: true };
    })) ?? { deposit: null, applied: false };
  }

  const refund = args.refund;
  const target = refundStatus(refund);
  if (!target) {
    return {
      deposit: args.deposit,
      applied: false,
      outcome: 'ignored_unsupported_status',
    };
  }

  if (args.deposit.priorRefundIds.includes(refund.id)) {
    return {
      deposit: args.deposit,
      applied: false,
      outcome: 'ignored_retired_refund',
    };
  }

  const amountMatches = refund.amount === args.deposit.amountCents;
  const currencyMatches = refund.currency === args.deposit.currency;
  if (!amountMatches || !currencyMatches) {
    // Detection-only external partial refund. Currency mismatches are not
    // allowed to mutate this deposit at all.
    if (
      currencyMatches
      && refund.amount > 0
      && refund.amount < args.deposit.amountCents
      && (
        args.origin === 'external'
        || args.origin === 'external_discovery'
        || args.origin === 'listing'
        || args.origin === 'webhook'
        || args.origin === 'reconciler'
      )
    ) {
      const partial = await withAppointmentFirstDepositLock(
        args.deposit,
        async (tx, locked) => {
          const observed = Math.max(locked.externalRefundObservedCents ?? 0, refund.amount);
          if (observed === locked.externalRefundObservedCents) {
            return { row: locked, changed: false, eventFinalized: false };
          }
          const [updated] = await tx
            .update(appointmentDepositSchema)
            .set({
              externalRefundObservedCents: observed,
              updatedAt: new Date(),
            })
            .where(and(
              eq(appointmentDepositSchema.id, locked.id),
              eq(appointmentDepositSchema.salonId, locked.salonId),
              sql`COALESCE(${appointmentDepositSchema.externalRefundObservedCents}, 0) < ${observed}`,
            ))
            .returning();
          if (!updated) {
            return { row: locked, changed: false, eventFinalized: false };
          }
          await insertDepositAudit(tx, {
            deposit: updated,
            action: 'deposit_external_refund_observed',
            actor: SYSTEM_ACTOR,
            reason: args.origin,
            previousValue: {
              externalRefundObservedCents: locked.externalRefundObservedCents,
            },
            metadata: actorAuditMetadata(SYSTEM_ACTOR, {
              depositId: updated.id,
              appointmentId: updated.appointmentId,
              refundId: refund.id,
              paymentIntentId: updated.stripePaymentIntentId ?? undefined,
              origin: args.origin,
            }),
          });
          if (args.eventClaim) {
            await finalizeRefundEventInTx(tx, args.eventClaim, 'refunded');
          }
          return {
            row: updated,
            changed: true,
            eventFinalized: Boolean(args.eventClaim),
          };
        },
      );
      return {
        deposit: partial?.row ?? null,
        applied: partial?.changed ?? false,
        outcome: partial && !partial.changed
          ? 'ignored_same_state'
          : 'ignored_amount_mismatch',
        ...(partial?.eventFinalized ? { eventFinalized: true } : {}),
      };
    }
    return {
      deposit: args.deposit,
      applied: false,
      outcome: 'ignored_amount_mismatch',
    };
  }

  return (await withAppointmentFirstDepositLock(args.deposit, async (tx, locked) => {
    if (locked.priorRefundIds.includes(refund.id)) {
      return {
        deposit: locked,
        applied: false,
        outcome: 'ignored_retired_refund' as const,
      };
    }

    const source = locked.refundStatus as DepositRefundStatus | null;
    const idMatches = locked.stripeRefundId === refund.id;
    const firstStamp = locked.stripeRefundId === null;
    const adoptsAfterFailure = source === 'failed'
      && !idMatches
      && (target === 'pending' || target === 'succeeded');

    if (
      locked.refundRequestedEnv !== null
      && locked.refundRequestedEnv !== resolveRuntimeEnvironment()
    ) {
      return {
        deposit: locked,
        applied: false,
        outcome: 'ignored_environment_mismatch' as const,
      };
    }

    if (
      firstStamp
      && args.allowedSourceStatuses
      && !args.allowedSourceStatuses.includes(locked.status as DepositStatus)
    ) {
      return {
        deposit: locked,
        applied: false,
        outcome: 'ignored_object_mismatch' as const,
      };
    }

    if (idMatches && source === target) {
      return {
        deposit: locked,
        applied: false,
        outcome: 'ignored_same_state' as const,
      };
    }

    const legal
      = (source === null && ((firstStamp && target !== 'failed') || idMatches))
      || (source === 'requested' && (idMatches || firstStamp))
      || (source === 'pending' && idMatches)
      || (source === 'succeeded'
        && idMatches
        && (target === 'failed' || target === 'pending'))
        || adoptsAfterFailure;
    if (!legal) {
      return {
        deposit: locked,
        applied: false,
        outcome: 'ignored_object_mismatch' as const,
      };
    }
    const bindsObject = firstStamp || adoptsAfterFailure;
    const previousId = adoptsAfterFailure ? locked.stripeRefundId : null;
    const values = {
      refundStatus: target,
      refundStatusChangedAt: sql`now()`,
      refundFailureReason: target === 'failed'
        ? mapStripeRefundFailureReason(refund.failure_reason)
        : null,
      ...(target === 'succeeded' ? { refundLastErrorCode: null } : {}),
      ...(bindsObject
        ? {
            stripeRefundId: refund.id,
            refundAmountCents: refund.amount,
            status: 'refunded',
            refundedAt: sql`COALESCE(${appointmentDepositSchema.refundedAt}, now())`,
            refundTrigger: sql`CASE
              WHEN ${appointmentDepositSchema.refundTrigger} = 'owner' THEN 'owner'
              WHEN ${args.eventMetadataDepositId ?? null} = ${appointmentDepositSchema.id}
                THEN 'system_late_payment'
              ELSE 'external'
            END`,
          }
        : {}),
      ...(adoptsAfterFailure
        ? {
            priorRefundIds: sql`CASE
              WHEN ${appointmentDepositSchema.stripeRefundId} IS NULL
                OR ${appointmentDepositSchema.stripeRefundId}
                  = ANY(COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'))
                THEN ${appointmentDepositSchema.priorRefundIds}
              ELSE array_append(
                COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'),
                ${appointmentDepositSchema.stripeRefundId}
              )
            END`,
          }
        : {}),
      ...(target === 'failed'
        ? {
            refundTerminalFailureCount: sql`GREATEST(
              ${appointmentDepositSchema.refundTerminalFailureCount},
              COALESCE(array_length(${appointmentDepositSchema.priorRefundIds}, 1), 0) + 1
            )`,
          }
        : {}),
      updatedAt: new Date(),
    };

    const sourcePredicate = source === null
      ? isNull(appointmentDepositSchema.refundStatus)
      : eq(appointmentDepositSchema.refundStatus, source);
    const identityPredicate = idMatches
      ? eq(appointmentDepositSchema.stripeRefundId, refund.id)
      : and(
        firstStamp
          ? isNull(appointmentDepositSchema.stripeRefundId)
          : sql`${appointmentDepositSchema.stripeRefundId} IS DISTINCT FROM ${refund.id}`,
        eq(appointmentDepositSchema.amountCents, refund.amount),
        eq(appointmentDepositSchema.currency, refund.currency),
        sql`${refund.id} <> ALL(COALESCE(${appointmentDepositSchema.priorRefundIds}, '{}'))`,
      );

    const [updated] = await tx
      .update(appointmentDepositSchema)
      .set(values)
      .where(and(
        eq(appointmentDepositSchema.id, locked.id),
        eq(appointmentDepositSchema.salonId, locked.salonId),
        sourcePredicate,
        sql`${appointmentDepositSchema.refundStatus} IS DISTINCT FROM ${target}`,
        identityPredicate,
        or(
          isNull(appointmentDepositSchema.refundRequestedEnv),
          eq(
            appointmentDepositSchema.refundRequestedEnv,
            resolveRuntimeEnvironment(),
          ),
        ),
        firstStamp && args.allowedSourceStatuses
          ? inArray(
            appointmentDepositSchema.status,
            [...args.allowedSourceStatuses],
          )
          : undefined,
      ))
      .returning();
    if (!updated) {
      return {
        deposit: locked,
        applied: false,
        outcome: 'ignored_object_mismatch' as const,
      };
    }

    const action = target === 'succeeded'
      ? 'deposit_refund_succeeded'
      : target === 'failed'
        ? 'deposit_refund_failed'
        : bindsObject && (source === null || adoptsAfterFailure)
          ? 'deposit_external_refund_observed'
          : 'deposit_refund_updated';
    const auditOrigin = bindsObject
      ? args.eventMetadataDepositId === updated.id
        ? 'luster_recovered'
        : 'external'
      : args.origin;
    await insertDepositAudit(tx, {
      deposit: updated,
      action,
      actor: SYSTEM_ACTOR,
      reason: args.origin,
      previousValue: {
        refundStatus: source,
        refundId: locked.stripeRefundId,
        terminalFailureCount: locked.refundTerminalFailureCount,
      },
      metadata: actorAuditMetadata(SYSTEM_ACTOR, {
        depositId: updated.id,
        appointmentId: updated.appointmentId,
        refundId: refund.id,
        priorRefundId: previousId ?? undefined,
        paymentIntentId: updated.stripePaymentIntentId ?? undefined,
        failureReason: target === 'failed'
          ? mapStripeRefundFailureReason(refund.failure_reason)
          : undefined,
        terminalFailureCount: updated.refundTerminalFailureCount,
        keyEpoch: updated.refundKeyEpoch,
        trigger: updated.refundTrigger ?? undefined,
        origin: auditOrigin,
      }),
    });
    if (args.noticeVariant && bindsObject && target !== 'failed') {
      await enqueueDepositRefundNotices(tx, {
        salonId: updated.salonId,
        appointmentId: updated.appointmentId,
        depositId: updated.id,
        refundId: refund.id,
        variant: args.noticeVariant,
      });
    }
    if (target === 'failed') {
      await enqueueDepositRefundAlertInTx(tx, {
        salonId: updated.salonId,
        appointmentId: updated.appointmentId,
        event: 'refundFailed',
        refund: {
          errorCode: updated.refundLastErrorCode,
          failureReason: updated.refundFailureReason,
          keyEpoch: updated.refundKeyEpoch,
          terminalFailureCount: updated.refundTerminalFailureCount,
        },
      });
    }
    if (args.eventClaim) {
      await finalizeRefundEventInTx(tx, args.eventClaim, 'refunded');
    }
    return {
      deposit: updated,
      applied: true,
      ...(args.eventClaim ? { eventFinalized: true } : {}),
    };
  })) ?? { deposit: null, applied: false };
}

function refundPaymentIntentId(refund: RefundObservation): string | null {
  return typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

/**
 * Webhook adapter for refund.created/refund.updated/refund.failed. The caller
 * has already passed the Connect signature, mode and admission gates; this
 * function repeats the account snapshot + PaymentIntent identity match before
 * delegating every write to the observation state machine.
 */
export async function applyRefundEvent(
  event: Stripe.Event,
  eventClaim?: RefundEventClaim,
): Promise<ApplyRefundObservationResult> {
  if (!['refund.created', 'refund.updated', 'refund.failed'].includes(event.type as string)) {
    return { deposit: null, applied: false, outcome: 'ignored_unhandled' };
  }
  const account = event.account;
  if (!account) {
    return { deposit: null, applied: false, outcome: 'ignored_account_mismatch' };
  }

  const refund = event.data.object as RefundObservation;
  if (!refund || typeof refund.id !== 'string') {
    return { deposit: null, applied: false, outcome: 'ignored_unhandled' };
  }
  const paymentIntentId = refundPaymentIntentId(refund);

  const bindings = await db
    .select({ salonId: salonStripeAccountSchema.salonId })
    .from(salonStripeAccountSchema)
    .where(eq(salonStripeAccountSchema.stripeAccountId, account));

  let deposit: DepositRow | null = null;
  // The refund id is authoritative when already bound. Only then fall back to
  // the PaymentIntent, as required by the charter.
  for (const binding of bindings) {
    const [byRefund] = await db
      .select()
      .from(appointmentDepositSchema)
      .where(and(
        eq(appointmentDepositSchema.salonId, binding.salonId),
        eq(appointmentDepositSchema.stripeRefundId, refund.id),
      ))
      .limit(1);
    if (byRefund?.stripeAccountId === account) {
      deposit = byRefund;
      break;
    }
  }
  if (!deposit && paymentIntentId) {
    for (const binding of bindings) {
      const [byIntent] = await db
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.salonId, binding.salonId),
          eq(appointmentDepositSchema.stripePaymentIntentId, paymentIntentId),
        ))
        .limit(1);
      if (byIntent?.stripeAccountId === account) {
        deposit = byIntent;
        break;
      }
    }
  }
  if (
    !deposit
    || deposit.stripeAccountId !== account
    || (paymentIntentId !== null && deposit.stripePaymentIntentId !== paymentIntentId)
  ) {
    return { deposit, applied: false, outcome: 'ignored_account_mismatch' };
  }

  return applyRefundObservation({
    deposit,
    refund,
    origin: 'webhook',
    eventMetadataDepositId: refund.metadata?.luster_deposit_id ?? null,
    eventClaim,
  });
}

/** One-row reconciliation entry used by every sweep pass that acts on a row. */
export async function reconcileDepositRefund(
  input: DepositRow | { depositId: string; salonId: string },
) {
  const missingDepositId = 'depositId' in input ? input.depositId : input.id;
  const deposit = 'depositId' in input
    ? await loadDepositById(input.depositId, input.salonId)
    : input;
  if (!deposit) {
    return { disposition: 'noop' as const, depositId: missingDepositId, note: 'deposit_not_found' };
  }
  if (
    deposit.refundRequestedEnv !== null
    && deposit.refundRequestedEnv !== resolveRuntimeEnvironment()
  ) {
    return { disposition: 'noop' as const, depositId: deposit.id, note: 'environment_mismatch' };
  }

  const {
    createOrAdoptDepositRefund,
    discoverAndAdoptDepositRefunds,
    resolveAllowedSourceStatuses,
  } = await import('./depositRefund');
  if (deposit.refundStatus === null) {
    return discoverAndAdoptDepositRefunds(deposit);
  }
  return createOrAdoptDepositRefund(deposit, 'slot_lost', {
    allowedSourceStatuses: resolveAllowedSourceStatuses(deposit),
  });
}

async function raiseRefundConflict(
  deposit: DepositRow,
  observedRefundId: string,
): Promise<DepositRow | null> {
  return withAppointmentFirstDepositLock(deposit, async (tx, locked) => {
    if (locked.refundConflictFlag) {
      return locked;
    }
    const [updated] = await tx
      .update(appointmentDepositSchema)
      .set({ refundConflictFlag: true, updatedAt: new Date() })
      .where(and(
        eq(appointmentDepositSchema.id, locked.id),
        eq(appointmentDepositSchema.salonId, locked.salonId),
        eq(appointmentDepositSchema.refundConflictFlag, false),
      ))
      .returning();
    if (!updated) {
      return locked;
    }
    await insertDepositAudit(tx, {
      deposit: updated,
      action: 'deposit_refund_updated',
      actor: SYSTEM_ACTOR,
      reason: 'refund_conflict',
      previousValue: { refundConflictFlag: false },
      metadata: actorAuditMetadata(SYSTEM_ACTOR, {
        depositId: updated.id,
        appointmentId: updated.appointmentId,
        refundId: observedRefundId,
        priorRefundId: locked.stripeRefundId ?? undefined,
        terminalFailureCount: updated.refundTerminalFailureCount,
        keyEpoch: updated.refundKeyEpoch,
        origin: 'reconciler',
      }),
    });
    return updated;
  });
}

/** TX-B's single stamp helper, including the two zero-row causes. */
export async function stampDepositRefund(args: {
  deposit: DepositRow;
  refund: RefundObservation;
  allowedSourceStatuses: readonly DepositStatus[];
  variant: 'slot_lost' | 'waiver' | 'owner';
  workClaim?: RefundEventClaim;
}): Promise<DepositLifecycleResult> {
  let applied: ApplyRefundObservationResult;
  let fenceLost = false;
  try {
    applied = await applyRefundObservation({
      deposit: args.deposit,
      refund: args.refund,
      origin: args.variant === 'owner' ? 'owner' : 'luster_recovered',
      eventMetadataDepositId: args.refund.metadata?.luster_deposit_id ?? null,
      noticeVariant: args.variant === 'waiver' ? 'waiver' : 'slot_lost',
      allowedSourceStatuses: args.allowedSourceStatuses,
      eventClaim: args.workClaim,
    });
  } catch (error) {
    if (!(error instanceof RefundEventFenceLostError)) {
      throw error;
    }
    fenceLost = true;
    // The combined transaction rolled back. Re-read below: another driver may
    // have committed the same stamp with the fencing token first.
    applied = { deposit: null, applied: false, outcome: 'ignored_object_mismatch' };
  }
  if (applied.applied && applied.deposit) {
    return {
      ok: true,
      disposition: refundStatus(args.refund) === 'succeeded'
        ? 'refunded'
        : 'refund_updated',
      deposit: applied.deposit,
      refundId: args.refund.id,
      ...(applied.eventFinalized ? { eventFinalized: true } : {}),
    };
  }

  const [current] = await db
    .select()
    .from(appointmentDepositSchema)
    .where(and(
      eq(appointmentDepositSchema.id, args.deposit.id),
      eq(appointmentDepositSchema.salonId, args.deposit.salonId),
    ))
    .limit(1);
  if (!current) {
    return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
  }

  if (
    current.stripeRefundId === args.refund.id
    || (current.refundStatus === 'succeeded' && current.stripeRefundId !== null)
  ) {
    return {
      ok: true,
      disposition: 'refunded',
      deposit: current,
      refundId: current.stripeRefundId ?? args.refund.id,
      ...(fenceLost ? { eventFinalized: true } : {}),
    };
  }
  if (current.stripeRefundId && current.stripeRefundId !== args.refund.id) {
    const conflicted = await raiseRefundConflict(current, args.refund.id);
    Sentry.captureMessage('deposit_refund_conflict', {
      level: 'error',
      tags: { surface: 'deposit-refund' },
      extra: {
        depositId: current.id,
        appointmentId: current.appointmentId,
        salonId: current.salonId,
      },
    });
    const conflict = depositFailure(
      'REFUND_CONFLICT',
      conflicted
        ? 'Another refund object is already bound to this deposit. Reconcile it in Stripe.'
        : 'The refund could not be bound to this deposit.',
    );
    return fenceLost ? { ...conflict, leaveWorkOpen: true } : conflict;
  }
  if (!args.allowedSourceStatuses.includes(current.status as DepositStatus)) {
    Sentry.captureMessage('deposit_already_confirmed_late_refund', {
      level: 'error',
      tags: { surface: 'deposit-refund' },
      extra: {
        depositId: current.id,
        appointmentId: current.appointmentId,
        salonId: current.salonId,
        refundId: args.refund.id,
      },
    });
    return {
      ok: true,
      disposition: 'already_confirmed_late_refund',
      deposit: current,
      refundId: args.refund.id,
    };
  }
  if (fenceLost) {
    await raiseRefundConflict(current, args.refund.id);
    Sentry.captureMessage('deposit_refund_fence_lost', {
      level: 'error',
      tags: { surface: 'deposit-refund' },
      extra: {
        depositId: current.id,
        appointmentId: current.appointmentId,
        salonId: current.salonId,
      },
    });
    return {
      ok: false,
      status: 409,
      code: 'REFUND_CONFLICT',
      message: 'The refund work lease changed before the stamp committed. Reconciliation will retry it.',
      leaveWorkOpen: true,
    };
  }
  return depositFailure(
    'REFUND_ALREADY_IN_FLIGHT',
    'The refund state changed before this update could be applied.',
  );
}

type HoldProviderPreparation =
  | { ok: true }
  | { ok: false; result: DepositLifecycleResult };

async function parkCompletedUnpaidHold(
  deposit: DepositRow,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (!deposit.stripeCheckoutSessionId) {
    return;
  }
  const metadata = session.metadata ?? {};
  const claim = await claimOrRearmPollEvidenceWorkRow({
    eventId: pollEvidenceEventId(deposit.id),
    account: deposit.stripeAccountId,
    livemode: session.livemode ?? false,
    salonId: deposit.salonId,
    sessionId: deposit.stripeCheckoutSessionId,
    depositId: deposit.id,
    projection: {
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
      projectionStatus: 'ok',
    },
  });
  if (!claim.claimed) {
    return;
  }
  await finalizeRetryable({
    id: claim.id,
    attempts: claim.attempts,
    outcome: 'awaiting_async_payment',
    lastError: 'awaiting_async_payment',
    availableAt: new Date(Date.now() + 60 * 60_000),
  });
}

async function prepareHoldSessionForTerminalWrite(
  deposit: DepositRow,
): Promise<HoldProviderPreparation> {
  const accountState = await checkDepositSnapshotAccount(deposit);
  if (accountState !== 'ready') {
    return {
      ok: false,
      result: depositFailure(
        'ACCOUNT_NOT_CHARGE_READY',
        'This hold belongs to a Stripe account the salon cannot currently use. No provider call or local change was made.',
      ),
    };
  }
  if (!deposit.stripeCheckoutSessionId) {
    return {
      ok: false,
      result: depositFailure(
        'HOLD_NOT_LIVE',
        'This hold has no live Checkout Session. No local change was made.',
      ),
    };
  }

  const client = getDepositStripeClient();
  const options = { stripeAccount: deposit.stripeAccountId };
  try {
    await client.checkout.sessions.expire(
      deposit.stripeCheckoutSessionId,
      {},
      options,
    );
    return { ok: true };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { surface: 'deposit-refund', operation: 'expire-hold' },
      extra: { depositId: deposit.id, appointmentId: deposit.appointmentId },
    });

    // A not-open response may mean either complete or already expired. The
    // retrieve is the only authority that separates those two money states.
    // For every other failure we still retrieve once; a successful status read
    // prevents an ambiguous expire error from being mistaken for non-payment.
    try {
      const session = await client.checkout.sessions.retrieve(
        deposit.stripeCheckoutSessionId,
        {},
        options,
      );
      if (session.status === 'expired') {
        return { ok: true };
      }
      if (session.status === 'complete') {
        if (session.payment_status === 'paid') {
          return {
            ok: false,
            result: depositFailure(
              'DEPOSIT_ALREADY_PAID',
              'This Checkout Session is paid. No local change was made; payment confirmation will finish normally.',
            ),
          };
        }
        await parkCompletedUnpaidHold(deposit, session);
        return {
          ok: false,
          result: depositFailure(
            'DEPOSIT_PAYMENT_PROCESSING',
            'This Checkout Session completed and its payment is still processing. No local change was made.',
          ),
        };
      }

      return {
        ok: false,
        result: depositFailure(
          'HOLD_NOT_LIVE',
          classifyStripeFailure(error) === 'session_not_open'
            ? 'The Checkout Session is not an expirable hold. No local change was made.'
            : 'Stripe could not confirm that this hold was expired. No local change was made; try again.',
        ),
      };
    } catch (retrieveError) {
      Sentry.captureException(retrieveError, {
        tags: { surface: 'deposit-refund', operation: 'retrieve-hold' },
        extra: { depositId: deposit.id, appointmentId: deposit.appointmentId },
      });
      return {
        ok: false,
        result: depositFailure(
          'HOLD_NOT_LIVE',
          'Stripe could not confirm that this hold was expired. No local change was made; try again.',
        ),
      };
    }
  }
}

class HoldTransitionConflict extends Error {
  constructor(readonly code: 'DEPOSIT_ALREADY_PAID' | 'HOLD_NOT_LIVE') {
    super(code);
  }
}

const EXPIRED_SESSION_WARNING
  = 'The Checkout Session was already expired. This hold can no longer be paid. Retry immediately; if the write cannot finish, the reaper will complete this as a client cancellation.';

/** Expire-first waiver, with appointment-first row locks and deposit-first CASes. */
export async function waiveDeposit(args: {
  depositId: string;
  salonId: string;
  actor: DepositActor;
  reason: string;
}): Promise<DepositLifecycleResult> {
  const snapshot = await loadDepositById(args.depositId, args.salonId);
  if (!snapshot) {
    return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
  }
  const prepared = await prepareHoldSessionForTerminalWrite(snapshot);
  if (!prepared.ok) {
    return prepared.result;
  }

  try {
    const waived = await depositsTransaction(db, async (tx) => {
      const [appointment] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, snapshot.appointmentId),
          eq(appointmentSchema.salonId, snapshot.salonId),
        ))
        .for('update')
        .limit(1);
      if (!appointment) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      const [locked] = await tx
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.id, snapshot.id),
          eq(appointmentDepositSchema.salonId, snapshot.salonId),
        ))
        .for('update')
        .limit(1);
      if (!locked) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      const [salon] = await tx
        .select({ freeSoloEnabled: salonSchema.freeSoloEnabled })
        .from(salonSchema)
        .where(eq(salonSchema.id, snapshot.salonId))
        .limit(1);
      if (!salon) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      const now = new Date();
      const [updatedDeposit] = await tx
        .update(appointmentDepositSchema)
        .set({
          status: 'waived',
          waivedAt: now,
          waivedBy: args.actor.requestedBy,
          waiverReason: args.reason,
          updatedAt: now,
        })
        .where(and(
          eq(appointmentDepositSchema.id, locked.id),
          eq(appointmentDepositSchema.salonId, locked.salonId),
          eq(appointmentDepositSchema.status, 'checkout_created'),
        ))
        .returning();
      if (!updatedDeposit) {
        throw new HoldTransitionConflict(
          locked.status === 'paid' ? 'DEPOSIT_ALREADY_PAID' : 'HOLD_NOT_LIVE',
        );
      }

      const [updatedAppointment] = await tx
        .update(appointmentSchema)
        .set({
          status: salon.freeSoloEnabled ? 'confirmed' : 'pending',
          canvasState: 'waiting',
          canvasStateUpdatedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(appointmentSchema.id, appointment.id),
          eq(appointmentSchema.salonId, appointment.salonId),
          eq(appointmentSchema.status, 'awaiting_payment'),
        ))
        .returning();
      if (!updatedAppointment) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      await insertDepositAudit(tx, {
        deposit: updatedDeposit,
        action: 'deposit_waived',
        actor: args.actor,
        reason: args.reason,
        previousValue: { status: locked.status },
        metadata: actorAuditMetadata(args.actor, {
          depositId: updatedDeposit.id,
          appointmentId: updatedDeposit.appointmentId,
          paymentIntentId: updatedDeposit.stripePaymentIntentId ?? undefined,
          origin: 'owner',
        }),
      });
      await enqueueDepositConfirmationEffectsInTx({
        tx,
        appointment: updatedAppointment,
        deposit: updatedDeposit,
        salonId: updatedDeposit.salonId,
        clientPhone: updatedAppointment.clientPhone,
      });
      return updatedDeposit;
    });
    return { ok: true, disposition: 'waived', deposit: waived };
  } catch (error) {
    if (isSlotConstraintViolation(error)) {
      return depositFailure(
        'HOLD_SLOT_TAKEN',
        `${EXPIRED_SESSION_WARNING} Release the hold to finish safely.`,
      );
    }
    if (error instanceof HoldTransitionConflict) {
      return depositFailure(error.code, EXPIRED_SESSION_WARNING);
    }
    Sentry.captureException(error, {
      tags: { surface: 'deposit-refund', operation: 'waive-hold' },
      extra: { depositId: snapshot.id, appointmentId: snapshot.appointmentId },
    });
    return depositFailure('HOLD_NOT_LIVE', EXPIRED_SESSION_WARNING);
  }
}

/** Expire-first hold release, with the reaper's terminal pair and Google delete. */
export async function releaseHold(args: {
  depositId: string;
  salonId: string;
  actor: DepositActor;
  reason: string;
}): Promise<DepositLifecycleResult> {
  const snapshot = await loadDepositById(args.depositId, args.salonId);
  if (!snapshot) {
    return depositFailure('DEPOSIT_NOT_FOUND', 'Deposit not found.', 404);
  }
  const prepared = await prepareHoldSessionForTerminalWrite(snapshot);
  if (!prepared.ok) {
    return prepared.result;
  }

  try {
    const released = await depositsTransaction(db, async (tx) => {
      const [appointment] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, snapshot.appointmentId),
          eq(appointmentSchema.salonId, snapshot.salonId),
        ))
        .for('update')
        .limit(1);
      if (!appointment) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      const [locked] = await tx
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.id, snapshot.id),
          eq(appointmentDepositSchema.salonId, snapshot.salonId),
        ))
        .for('update')
        .limit(1);
      if (!locked) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      const now = new Date();
      const [updatedDeposit] = await tx
        .update(appointmentDepositSchema)
        .set({ status: 'canceled', updatedAt: now })
        .where(and(
          eq(appointmentDepositSchema.id, locked.id),
          eq(appointmentDepositSchema.salonId, locked.salonId),
          eq(appointmentDepositSchema.status, 'checkout_created'),
        ))
        .returning();
      if (!updatedDeposit) {
        throw new HoldTransitionConflict(
          locked.status === 'paid' ? 'DEPOSIT_ALREADY_PAID' : 'HOLD_NOT_LIVE',
        );
      }

      const [updatedAppointment] = await tx
        .update(appointmentSchema)
        .set({
          status: 'cancelled',
          cancelReason: 'deposit_not_paid',
          canvasState: 'cancelled',
          canvasStateUpdatedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(appointmentSchema.id, appointment.id),
          eq(appointmentSchema.salonId, appointment.salonId),
          eq(appointmentSchema.status, 'awaiting_payment'),
        ))
        .returning();
      if (!updatedAppointment) {
        throw new HoldTransitionConflict('HOLD_NOT_LIVE');
      }

      await insertDepositAudit(tx, {
        deposit: updatedDeposit,
        action: 'deposit_hold_released',
        actor: args.actor,
        reason: args.reason,
        previousValue: { status: locked.status },
        metadata: actorAuditMetadata(args.actor, {
          depositId: updatedDeposit.id,
          appointmentId: updatedDeposit.appointmentId,
          paymentIntentId: updatedDeposit.stripePaymentIntentId ?? undefined,
          origin: 'owner',
        }),
      });
      await enqueueGoogleCalendarDeleteInTx(tx, {
        appointmentId: updatedAppointment.id,
        salonId: updatedAppointment.salonId,
        mutationVersion: updatedAppointment.updatedAt,
        authoritativeTerminalDelete: true,
      });
      return updatedDeposit;
    });
    return { ok: true, disposition: 'released', deposit: released };
  } catch (error) {
    if (isSlotConstraintViolation(error)) {
      return depositFailure(
        'HOLD_SLOT_TAKEN',
        'The Checkout Session was already expired and the hold cannot be paid. Retry release immediately.',
      );
    }
    if (error instanceof HoldTransitionConflict) {
      return depositFailure(
        error.code,
        'The Checkout Session was already expired and the hold cannot be paid. Retry release immediately.',
      );
    }
    Sentry.captureException(error, {
      tags: { surface: 'deposit-refund', operation: 'release-hold' },
      extra: { depositId: snapshot.id, appointmentId: snapshot.appointmentId },
    });
    return depositFailure(
      'HOLD_NOT_LIVE',
      'The Checkout Session was already expired and the hold cannot be paid. Retry release immediately.',
    );
  }
}

/** The only response projection for D6 deposit rows. */
export function serializeDepositForRole(
  role: 'admin' | 'super_admin',
  deposit: DepositRow,
): DepositRow {
  // Both admitted roles receive the audited admin record. Keeping the closed
  // role union here prevents a client/staff projection from being invented by
  // a caller and guarantees the row is copied rather than mutated.
  void role;
  return { ...deposit };
}

const terminalRefundCodesSql = sql.raw(
  '(\'charge_disputed\',\'refund_disputed_payment\',\'charge_already_refunded\')',
);

/** The exact deposit-row union used by the owner list and owner health block. */
export function needsAttentionPredicate(salonId: string) {
  return and(
    eq(appointmentDepositSchema.salonId, salonId),
    or(
      // 3 — refundIntentsStuck
      and(
        eq(appointmentDepositSchema.refundStatus, 'requested'),
        lt(
          appointmentDepositSchema.refundStatusChangedAt,
          sql`now() - interval '15 minutes'`,
        ),
      ),
      // 4 — refundsPendingOver7d
      and(
        eq(appointmentDepositSchema.refundStatus, 'pending'),
        lt(
          appointmentDepositSchema.refundStatusChangedAt,
          sql`now() - interval '7 days'`,
        ),
      ),
      // 5 — refundsFailedRetryable
      and(
        eq(appointmentDepositSchema.refundStatus, 'failed'),
        lt(appointmentDepositSchema.refundTerminalFailureCount, 3),
        lt(appointmentDepositSchema.refundKeyEpoch, 4),
        isNull(appointmentDepositSchema.externalRefundObservedCents),
        sql`COALESCE(${appointmentDepositSchema.refundLastErrorCode}, '')
          NOT IN ${terminalRefundCodesSql}`,
      ),
      // 6 — refundsAbandoned
      sql`(
        (${appointmentDepositSchema.refundStatus} = 'requested' AND (
          ${appointmentDepositSchema.refundReconcileAttempts} >= 3
          OR ${appointmentDepositSchema.refundTerminalFailureCount} >= 3
          OR ${appointmentDepositSchema.refundKeyEpoch} >= 4
        )) OR
        (${appointmentDepositSchema.refundStatus} = 'failed' AND (
          ${appointmentDepositSchema.refundTerminalFailureCount} >= 3
          OR ${appointmentDepositSchema.refundKeyEpoch} >= 4
          OR ${appointmentDepositSchema.externalRefundObservedCents} IS NOT NULL
          OR COALESCE(${appointmentDepositSchema.refundLastErrorCode}, '')
            IN ${terminalRefundCodesSql}
        ))
      )`,
      // 7 — paidOnDeadAppointment (no_show is intentionally absent)
      sql`${appointmentDepositSchema.status} = 'paid' AND EXISTS (
        SELECT 1 FROM ${appointmentSchema}
        WHERE ${appointmentSchema.id} = ${appointmentDepositSchema.appointmentId}
          AND ${appointmentSchema.salonId} = ${appointmentDepositSchema.salonId}
          AND ${appointmentSchema.status} = 'cancelled'
      )`,
      // 8, 9, 11, 13, 14 and 17.
      sql`${appointmentDepositSchema.externalRefundObservedCents} IS NOT NULL
        AND ${appointmentDepositSchema.status} <> 'refunded'`,
      eq(appointmentDepositSchema.refundConflictFlag, true),
      sql`${appointmentDepositSchema.status} IN ('waived','canceled')
        AND ${appointmentDepositSchema.stripePaymentIntentId} IS NOT NULL
        AND ${appointmentDepositSchema.refundStatus} IS DISTINCT FROM 'succeeded'`,
      eq(appointmentDepositSchema.refundLastErrorCode, 'ACCOUNT_DISCONNECTED'),
      sql`${appointmentDepositSchema.status} = 'refunded'
        AND ${appointmentDepositSchema.refundStatus} IS NULL`,
      sql`${appointmentDepositSchema.stripeRefundId} IS NOT NULL
        AND ${appointmentDepositSchema.status} <> 'refunded'`,
      // 18 — current live binding differs; a missing binding stays with 13.
      sql`${appointmentDepositSchema.stripeAccountId} <> (
        SELECT ${salonStripeAccountSchema.stripeAccountId}
        FROM ${salonStripeAccountSchema}
        WHERE ${salonStripeAccountSchema.salonId} = ${appointmentDepositSchema.salonId}
          AND ${salonStripeAccountSchema.revokedAt} IS NULL
        LIMIT 1
      )`,
    ),
  );
}

export const DEPOSIT_HEALTH_COUNTER_KEYS = [
  'paidDeposits',
  'staleHolds',
  'refundIntentsStuck',
  'refundsPendingOver7d',
  'refundsFailedRetryable',
  'refundsAbandoned',
  'paidOnDeadAppointment',
  'externalPartialRefunds',
  'refundConflicts',
  'moneyOnWaivedOrReleased',
  'depositsAccountDisconnected',
  'refundedWithoutRefundStatus',
  'webhookManualTerminals',
  'webhookLateRefundCriticals',
  'envMismatchSkipped',
  'refundBoundWithoutRefundedStatus',
  'depositsAccountRebound',
] as const;

export type DepositHealthCounterKey = (typeof DEPOSIT_HEALTH_COUNTER_KEYS)[number];
export type DepositHealthCounters = Record<DepositHealthCounterKey, number>;

export type DepositHealthPayload = {
  generatedAt: string;
  sentryDsnConfigured: boolean;
  lastReconcileObservedAt: string | null;
  totals: DepositHealthCounters;
  unattributed: {
    webhookManualTerminals: number;
    webhookLateRefundCriticals: number;
  };
  salonsOmitted: number;
  salons: Array<{
    salonId: string;
    salonSlug: string;
    salonName: string;
    counters: DepositHealthCounters;
  }>;
};

function zeroHealthCounters(): DepositHealthCounters {
  return Object.fromEntries(
    DEPOSIT_HEALTH_COUNTER_KEYS.map(key => [key, 0]),
  ) as DepositHealthCounters;
}

function countValue(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowsFromExecute(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []);
}

/** Exact 17-key payment-health aggregate; null explicitly selects all salons. */
export async function loadDepositHealth(
  salonId: string | null,
): Promise<DepositHealthPayload> {
  const runtimeEnv = resolveRuntimeEnvironment();
  const depositResult = await db.execute(sql`
    SELECT
      d.salon_id AS "salonId",
      COUNT(*) FILTER (WHERE d.status = 'paid') AS "paidDeposits",
      COUNT(*) FILTER (WHERE d.status = 'checkout_created'
        AND COALESCE(
          a.deposit_hold_expires_at,
          d.created_at + ${DEPOSIT_HOLD_WINDOW_MINUTES} * interval '1 minute'
        ) < now() - interval '10 minutes') AS "staleHolds",
      COUNT(*) FILTER (WHERE d.refund_status = 'requested'
        AND d.refund_status_changed_at < now() - interval '15 minutes') AS "refundIntentsStuck",
      COUNT(*) FILTER (WHERE d.refund_status = 'pending'
        AND d.refund_status_changed_at < now() - interval '7 days') AS "refundsPendingOver7d",
      COUNT(*) FILTER (WHERE d.refund_status = 'failed'
        AND d.refund_terminal_failure_count < 3
        AND d.refund_key_epoch < 4
        AND d.external_refund_observed_cents IS NULL
        AND COALESCE(d.refund_last_error_code, '')
          NOT IN ('charge_disputed','refund_disputed_payment','charge_already_refunded'))
        AS "refundsFailedRetryable",
      COUNT(*) FILTER (WHERE
        (d.refund_status = 'requested' AND (
          d.refund_reconcile_attempts >= 3
          OR d.refund_terminal_failure_count >= 3
          OR d.refund_key_epoch >= 4
        )) OR
        (d.refund_status = 'failed' AND (
          d.refund_terminal_failure_count >= 3
          OR d.refund_key_epoch >= 4
          OR d.external_refund_observed_cents IS NOT NULL
          OR COALESCE(d.refund_last_error_code, '')
            IN ('charge_disputed','refund_disputed_payment','charge_already_refunded')
        ))) AS "refundsAbandoned",
      COUNT(*) FILTER (WHERE d.status = 'paid' AND a.status = 'cancelled')
        AS "paidOnDeadAppointment",
      COUNT(*) FILTER (WHERE d.external_refund_observed_cents IS NOT NULL
        AND d.status <> 'refunded') AS "externalPartialRefunds",
      COUNT(*) FILTER (WHERE d.refund_conflict_flag = true) AS "refundConflicts",
      COUNT(*) FILTER (WHERE d.status IN ('waived','canceled')
        AND d.stripe_payment_intent_id IS NOT NULL
        AND d.refund_status IS DISTINCT FROM 'succeeded') AS "moneyOnWaivedOrReleased",
      COUNT(*) FILTER (WHERE d.refund_last_error_code = 'ACCOUNT_DISCONNECTED')
        AS "depositsAccountDisconnected",
      COUNT(*) FILTER (WHERE d.status = 'refunded' AND d.refund_status IS NULL)
        AS "refundedWithoutRefundStatus",
      0::bigint AS "webhookManualTerminals",
      0::bigint AS "webhookLateRefundCriticals",
      COUNT(*) FILTER (WHERE d.refund_requested_env IS NOT NULL
        AND d.refund_requested_env <> ${runtimeEnv}
        AND d.refund_status IN ('requested','pending')) AS "envMismatchSkipped",
      COUNT(*) FILTER (WHERE d.stripe_refund_id IS NOT NULL
        AND d.status <> 'refunded') AS "refundBoundWithoutRefundedStatus",
      COUNT(*) FILTER (WHERE d.stripe_account_id <> current_binding.stripe_account_id)
        AS "depositsAccountRebound",
      MAX(d.refund_reconcile_claimed_at) AS "lastReconcileObservedAt"
    FROM appointment_deposit d
    JOIN appointment a ON a.salon_id = d.salon_id AND a.id = d.appointment_id
    LEFT JOIN salon_stripe_account current_binding
      ON current_binding.salon_id = d.salon_id
      AND current_binding.revoked_at IS NULL
    WHERE (${salonId}::text IS NULL OR d.salon_id = ${salonId})
    GROUP BY d.salon_id
  `);

  const manualOutcomes = [
    'orphan_unresolved',
    'held_mismatch',
    'held_duplicate_session',
    'account_mismatch',
    'unbound_unresolved',
    'poisoned',
    'refund_failed_unreconciled',
  ];
  const manualOutcomesSql = sql.join(
    manualOutcomes.map(outcome => sql`${outcome}`),
    sql`, `,
  );
  const eventResult = await db.execute(sql`
    SELECT
      e.salon_id AS "salonId",
      COUNT(*) FILTER (WHERE e.outcome IN (${manualOutcomesSql})
        AND e.type NOT LIKE 'luster.%'
        AND NOT EXISTS (
          SELECT 1 FROM appointment_deposit d
          WHERE (
            d.stripe_refund_id = e.raw_payload #>> '{data,object,id}'
            OR d.stripe_payment_intent_id = COALESCE(
              e.payment_intent_id,
              e.raw_payload #>> '{data,object,payment_intent}'
            )
          )
          AND d.refund_status IN ('succeeded','failed')
        )) AS "webhookManualTerminals",
      COUNT(*) FILTER (WHERE e.outcome = 'already_confirmed_late_refund')
        AS "webhookLateRefundCriticals"
    FROM stripe_webhook_event e
    WHERE (${salonId}::text IS NULL OR e.salon_id = ${salonId})
    GROUP BY e.salon_id
  `);

  const salonRows = salonId === null
    ? await db.select({
      salonId: salonSchema.id,
      salonSlug: salonSchema.slug,
      salonName: salonSchema.name,
    }).from(salonSchema)
    : await db.select({
      salonId: salonSchema.id,
      salonSlug: salonSchema.slug,
      salonName: salonSchema.name,
    }).from(salonSchema).where(eq(salonSchema.id, salonId));

  const bySalon = new Map<string, DepositHealthCounters>();
  let lastReconcileObservedAt: Date | string | null = null;
  for (const row of rowsFromExecute(depositResult)) {
    const rowSalonId = String(row.salonId);
    const counters = zeroHealthCounters();
    for (const key of DEPOSIT_HEALTH_COUNTER_KEYS) {
      counters[key] = countValue(row[key]);
    }
    bySalon.set(rowSalonId, counters);
    const observed = row.lastReconcileObservedAt as Date | string | null;
    if (
      observed
      && (!lastReconcileObservedAt
        || new Date(observed).getTime() > new Date(lastReconcileObservedAt).getTime())
    ) {
      lastReconcileObservedAt = observed;
    }
  }

  const unattributed = {
    webhookManualTerminals: 0,
    webhookLateRefundCriticals: 0,
  };
  for (const row of rowsFromExecute(eventResult)) {
    const manual = countValue(row.webhookManualTerminals);
    const late = countValue(row.webhookLateRefundCriticals);
    if (row.salonId === null) {
      unattributed.webhookManualTerminals += manual;
      unattributed.webhookLateRefundCriticals += late;
      continue;
    }
    const rowSalonId = String(row.salonId);
    const counters = bySalon.get(rowSalonId) ?? zeroHealthCounters();
    counters.webhookManualTerminals += manual;
    counters.webhookLateRefundCriticals += late;
    bySalon.set(rowSalonId, counters);
  }

  const totals = zeroHealthCounters();
  for (const counters of bySalon.values()) {
    for (const key of DEPOSIT_HEALTH_COUNTER_KEYS) {
      totals[key] += counters[key];
    }
  }
  totals.webhookManualTerminals += unattributed.webhookManualTerminals;
  totals.webhookLateRefundCriticals += unattributed.webhookLateRefundCriticals;

  const nonZero = salonRows
    .map(salon => ({
      ...salon,
      counters: bySalon.get(salon.salonId) ?? zeroHealthCounters(),
    }))
    .filter(row => DEPOSIT_HEALTH_COUNTER_KEYS.some(key => row.counters[key] > 0))
    .sort((left, right) => {
      const severity: DepositHealthCounterKey[] = [
        'moneyOnWaivedOrReleased',
        'refundsAbandoned',
        'refundsFailedRetryable',
        'refundIntentsStuck',
        'webhookLateRefundCriticals',
      ];
      for (const key of severity) {
        const difference = right.counters[key] - left.counters[key];
        if (difference !== 0) {
          return difference;
        }
      }
      return left.salonName.localeCompare(right.salonName);
    });
  const salons = nonZero.slice(0, 100);

  return {
    generatedAt: new Date().toISOString(),
    sentryDsnConfigured: getPublicSentryRuntimeConfig().enabled,
    lastReconcileObservedAt: lastReconcileObservedAt
      ? new Date(lastReconcileObservedAt).toISOString()
      : null,
    totals,
    unattributed,
    salonsOmitted: Math.max(0, nonZero.length - salons.length),
    salons,
  };
}
