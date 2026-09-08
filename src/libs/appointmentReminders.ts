import 'server-only';

import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { mintAppointmentManageCapability } from '@/libs/bookingCommitEffects';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  formatIntentStartTime,
  reconcileAppointmentReminders,
  resolveSalonCommunicationContext,
} from '@/libs/communicationMaterialization';
import { planReminders } from '@/libs/communicationScheduling';
import { resolveActiveReminderRules, resolveEventChannels } from '@/libs/communicationSettings';
import { db } from '@/libs/DB';
import { isReminderEligibleAppointment, reminderEligibleAppointmentCondition } from '@/libs/reminderEligibility';
import {
  appointmentSchema,
  communicationIntentSchema,
  salonClientSchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

const RECONCILER_QUERY_HOURS = 8 * 24;
const MAX_CANDIDATES_PER_RUN = 500;

type ReminderCandidate = {
  appointmentId: string;
  salonId: string;
  salonClientId: string | null;
  salonName: string;
  salonSettings: unknown;
  clientName: string | null;
  clientPhone: string;
  startTime: Date;
  endTime: Date;
  technicianName: string | null;
  salonClientEmail: string | null;
  appointmentEmail: string | null;
  dayBeforeReminderSentAt: Date | null;
  sameDayReminderSentAt: Date | null;
  salonSlug: string;
  salonCustomDomain: string | null;
  appointmentUpdatedAt: Date;
};

export type ProcessAppointmentRemindersResult = {
  scanned: number;
  dayBeforeSent: number;
  dayBeforeEmail: number;
  dayBeforeSms: number;
  sameDaySent: number;
  skipped: number;
  failures: number;
  /** Durable scheduling counters; actual sends belong to the dispatcher. */
  intentsMaterialized: number;
  intentsCanceledStale: number;
  orphanIntentsCanceled: number;
  failedEmailsRetried: number;
};

/** Both shared and connected Twilio senders use the same durable rule scheduler. */
export async function processAppointmentReminders(args?: {
  now?: Date;
  beforeDeliveryGuard?: () => Promise<void>;
}): Promise<ProcessAppointmentRemindersResult> {
  const now = args?.now ?? new Date();
  const candidates = await loadReminderCandidates(now);
  const result: ProcessAppointmentRemindersResult = {
    scanned: candidates.length,
    dayBeforeSent: 0,
    dayBeforeEmail: 0,
    dayBeforeSms: 0,
    sameDaySent: 0,
    skipped: 0,
    failures: 0,
    intentsMaterialized: 0,
    intentsCanceledStale: 0,
    orphanIntentsCanceled: 0,
    failedEmailsRetried: 0,
  };
  await args?.beforeDeliveryGuard?.();
  for (const candidate of candidates) {
    try {
      const communicationContext = await resolveSalonCommunicationContext(db, candidate.salonId);
      const timeZone = resolveBookingConfigFromSettings(candidate.salonSettings as SalonSettings | null).timezone;
      const outcome = await reconcileCurrentReminders({ candidate, communicationContext, timeZone, now });
      result.intentsMaterialized += outcome.materialized;
      result.intentsCanceledStale += outcome.canceledStale;
      if (outcome.materialized === 0 && outcome.canceledStale === 0) {
        result.skipped += 1;
      }
    } catch {
      result.failures += 1;
    }
  }
  const retriedEmails = await db.execute(sql`
    UPDATE communication_intent
       SET status = 'pending', available_at = ${new Date(now.getTime() + 10 * 60 * 1000)}
     WHERE channel = 'email' AND status = 'failed' AND attempts <= 3 AND not_after > ${now}
    RETURNING id
  `);
  result.failedEmailsRetried = retriedEmails.rows.length;
  const orphaned = await db.execute(sql`
    UPDATE communication_intent i
       SET status = 'canceled', resolved_at = ${now}, last_error = 'APPOINTMENT_NO_LONGER_ACTIVE'
      FROM appointment a
     WHERE i.appointment_id = a.id AND i.salon_id = a.salon_id
       AND i.event_type = 'appointment_reminder' AND i.status IN ('pending', 'blocked_no_credit')
       AND (a.status NOT IN ('pending', 'confirmed') OR a.deleted_at IS NOT NULL
         OR (a.status = 'pending' AND a.request_expires_at IS NOT NULL))
    RETURNING i.id
  `);
  result.orphanIntentsCanceled = orphaned.rows.length;
  return result;
}

async function loadReminderCandidates(now: Date): Promise<ReminderCandidate[]> {
  const latestRelevantStartTime = new Date(now.getTime() + RECONCILER_QUERY_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({
      appointmentId: appointmentSchema.id,
      salonId: appointmentSchema.salonId,
      salonClientId: appointmentSchema.salonClientId,
      salonName: salonSchema.name,
      salonSettings: salonSchema.settings,
      salonSlug: salonSchema.slug,
      salonCustomDomain: salonSchema.customDomain,
      appointmentUpdatedAt: appointmentSchema.updatedAt,
      clientName: appointmentSchema.clientName,
      clientPhone: appointmentSchema.clientPhone,
      startTime: appointmentSchema.startTime,
      endTime: appointmentSchema.endTime,
      technicianName: technicianSchema.name,
      salonClientEmail: salonClientSchema.email,
      appointmentEmail: appointmentSchema.clientEmail,
      dayBeforeReminderSentAt: appointmentSchema.dayBeforeReminderSentAt,
      sameDayReminderSentAt: appointmentSchema.sameDayReminderSentAt,
    })
    .from(appointmentSchema)
    .innerJoin(
      salonSchema,
      and(
        eq(appointmentSchema.salonId, salonSchema.id),
        eq(salonSchema.isActive, true),
      ),
    )
    .leftJoin(
      salonClientSchema,
      and(
        eq(appointmentSchema.salonClientId, salonClientSchema.id),
        eq(appointmentSchema.salonId, salonClientSchema.salonId),
      ),
    )
    .leftJoin(
      technicianSchema,
      and(
        eq(appointmentSchema.technicianId, technicianSchema.id),
        eq(appointmentSchema.salonId, technicianSchema.salonId),
      ),
    )
    .where(
      and(
        // L1 PR5 — an unapproved explicit request-approval booking (pending
        // + non-null request_expires_at) is excluded here; see
        // reminderEligibility.ts for why.
        reminderEligibleAppointmentCondition(),
        isNull(appointmentSchema.deletedAt),
        gt(appointmentSchema.startTime, now),
        lt(appointmentSchema.startTime, latestRelevantStartTime),
        // Reconciliation sees every upcoming appointment because a settings
        // change can invalidate an already materialized reminder.
      ),
    )
    .orderBy(appointmentSchema.startTime)
    .limit(MAX_CANDIDATES_PER_RUN);

  return rows;
}

async function reconcileCurrentReminders(args: {
  candidate: ReminderCandidate;
  communicationContext: Awaited<ReturnType<typeof resolveSalonCommunicationContext>>;
  timeZone: string;
  now: Date;
}): Promise<{ materialized: number; canceledStale: number }> {
  const { candidate, communicationContext, timeZone, now } = args;
  const settings = communicationContext.settings;
  const clientEmail = candidate.appointmentEmail ?? candidate.salonClientEmail ?? null;
  const { resolveOperationalSalonClientContactWithHandle, resolveOperationalSalonClientContactByPhoneWithHandle } = await import('@/libs/clientLifecycleStabilization');
  const contact = candidate.salonClientId
    ? await resolveOperationalSalonClientContactWithHandle(db, { salonId: candidate.salonId, clientId: candidate.salonClientId, allowArchived: true })
    : await resolveOperationalSalonClientContactByPhoneWithHandle(db, { salonId: candidate.salonId, phone: candidate.clientPhone, allowArchived: true });
  const clientPhone = contact?.phone ?? candidate.clientPhone ?? null;
  const clientId = contact?.id ?? candidate.salonClientId;

  const allRows = await db
    .select({
      dedupeKey: communicationIntentSchema.dedupeKey,
      status: communicationIntentSchema.status,
    })
    .from(communicationIntentSchema)
    .where(and(
      eq(communicationIntentSchema.salonId, candidate.salonId),
      eq(communicationIntentSchema.appointmentId, candidate.appointmentId),
      eq(communicationIntentSchema.eventType, 'appointment_reminder'),
    ));

  const allowedChannels = resolveEventChannels(settings, 'appointment_reminder')
    .filter(channel => (channel === 'sms'
      ? communicationContext.smsEligible && clientPhone !== null
      : clientEmail !== null));
  const planned = planReminders({
    salonId: candidate.salonId,
    appointmentId: candidate.appointmentId,
    appointmentStart: candidate.startTime,
    appointmentUpdatedAt: candidate.appointmentUpdatedAt,
    timeZone,
    quietHours: settings.quietHours,
    rules: resolveActiveReminderRules(settings),
    allowedChannels,
    smsEnabled: settings.sms.enabled,
    emailEnabled: settings.email.enabled,
    existingDedupeKeys: new Set(allRows.map(row => row.dedupeKey)),
    now,
  });
  const desiredKeys = planned.flatMap(plan => (plan.kind === 'scheduled' ? [plan.dedupeKey] : []));

  if (contact) {
    await db.execute(sql`
      UPDATE communication_intent
         SET recipient = ${clientPhone},
             variables = jsonb_set(variables, '{clientId}', to_jsonb(${clientId}::text)),
             updated_at = clock_timestamp()
       WHERE salon_id = ${candidate.salonId} AND appointment_id = ${candidate.appointmentId}
         AND event_type = 'appointment_reminder' AND channel = 'sms'
         AND status IN ('pending', 'blocked_no_credit')
         AND (recipient IS DISTINCT FROM ${clientPhone} OR variables->>'clientId' IS DISTINCT FROM ${clientId})
    `);
  }
  // ANY existing row satisfies a desired key for the fast path — a FAILED or
  // SENT row still owns its dedupe key (the unique index has no status
  // predicate), so treating it as drift would re-enter the transaction and
  // mint a fresh manage capability every pass, forever (review H7). Stale
  // detection cares only about LIVE rows outside the desired set.
  const anyKeys = new Set(allRows.map(row => row.dedupeKey));
  const liveKeys = new Set(allRows
    .filter(row => row.status === 'pending' || row.status === 'blocked_no_credit')
    .map(row => row.dedupeKey));
  const desiredSet = new Set(desiredKeys);
  const missing = desiredKeys.some(key => !anyKeys.has(key));
  const stale = [...liveKeys].some(key => !desiredSet.has(key));
  if (!missing && !stale) {
    return { materialized: 0, canceledStale: 0 };
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(appointmentSchema).where(and(
      eq(appointmentSchema.id, candidate.appointmentId),
      eq(appointmentSchema.salonId, candidate.salonId),
    )).for('update').limit(1);
    if (!current || current.deletedAt || !isReminderEligibleAppointment(current)
      || current.startTime.getTime() !== candidate.startTime.getTime()
      || current.updatedAt.getTime() !== candidate.appointmentUpdatedAt.getTime()) {
      return { materialized: 0, canceledStale: 0 };
    }
    const capability = await mintAppointmentManageCapability(tx, {
      salonId: candidate.salonId,
      appointmentId: candidate.appointmentId,
      appointmentEndTime: candidate.endTime,
    });
    const outcome = await reconcileAppointmentReminders({
      tx,
      salonId: candidate.salonId,
      appointmentId: candidate.appointmentId,
      appointmentStart: candidate.startTime,
      appointmentUpdatedAt: candidate.appointmentUpdatedAt,
      clientPhone,
      clientEmail,
      settings,
      timeZone,
      variables: {
        salonName: candidate.salonName,
        ...(clientId ? { clientId } : {}),
        startTime: formatIntentStartTime(candidate.startTime, timeZone),
        manageUrl: buildAppointmentManageUrl(
          { slug: candidate.salonSlug, customDomain: candidate.salonCustomDomain ?? null },
          capability.token,
        ),
      },
      smsEligible: communicationContext.smsEligible,
      now,
    });
    return { materialized: outcome.materialized.filter(row => row.created).length, canceledStale: outcome.canceledStale };
  });
}
