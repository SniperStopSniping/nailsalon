/**
 * Durable §6.7 exclusions, stored with the refund transition in audit_log.
 * These financial facts must remain for the subscription's lifetime; payload
 * purging never removes them. All callers hold the subscription row lock.
 *
 * PR-1/R-2 makes the evidence CORRECTABLE without ever deleting a row: a
 * second action (`billing_subscription_refund_evidence_resolved`) records a
 * `void` (the charge is no longer fully refunded) or a `set` (an
 * authoritative coverage window replacing malformed legacy evidence). The
 * EFFECTIVE state of an invoice is the row with the highest `seq` across BOTH
 * actions, so the log stays append-only and every correction is auditable.
 *
 * `seq` is assigned by the writer under the `billing_subscription FOR UPDATE`
 * lock as `max(seq) + 1`; ordering therefore never depends on clocks (two
 * rows can share a `created_at` second, and a replayed event can land with an
 * older one).
 */
import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { type ActorType, logAuditEventTx } from '@/libs/auditLog';
import { auditLogSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

/** Metadata written by PR-1 onward. v1 = the pre-PR-1 `refund_applied` shape. */
export const REFUND_EVIDENCE_VERSION = 2;

const REFUND_APPLIED_ACTION = 'billing_subscription_refund_applied';
const REFUND_RESOLVED_ACTION = 'billing_subscription_refund_evidence_resolved';

/**
 * The read surface {@link readSubscriptionRefunds} needs. Declared structurally
 * so the same reader serves both a transaction handle (every locked writer)
 * and the top-level database handle (the super-admin `plan` read).
 */
export type BillingEvidenceReader = Pick<BillingDbTransaction, 'select'>;

export type SubscriptionRefund = { invoiceId: string; start: Date; end: Date };

export type SubscriptionRefundEvidence = {
  /** Effective, well-formed refunded coverage. */
  refunds: SubscriptionRefund[];
  /** Any effective row is malformed or of an unknown version → fail closed. */
  incomplete: boolean;
  /** Invoices whose effective state is "refunded" (applied or set), well-formed or not. */
  appliedInvoiceIds: Set<string>;
  /**
   * Invoices whose effective state is an explicit `void`, mapped to the
   * ACTOR TYPE that voided them.
   *
   * The reconcile safety net needs both halves of the question — evidence
   * can be wrong in either direction, and a void is just as capable of being
   * stale as an applied row (a handler that read a partial charge can commit
   * its void AFTER a newer handler committed the applied row). The actor
   * type is what keeps the repair from fighting a human: a `super_admin`
   * void is a deliberate operator decision and is never re-asserted
   * automatically.
   */
  voidedInvoiceIds: Map<string, ActorType>;
  /** max(seq) + 1 over ALL rows of both actions; 0 rows → 1. */
  nextSeq: number;
  /** Total rows read (operator plan output). */
  rows: number;
};

type EvidenceRow = {
  id: string;
  createdAt: Date;
  action: string;
  actorType: string;
  metadata: Record<string, unknown>;
  invoiceId: string;
  seq: number;
  /** null when the row declares a version this build cannot interpret. */
  version: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** A finite, non-negative sequence number; anything else counts as 0. */
function readSeq(metadata: Record<string, unknown>): number {
  const raw = metadata.seq;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Legacy `refund_applied` rows predate `evidenceVersion` and are v1 by
 * definition. Everything else must declare a version this build understands;
 * a higher one means a newer writer wrote evidence we cannot interpret, which
 * is a fail-closed condition, never a silently ignored row.
 */
function readVersion(metadata: Record<string, unknown>, action: string): number | null {
  const raw = metadata.evidenceVersion;
  if (raw === undefined || raw === null) {
    return action === REFUND_APPLIED_ACTION ? 1 : null;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1 || raw > REFUND_EVIDENCE_VERSION) {
    return null;
  }
  return raw;
}

function readBounds(
  metadata: Record<string, unknown>,
  startKey: string,
  endKey: string,
): { start: Date; end: Date } | null {
  const rawStart = metadata[startKey];
  const rawEnd = metadata[endKey];
  if (typeof rawStart !== 'string' || typeof rawEnd !== 'string') {
    return null;
  }
  const start = new Date(rawStart);
  const end = new Date(rawEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    return null;
  }
  return { start, end };
}

/**
 * Deterministic winner for one invoice: highest `seq`, then the later
 * `created_at`, then the greater row id. Never a clock-only comparison.
 */
function laterRow(current: EvidenceRow, candidate: EvidenceRow): EvidenceRow {
  if (candidate.seq !== current.seq) {
    return candidate.seq > current.seq ? candidate : current;
  }
  const currentAt = current.createdAt.getTime();
  const candidateAt = candidate.createdAt.getTime();
  if (candidateAt !== currentAt) {
    return candidateAt > currentAt ? candidate : current;
  }
  return candidate.id > current.id ? candidate : current;
}

export async function readSubscriptionRefunds(
  tx: BillingEvidenceReader,
  subscription: { id: string; salonId: string },
): Promise<SubscriptionRefundEvidence> {
  const rows = await tx
    .select({
      id: auditLogSchema.id,
      createdAt: auditLogSchema.createdAt,
      action: auditLogSchema.action,
      actorType: auditLogSchema.actorType,
      metadata: auditLogSchema.metadata,
    })
    .from(auditLogSchema)
    .where(and(
      eq(auditLogSchema.salonId, subscription.salonId),
      eq(auditLogSchema.entityType, 'billing_subscription'),
      eq(auditLogSchema.entityId, subscription.id),
      inArray(auditLogSchema.action, [REFUND_APPLIED_ACTION, REFUND_RESOLVED_ACTION]),
    ));

  const refunds: SubscriptionRefund[] = [];
  const appliedInvoiceIds = new Set<string>();
  const voidedInvoiceIds = new Map<string, ActorType>();
  let incomplete = false;
  let maxSeq = 0;

  // Pass 1: parse identities and the global sequence high-water mark.
  const effective = new Map<string, EvidenceRow>();
  for (const row of rows) {
    const metadata = asRecord(row.metadata);
    const seq = readSeq(metadata);
    maxSeq = Math.max(maxSeq, seq);
    const invoiceId = metadata.invoiceId;
    if (typeof invoiceId !== 'string' || invoiceId.length === 0) {
      // No invoice identity at all: the row cannot be grouped, superseded or
      // reasoned about — operator review, never a silent re-grant.
      incomplete = true;
      continue;
    }
    const parsed: EvidenceRow = {
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      actorType: row.actorType,
      metadata,
      invoiceId,
      seq,
      version: readVersion(metadata, row.action),
    };
    const current = effective.get(invoiceId);
    effective.set(invoiceId, current === undefined ? parsed : laterRow(current, parsed));
  }

  // Pass 2: reduce each invoice's winning row to its effective state.
  for (const row of effective.values()) {
    if (row.version === null) {
      incomplete = true; // Unknown evidence version → fail closed.
      continue;
    }
    if (row.action === REFUND_APPLIED_ACTION) {
      appliedInvoiceIds.add(row.invoiceId);
      const bounds = readBounds(row.metadata, 'refundedPeriodStart', 'refundedPeriodEnd');
      if (bounds === null) {
        incomplete = true; // Legacy null-bound evidence: refunded, extent unknown.
        continue;
      }
      refunds.push({ invoiceId: row.invoiceId, start: bounds.start, end: bounds.end });
      continue;
    }
    const resolution = row.metadata.resolution;
    if (resolution === 'void') {
      // The invoice is NOT refunded; it contributes no exclusion. Recorded
      // with its actor so the reconcile safety net can re-check a MACHINE
      // void against Stripe while leaving an operator's decision alone.
      voidedInvoiceIds.set(row.invoiceId, row.actorType as ActorType);
      continue;
    }
    if (resolution === 'set') {
      appliedInvoiceIds.add(row.invoiceId);
      const bounds = readBounds(row.metadata, 'periodStart', 'periodEnd');
      if (bounds === null) {
        incomplete = true;
        continue;
      }
      refunds.push({ invoiceId: row.invoiceId, start: bounds.start, end: bounds.end });
      continue;
    }
    incomplete = true; // Unknown resolution verb → fail closed.
  }

  return { refunds, incomplete, appliedInvoiceIds, voidedInvoiceIds, nextSeq: maxSeq + 1, rows: rows.length };
}

export function overlapsRefund(
  evidence: Pick<SubscriptionRefundEvidence, 'refunds' | 'incomplete'>,
  period: { start: Date; end: Date },
): boolean {
  return evidence.incomplete || evidence.refunds.some(refund => period.start < refund.end && period.end > refund.start);
}

/**
 * Append ONE correction row for a single invoice. The caller must already
 * hold the `billing_subscription FOR UPDATE` lock and must pass the `nextSeq`
 * it read under that same lock, so two concurrent corrections serialize into
 * two rows with distinct, totally ordered sequence numbers.
 *
 * Throws on invalid input: a correction that cannot be read back
 * unambiguously is worse than no correction at all.
 */
export async function recordSubscriptionRefundResolution(
  tx: BillingDbTransaction,
  input: {
    subscription: { id: string; salonId: string };
    invoiceId: string;
    resolution: 'void' | 'set';
    periodStart?: Date;
    periodEnd?: Date;
    reason: string;
    actor: { actorType: ActorType; actorId: string | null };
    eventId?: string;
    observedAmountRefunded?: number;
    observedAmount?: number;
    seq: number;
  },
): Promise<void> {
  if (typeof input.invoiceId !== 'string' || input.invoiceId.length === 0) {
    throw new TypeError('INVALID_REFUND_RESOLUTION_INVOICE');
  }
  if (input.resolution !== 'void' && input.resolution !== 'set') {
    throw new TypeError('INVALID_REFUND_RESOLUTION_VERB');
  }
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    throw new TypeError('INVALID_REFUND_RESOLUTION_REASON');
  }
  if (!Number.isFinite(input.seq) || input.seq < 1) {
    throw new TypeError('INVALID_REFUND_RESOLUTION_SEQ');
  }
  const bounded = input.resolution === 'set';
  if (bounded && (
    input.periodStart === undefined
    || input.periodEnd === undefined
    || !Number.isFinite(input.periodStart.getTime())
    || !Number.isFinite(input.periodEnd.getTime())
    || input.periodStart >= input.periodEnd
  )) {
    throw new TypeError('INVALID_REFUND_RESOLUTION_BOUNDS');
  }

  await logAuditEventTx(tx, {
    salonId: input.subscription.salonId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    action: REFUND_RESOLVED_ACTION,
    entityType: 'billing_subscription',
    entityId: input.subscription.id,
    metadata: {
      evidenceVersion: REFUND_EVIDENCE_VERSION,
      seq: input.seq,
      invoiceId: input.invoiceId,
      resolution: input.resolution,
      ...(bounded
        ? {
            periodStart: input.periodStart!.toISOString(),
            periodEnd: input.periodEnd!.toISOString(),
          }
        : {}),
      reason: input.reason,
      ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      // Non-finite observations are DROPPED rather than written: JSON turns
      // NaN/Infinity into null, which would read back as a real observation
      // of zero-ish amounts.
      ...(Number.isFinite(input.observedAmountRefunded)
        ? { observedAmountRefunded: input.observedAmountRefunded }
        : {}),
      ...(Number.isFinite(input.observedAmount) ? { observedAmount: input.observedAmount } : {}),
    },
  });
}
