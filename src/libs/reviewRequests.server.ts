import 'server-only';

import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { ClientLifecycleStabilizationError, getSalonClientLineageIdentityWithHandle, lockOperationalSalonClientContactWithHandle, resolveOperationalSalonClientContactWithHandle } from '@/libs/clientLifecycleStabilization';
import type { CommunicationIntentDatabase, CommunicationIntentTransaction } from '@/libs/communicationIntent';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { applyQuietHours } from '@/libs/communicationScheduling';
import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { db, usesRuntimePostgres } from '@/libs/DB';
import { isValidPhone } from '@/libs/phone';
import { resolveReviewAutomationPolicy } from '@/libs/reviewAutomationPolicy';
import { DEFAULT_REVIEW_MESSAGE, isReviewUrl, renderReviewMessage, reviewMessageFits, reviewSettingsSchema, reviewSmsBody } from '@/libs/reviewRequests';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { readSharedSenderEnvConfig } from '@/libs/smsSender';
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
};

type MaterializeReviewTriggersResult = {
  materialized: number;
  pending: number;
  skipped: number;
  deferred: number;
  phaseError: boolean;
};

/**
 * Turns due completion events into the existing review-request/intents model.
 * The producer above is the sole source of trigger rows in this slice: this
 * function never scans historic completed appointments.
 */
export async function materializeCompletedReviewTriggers(
  input: MaterializeReviewTriggersInput = {},
): Promise<MaterializeReviewTriggersResult> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const batchDeadline = Date.now() + REVIEW_TRIGGER_BATCH_BUDGET_MS;
  const limit = Math.max(1, Math.min(input.limit ?? REVIEW_TRIGGER_BATCH_LIMIT, REVIEW_TRIGGER_BATCH_LIMIT));
  let candidates: { id: string; salonId: string }[];
  try {
    candidates = await database.transaction(async (transaction) => {
      await setReviewMutationTimeouts(transaction);
      // One due row per salon keeps a busy salon from hiding other tenants;
      // the next cron naturally advances that salon's remaining queue.
      const rows = await transaction.execute(sql`
        select id, "salonId"
        from (
          select distinct on (salon_id)
            id,
            salon_id as "salonId",
            available_at as "availableAt"
          from review_request_trigger
          where kind = 'completed'
            and state = 'pending'
            and available_at <= ${now}
          order by salon_id, available_at asc, id asc
        ) due
        order by "availableAt" asc, id asc
        limit ${limit}
      `);
      return queryRows<{ id: string; salonId: string }>(rows);
    });
  } catch {
    return { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: true };
  }
  const result: MaterializeReviewTriggersResult = { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: false };

  for (const candidate of candidates) {
    if (Date.now() >= batchDeadline) {
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

        const ctx = await context(transaction, trigger.salonId, trigger.appointmentId);
        const snapshotsMatch = ctx.appointment?.completedAt?.getTime() === trigger.triggerAt.getTime()
          && ctx.appointment.startTime.getTime() === trigger.appointmentStartAt.getTime()
          && ctx.appointment.endTime.getTime() === trigger.appointmentEndAt.getTime();
        const [storedSettings] = await transaction.select().from(salonRetentionSettingsSchema)
          .where(eq(salonRetentionSettingsSchema.salonId, trigger.salonId)).limit(1);
        const policy = resolveReviewAutomationPolicy(storedSettings);
        const automaticReason = ineligible(ctx, true);
        if (!snapshotsMatch || policy.mode !== 'marked_completed'
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

        await cancelReleasedReviewReservations(transaction, trigger.salonId, ctx, freshNow);
        const existing = await existingRequest(transaction, trigger.salonId, ctx);
        if (existing) {
          await transaction.update(reviewRequestTriggerSchema).set({
            state: 'skipped',
            reasonCode: 'EXISTING_REQUEST',
            resolvedAt: freshNow,
          }).where(eq(reviewRequestTriggerSchema.id, trigger.id));
          return 'skipped' as const;
        }

        if (!ctx.client || !ctx.settings.salon || !ctx.appointment?.completedAt) {
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
          completedAt: trigger.triggerAt,
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
          templateKey: 'client_manual_text',
          templateVersion: 'v1',
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
  return {
    googleReviewUrl: settings ? settings.googleReviewUrl : salon?.settings?.googleReviewUrl ?? null,
    automaticEnabled: settings?.automaticReviewRequests ?? false,
    enabledAt: settings?.reviewRequestsEnabledAt ?? null,
    delayMinutes: settings?.reviewRequestDelayMinutes ?? 60,
    messageTemplate: settings?.reviewRequestMessage ?? DEFAULT_REVIEW_MESSAGE,
    businessName: salon?.name ?? '',
    salon,
  };
}

async function context(database: CommunicationIntentDatabase, salonId: string, appointmentId: string) {
  const [appointment] = await database.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId))).limit(1);
  const settings = await getReviewSettings(salonId, database);
  if (!appointment?.salonClientId) {
    return { appointment, settings, client: null, legacyReview: null, consent: false, clientIds: [] as string[] };
  }
  try {
    const contact = await resolveOperationalSalonClientContactWithHandle(database, { salonId, clientId: appointment.salonClientId });
    const identity = await getSalonClientLineageIdentityWithHandle(database, { salonId, terminalClientId: contact.id });
    const [client] = await database.select().from(salonClientSchema).where(and(eq(salonClientSchema.id, contact.id), eq(salonClientSchema.salonId, salonId))).limit(1);
    const [legacyReview] = await database.select().from(clientCommunicationSchema).where(and(
      eq(clientCommunicationSchema.salonId, salonId),
      inArray(clientCommunicationSchema.salonClientId, identity.clientIds),
      eq(clientCommunicationSchema.kind, 'google_review'),
      eq(clientCommunicationSchema.status, 'marked_sent'),
    )).orderBy(desc(clientCommunicationSchema.markedSentAt)).limit(1);
    const recipient = normalizeConsentRecipient(contact.phone);
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
    return { appointment, settings, client: client ?? null, legacyReview: legacyReview ?? null, consent: consent?.status === 'granted' && global?.state !== 'suppressed', clientIds: identity.clientIds };
  } catch (error) {
    if (!(error instanceof ClientLifecycleStabilizationError)) {
      throw error;
    }
    // Archived, missing, or malformed identity always fails closed.
    return { appointment, settings, client: null, legacyReview: null, consent: false, clientIds: [] as string[] };
  }
}

type ReviewContext = Awaited<ReturnType<typeof context>>;
function ineligible(ctx: ReviewContext, automatic: boolean): string | null {
  const { appointment, client, settings } = ctx;
  if (!appointment || appointment.deletedAt || appointment.status !== 'completed' || !appointment.completedAt) {
    return 'Complete this appointment before requesting a review.';
  }
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
  if (automatic && (!settings.automaticEnabled || !settings.enabledAt || appointment.completedAt <= settings.enabledAt
    || (client.reviewRequestsEligibleAfter && appointment.completedAt <= client.reviewRequestsEligibleAfter))) {
    return 'Automatic review requests are off for this appointment.';
  }
  const body = reviewSmsBody({ template: settings.messageTemplate, clientName: client.fullName, businessName: settings.businessName, reviewLink: settings.googleReviewUrl });
  return reviewMessageFits(body) ? null : 'Shorten the review message to 10 SMS segments or fewer.';
}

async function existingRequest(database: CommunicationIntentDatabase, salonId: string, ctx: ReviewContext) {
  if (!ctx.client || ctx.clientIds.length === 0) {
    return undefined;
  }
  const [row] = await database.select().from(reviewRequestSchema).where(and(
    eq(reviewRequestSchema.salonId, salonId),
    ne(reviewRequestSchema.status, 'cancelled'),
    or(inArray(reviewRequestSchema.clientId, ctx.clientIds), eq(reviewRequestSchema.recipient, normalizeConsentRecipient(ctx.client.phone))),
  )).orderBy(desc(reviewRequestSchema.createdAt)).limit(1);
  return row;
}

/** Only a proven never-sent intent can release a client's normal request slot. */
export async function cancelReviewRequests(database: CommunicationIntentDatabase, salonId: string, filter: { clientIds?: string[]; automaticOnly?: boolean } = {}) {
  const rows = await database.select().from(reviewRequestSchema).where(and(
    eq(reviewRequestSchema.salonId, salonId),
    ne(reviewRequestSchema.status, 'cancelled'),
    filter.clientIds ? inArray(reviewRequestSchema.clientId, filter.clientIds) : undefined,
    filter.automaticOnly ? eq(reviewRequestSchema.source, 'automatic') : undefined,
  ));
  for (const row of rows) {
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

export async function saveReviewSettings(salonId: string, input: unknown) {
  const parsed = reviewSettingsSchema.parse(input);
  const value = { ...parsed, automaticEnabled: parsed.automaticEnabled && parsed.googleReviewUrl !== null };
  await db.transaction(async (tx) => {
    await lockSalonReviewMutation(tx, salonId);
    // Existing completion takes a share lock on this row: settings changes
    // and event production cannot straddle one another's commit.
    await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('update');
    const old = await getReviewSettings(salonId, tx);
    const enabledAt = value.automaticEnabled ? (old.automaticEnabled ? old.enabledAt : new Date()) : null;
    const patch = { googleReviewUrl: value.googleReviewUrl, automaticReviewRequests: value.automaticEnabled, reviewRequestsEnabledAt: enabledAt, reviewRequestDelayMinutes: value.delayMinutes, reviewRequestMessage: value.messageTemplate };
    await tx.insert(salonRetentionSettingsSchema).values({ salonId, ...patch }).onConflictDoUpdate({ target: salonRetentionSettingsSchema.salonId, set: patch });
    if (!value.googleReviewUrl || !value.automaticEnabled) {
      await cancelReviewRequests(tx, salonId, { automaticOnly: !!value.googleReviewUrl });
    }
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
    if (!automatic && existing.source === 'automatic' && !ineligible(ctx, false)) {
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
  const intent = await enqueueCommunicationIntent({ database, salonId, appointmentId, channel: 'sms', audience: 'client', eventType: 'review_request', dedupeKey: `review:${salonId}:${id}`, recipient: ctx.client.phone, destinationCountry: 'CA', templateKey: 'client_manual_text', templateVersion: 'v1', variables: { clientId: ctx.client.id, reviewRequestId: id }, schedulingRevision: id, scheduledFor: quiet.sendAt, notAfter });
  await database.update(reviewRequestSchema).set({ intentId: intent.intentId }).where(and(eq(reviewRequestSchema.id, id), eq(reviewRequestSchema.salonId, salonId)));
}

/** Re-read mutable business rules at BOTH existing pre-provider boundaries. */
export async function reviewRequestSendContext(salonId: string, intentId: string) {
  const [row] = await db.select().from(reviewRequestSchema).where(and(eq(reviewRequestSchema.salonId, salonId), eq(reviewRequestSchema.intentId, intentId), ne(reviewRequestSchema.status, 'cancelled'))).limit(1);
  if (!row?.appointmentId) {
    return null;
  }
  const ctx = await context(db, salonId, row.appointmentId);
  if (row.triggerId) {
    const [trigger] = await db.select().from(reviewRequestTriggerSchema).where(and(
      eq(reviewRequestTriggerSchema.id, row.triggerId),
      eq(reviewRequestTriggerSchema.salonId, salonId),
    )).limit(1);
    const [storedSettings] = await db.select().from(salonRetentionSettingsSchema)
      .where(eq(salonRetentionSettingsSchema.salonId, salonId)).limit(1);
    const policy = resolveReviewAutomationPolicy(storedSettings);
    const snapshotsMatch = trigger?.state === 'materialized'
      && ctx.appointment?.completedAt?.getTime() === trigger.triggerAt.getTime()
      && ctx.appointment.startTime.getTime() === trigger.appointmentStartAt.getTime()
      && ctx.appointment.endTime.getTime() === trigger.appointmentEndAt.getTime();
    if (!snapshotsMatch || policy.mode !== 'marked_completed'
      || !ctx.settings.enabledAt || trigger.triggerAt <= ctx.settings.enabledAt
      || trigger.policyRevision !== storedSettings?.reviewRequestPolicyRevision) {
      return null;
    }
  }
  if (ineligible(ctx, row.source === 'automatic') || !ctx.client || !ctx.clientIds.includes(row.clientId)
    || normalizeConsentRecipient(ctx.client.phone) !== row.recipient || ctx.appointment?.completedAt?.getTime() !== row.completedAt.getTime()) {
    return null;
  }
  return { message: renderReviewMessage({ template: ctx.settings.messageTemplate, clientName: ctx.client.fullName, businessName: ctx.settings.businessName, reviewLink: ctx.settings.googleReviewUrl! }) };
}

export async function getAppointmentReviewState(salonId: string, appointmentId: string) {
  const ctx = await context(db, salonId, appointmentId);
  const [ownRequest] = await db.select().from(reviewRequestSchema).where(and(
    eq(reviewRequestSchema.salonId, salonId),
    eq(reviewRequestSchema.appointmentId, appointmentId),
    ne(reviewRequestSchema.status, 'cancelled'),
  )).orderBy(desc(reviewRequestSchema.createdAt)).limit(1);
  const [trigger] = await db.select().from(reviewRequestTriggerSchema).where(and(
    eq(reviewRequestTriggerSchema.salonId, salonId),
    eq(reviewRequestTriggerSchema.appointmentId, appointmentId),
  )).orderBy(desc(reviewRequestTriggerSchema.createdAt)).limit(1);
  // A completion trigger exists before the five-minute worker has allocated an
  // intent. Show that appointment's own durable state rather than unrelated
  // history for the same returning client.
  if (!ownRequest && trigger?.state === 'pending') {
    return {
      status: 'scheduled',
      reason: null,
      scheduledFor: trigger.scheduledFor.toISOString(),
      sentAt: null,
      message: null,
      phone: ctx.client?.phone ?? null,
      clientId: ctx.client?.id ?? null,
    };
  }
  if (!ownRequest && trigger?.state === 'skipped') {
    return {
      status: 'not_eligible',
      reason: trigger.reasonCode ?? 'REVIEW_REQUEST_SKIPPED',
      scheduledFor: null,
      sentAt: null,
      message: null,
      phone: ctx.client?.phone ?? null,
      clientId: ctx.client?.id ?? null,
    };
  }
  const row = ownRequest ?? await existingRequest(db, salonId, ctx);
  const [intent] = row ? await db.select().from(communicationIntentSchema).where(and(eq(communicationIntentSchema.id, row.intentId), eq(communicationIntentSchema.salonId, salonId))).limit(1) : [];
  const [delivery] = intent?.deliveryId ? await db.select().from(notificationDeliverySchema).where(and(eq(notificationDeliverySchema.id, intent.deliveryId), eq(notificationDeliverySchema.salonId, salonId))).limit(1) : [];
  const reason = ineligible(ctx, false);
  let status = reason ? (ctx.client?.reviewRequestsSuppressed || ctx.client?.hasGoogleReview ? 'suppressed' : 'not_eligible') : 'eligible';
  if (row) {
    status = intent?.status === 'sent' ? 'sent' : ['sending', 'send_outcome_unknown'].includes(intent?.status ?? '') ? 'sending' : ['canceled', 'suppressed', 'expired'].includes(intent?.status ?? '') ? 'cancelled' : intent?.status === 'failed' || !intent ? 'failed' : 'scheduled';
  }
  if (!row && ctx.legacyReview) {
    status = 'sent';
  }
  if (delivery && ['failed', 'undelivered'].includes(delivery.status)) {
    status = 'failed';
  }
  return { status, reason: status === 'failed' ? 'The review request could not be sent. It will not be retried automatically.' : intent?.status === 'blocked_no_credit' ? 'Add SMS credits to send this review request.' : reason, scheduledFor: intent?.availableAt?.toISOString() ?? null, sentAt: intent?.status === 'sent' ? intent.resolvedAt?.toISOString() ?? null : ctx.legacyReview?.markedSentAt?.toISOString() ?? null, message: intent?.bodySnapshot ?? ctx.legacyReview?.messageSnapshot ?? (ctx.settings.googleReviewUrl && ctx.client ? reviewSmsBody({ template: ctx.settings.messageTemplate, clientName: ctx.client.fullName, businessName: ctx.settings.businessName, reviewLink: ctx.settings.googleReviewUrl }) : null), phone: ctx.client?.phone ?? null, clientId: ctx.client?.id ?? null };
}
