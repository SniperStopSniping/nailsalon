import 'server-only';

import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';

import { ClientLifecycleStabilizationError, getSalonClientLineageIdentityWithHandle, lockOperationalSalonClientContactWithHandle, resolveOperationalSalonClientContactWithHandle } from '@/libs/clientLifecycleStabilization';
import type { CommunicationIntentDatabase, CommunicationIntentTransaction } from '@/libs/communicationIntent';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { applyQuietHours } from '@/libs/communicationScheduling';
import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { db, usesRuntimePostgres } from '@/libs/DB';
import { isValidPhone } from '@/libs/phone';
import type { ReviewAutomationMode } from '@/libs/reviewAutomationPolicy';
import { applyLegacyAutomaticReviewUpdate, evaluateScheduledEndReviewEligibility, resolveReviewAutomationPolicy, reviewSettingsUpdateSchema } from '@/libs/reviewAutomationPolicy';
import { evaluateReviewHistory } from '@/libs/reviewRequestHistory';
import { isReviewUrl, renderReviewMessage, resolveReviewMessageTemplate, reviewMessageFits, reviewSmsBody } from '@/libs/reviewRequests';
import type { ClientReviewHistoryItem, ClientReviewOverview, ReviewRequestDisplay } from '@/libs/reviewRequestStatus';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { readSharedSenderEnvConfig } from '@/libs/smsSender';
import { DEFAULT_BOOKING_TIME_ZONE } from '@/libs/timeZone';
import { appointmentSchema, clientCommunicationSchema, communicationConsentSchema, communicationIntentSchema, notificationDeliverySchema, reviewRequestSchema, reviewRequestTriggerSchema, salonClientSchema, salonRetentionSettingsSchema, salonSchema, smsGlobalConsentEventSchema } from '@/models/Schema';

const DAY = 86400000;
const CANCELLABLE = ['pending', 'claimed', 'blocked_no_credit'] as const;
const REVIEW_TRIGGER_BATCH_LIMIT = 50;
const REVIEW_TRIGGER_RETRY_MS = 5 * 60_000;
const REVIEW_TRIGGER_BATCH_BUDGET_MS = 15_000;

type ReviewMutationTransaction = CommunicationIntentTransaction;

function queryRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows as T[] : [];
}

async function setReviewMutationTimeouts(transaction: ReviewMutationTransaction) {
  if (!usesRuntimePostgres) {
    return;
  }
  await transaction.execute(sql`set local lock_timeout = '1s'`);
  await transaction.execute(sql`set local statement_timeout = '4s'`);
}

/** Review mutations share one short-lived, transaction-scoped salon fence. */
async function tryLockSalonReviewMutation(
  transaction: ReviewMutationTransaction,
  salonId: string,
): Promise<boolean> {
  // PGlite has one physical session and cannot prove advisory-lock behavior.
  // Production workers always take the transaction-scoped salon fence.
  if (!usesRuntimePostgres) {
    return true;
  }
  const result = await transaction.execute<{ acquired: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${`review-mutation:${salonId}`}, 0)) AS acquired
  `);
  const rows = Array.isArray(result) ? result : result.rows ?? [];
  return rows[0]?.acquired === true;
}

/** Owner mutations wait briefly for the same fence used by the worker. */
export async function lockSalonReviewMutation(
  transaction: ReviewMutationTransaction,
  salonId: string,
) {
  await setReviewMutationTimeouts(transaction);
  if (!usesRuntimePostgres) {
    return;
  }
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`review-mutation:${salonId}`}, 0))
  `);
}

function retryTriggerAt(trigger: typeof reviewRequestTriggerSchema.$inferSelect, now: Date) {
  return new Date(Math.min(now.getTime() + REVIEW_TRIGGER_RETRY_MS, trigger.expiresAt.getTime()));
}

async function deferReviewTrigger(
  database: typeof db,
  candidate: { id: string; salonId: string },
  now: Date,
) {
  try {
    await database.transaction(async (transaction) => {
      await setReviewMutationTimeouts(transaction);
      if (!(await tryLockSalonReviewMutation(transaction, candidate.salonId))) {
        return;
      }
      const [trigger] = await transaction.select().from(reviewRequestTriggerSchema)
        .where(and(eq(reviewRequestTriggerSchema.id, candidate.id), eq(reviewRequestTriggerSchema.salonId, candidate.salonId))).limit(1);
      if (!trigger || trigger.state !== 'pending' || trigger.availableAt > now) {
        return;
      }
      await transaction.update(reviewRequestTriggerSchema).set({
        availableAt: retryTriggerAt(trigger, now),
        updatedAt: now,
      }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
    });
  } catch {
    // This is only a fairness optimization. The immutable due/expiry record
    // remains pending for the next cron if the retry write cannot run.
  }
}

function reviewIneligibilityReasonCode(reason: string | null) {
  switch (reason) {
    case 'A review request was previously marked sent for this client.': return 'LEGACY_REVIEW_SENT';
    case 'This client is already marked as having left a review.': return 'CLIENT_ALREADY_REVIEWED';
    case 'Review requests are off for this client.': return 'CLIENT_SUPPRESSED';
    case 'This client has not permitted Luster SMS, or has opted out.': return 'SMS_INELIGIBLE';
    case 'Add a Google review link in Review settings.': return 'GOOGLE_REVIEW_LINK_MISSING';
    case 'Enable Luster SMS in Client communications to request reviews.': return 'SMS_DISABLED';
    case 'Automatic review requests are off for this appointment.': return 'AUTOMATIC_NOT_ACTIVE';
    case 'Shorten the review message to 10 SMS segments or fewer.': return 'MESSAGE_TOO_LONG';
    case 'Complete this appointment before requesting a review.': return 'APPOINTMENT_NOT_COMPLETED';
    case 'This client needs an active profile and a usable mobile number.': return 'CLIENT_UNAVAILABLE';
    case 'This business is unavailable.': return 'SALON_UNAVAILABLE';
    default: return 'INELIGIBLE';
  }
}

/**
 * Records only the durable completion event. This deliberately runs inside the
 * existing completion transaction and does not resolve client identity, create
 * an intent, take a review advisory lock, or contact a provider. A later
 * materializer owns those mutable eligibility and delivery decisions.
 */
export async function recordCompletedReviewTrigger(
  transaction: CommunicationIntentTransaction,
  appointment: typeof appointmentSchema.$inferSelect,
  now: Date,
) {
  if (appointment.status !== 'completed' || !appointment.completedAt) {
    return { created: false as const };
  }

  const [settings] = await transaction.select().from(salonRetentionSettingsSchema)
    .where(eq(salonRetentionSettingsSchema.salonId, appointment.salonId)).limit(1);
  const policy = resolveReviewAutomationPolicy(settings);
  if (policy.mode !== 'marked_completed' || !settings?.reviewRequestsEnabledAt
    || appointment.completedAt <= settings.reviewRequestsEnabledAt) {
    return { created: false as const };
  }

  const scheduledFor = new Date(appointment.completedAt.getTime() + policy.delayMinutes * 60_000);
  const expiresAt = new Date(scheduledFor.getTime() + DAY);
  const inserted = await transaction.insert(reviewRequestTriggerSchema).values({
    id: `rrt_${crypto.randomUUID()}`,
    salonId: appointment.salonId,
    appointmentId: appointment.id,
    kind: 'completed',
    triggerAt: appointment.completedAt,
    appointmentStartAt: appointment.startTime,
    appointmentEndAt: appointment.endTime,
    policyRevision: settings.reviewRequestPolicyRevision,
    scheduledFor,
    // The durable event is ready to become an intent immediately. The intent
    // itself remains scheduled for this immutable due time, so worker cadence
    // never changes the owner-selected delay.
    availableAt: now,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning();

  return { created: inserted.length === 1 };
}

type MaterializeReviewTriggersInput = {
  database?: typeof db;
  limit?: number;
  now?: Date;
  /** Monotonic execution deadline, independent of fixture/business time. */
  deadlineMs?: number;
};

type ScanScheduledEndReviewTriggersInput = {
  database?: typeof db;
  limit?: number;
  now?: Date;
  /** Monotonic execution deadline, independent of fixture/business time. */
  deadlineMs?: number;
};

/**
 * Captures scheduled-end events only for salons that explicitly opted into the
 * new mode. It records business time; delivery remains in the existing intent
 * dispatcher and is deliberately not part of this scan.
 */
export async function scanScheduledEndReviewTriggers(
  input: ScanScheduledEndReviewTriggersInput = {},
) {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? REVIEW_TRIGGER_BATCH_LIMIT, REVIEW_TRIGGER_BATCH_LIMIT));
  const deadlineMs = input.deadlineMs ?? performance.now() + REVIEW_TRIGGER_BATCH_BUDGET_MS;
  const result = { recorded: 0, skipped: 0, deferred: 0, phaseError: false };
  if (performance.now() >= deadlineMs) {
    return result;
  }
  let candidates: { id: string; salonId: string }[];
  try {
    candidates = await database.transaction(async (transaction) => {
      await setReviewMutationTimeouts(transaction);
      // Filter before LIMIT, including all previously captured identities.
      // Round-robin up to five rows per salon; recent sendable events precede
      // expired events after an outage, which are recorded once for history.
      const rows = await transaction.execute(sql`
        with eligible as (
          select a.id, a.salon_id as "salonId", a.end_time as "endTime",
            (a.end_time + ((least(10080, greatest(0, s.review_request_delay_minutes)) + 1440) * interval '1 minute') <= ${now}) as expired
          from appointment a
          join salon_retention_settings s on s.salon_id = a.salon_id
          join salon b on b.id = a.salon_id
          where s.review_request_automation_mode = 'scheduled_end'
            and s.automatic_review_requests = true
            and s.review_requests_enabled_at is not null
            and a.end_time > s.review_requests_enabled_at
            and a.end_time <= ${now}
            and a.start_time < a.end_time
            and a.created_at <= a.end_time
            and a.status in ('confirmed', 'in_progress', 'completed')
            and a.deleted_at is null and b.deleted_at is null and b.is_active = true
            and not exists (
              select 1 from review_request_trigger t
              where t.salon_id = a.salon_id and t.appointment_id = a.id
                and t.kind = 'scheduled_end' and t.trigger_at = a.end_time
                and t.appointment_start_at = a.start_time and t.appointment_end_at = a.end_time
                and t.policy_revision = s.review_request_policy_revision
            )
        ), ranked as (
          select *, row_number() over (partition by "salonId" order by expired, "endTime", id) as turn
          from eligible
        )
        select id, "salonId" from ranked where turn <= 5
        order by expired, turn, "endTime", id limit ${limit}
      `);
      return queryRows<{ id: string; salonId: string }>(rows);
    });
  } catch {
    return { ...result, phaseError: true };
  }
  for (const candidate of candidates) {
    if (performance.now() >= deadlineMs) {
      result.deferred += 1;
      continue;
    }
    try {
      const outcome = await database.transaction(async (transaction) => {
        await setReviewMutationTimeouts(transaction);
        if (!(await tryLockSalonReviewMutation(transaction, candidate.salonId))) {
          return 'deferred' as const;
        }
        if (usesRuntimePostgres) {
          await transaction.execute(sql`select id from appointment where id = ${candidate.id} and salon_id = ${candidate.salonId} for update nowait`);
          await transaction.execute(sql`select id from salon where id = ${candidate.salonId} for share nowait`);
        }
        const [current] = await transaction.select().from(appointmentSchema)
          .where(and(eq(appointmentSchema.id, candidate.id), eq(appointmentSchema.salonId, candidate.salonId))).limit(1);
        const [salon] = await transaction.select().from(salonSchema).where(eq(salonSchema.id, candidate.salonId)).limit(1);
        const [settings] = await transaction.select().from(salonRetentionSettingsSchema)
          .where(eq(salonRetentionSettingsSchema.salonId, candidate.salonId)).limit(1);
        const freshNow = input.now ?? new Date();
        if (!current || current.deletedAt || !salon || salon.deletedAt || !salon.isActive || !settings) {
          return null;
        }
        const decision = evaluateScheduledEndReviewEligibility({
          appointment: current,
          policy: resolveReviewAutomationPolicy(settings),
          now: freshNow,
          automationEnabledAt: settings.reviewRequestsEnabledAt,
        });
        if (!decision.eligible || !decision.scheduledFor) {
          return null;
        }
        const expiresAt = new Date(decision.scheduledFor.getTime() + DAY);
        const expired = expiresAt <= freshNow;
        const rows = await transaction.insert(reviewRequestTriggerSchema).values({
          id: `rrt_${crypto.randomUUID()}`,
          salonId: current.salonId,
          appointmentId: current.id,
          kind: 'scheduled_end',
          triggerAt: current.endTime,
          appointmentStartAt: current.startTime,
          appointmentEndAt: current.endTime,
          policyRevision: settings.reviewRequestPolicyRevision,
          scheduledFor: decision.scheduledFor,
          availableAt: freshNow,
          expiresAt,
          state: expired ? 'skipped' : 'pending',
          reasonCode: expired ? 'EXPIRED' : null,
          resolvedAt: expired ? freshNow : null,
          createdAt: freshNow,
          updatedAt: freshNow,
        }).onConflictDoNothing().returning();
        return rows.length ? expired ? 'skipped' as const : 'recorded' as const : null;
      });
      if (outcome) {
        result[outcome] += 1;
      }
    } catch {
      // A busy or changed appointment must not abort other salons' capture.
      result.deferred += 1;
    }
  }
  return result;
}

type MaterializeReviewTriggersResult = {
  materialized: number;
  pending: number;
  skipped: number;
  deferred: number;
  phaseError: boolean;
  scheduledEnd?: Awaited<ReturnType<typeof scanScheduledEndReviewTriggers>>;
};

/**
 * Turns due completion events into the existing review-request/intents model.
 * Producers snapshot completion or scheduled-end events. This function only
 * consumes durable records and never discovers historic appointments.
 */
export async function materializeCompletedReviewTriggers(
  input: MaterializeReviewTriggersInput = {},
): Promise<MaterializeReviewTriggersResult> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const batchDeadline = input.deadlineMs ?? performance.now() + REVIEW_TRIGGER_BATCH_BUDGET_MS;
  const limit = Math.max(1, Math.min(input.limit ?? REVIEW_TRIGGER_BATCH_LIMIT, REVIEW_TRIGGER_BATCH_LIMIT));
  if (performance.now() >= batchDeadline) {
    return { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: false };
  }
  let candidates: { id: string; salonId: string }[];
  try {
    candidates = await database.transaction(async (transaction) => {
      await setReviewMutationTimeouts(transaction);
      // Round-robin within the bounded batch prevents one salon from taking
      // every slot without limiting a busy salon to one appointment per cron.
      const rows = await transaction.execute(sql`
        select id, "salonId"
        from (
          select
            id,
            salon_id as "salonId",
            available_at as "availableAt",
            row_number() over (partition by salon_id order by available_at, id) as turn
          from review_request_trigger
          where kind in ('completed', 'scheduled_end')
            and state = 'pending'
            and available_at <= ${now}
        ) due
        where turn <= 5
        order by turn, "availableAt" asc, id asc
        limit ${limit}
      `);
      return queryRows<{ id: string; salonId: string }>(rows);
    });
  } catch {
    return { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: true };
  }
  const result: MaterializeReviewTriggersResult = { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: false };

  for (const candidate of candidates) {
    if (performance.now() >= batchDeadline) {
      result.deferred += 1;
      continue;
    }
    try {
      const outcome = await database.transaction(async (transaction) => {
        await setReviewMutationTimeouts(transaction);
        if (!(await tryLockSalonReviewMutation(transaction, candidate.salonId))) {
          return 'deferred' as const;
        }

        const [trigger] = await transaction.select().from(reviewRequestTriggerSchema)
          .where(and(eq(reviewRequestTriggerSchema.id, candidate.id), eq(reviewRequestTriggerSchema.salonId, candidate.salonId))).limit(1);
        if (!trigger || trigger.state !== 'pending') {
          return 'pending' as const;
        }
        const triggerKind: 'completed' | 'scheduled_end' = trigger.kind;
        const isCompletionTrigger = (trigger.kind as string) === 'completed';
        const freshNow = input.now ?? new Date();
        if (trigger.availableAt > freshNow) {
          return 'pending' as const;
        }
        if (trigger.expiresAt <= freshNow) {
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: 'EXPIRED',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }

        // Keep the lifecycle writer's terminal-client lock before the mutable
        // appointment and salon reads. NOWAIT makes a concurrent appointment
        // mutation a retry, never a stalled communications cron.
        const [unlockedAppointment] = await transaction.select().from(appointmentSchema)
          .where(and(eq(appointmentSchema.id, trigger.appointmentId), eq(appointmentSchema.salonId, trigger.salonId))).limit(1);
        if (!unlockedAppointment) {
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: 'APPOINTMENT_CHANGED',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }
        if (!unlockedAppointment.salonClientId) {
          await transaction.update(reviewRequestTriggerSchema).set({ availableAt: retryTriggerAt(trigger, freshNow), updatedAt: freshNow })
            .where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'deferred' as const;
        }
        if (usesRuntimePostgres) {
          await lockOperationalSalonClientContactWithHandle(transaction, { salonId: trigger.salonId, clientId: unlockedAppointment.salonClientId });
        }
        if (usesRuntimePostgres) {
          // Drizzle's current noWait option renders `no wait`, which PostgreSQL
          // rejects. Take the exact NOWAIT locks explicitly, then use typed
          // reads while those transaction locks remain held.
          await transaction.execute(sql`select id from appointment where id = ${trigger.appointmentId} and salon_id = ${trigger.salonId} for update nowait`);
          await transaction.execute(sql`select id from salon where id = ${trigger.salonId} for share nowait`);
        }
        const [lockedAppointment] = await transaction.select().from(appointmentSchema)
          .where(and(eq(appointmentSchema.id, trigger.appointmentId), eq(appointmentSchema.salonId, trigger.salonId)))
          .for('update').limit(1);
        const [lockedSalon] = await transaction.select({ id: salonSchema.id }).from(salonSchema)
          .where(eq(salonSchema.id, trigger.salonId)).for('share').limit(1);
        if (!lockedAppointment || !lockedSalon) {
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: lockedAppointment ? 'SALON_UNAVAILABLE' : 'APPOINTMENT_CHANGED',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }
        if (lockedAppointment.salonClientId !== unlockedAppointment.salonClientId) {
          await transaction.update(reviewRequestTriggerSchema).set({
            availableAt: retryTriggerAt(trigger, freshNow),
            updatedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'deferred' as const;
        }

        const ctx = await context(transaction, trigger.salonId, trigger.appointmentId, freshNow);
        const snapshotsMatch = (trigger.kind === 'scheduled_end'
          ? ctx.appointment?.endTime.getTime() === trigger.triggerAt.getTime()
          : ctx.appointment?.completedAt?.getTime() === trigger.triggerAt.getTime())
          && ctx.appointment?.startTime.getTime() === trigger.appointmentStartAt.getTime()
          && ctx.appointment.endTime.getTime() === trigger.appointmentEndAt.getTime();
        const [storedSettings] = await transaction.select().from(salonRetentionSettingsSchema)
          .where(eq(salonRetentionSettingsSchema.salonId, trigger.salonId)).limit(1);
        const policy = resolveReviewAutomationPolicy(storedSettings);
        const automaticReason = ineligible(ctx, true, triggerKind);
        if (!snapshotsMatch || policy.mode !== (triggerKind === 'completed' ? 'marked_completed' : 'scheduled_end')
          || !ctx.settings.enabledAt || trigger.triggerAt <= ctx.settings.enabledAt
          || trigger.policyRevision !== storedSettings?.reviewRequestPolicyRevision
          || automaticReason) {
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: !snapshotsMatch ? 'APPOINTMENT_CHANGED' : automaticReason ? reviewIneligibilityReasonCode(automaticReason) : 'POLICY_CHANGED',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }

        await cancelObsoleteAppointmentReviewReservations(transaction, trigger.salonId, ctx, storedSettings!.reviewRequestPolicyRevision, freshNow);
        await cancelReleasedReviewReservations(transaction, trigger.salonId, ctx, freshNow);
        const existing = await existingRequest(transaction, trigger.salonId, ctx);
        if (existing) {
          const [blockingIntent] = await transaction.select({ status: communicationIntentSchema.status })
            .from(communicationIntentSchema).where(and(
              eq(communicationIntentSchema.id, existing.intentId),
              eq(communicationIntentSchema.salonId, trigger.salonId),
            )).limit(1);
          // A concurrent unresolved attempt may later be proven never sent.
          // Keep this new event retryable without moving its due/expiry times.
          if (blockingIntent?.status !== 'sent') {
            await transaction.update(reviewRequestTriggerSchema).set({
              availableAt: retryTriggerAt(trigger, freshNow),
              updatedAt: freshNow,
            }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
            return 'deferred' as const;
          }
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: 'EXISTING_REQUEST',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }

        if (!ctx.client || !ctx.settings.salon || (isCompletionTrigger && !ctx.appointment?.completedAt)) {
          await transaction.update(reviewRequestTriggerSchema).set({ availableAt: retryTriggerAt(trigger, freshNow), updatedAt: freshNow })
            .where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'deferred' as const;
        }
        const settings = resolveCommunicationSettingsFromSettings(ctx.settings.salon.settings);
        const quiet = applyQuietHours({
          instant: trigger.scheduledFor,
          quietHours: settings.quietHours,
          timeZone: ctx.settings.salon.settings?.booking?.timezone,
          notAfter: trigger.expiresAt,
        });
        if (quiet.kind === 'stale') {
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: 'QUIET_HOURS_EXPIRED',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }

        const id = `rr_${crypto.randomUUID()}`;
        const intentId = `ci_review_${id}`;
        const inserted = await transaction.insert(reviewRequestSchema).values({
          id,
          salonId: trigger.salonId,
          clientId: ctx.client.id,
          appointmentId: trigger.appointmentId,
          recipient: normalizeConsentRecipient(ctx.client.phone),
          source: 'automatic',
          triggerId: trigger.id,
          intentId,
          completedAt: isCompletionTrigger ? trigger.triggerAt : null,
          scheduledFor: quiet.sendAt,
        }).onConflictDoNothing().returning();
        if (!inserted.length) {
          return 'deferred' as const;
        }
        const intent = await enqueueCommunicationIntent({
          database: transaction,
          salonId: trigger.salonId,
          appointmentId: trigger.appointmentId,
          channel: 'sms',
          audience: 'client',
          eventType: 'review_request',
          dedupeKey: `review:${trigger.salonId}:${id}`,
          recipient: ctx.client.phone,
          destinationCountry: 'CA',
          templateKey: 'client_review_request',
          templateVersion: 'v3',
          variables: { clientId: ctx.client.id, reviewRequestId: id },
          schedulingRevision: id,
          scheduledFor: quiet.sendAt,
          notAfter: trigger.expiresAt,
        });
        await transaction.update(reviewRequestSchema).set({ intentId: intent.intentId })
          .where(and(eq(reviewRequestSchema.id, id), eq(reviewRequestSchema.salonId, trigger.salonId)));
        await transaction.update(reviewRequestTriggerSchema).set({
          state: 'materialized',
          resolvedAt: freshNow,
        }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
        return 'materialized' as const;
      });
      result[outcome] += 1;
    } catch {
      result.deferred += 1;
      await deferReviewTrigger(database, candidate, input.now ?? new Date());
    }
  }

  return result;
}

export async function getReviewSettings(salonId: string, database: CommunicationIntentDatabase = db) {
  const [settings] = await database.select().from(salonRetentionSettingsSchema).where(eq(salonRetentionSettingsSchema.salonId, salonId)).limit(1);
  const [salon] = await database.select().from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
  const googleReviewUrl = settings ? settings.googleReviewUrl : salon?.settings?.googleReviewUrl ?? null;
  const policy = resolveReviewAutomationPolicy(settings);
  const communications = salon ? resolveCommunicationSettingsFromSettings(salon.settings) : null;
  const reasons: string[] = [];
  if (!googleReviewUrl || !isReviewUrl(googleReviewUrl)) {
    reasons.push('Add a valid Google review link.');
  }
  if (!salon || salon.deletedAt || salon.isActive === false) {
    reasons.push('This business is unavailable.');
  }
  if (!communications?.sms.enabled || communications.killSwitch) {
    reasons.push('Enable Luster SMS in Client communications.');
  }
  return {
    googleReviewUrl,
    automaticEnabled: settings?.automaticReviewRequests ?? false,
    enabledAt: settings?.reviewRequestsEnabledAt ?? null,
    delayMinutes: settings?.reviewRequestDelayMinutes ?? 60,
    messageTemplate: resolveReviewMessageTemplate(settings?.reviewRequestMessage),
    policy,
    storedAutomationMode: settings?.reviewRequestAutomationMode ?? null,
    policyRevision: settings?.reviewRequestPolicyRevision ?? 0,
    readiness: {
      status: policy.mode === 'manual' ? 'manual' as const : reasons.length ? 'needs_setup' as const : 'configured' as const,
      reasons,
    },
    businessName: salon?.name ?? '',
    salon,
  };
}

async function context(database: CommunicationIntentDatabase, salonId: string, appointmentId: string | null, now = new Date(), clientId?: string) {
  const [appointment] = appointmentId ? await database.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId))).limit(1) : [];
  const settings = await getReviewSettings(salonId, database);
  const contactId = appointment?.salonClientId ?? clientId;
  if (!contactId) {
    return { appointment, settings, now, client: null, legacyReview: null, consent: false, clientIds: [] as string[] };
  }
  try {
    const contact = await resolveOperationalSalonClientContactWithHandle(database, { salonId, clientId: contactId });
    const identity = await getSalonClientLineageIdentityWithHandle(database, { salonId, terminalClientId: contact.id });
    const [client] = await database.select().from(salonClientSchema).where(and(eq(salonClientSchema.id, contact.id), eq(salonClientSchema.salonId, salonId))).limit(1);
    const recipient = normalizeConsentRecipient(contact.phone);
    const legacyReviews = await database.select().from(clientCommunicationSchema).where(and(
      eq(clientCommunicationSchema.salonId, salonId),
      or(inArray(clientCommunicationSchema.salonClientId, identity.clientIds), appointmentId ? eq(clientCommunicationSchema.appointmentId, appointmentId) : undefined, eq(clientCommunicationSchema.destinationSnapshot, recipient)),
      eq(clientCommunicationSchema.kind, 'google_review'),
      or(eq(clientCommunicationSchema.status, 'marked_sent'), isNotNull(clientCommunicationSchema.markedSentAt)),
    )).orderBy(desc(clientCommunicationSchema.markedSentAt));
    const legacyDecision = evaluateReviewHistory({
      history: legacyReviews.map(row => ({ id: row.id, appointmentId: row.appointmentId, state: 'sent', sentAt: row.markedSentAt })),
      appointmentId,
      cooldownDays: settings.policy.repeatCooldownDays,
      now,
    });
    const legacyReview = legacyReviews.find(row => row.id === legacyDecision.blockingId);
    const [consent] = await database.select().from(communicationConsentSchema).where(and(
      eq(communicationConsentSchema.salonId, salonId),
      eq(communicationConsentSchema.recipient, recipient),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
    )).orderBy(desc(communicationConsentSchema.createdAt)).limit(1);
    const [global] = await database.select().from(smsGlobalConsentEventSchema).where(and(
      eq(smsGlobalConsentEventSchema.recipient, recipient),
      eq(smsGlobalConsentEventSchema.senderIdentity, readSharedSenderEnvConfig().senderIdentity),
    )).orderBy(desc(smsGlobalConsentEventSchema.seq)).limit(1);
    return { appointment, settings, now, client: client ?? null, legacyReview: legacyReview ?? null, consent: consent?.status === 'granted' && global?.state !== 'suppressed', clientIds: identity.clientIds };
  } catch (error) {
    if (!(error instanceof ClientLifecycleStabilizationError)) {
      throw error;
    }
    // Archived, missing, or malformed identity always fails closed.
    return { appointment, settings, now, client: null, legacyReview: null, consent: false, clientIds: [] as string[] };
  }
}

type ReviewContext = Awaited<ReturnType<typeof context>>;

/**
 * A reschedule supersedes only this appointment's linked, never-sent automatic
 * reservation. The intent lock/CAS shares the dispatcher's TX1 boundary: once
 * sending starts, neither this producer nor a retry can release the identity.
 * Caller holds the salon review fence and current appointment lock.
 */
async function cancelObsoleteAppointmentReviewReservations(
  transaction: CommunicationIntentTransaction,
  salonId: string,
  ctx: ReviewContext,
  policyRevision: number,
  now: Date,
) {
  if (!ctx.appointment) {
    return;
  }
  const rows = await transaction.select({ request: reviewRequestSchema, trigger: reviewRequestTriggerSchema })
    .from(reviewRequestSchema)
    .innerJoin(reviewRequestTriggerSchema, and(
      eq(reviewRequestTriggerSchema.id, reviewRequestSchema.triggerId),
      eq(reviewRequestTriggerSchema.salonId, salonId),
      eq(reviewRequestTriggerSchema.appointmentId, ctx.appointment.id),
    ))
    .where(and(eq(reviewRequestSchema.salonId, salonId), eq(reviewRequestSchema.appointmentId, ctx.appointment.id), eq(reviewRequestSchema.source, 'automatic'), ne(reviewRequestSchema.status, 'cancelled')));
  for (const { request, trigger } of rows) {
    if (trigger.appointmentStartAt.getTime() === ctx.appointment.startTime.getTime()
      && trigger.appointmentEndAt.getTime() === ctx.appointment.endTime.getTime()
      && trigger.policyRevision === policyRevision) {
      continue;
    }
    const [intent] = await transaction.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.id, request.intentId),
      eq(communicationIntentSchema.salonId, salonId),
    )).for('update').limit(1);
    if (!intent || !CANCELLABLE.includes(intent.status as typeof CANCELLABLE[number])) {
      continue;
    }
    const [evidence] = await transaction.select({ id: notificationDeliverySchema.id }).from(notificationDeliverySchema).where(and(
      eq(notificationDeliverySchema.salonId, salonId),
      or(eq(notificationDeliverySchema.intentId, intent.id), intent.deliveryId ? eq(notificationDeliverySchema.id, intent.deliveryId) : undefined),
      or(isNotNull(notificationDeliverySchema.providerMessageId), inArray(notificationDeliverySchema.status, ['sent', 'delivered'])),
    )).limit(1);
    if (evidence) {
      continue;
    }
    const cancelled = await transaction.update(communicationIntentSchema).set({
      status: 'canceled',
      resolvedAt: now,
      lastError: 'REVIEW_APPOINTMENT_SUPERSEDED',
    }).where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, salonId), inArray(communicationIntentSchema.status, [...CANCELLABLE]))).returning();
    if (cancelled.length) {
      await transaction.update(reviewRequestSchema).set({ status: 'cancelled', cancelledAt: now })
        .where(and(eq(reviewRequestSchema.id, request.id), eq(reviewRequestSchema.salonId, salonId)));
    }
  }
}

function ineligible(ctx: ReviewContext, automatic: boolean, kind: 'completed' | 'scheduled_end' = 'completed'): string | null {
  const { appointment, client, settings } = ctx;
  const scheduledEnd = kind === 'scheduled_end';
  if (!appointment || appointment.deletedAt
    || (scheduledEnd
      ? !evaluateScheduledEndReviewEligibility({
          appointment,
          policy: settings.policy,
          now: ctx.now,
          automationEnabledAt: settings.enabledAt,
          reviewRequestsEligibleAfter: client?.reviewRequestsEligibleAfter,
        }).eligible
      : appointment.status !== 'completed' || !appointment.completedAt)) {
    return 'Complete this appointment before requesting a review.';
  }
  const clientReason = clientReviewIneligibility(ctx);
  if (clientReason) {
    return clientReason;
  }
  const eventAt = scheduledEnd ? appointment.endTime : appointment.completedAt!;
  if (automatic && (!settings.automaticEnabled || !settings.enabledAt || eventAt <= settings.enabledAt
    || (client?.reviewRequestsEligibleAfter && eventAt <= client.reviewRequestsEligibleAfter))) {
    return 'Automatic review requests are off for this appointment.';
  }
  return null;
}

/** Client-only manual requests share every contact and delivery eligibility rule. */
function clientReviewIneligibility(ctx: ReviewContext, customMessage?: string): string | null {
  const { client, settings } = ctx;
  if (!client || client.archivedAt || client.mergedIntoClientId || !isValidPhone(client.phone)) {
    return 'This client needs an active profile and a usable mobile number.';
  }
  if (ctx.legacyReview) {
    return 'A review request was previously marked sent for this client.';
  }
  if (client.reviewRequestsSuppressed || client.hasGoogleReview) {
    return client.hasGoogleReview ? 'This client is already marked as having left a review.' : 'Review requests are off for this client.';
  }
  if (!settings.googleReviewUrl || !isReviewUrl(settings.googleReviewUrl)) {
    return 'Add a Google review link in Review settings.';
  }
  if (!settings.salon || settings.salon.deletedAt || settings.salon.isActive === false) {
    return 'This business is unavailable.';
  }
  const communications = resolveCommunicationSettingsFromSettings(settings.salon.settings);
  if (!communications.sms.enabled || communications.killSwitch) {
    return 'Enable Luster SMS in Client communications to request reviews.';
  }
  if (!ctx.consent) {
    return 'This client has not permitted Luster SMS, or has opted out.';
  }
  const body = customMessage === undefined
    ? reviewSmsBody({ template: settings.messageTemplate, clientName: client.fullName, businessName: settings.businessName, reviewLink: settings.googleReviewUrl })
    : COMMUNICATION_TEMPLATES.client_review_request!.render({ salonName: settings.businessName, message: customMessage });
  return reviewMessageFits(body) ? null : 'Shorten the review message to 10 SMS segments or fewer.';
}

async function existingRequest(database: CommunicationIntentDatabase, salonId: string, ctx: ReviewContext, excludeIntentId?: string) {
  if (!ctx.client || ctx.clientIds.length === 0) {
    return undefined;
  }
  const rows = await database.select({ request: reviewRequestSchema, intent: communicationIntentSchema, delivery: notificationDeliverySchema })
    .from(reviewRequestSchema)
    .leftJoin(communicationIntentSchema, and(eq(communicationIntentSchema.id, reviewRequestSchema.intentId), eq(communicationIntentSchema.salonId, salonId)))
    .leftJoin(notificationDeliverySchema, and(eq(notificationDeliverySchema.id, communicationIntentSchema.deliveryId), eq(notificationDeliverySchema.salonId, salonId)))
    .where(and(
      eq(reviewRequestSchema.salonId, salonId),
      excludeIntentId ? ne(reviewRequestSchema.intentId, excludeIntentId) : undefined,
      or(
        inArray(reviewRequestSchema.clientId, ctx.clientIds),
        eq(reviewRequestSchema.recipient, normalizeConsentRecipient(ctx.client.phone)),
        ctx.appointment ? eq(reviewRequestSchema.appointmentId, ctx.appointment.id) : undefined,
      ),
    ));
  const decision = evaluateReviewHistory({
    history: rows.map(({ request, intent, delivery }) => ({
      id: request.id,
      appointmentId: request.appointmentId,
      state: intent?.status ?? null,
      sentAt: intent?.status === 'sent' ? intent.resolvedAt : null,
      hasProviderEvidence: !!delivery?.providerMessageId || ['sent', 'delivered'].includes(delivery?.status ?? ''),
    })),
    appointmentId: ctx.appointment?.id ?? null,
    cooldownDays: ctx.settings.policy.repeatCooldownDays,
    now: ctx.now,
  });
  return rows.find(({ request }) => request.id === decision.blockingId)?.request;
}

/** Only a proven never-sent intent can release a client's normal request slot. */
export async function cancelReviewRequests(database: CommunicationIntentTransaction, salonId: string, filter: { clientIds?: string[]; recipient?: string; automaticOnly?: boolean } = {}) {
  const rows = await database.select().from(reviewRequestSchema).where(and(
    eq(reviewRequestSchema.salonId, salonId),
    ne(reviewRequestSchema.status, 'cancelled'),
    filter.clientIds || filter.recipient
      ? or(
        filter.clientIds ? inArray(reviewRequestSchema.clientId, filter.clientIds) : undefined,
        filter.recipient ? eq(reviewRequestSchema.recipient, filter.recipient) : undefined,
      )
      : undefined,
    filter.automaticOnly ? eq(reviewRequestSchema.source, 'automatic') : undefined,
  ));
  for (const row of rows) {
    // Share the dispatcher's TX1 boundary. A status alone cannot prove that a
    // provider did not accept an earlier attempt with contradictory evidence.
    const [intent] = await database.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.id, row.intentId),
      eq(communicationIntentSchema.salonId, salonId),
    )).for('update').limit(1);
    if (!intent || !CANCELLABLE.includes(intent.status as typeof CANCELLABLE[number])) {
      continue;
    }
    const [evidence] = await database.select({ id: notificationDeliverySchema.id }).from(notificationDeliverySchema).where(and(
      eq(notificationDeliverySchema.salonId, salonId),
      or(eq(notificationDeliverySchema.intentId, intent.id), intent.deliveryId ? eq(notificationDeliverySchema.id, intent.deliveryId) : undefined),
      or(isNotNull(notificationDeliverySchema.providerMessageId), inArray(notificationDeliverySchema.status, ['sent', 'delivered'])),
    )).limit(1);
    if (evidence) {
      continue;
    }
    const now = new Date();
    const cancelled = await database.update(communicationIntentSchema).set({ status: 'canceled', resolvedAt: now, lastError: 'REVIEW_REQUEST_CANCELLED' }).where(and(
      eq(communicationIntentSchema.id, row.intentId),
      eq(communicationIntentSchema.salonId, salonId),
      inArray(communicationIntentSchema.status, [...CANCELLABLE]),
    )).returning();
    if (cancelled.length) {
      await database.update(reviewRequestSchema).set({ status: 'cancelled', cancelledAt: now }).where(and(eq(reviewRequestSchema.id, row.id), eq(reviewRequestSchema.salonId, salonId)));
    }
  }
}

/**
 * Shared by canonical and legacy Google-link writers. Caller holds the review
 * fence and salon row lock; this helper never opens a nested transaction.
 * Restoring a destination starts a fresh epoch rather than sending a backlog.
 */
export async function applyReviewPolicyTransitionWithHandle(
  transaction: CommunicationIntentTransaction,
  salonId: string,
  old: Awaited<ReturnType<typeof getReviewSettings>>,
  next: { mode: ReviewAutomationMode; googleReviewUrl: string | null },
) {
  const automaticEnabled = next.mode !== 'manual';
  const hasDestination = !!next.googleReviewUrl && isReviewUrl(next.googleReviewUrl);
  const restoredLink = automaticEnabled && hasDestination && (!old.googleReviewUrl || !isReviewUrl(old.googleReviewUrl));
  const newEpoch = old.policy.mode !== next.mode || restoredLink || (automaticEnabled && !old.enabledAt);
  if (!hasDestination || !automaticEnabled || newEpoch) {
    await cancelReviewRequests(transaction, salonId, { automaticOnly: hasDestination });
  }
  return {
    reviewRequestsEnabledAt: automaticEnabled ? (newEpoch ? new Date() : old.enabledAt) : null,
    reviewRequestPolicyRevision: old.policyRevision + (newEpoch ? 1 : 0),
  };
}

export async function saveReviewSettings(salonId: string, input: unknown) {
  const parsed = reviewSettingsUpdateSchema.parse(input);
  await db.transaction(async (tx) => {
    await lockSalonReviewMutation(tx, salonId);
    // Existing completion takes a share lock on this row: settings changes
    // and event production cannot straddle one another's commit.
    // NO KEY UPDATE still excludes producers' SHARE locks, while allowing
    // the dispatcher's delivery insert to take its salon FK KEY SHARE lock.
    await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('no key update');
    const old = await getReviewSettings(salonId, tx);
    const explicit = 'automationMode' in parsed;
    const legacyEnabled = !explicit && parsed.automaticEnabled && parsed.googleReviewUrl !== null;
    const mode = explicit
      ? parsed.automationMode
      : applyLegacyAutomaticReviewUpdate({
        automaticReviewRequests: old.automaticEnabled,
        reviewRequestAutomationMode: old.storedAutomationMode,
        reviewRequestDelayMinutes: old.delayMinutes,
        reviewRequestRepeatCooldownDays: old.policy.repeatCooldownDays,
      }, legacyEnabled).mode;
    const automaticEnabled = mode !== 'manual';
    const transition = await applyReviewPolicyTransitionWithHandle(tx, salonId, old, { mode, googleReviewUrl: parsed.googleReviewUrl });
    const patch = {
      googleReviewUrl: parsed.googleReviewUrl,
      automaticReviewRequests: automaticEnabled,
      ...transition,
      reviewRequestDelayMinutes: parsed.delayMinutes,
      reviewRequestMessage: parsed.messageTemplate,
      ...(explicit
        ? {
            reviewRequestAutomationMode: mode,
            reviewRequestRepeatCooldownDays: parsed.repeatCooldownDays === 'never' ? null : parsed.repeatCooldownDays,
          }
        : legacyEnabled && old.storedAutomationMode === 'manual' ? { reviewRequestAutomationMode: mode } : {}),
    };
    await tx.insert(salonRetentionSettingsSchema).values({ salonId, ...patch }).onConflictDoUpdate({ target: salonRetentionSettingsSchema.salonId, set: patch });
  });
  return getReviewSettings(salonId);
}

export async function setReviewSuppression(salonId: string, clientId: string, suppressed: boolean) {
  await db.transaction(async (tx) => {
    await lockSalonReviewMutation(tx, salonId);
    const contact = await lockOperationalSalonClientContactWithHandle(tx, { salonId, clientId });
    const identity = await getSalonClientLineageIdentityWithHandle(tx, { salonId, terminalClientId: contact.id });
    await tx.update(salonClientSchema).set({ reviewRequestsSuppressed: suppressed, reviewRequestsEligibleAfter: new Date() }).where(and(eq(salonClientSchema.salonId, salonId), inArray(salonClientSchema.id, identity.clientIds)));
    if (suppressed) {
      await cancelReviewRequests(tx, salonId, { clientIds: identity.clientIds });
    }
  });
}

/** Releases only reservations whose intent has already reached a never-sent terminal state. */
async function cancelReleasedReviewReservations(
  database: CommunicationIntentDatabase,
  salonId: string,
  ctx: ReviewContext,
  now: Date,
) {
  if (!ctx.client) {
    return;
  }
  const historical = await database.select({ request: reviewRequestSchema }).from(reviewRequestSchema)
    .innerJoin(communicationIntentSchema, and(eq(communicationIntentSchema.id, reviewRequestSchema.intentId), eq(communicationIntentSchema.salonId, reviewRequestSchema.salonId)))
    .where(and(eq(reviewRequestSchema.salonId, salonId), or(inArray(reviewRequestSchema.clientId, ctx.clientIds), eq(reviewRequestSchema.recipient, normalizeConsentRecipient(ctx.client.phone))), eq(reviewRequestSchema.status, 'scheduled'), inArray(communicationIntentSchema.status, ['canceled', 'suppressed', 'expired'])));
  for (const entry of historical) {
    await database.update(reviewRequestSchema).set({ status: 'cancelled', cancelledAt: now })
      .where(and(eq(reviewRequestSchema.id, entry.request.id), eq(reviewRequestSchema.salonId, salonId)));
  }
}

/** Called only by a NEW successful completion transaction, never by a scan. */
export async function scheduleReviewRequest(database: CommunicationIntentDatabase, salonId: string, appointmentId: string, automatic = true) {
  if (automatic && !(await getReviewSettings(salonId, database)).automaticEnabled) {
    return;
  }
  const ctx = await context(database, salonId, appointmentId);
  if (!ctx.client) {
    return;
  }
  await cancelReleasedReviewReservations(database, salonId, ctx, new Date());
  const existing = await existingRequest(database, salonId, ctx);
  if (existing) {
    if (!automatic && existing.source === 'automatic' && existing.appointmentId === appointmentId
      && ctx.clientIds.includes(existing.clientId) && existing.recipient === normalizeConsentRecipient(ctx.client.phone)
      && !ineligible(ctx, false)) {
      // Keep its immutable send identity. An accepted/unknown attempt is never reset.
      await database.update(communicationIntentSchema).set({ scheduledFor: new Date(), availableAt: new Date() }).where(and(eq(communicationIntentSchema.id, existing.intentId), eq(communicationIntentSchema.salonId, salonId), eq(communicationIntentSchema.status, 'pending')));
    }
    return;
  }
  if (ineligible(ctx, automatic) || !ctx.client || !ctx.appointment?.completedAt) {
    return;
  }
  const now = new Date();
  const planned = automatic ? new Date(ctx.appointment.completedAt.getTime() + ctx.settings.delayMinutes * 60000) : now;
  const scheduledFor = new Date(Math.max(now.getTime(), planned.getTime()));
  const notAfter = new Date(scheduledFor.getTime() + DAY);
  const settings = resolveCommunicationSettingsFromSettings(ctx.settings.salon!.settings);
  const quiet = applyQuietHours({ instant: scheduledFor, quietHours: settings.quietHours, timeZone: ctx.settings.salon?.settings?.booking?.timezone, notAfter });
  if (quiet.kind === 'stale') {
    return;
  }
  const id = `rr_${crypto.randomUUID()}`;
  const intentId = `ci_review_${id}`;
  const inserted = await database.insert(reviewRequestSchema).values({ id, salonId, clientId: ctx.client.id, appointmentId, recipient: normalizeConsentRecipient(ctx.client.phone), source: automatic ? 'automatic' : 'manual', intentId, completedAt: ctx.appointment.completedAt, scheduledFor: quiet.sendAt }).onConflictDoNothing().returning();
  if (!inserted.length) {
    return;
  }
  const intent = await enqueueCommunicationIntent({ database, salonId, appointmentId, channel: 'sms', audience: 'client', eventType: 'review_request', dedupeKey: `review:${salonId}:${id}`, recipient: ctx.client.phone, destinationCountry: 'CA', templateKey: 'client_review_request', templateVersion: 'v3', variables: { clientId: ctx.client.id, reviewRequestId: id }, schedulingRevision: id, scheduledFor: quiet.sendAt, notAfter });
  await database.update(reviewRequestSchema).set({ intentId: intent.intentId }).where(and(eq(reviewRequestSchema.id, id), eq(reviewRequestSchema.salonId, salonId)));
}

export class ClientReviewRequestError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

/**
 * Explicit client-profile Google presets keep their appointmentless workflow.
 * Ordinary free-text messages never enter this coordinator by content matching.
 */
export async function queueClientReviewRequest(input: {
  salonId: string;
  clientId: string;
  message: string;
  requestId: string;
  availability?: { available: boolean; code: string | null; message: string };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (transaction) => {
    await lockSalonReviewMutation(transaction, input.salonId);
    const contact = await lockOperationalSalonClientContactWithHandle(transaction, { salonId: input.salonId, clientId: input.clientId });
    const identity = await getSalonClientLineageIdentityWithHandle(transaction, { salonId: input.salonId, terminalClientId: contact.id });
    const dedupeKey = `manual:${input.salonId}:${input.requestId}`;
    const [existing] = await transaction.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.dedupeKey, dedupeKey),
    )).limit(1);
    // A lost response must observe the original action before mutable contact,
    // readiness, consent or cooldown checks. Purpose is part of that identity.
    if (existing) {
      const [request] = await transaction.select().from(reviewRequestSchema).where(and(
        eq(reviewRequestSchema.salonId, input.salonId),
        eq(reviewRequestSchema.intentId, existing.id),
      )).limit(1);
      if (existing.eventType !== 'review_request' || existing.appointmentId !== null
        || existing.variables.reviewRequestPurpose !== 'client_google_review'
        || existing.variables.message !== input.message || !identity.clientIds.includes(existing.variables.clientId ?? '')
        || !request || request.source !== 'manual' || request.appointmentId !== null || request.completedAt !== null || request.triggerId !== null
        || !identity.clientIds.includes(request.clientId) || request.recipient !== normalizeConsentRecipient(existing.recipient)) {
        throw new ClientReviewRequestError('IDEMPOTENCY_CONFLICT', 'This send was already used for a different message. Start a new text.');
      }
      return { intentId: existing.id, created: false };
    }
    if (input.availability?.available === false) {
      throw new ClientReviewRequestError(input.availability.code ?? 'SMS_UNAVAILABLE', input.availability.message);
    }
    const ctx = await context(transaction, input.salonId, null, now, contact.id);
    const reason = clientReviewIneligibility(ctx, input.message);
    if (reason || !ctx.client) {
      throw new ClientReviewRequestError('REVIEW_INELIGIBLE', reason ?? 'This client is unavailable.');
    }
    await cancelReleasedReviewReservations(transaction, input.salonId, ctx, now);
    if (await existingRequest(transaction, input.salonId, ctx)) {
      throw new ClientReviewRequestError('REVIEW_ALREADY_REQUESTED', 'A review request is already pending or this client is still within the repeat-review waiting period. Check their review history.');
    }
    const communications = resolveCommunicationSettingsFromSettings(ctx.settings.salon!.settings);
    const notAfter = new Date(now.getTime() + DAY);
    const quiet = applyQuietHours({ instant: now, quietHours: communications.quietHours, timeZone: ctx.settings.salon?.settings?.booking?.timezone, notAfter });
    if (quiet.kind === 'stale') {
      throw new ClientReviewRequestError('QUIET_HOURS_STALE', 'Quiet hours leave no sending window for this message.');
    }
    const id = `rr_${crypto.randomUUID()}`;
    const inserted = await transaction.insert(reviewRequestSchema).values({
      id,
      salonId: input.salonId,
      clientId: ctx.client.id,
      appointmentId: null,
      recipient: normalizeConsentRecipient(ctx.client.phone),
      source: 'manual',
      intentId: `ci_review_${id}`,
      completedAt: null,
      triggerId: null,
      scheduledFor: quiet.sendAt,
    }).onConflictDoNothing().returning();
    if (!inserted.length) {
      throw new ClientReviewRequestError('REVIEW_ALREADY_REQUESTED', 'A review request is already recorded for this client. Check their review history.');
    }
    const intent = await enqueueCommunicationIntent({
      database: transaction,
      salonId: input.salonId,
      channel: 'sms',
      audience: 'client',
      eventType: 'review_request',
      dedupeKey,
      recipient: ctx.client.phone,
      destinationCountry: 'CA',
      templateKey: 'client_review_request',
      templateVersion: 'v3',
      variables: { clientId: ctx.client.id, reviewRequestId: id, reviewRequestPurpose: 'client_google_review', message: input.message },
      schedulingRevision: id,
      scheduledFor: quiet.sendAt,
      notAfter,
    });
    // Generic SMS shares the action-ID namespace but can hold a different
    // client lock. Roll back if it won after our initial dedupe read.
    if (!intent.created) {
      throw new ClientReviewRequestError('IDEMPOTENCY_CONFLICT', 'This send was already used for a different message. Start a new text.');
    }
    await transaction.update(reviewRequestSchema).set({ intentId: intent.intentId })
      .where(and(eq(reviewRequestSchema.id, id), eq(reviewRequestSchema.salonId, input.salonId)));
    return intent;
  });
}

/** Re-read mutable business rules at BOTH existing pre-provider boundaries. */
export async function reviewRequestSendContext(salonId: string, intentId: string) {
  const [row] = await db.select().from(reviewRequestSchema).where(and(eq(reviewRequestSchema.salonId, salonId), eq(reviewRequestSchema.intentId, intentId), ne(reviewRequestSchema.status, 'cancelled'))).limit(1);
  if (!row) {
    return null;
  }
  if (!row.appointmentId) {
    if (row.source !== 'manual' || row.completedAt !== null || row.triggerId !== null) {
      return null;
    }
    const [intent] = await db.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.id, intentId),
      eq(communicationIntentSchema.salonId, salonId),
    )).limit(1);
    const message = intent?.variables.message;
    if (!intent || intent.eventType !== 'review_request' || intent.appointmentId !== null
      || intent.variables.reviewRequestPurpose !== 'client_google_review' || intent.variables.reviewRequestId !== row.id
      || typeof message !== 'string' || !message.trim() || message.length > 1000) {
      return null;
    }
    const ctx = await context(db, salonId, null, new Date(), row.clientId);
    if (clientReviewIneligibility(ctx, message) || !ctx.client || !ctx.clientIds.includes(intent.variables.clientId ?? '')
      || row.recipient !== normalizeConsentRecipient(ctx.client.phone) || row.recipient !== normalizeConsentRecipient(intent.recipient)
      || await existingRequest(db, salonId, ctx, intentId)) {
      return null;
    }
    return { message };
  }
  const ctx = await context(db, salonId, row.appointmentId);
  let triggerKind: 'completed' | 'scheduled_end' = 'completed';
  if (row.triggerId) {
    const [trigger] = await db.select().from(reviewRequestTriggerSchema).where(and(
      eq(reviewRequestTriggerSchema.id, row.triggerId),
      eq(reviewRequestTriggerSchema.salonId, salonId),
    )).limit(1);
    const [storedSettings] = await db.select().from(salonRetentionSettingsSchema)
      .where(eq(salonRetentionSettingsSchema.salonId, salonId)).limit(1);
    const policy = resolveReviewAutomationPolicy(storedSettings);
    if (!trigger || (trigger.kind !== 'completed' && trigger.kind !== 'scheduled_end')) {
      return null;
    }
    triggerKind = trigger.kind;
    const snapshotsMatch = trigger?.state === 'materialized'
      && trigger.appointmentId === row.appointmentId
      && (trigger.kind === 'scheduled_end'
        ? ctx.appointment?.endTime.getTime() === trigger.triggerAt.getTime()
        && ['confirmed', 'in_progress', 'completed'].includes(ctx.appointment.status)
        : ctx.appointment?.completedAt?.getTime() === trigger.triggerAt.getTime())
        && ctx.appointment?.startTime.getTime() === trigger.appointmentStartAt.getTime()
        && ctx.appointment?.endTime.getTime() === trigger.appointmentEndAt.getTime();
    if (!snapshotsMatch || policy.mode !== (trigger.kind === 'completed' ? 'marked_completed' : 'scheduled_end')
      || !ctx.settings.enabledAt || trigger.triggerAt <= ctx.settings.enabledAt
      || trigger.policyRevision !== storedSettings?.reviewRequestPolicyRevision) {
      return null;
    }
  }
  if ((!row.completedAt && triggerKind !== 'scheduled_end')
    || ineligible(ctx, row.source === 'automatic', triggerKind) || !ctx.client || !ctx.clientIds.includes(row.clientId)
    || normalizeConsentRecipient(ctx.client.phone) !== row.recipient
    || (triggerKind === 'completed' && ctx.appointment?.completedAt?.getTime() !== row.completedAt?.getTime())) {
    return null;
  }
  // Another appointment may have been manually requested or marked sent after
  // this intent was scheduled. Re-read the same history at dispatch, excluding
  // only this intent's own reservation.
  if (await existingRequest(db, salonId, ctx, intentId)) {
    return null;
  }
  return { message: renderReviewMessage({ template: ctx.settings.messageTemplate, clientName: ctx.client.fullName, businessName: ctx.settings.businessName, reviewLink: ctx.settings.googleReviewUrl! }) };
}

const REVIEW_STATUS_REASONS: Record<string, string> = {
  EXPIRED: 'The review request window has expired.',
  APPOINTMENT_CHANGED: 'The appointment changed after this request was planned.',
  POLICY_CHANGED: 'The automation settings changed after this request was planned.',
  EXISTING_REQUEST: 'Another applicable review request already exists for this client.',
  QUIET_HOURS_EXPIRED: 'Quiet hours extend past this request’s sending window.',
  LEGACY_REVIEW_SENT: 'A previous request was marked sent by the owner.',
  CLIENT_ALREADY_REVIEWED: 'This client is marked as having left a review.',
  CLIENT_SUPPRESSED: 'Review requests are off for this client.',
  SMS_INELIGIBLE: 'This client has not permitted Luster SMS, or has opted out.',
  GOOGLE_REVIEW_LINK_MISSING: 'Add a Google review link in Review settings.',
  SMS_DISABLED: 'Enable Luster SMS in Client communications to request reviews.',
  AUTOMATIC_NOT_ACTIVE: 'Automatic requests are not active for this appointment.',
  MESSAGE_TOO_LONG: 'Shorten the review message to 10 SMS segments or fewer.',
  APPOINTMENT_NOT_COMPLETED: 'The appointment was not marked Completed.',
  CLIENT_UNAVAILABLE: 'The client needs an active profile and a usable mobile number.',
  SALON_UNAVAILABLE: 'This business is unavailable.',
};

function baseReviewDisplay(ctx: ReviewContext): ReviewRequestDisplay {
  return {
    status: 'not_eligible',
    reason: null,
    scheduledFor: null,
    sentAt: null,
    message: ctx.settings.googleReviewUrl && ctx.client ? reviewSmsBody({ template: ctx.settings.messageTemplate, clientName: ctx.client.fullName, businessName: ctx.settings.businessName, reviewLink: ctx.settings.googleReviewUrl }) : null,
    phone: ctx.client?.phone ?? null,
    clientId: ctx.client?.id ?? null,
    source: null,
    channel: null,
    canSendManually: false,
    automationMode: ctx.settings.policy.mode,
  };
}

function appointmentUnavailableReason(ctx: ReviewContext): string | null {
  const appointment = ctx.appointment;
  if (!appointment || appointment.deletedAt) {
    return 'The appointment is no longer available.';
  }
  if (appointment.status === 'no_show') {
    return 'The appointment was marked no-show.';
  }
  if (['cancelled', 'canceled', 'declined'].includes(appointment.status)) {
    return 'The appointment was cancelled or declined.';
  }
  if (!['confirmed', 'in_progress', 'completed'].includes(appointment.status)) {
    return 'The appointment is not confirmed.';
  }
  return null;
}

function triggerMismatch(ctx: ReviewContext, trigger: typeof reviewRequestTriggerSchema.$inferSelect) {
  return !ctx.appointment
    || ctx.appointment.startTime.getTime() !== trigger.appointmentStartAt.getTime()
    || ctx.appointment.endTime.getTime() !== trigger.appointmentEndAt.getTime()
    || ctx.settings.policyRevision !== trigger.policyRevision
    || ctx.settings.policy.mode !== (trigger.kind === 'completed' ? 'marked_completed' : 'scheduled_end')
    || (trigger.kind === 'completed' && ctx.appointment.completedAt?.getTime() !== trigger.triggerAt.getTime());
}

function displayTrigger(ctx: ReviewContext, trigger: typeof reviewRequestTriggerSchema.$inferSelect): ReviewRequestDisplay {
  const display = { ...baseReviewDisplay(ctx), source: 'automatic' as const, channel: 'sms' as const };
  const reason = appointmentUnavailableReason(ctx) ?? clientReviewIneligibility(ctx)
    ?? (triggerMismatch(ctx, trigger) ? REVIEW_STATUS_REASONS.APPOINTMENT_CHANGED! : null);
  if (reason) {
    return { ...display, status: 'skipped', reason };
  }
  if (trigger.state === 'materialized') {
    return { ...display, status: 'unknown', reason: 'The request record is unavailable. Reload before taking action.' };
  }
  if (trigger.state === 'skipped' || ctx.now >= trigger.expiresAt) {
    return { ...display, status: 'skipped', reason: REVIEW_STATUS_REASONS[trigger.reasonCode ?? 'EXPIRED'] ?? 'This request did not pass the review eligibility checks.' };
  }
  const quiet = applyQuietHours({
    instant: trigger.scheduledFor,
    quietHours: resolveCommunicationSettingsFromSettings(ctx.settings.salon?.settings).quietHours,
    timeZone: ctx.settings.salon?.settings?.booking?.timezone,
    notAfter: trigger.expiresAt,
  });
  if (quiet.kind === 'stale') {
    return { ...display, status: 'skipped', reason: REVIEW_STATUS_REASONS.QUIET_HOURS_EXPIRED! };
  }
  return { ...display, status: 'scheduled', scheduledFor: quiet.sendAt.toISOString(), canSendManually: !ineligible(ctx, false), reason: 'Waiting for the review worker. Eligibility is checked again before sending.' };
}

type ReviewDisplayEvidence = {
  intent: typeof communicationIntentSchema.$inferSelect | null;
  deliveries: (typeof notificationDeliverySchema.$inferSelect)[];
  trigger: typeof reviewRequestTriggerSchema.$inferSelect | null;
};

async function displayRequest(ctx: ReviewContext, salonId: string, row: typeof reviewRequestSchema.$inferSelect, evidence?: ReviewDisplayEvidence): Promise<ReviewRequestDisplay> {
  const [intent] = evidence ? [evidence.intent] : await db.select().from(communicationIntentSchema).where(and(eq(communicationIntentSchema.salonId, salonId), eq(communicationIntentSchema.id, row.intentId))).limit(1);
  const deliveries = evidence?.deliveries ?? await db.select().from(notificationDeliverySchema).where(and(
    eq(notificationDeliverySchema.salonId, salonId),
    or(eq(notificationDeliverySchema.intentId, row.intentId), intent?.deliveryId ? eq(notificationDeliverySchema.id, intent.deliveryId) : undefined),
  )).orderBy(desc(notificationDeliverySchema.updatedAt));
  const delivered = deliveries.some(delivery => delivery.status === 'delivered');
  const deliveryFailed = deliveries.some(delivery => ['failed', 'undelivered'].includes(delivery.status));
  const providerEvidence = deliveries.some(delivery => !!delivery.providerMessageId || ['sent', 'delivered'].includes(delivery.status));
  const display = {
    ...baseReviewDisplay(ctx),
    source: row.source,
    channel: 'sms' as const,
    scheduledFor: intent?.availableAt?.toISOString() ?? row.scheduledFor.toISOString(),
    sentAt: intent?.status === 'sent' ? intent.resolvedAt?.toISOString() ?? null : null,
    message: intent?.bodySnapshot ?? baseReviewDisplay(ctx).message,
    phone: row.recipient,
  };
  if (delivered) {
    return { ...display, status: 'delivered', reason: 'Delivery confirmed by the SMS provider.' };
  }
  if (deliveryFailed || intent?.status === 'failed') {
    return { ...display, status: 'failed', reason: 'The review request could not be sent. It will not be retried automatically.' };
  }
  if (intent?.status === 'sent') {
    return { ...display, status: 'sent', reason: 'Accepted by the SMS provider. Delivery is not yet confirmed.' };
  }
  if (!intent || intent.status === 'send_outcome_unknown' || providerEvidence) {
    return { ...display, status: 'unknown', reason: 'The sending outcome is uncertain. Another request is blocked to avoid a duplicate.' };
  }
  if (intent.status === 'sending') {
    return { ...display, status: 'sending', reason: 'This request is being sent. Another request will not be queued.' };
  }
  if (['canceled', 'suppressed', 'expired'].includes(intent.status)) {
    return { ...display, status: intent.status === 'canceled' ? 'cancelled' : 'skipped', reason: intent.status === 'expired' ? REVIEW_STATUS_REASONS.EXPIRED! : 'The pending request was stopped before sending.' };
  }
  if (ctx.now >= intent.notAfter) {
    return { ...display, status: 'skipped', reason: REVIEW_STATUS_REASONS.EXPIRED! };
  }
  if (row.status === 'cancelled') {
    return { ...display, status: 'unknown', reason: 'The request and delivery records disagree. Another request is blocked.' };
  }
  // These mutable checks explain pending work; accepted/uncertain sends above
  // remain historical facts even after a client or appointment changes.
  const identityChanged = !ctx.client || !ctx.clientIds.includes(row.clientId) || normalizeConsentRecipient(ctx.client.phone) !== row.recipient
    || (ctx.appointment?.salonClientId != null && !ctx.clientIds.includes(ctx.appointment.salonClientId));
  const reason = (row.appointmentId ? appointmentUnavailableReason(ctx) : null)
    ?? (identityChanged ? 'The client or recipient changed after this request was planned.' : null) ?? clientReviewIneligibility(ctx);
  if (reason) {
    return { ...display, status: 'skipped', reason };
  }
  if (row.triggerId) {
    const [trigger] = evidence ? [evidence.trigger] : await db.select().from(reviewRequestTriggerSchema).where(and(eq(reviewRequestTriggerSchema.salonId, salonId), eq(reviewRequestTriggerSchema.id, row.triggerId))).limit(1);
    if (!trigger || triggerMismatch(ctx, trigger)) {
      return { ...display, status: 'skipped', reason: REVIEW_STATUS_REASONS.APPOINTMENT_CHANGED! };
    }
  }
  return {
    ...display,
    status: 'scheduled',
    reason: intent.status === 'blocked_no_credit' ? 'Add SMS credits to send this review request.' : 'Eligibility is checked again before sending.',
    canSendManually: row.source === 'automatic' && intent.status === 'pending' && !ineligible(ctx, false)
      && !!ctx.client && ctx.clientIds.includes(row.clientId) && normalizeConsentRecipient(ctx.client.phone) === row.recipient,
  };
}

async function blockingHistoryReason(salonId: string, ctx: ReviewContext): Promise<string | null> {
  if (ctx.legacyReview) {
    return 'A previous request was marked sent by the owner. The repeat-review rule prevents another request.';
  }
  const previous = await existingRequest(db, salonId, ctx);
  if (!previous) {
    return null;
  }
  const [intent] = await db.select().from(communicationIntentSchema).where(and(eq(communicationIntentSchema.salonId, salonId), eq(communicationIntentSchema.id, previous.intentId))).limit(1);
  if (intent?.status === 'sent' && intent.resolvedAt && ctx.settings.policy.repeatCooldownDays !== 'never') {
    return `A previous request is within the ${ctx.settings.policy.repeatCooldownDays}-day repeat-review cooldown.`;
  }
  return intent?.status === 'sent'
    ? 'A previous request was sent. Repeat requests are turned off.'
    : 'Another review request is pending or has an uncertain outcome. Another request is blocked to avoid a duplicate.';
}

/** Appointment-specific facts only; another visit's send never appears as this visit's send. */
export async function getAppointmentReviewState(salonId: string, appointmentId: string): Promise<ReviewRequestDisplay> {
  const ctx = await context(db, salonId, appointmentId);
  const display = baseReviewDisplay(ctx);
  if (!ctx.appointment) {
    return { ...display, reason: 'The appointment is no longer available.' };
  }
  const [row] = await db.select().from(reviewRequestSchema).where(and(eq(reviewRequestSchema.salonId, salonId), eq(reviewRequestSchema.appointmentId, appointmentId)))
    .orderBy(sql`case when ${reviewRequestSchema.status} = 'cancelled' then 1 else 0 end`, desc(reviewRequestSchema.createdAt), desc(reviewRequestSchema.id)).limit(1);
  const [trigger] = await db.select().from(reviewRequestTriggerSchema).where(and(eq(reviewRequestTriggerSchema.salonId, salonId), eq(reviewRequestTriggerSchema.appointmentId, appointmentId))).orderBy(desc(reviewRequestTriggerSchema.createdAt)).limit(1);
  const rowDisplay = row ? await displayRequest(ctx, salonId, row) : null;
  if (rowDisplay && !['cancelled', 'skipped'].includes(rowDisplay.status)) {
    return rowDisplay;
  }
  if (trigger?.state === 'pending' && !triggerMismatch(ctx, trigger)) {
    const blocked = await blockingHistoryReason(salonId, ctx);
    return blocked ? { ...display, status: 'skipped', reason: blocked } : displayTrigger(ctx, trigger);
  }
  if (rowDisplay) {
    if (rowDisplay.status === 'cancelled' && !ineligible(ctx, false) && !await blockingHistoryReason(salonId, ctx)) {
      // Cancellation is history, not a permanent ban on a proven-unsent
      // request. Preview the current recipient/template for the new manual
      // action; historical body snapshots remain in client history.
      return { ...rowDisplay, canSendManually: true, message: display.message, phone: display.phone };
    }
    return rowDisplay;
  }
  const [legacy] = await db.select().from(clientCommunicationSchema).where(and(
    eq(clientCommunicationSchema.salonId, salonId),
    eq(clientCommunicationSchema.appointmentId, appointmentId),
    eq(clientCommunicationSchema.kind, 'google_review'),
    or(eq(clientCommunicationSchema.status, 'marked_sent'), isNotNull(clientCommunicationSchema.markedSentAt)),
  )).orderBy(desc(clientCommunicationSchema.markedSentAt)).limit(1);
  if (legacy) {
    return { ...display, status: 'reported_sent', source: 'owner_reported', channel: 'owner_device', sentAt: legacy.markedSentAt?.toISOString() ?? null, message: legacy.messageSnapshot, reason: 'Marked sent by the owner. Luster cannot verify delivery.' };
  }
  const reason = appointmentUnavailableReason(ctx) ?? await blockingHistoryReason(salonId, ctx) ?? clientReviewIneligibility(ctx);
  if (reason) {
    return { ...display, status: ctx.client?.reviewRequestsSuppressed || ctx.client?.hasGoogleReview ? 'suppressed' : 'not_eligible', reason };
  }
  if (trigger) {
    return displayTrigger(ctx, trigger);
  }
  const canSendManually = !ineligible(ctx, false);
  if (ctx.settings.policy.mode === 'manual') {
    return { ...display, status: canSendManually ? 'eligible' : 'not_eligible', canSendManually, reason: canSendManually ? 'Not scheduled — automatic requests are off. You can request a review manually.' : 'Automatic requests are off. Mark this appointment Completed to request a review manually.' };
  }
  if (ctx.settings.policy.mode === 'marked_completed') {
    return { ...display, status: canSendManually ? 'eligible' : 'awaiting_trigger', canSendManually, reason: canSendManually ? 'No automatic request is recorded for this completion. You can request a review manually.' : 'Waiting for this appointment to be marked Completed.' };
  }
  const eligibility = evaluateScheduledEndReviewEligibility({ appointment: ctx.appointment, policy: ctx.settings.policy, now: ctx.now, automationEnabledAt: ctx.settings.enabledAt, reviewRequestsEligibleAfter: ctx.client?.reviewRequestsEligibleAfter });
  if (!eligibility.eligible && eligibility.reason !== 'waiting_for_end') {
    return { ...display, status: canSendManually ? 'eligible' : 'not_eligible', canSendManually, reason: 'This appointment does not qualify for scheduled-end automation. Only valid appointments after automation was enabled are included.' };
  }
  return { ...display, status: 'awaiting_trigger', source: 'automatic', channel: 'sms', canSendManually, reason: eligibility.triggerReached ? 'Waiting for the next automatic review check.' : 'The review request will be checked after the appointment ends.' };
}

/** Bounded client history from the existing request, trigger, and owner-reported records. */
export async function getClientReviewOverview(salonId: string, clientId: string): Promise<ClientReviewOverview> {
  const ctx = await context(db, salonId, null, new Date(), clientId);
  if (!ctx.client || ctx.clientIds.length === 0) {
    throw new Error('CLIENT_UNAVAILABLE');
  }
  const recipient = isValidPhone(ctx.client.phone) ? normalizeConsentRecipient(ctx.client.phone) : null;
  // Full matched evidence is needed for cooldown/unknown outcomes; rendered
  // history is bounded to 20. One batch replaces per-appointment context reads.
  const rows = await db.select({ request: reviewRequestSchema, intent: communicationIntentSchema, delivery: notificationDeliverySchema })
    .from(reviewRequestSchema)
    .leftJoin(communicationIntentSchema, and(eq(communicationIntentSchema.id, reviewRequestSchema.intentId), eq(communicationIntentSchema.salonId, salonId)))
    .leftJoin(notificationDeliverySchema, and(eq(notificationDeliverySchema.id, communicationIntentSchema.deliveryId), eq(notificationDeliverySchema.salonId, salonId)))
    .where(and(eq(reviewRequestSchema.salonId, salonId), or(inArray(reviewRequestSchema.clientId, ctx.clientIds), recipient ? eq(reviewRequestSchema.recipient, recipient) : undefined)))
    .orderBy(desc(reviewRequestSchema.createdAt));
  const legacy = await db.select().from(clientCommunicationSchema).where(and(
    eq(clientCommunicationSchema.salonId, salonId),
    eq(clientCommunicationSchema.kind, 'google_review'),
    or(inArray(clientCommunicationSchema.salonClientId, ctx.clientIds), recipient ? eq(clientCommunicationSchema.destinationSnapshot, recipient) : undefined),
    or(eq(clientCommunicationSchema.status, 'marked_sent'), isNotNull(clientCommunicationSchema.markedSentAt)),
  )).orderBy(desc(clientCommunicationSchema.markedSentAt));
  const triggers = await db.select({ trigger: reviewRequestTriggerSchema }).from(reviewRequestTriggerSchema)
    .innerJoin(appointmentSchema, and(eq(appointmentSchema.id, reviewRequestTriggerSchema.appointmentId), eq(appointmentSchema.salonId, salonId)))
    .where(and(eq(reviewRequestTriggerSchema.salonId, salonId), inArray(appointmentSchema.salonClientId, ctx.clientIds), inArray(reviewRequestTriggerSchema.state, ['pending', 'skipped'])))
    .orderBy(desc(reviewRequestTriggerSchema.createdAt)).limit(21);
  const recentRows = rows.slice(0, 21);
  const appointmentIds = [...new Set([...recentRows.flatMap(({ request }) => request.appointmentId ? [request.appointmentId] : []), ...triggers.map(({ trigger }) => trigger.appointmentId)])];
  const appointments = appointmentIds.length ? await db.select().from(appointmentSchema).where(and(eq(appointmentSchema.salonId, salonId), inArray(appointmentSchema.id, appointmentIds))) : [];
  const requestTriggerIds = recentRows.flatMap(({ request }) => request.triggerId ? [request.triggerId] : []);
  const requestTriggers = requestTriggerIds.length ? await db.select().from(reviewRequestTriggerSchema).where(and(eq(reviewRequestTriggerSchema.salonId, salonId), inArray(reviewRequestTriggerSchema.id, requestTriggerIds))) : [];
  const intentIds = recentRows.map(({ request }) => request.intentId);
  const deliveryIds = recentRows.flatMap(({ intent }) => intent?.deliveryId ? [intent.deliveryId] : []);
  const deliveries = intentIds.length ? await db.select().from(notificationDeliverySchema).where(and(eq(notificationDeliverySchema.salonId, salonId), or(inArray(notificationDeliverySchema.intentId, intentIds), deliveryIds.length ? inArray(notificationDeliverySchema.id, deliveryIds) : undefined))) : [];
  const appointmentContext = (appointmentId: string | null): ReviewContext => ({ ...ctx, appointment: appointments.find(appointment => appointment.id === appointmentId) });
  const history: ClientReviewHistoryItem[] = [];
  for (const { request, intent } of recentRows) {
    const evidence: ReviewDisplayEvidence = {
      intent,
      deliveries: deliveries.filter(delivery => delivery.intentId === request.intentId || delivery.id === intent?.deliveryId),
      trigger: requestTriggers.find(trigger => trigger.id === request.triggerId) ?? null,
    };
    history.push({ ...await displayRequest(appointmentContext(request.appointmentId), salonId, request, evidence), canSendManually: false, id: request.id, appointmentId: request.appointmentId, occurredAt: request.createdAt.toISOString() });
  }
  for (const row of legacy.slice(0, 21)) {
    history.push({ ...baseReviewDisplay(ctx), id: row.id, appointmentId: row.appointmentId, occurredAt: (row.markedSentAt ?? row.createdAt).toISOString(), status: 'reported_sent', source: 'owner_reported', channel: 'owner_device', sentAt: row.markedSentAt?.toISOString() ?? null, message: row.messageSnapshot, reason: 'Marked sent by the owner. Luster cannot verify delivery.' });
  }
  const historyEvidence = [
    ...rows.map(({ request, intent, delivery }) => ({ id: request.id, appointmentId: request.appointmentId, state: intent?.status ?? null, sentAt: intent?.status === 'sent' ? intent.resolvedAt : null, hasProviderEvidence: !!delivery?.providerMessageId || ['sent', 'delivered'].includes(delivery?.status ?? '') })),
    ...legacy.map(row => ({ id: row.id, appointmentId: row.appointmentId, state: 'sent', sentAt: row.markedSentAt, hasProviderEvidence: false })),
  ];
  for (const { trigger } of triggers) {
    if (rows.some(({ request }) => request.triggerId === trigger.id)) {
      continue;
    }
    const appointmentCtx = appointmentContext(trigger.appointmentId);
    const blocked = evaluateReviewHistory({ history: historyEvidence, appointmentId: trigger.appointmentId, cooldownDays: ctx.settings.policy.repeatCooldownDays, now: ctx.now });
    const projected = displayTrigger(appointmentCtx, trigger);
    const display = projected.status === 'scheduled' && !blocked.allowed
      ? { ...projected, status: 'skipped' as const, scheduledFor: null, reason: 'Another applicable review request already exists for this client.' }
      : projected;
    history.push({ ...display, canSendManually: false, id: trigger.id, appointmentId: trigger.appointmentId, occurredAt: trigger.createdAt.toISOString() });
  }
  history.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return { timeZone: ctx.settings.salon?.settings?.booking?.timezone ?? DEFAULT_BOOKING_TIME_ZONE, reviewRequestsSuppressed: ctx.client.reviewRequestsSuppressed, history: history.slice(0, 20), hasMore: history.length > 20 || rows.length > 20 || legacy.length > 20 || triggers.length > 20 };
}
