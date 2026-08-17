/**
 * Communication intents — enqueue, claim, lease recovery, supersession.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §11 +
 * the Rev 1 intent model carried by §11.1.
 *
 * State machine (all transitions CAS, idempotent, tenant-safe):
 *
 *   pending → claimed → sending → { sent | send_outcome_unknown | failed }
 *   pending → { canceled | suppressed | expired | blocked_no_credit }
 *
 * send_outcome_unknown never transitions back to pending and is never
 * re-sent — the reconciler resolves it with provider evidence only.
 *
 * Lease recovery discriminates on STATUS, not on the presence of a
 * delivery row: 'claimed' provably never reached the provider (recover to
 * pending); 'sending' means the pre-provider transaction committed, so
 * acceptance may have happened (→ send_outcome_unknown).
 */

import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { type DatabaseSessionHandle, db } from '@/libs/DB';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import {
  type CommunicationEventType,
  type CommunicationIntent,
  communicationIntentSchema,
  type CommunicationIntentStatus,
} from '@/models/Schema';

/**
 * Transaction plumbing, mirroring the codebase's single transaction idiom
 * (`OutboxTransaction`/`OutboxDatabase`, integrationOutbox.ts:47-48).
 *
 * Gate C / C1 needs this because materialization must happen INSIDE the
 * appointment-mutation transaction (contract §11.1): enqueuing after the
 * commit means a crash in the gap silently drops the confirmation or
 * reminder with no retry path, which is exactly the durability the intent
 * model exists to provide.
 */
export type CommunicationIntentTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export type CommunicationIntentDatabase =
  | CommunicationIntentTransaction
  | DatabaseSessionHandle;

export type EnqueueIntentInput = {
  /**
   * Optional transaction handle. Defaults to the module-level `db` so every
   * pre-existing caller keeps working unchanged; C1's producers pass the open
   * appointment/deposit transaction so the intent commits atomically with the
   * business state that justifies it.
   */
  database?: CommunicationIntentDatabase;
  salonId: string;
  appointmentId?: string | null;
  channel: 'sms' | 'email';
  eventType: CommunicationEventType;
  audience: 'client' | 'owner' | 'technician';
  dedupeKey: string;
  recipient: string;
  destinationCountry?: string | null;
  templateKey: string;
  templateVersion: string;
  variables: Record<string, string>;
  ruleId?: string | null;
  startRevision?: string | null;
  schedulingRevision: string;
  scheduledFor: Date;
  notAfter: Date;
};

/** Idempotent on dedupe_key: a replayed enqueue returns the existing intent. */
export async function enqueueCommunicationIntent(
  input: EnqueueIntentInput,
): Promise<{ intentId: string; created: boolean }> {
  const database = input.database ?? db;
  const id = `ci_${crypto.randomUUID()}`;
  const inserted = await database
    .insert(communicationIntentSchema)
    .values({
      id,
      salonId: input.salonId,
      appointmentId: input.appointmentId ?? null,
      channel: input.channel,
      eventType: input.eventType,
      audience: input.audience,
      dedupeKey: input.dedupeKey,
      // SMS: one recipient format everywhere — consent rows, suppression
      // events and attribution all key on the bare-10-digit form. EMAIL:
      // phone normalization would reduce an address to an empty string
      // (latent through Gate B, which only produced SMS intents; caught by
      // the C1 email-lane tests) — emails just get case/whitespace folding.
      recipient: input.channel === 'sms'
        ? normalizeConsentRecipient(input.recipient)
        : input.recipient.trim().toLowerCase(),
      destinationCountry: input.destinationCountry ?? null,
      templateKey: input.templateKey,
      templateVersion: input.templateVersion,
      variables: input.variables,
      ruleId: input.ruleId ?? null,
      startRevision: input.startRevision ?? null,
      schedulingRevision: input.schedulingRevision,
      status: 'pending',
      scheduledFor: input.scheduledFor,
      notAfter: input.notAfter,
      availableAt: input.scheduledFor,
    })
    .onConflictDoNothing({ target: communicationIntentSchema.dedupeKey })
    .returning();
  if (inserted.length === 1) {
    return { intentId: inserted[0]!.id, created: true };
  }
  const existing = await database
    .select({ id: communicationIntentSchema.id })
    .from(communicationIntentSchema)
    .where(eq(communicationIntentSchema.dedupeKey, input.dedupeKey))
    .limit(1);
  return { intentId: existing[0]!.id, created: false };
}

export const INTENT_LEASE_MS = 2 * 60 * 1000;

/**
 * Atomic due-intent claiming: bounded batch, per-salon fairness (row_number
 * over salon partitions), per-salon in-flight concurrency of 1 enforced in
 * the claim SQL itself — worker-local mutexes cannot serialize concurrent
 * serverless invocations.
 */
export async function claimDueIntents(input: {
  workerId: string;
  batchLimit: number;
  perSalonLimit: number;
  now?: Date;
}): Promise<CommunicationIntent[]> {
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + INTENT_LEASE_MS);
  const rows = await db.execute(sql`
    WITH due AS (
      SELECT i.id,
             ROW_NUMBER() OVER (PARTITION BY i.salon_id ORDER BY i.scheduled_for, i.id) AS rn
      FROM communication_intent i
      WHERE i.status = 'pending'
        AND i.available_at <= ${now}
        AND i.not_after > ${now}
        AND NOT EXISTS (
          SELECT 1 FROM communication_intent inflight
          WHERE inflight.salon_id = i.salon_id
            AND inflight.status IN ('claimed', 'sending')
        )
    ),
    picked AS (
      SELECT id FROM due WHERE rn <= ${input.perSalonLimit} ORDER BY id LIMIT ${input.batchLimit}
    )
    UPDATE communication_intent i
       SET status = 'claimed',
           locked_by = ${input.workerId},
           lease_expires_at = ${leaseUntil},
           attempts = i.attempts + 1,
           updated_at = clock_timestamp()
      FROM picked
     WHERE i.id = picked.id AND i.status = 'pending'
    RETURNING i.id
  `);
  const ids = (rows.rows as Array<Record<string, unknown>>).map(row => String(row.id));
  if (ids.length === 0) {
    return [];
  }
  // Re-select through the drizzle mapping so callers get typed camelCase rows
  // (raw RETURNING yields snake_case objects).
  return db
    .select()
    .from(communicationIntentSchema)
    .where(inArray(communicationIntentSchema.id, ids));
}

export type IntentTransition =
  | { to: 'sending'; deliveryId: string; creditReservationId: string | null; bodySnapshot: string; bodyFingerprint: string; segmentCount: number; encoding: string }
  | { to: 'sent' }
  | { to: 'send_outcome_unknown'; lastError: string }
  | { to: 'failed'; lastError: string }
  | { to: 'suppressed'; lastError: string }
  | { to: 'canceled'; supersededByIntentId?: string }
  | { to: 'expired'; lastError: string }
  | { to: 'blocked_no_credit'; blockedReason: string; requiredCredits: number };

const TRANSITION_PRECONDITIONS: Record<IntentTransition['to'], CommunicationIntentStatus[]> = {
  sending: ['claimed'],
  // sent-from-unknown is legal ONLY in the dispatcher's TX2, which holds the
  // provider SID in hand: if the lease expired DURING the provider call and
  // recovery already parked the intent, the proven acceptance still wins.
  sent: ['sending', 'send_outcome_unknown'],
  send_outcome_unknown: ['sending', 'claimed'],
  failed: ['sending', 'claimed'],
  // 'sending' is legal ONLY because the dispatcher's final pre-provider
  // check runs after TX1 (claimed→sending) and BEFORE the provider call —
  // a sending-state suppression is always a proven never-sent message.
  suppressed: ['claimed', 'pending', 'sending'],
  canceled: ['pending', 'claimed', 'blocked_no_credit'],
  expired: ['pending', 'claimed', 'blocked_no_credit'],
  blocked_no_credit: ['claimed'],
};

export async function transitionIntent(
  intentId: string,
  transition: IntentTransition,
  now = new Date(),
): Promise<{ applied: boolean }> {
  const preconditions = TRANSITION_PRECONDITIONS[transition.to];
  const patch: Record<string, unknown> = { status: transition.to };
  if (transition.to === 'sending') {
    patch.deliveryId = transition.deliveryId;
    patch.creditReservationId = transition.creditReservationId;
    patch.bodySnapshot = transition.bodySnapshot;
    patch.bodyFingerprint = transition.bodyFingerprint;
    patch.segmentCount = transition.segmentCount;
    patch.encoding = transition.encoding;
  }
  if ('lastError' in transition) {
    patch.lastError = transition.lastError;
  }
  if (transition.to === 'blocked_no_credit') {
    patch.blockedReason = transition.blockedReason;
    patch.requiredCredits = transition.requiredCredits;
    patch.blockedAt = now;
  }
  if (transition.to === 'canceled' && transition.supersededByIntentId !== undefined) {
    patch.supersededByIntentId = transition.supersededByIntentId;
  }
  if (['sent', 'failed', 'canceled', 'suppressed', 'expired'].includes(transition.to)) {
    patch.resolvedAt = now;
  }
  const updated = await db
    .update(communicationIntentSchema)
    .set(patch)
    .where(and(
      eq(communicationIntentSchema.id, intentId),
      inArray(communicationIntentSchema.status, preconditions),
    ))
    .returning();
  return { applied: updated.length === 1 };
}

/**
 * Lease recovery. 'claimed' past lease → pending (never reached provider);
 * 'sending' past lease → send_outcome_unknown (acceptance may have
 * happened; NEVER resend).
 */
export async function recoverExpiredLeases(now = new Date()): Promise<{
  recovered: number;
  unknownOutcome: number;
}> {
  const recovered = await db
    .update(communicationIntentSchema)
    .set({
      status: 'pending',
      lockedBy: null,
      leaseExpiresAt: null,
      availableAt: now,
      lastError: 'WORKER_LEASE_EXPIRED',
    })
    .where(and(
      eq(communicationIntentSchema.status, 'claimed'),
      lt(communicationIntentSchema.leaseExpiresAt, now),
    ))
    .returning();
  const unknown = await db
    .update(communicationIntentSchema)
    .set({ status: 'send_outcome_unknown', lastError: 'WORKER_DIED_MID_SEND' })
    .where(and(
      eq(communicationIntentSchema.status, 'sending'),
      lt(communicationIntentSchema.leaseExpiresAt, now),
    ))
    .returning();
  return { recovered: recovered.length, unknownOutcome: unknown.length };
}

/** Expire pending/blocked intents past their notAfter — never send stale. */
export async function expireStaleIntents(now = new Date()): Promise<{ expired: number }> {
  const updated = await db
    .update(communicationIntentSchema)
    .set({ status: 'expired', lastError: 'NOT_AFTER_ELAPSED', resolvedAt: now })
    .where(and(
      inArray(communicationIntentSchema.status, ['pending', 'blocked_no_credit']),
      lt(communicationIntentSchema.notAfter, now),
    ))
    .returning();
  return { expired: updated.length };
}

/** Cancel all live intents for an appointment (reschedule/cancel supersession). */
export async function cancelAppointmentIntents(input: {
  /**
   * Optional transaction handle — supersession must commit atomically with
   * the appointment mutation that justifies it (same contract as enqueue).
   */
  database?: CommunicationIntentDatabase;
  salonId: string;
  appointmentId: string;
  supersededByIntentId?: string;
  now?: Date;
}): Promise<{ canceled: number }> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const updated = await database
    .update(communicationIntentSchema)
    .set({
      status: 'canceled',
      resolvedAt: now,
      supersededByIntentId: input.supersededByIntentId ?? null,
      lastError: 'APPOINTMENT_SUPERSEDED',
    })
    .where(and(
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.appointmentId, input.appointmentId),
      inArray(communicationIntentSchema.status, ['pending', 'blocked_no_credit']),
    ))
    .returning();
  return { canceled: updated.length };
}

/**
 * Release blocked_no_credit intents after a top-up — ONLY those still
 * relevant (notAfter in the future). Everything else stays blocked as
 * evidence.
 */
export async function releaseBlockedIntentsAfterTopup(
  salonId: string,
  now = new Date(),
): Promise<{ released: number }> {
  const updated = await db
    .update(communicationIntentSchema)
    .set({
      status: 'pending',
      availableAt: now,
      blockedReason: null,
      lastError: 'RELEASED_AFTER_TOPUP',
    })
    .where(and(
      eq(communicationIntentSchema.salonId, salonId),
      eq(communicationIntentSchema.status, 'blocked_no_credit'),
      sql`${communicationIntentSchema.notAfter} > ${now}`,
    ))
    .returning();
  return { released: updated.length };
}
