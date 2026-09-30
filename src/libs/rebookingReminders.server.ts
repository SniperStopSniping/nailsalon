import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { getClientSmsPurposeEligibility } from '@/libs/clientSmsEligibility.server';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { db } from '@/libs/DB';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { defaultRebookingReminderSettings, rebookingReminderDueAt, type RebookingReminderSettings, renderRebookingReminder } from '@/libs/rebookingReminders';
import { DEFAULT_BOOKING_TIME_ZONE } from '@/libs/timeZone';
import { rebookingReminderSettingsSchema } from '@/models/Schema';

const CANDIDATE_LIMIT = 50;
const SEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Candidate = {
  appointment_id: string;
  status: string;
  salon_id: string;
  client_id: string;
  completed_at: Date | string;
  phone: string;
  full_name: string | null;
  salon_name: string;
  slug: string;
  custom_domain: string | null;
  time_zone: string | null;
  service_name: string | null;
  interval_weeks: number;
  enabled: boolean;
  enabled_at: Date | string | null;
  message_template: string;
  has_upcoming: boolean;
  has_later_completed: boolean;
  is_blocked: boolean;
};

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  return (result as { rows?: T[] }).rows ?? [];
}

export function evaluateRebookingCandidate(candidate: Candidate, now: Date): { dueAt: Date; notAfter: Date } | null {
  if (candidate.status !== 'completed' || !candidate.enabled || !candidate.enabled_at || candidate.has_upcoming || candidate.has_later_completed || candidate.is_blocked) {
    return null;
  }
  const completedAt = new Date(candidate.completed_at);
  const enabledAt = new Date(candidate.enabled_at);
  if (completedAt > now || !Number.isInteger(candidate.interval_weeks)
    || candidate.interval_weeks < 1 || candidate.interval_weeks > 52) {
    return null;
  }
  const dueAt = rebookingReminderDueAt(completedAt, candidate.interval_weeks, candidate.time_zone || DEFAULT_BOOKING_TIME_ZONE);
  const notAfter = new Date(dueAt.getTime() + SEND_WINDOW_MS);
  return enabledAt <= dueAt && dueAt <= now && now < notAfter ? { dueAt, notAfter } : null;
}

const candidateColumns = (now: Date) => sql`
  a.id AS appointment_id, a.status, a.salon_id, a.salon_client_id AS client_id,
  a.completed_at, c.phone, c.full_name, s.name AS salon_name, s.slug,
  s.custom_domain, s.settings #>> '{booking,timezone}' AS time_zone,
  COALESCE(aps.name_snapshot, service.name) AS service_name,
  COALESCE(interval_override.interval_weeks, config.default_interval_weeks) AS interval_weeks,
  config.enabled, config.enabled_at, config.message_template,
  COALESCE(c.is_blocked, false) AS is_blocked,
  EXISTS (
    SELECT 1 FROM appointment upcoming
    WHERE upcoming.salon_id = a.salon_id
      AND (upcoming.salon_client_id = a.salon_client_id
        OR right(regexp_replace(upcoming.client_phone, '[^0-9]', '', 'g'), 10) = c.phone)
      AND upcoming.deleted_at IS NULL AND upcoming.end_time > ${now}
      AND upcoming.status IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment')
      AND (upcoming.status <> 'awaiting_payment' OR upcoming.deposit_hold_expires_at > ${now})
  ) AS has_upcoming,
  EXISTS (
    SELECT 1 FROM appointment newer
    WHERE newer.salon_id = a.salon_id
      AND (newer.salon_client_id = a.salon_client_id
        OR right(regexp_replace(newer.client_phone, '[^0-9]', '', 'g'), 10) = c.phone)
      AND newer.deleted_at IS NULL AND newer.status = 'completed'
      AND (COALESCE(newer.completed_at, newer.end_time), newer.id) > (a.completed_at, a.id)
  ) AS has_later_completed
`;

const candidateJoins = sql`
  FROM appointment a
  JOIN rebooking_reminder_settings config ON config.salon_id = a.salon_id
  JOIN salon s ON s.id = a.salon_id
  JOIN salon_client c ON c.id = a.salon_client_id AND c.salon_id = a.salon_id
  LEFT JOIN LATERAL (
    SELECT ap.service_id, ap.name_snapshot FROM appointment_services ap
    WHERE ap.appointment_id = a.id ORDER BY ap.id LIMIT 1
  ) aps ON true
  LEFT JOIN service ON service.id = aps.service_id AND service.salon_id = a.salon_id
  LEFT JOIN rebooking_reminder_service_interval interval_override
    ON interval_override.salon_id = a.salon_id AND interval_override.service_id = aps.service_id
`;

function validCurrentRow(candidate: Candidate): boolean {
  return Boolean(candidate.client_id && candidate.phone && candidate.slug && candidate.enabled
    && !candidate.is_blocked && !candidate.has_later_completed && !candidate.has_upcoming);
}

/** Read fresh tenant, client, appointment and scheduling state before sending. */
export async function rebookingReminderSendContext(salonId: string, appointmentId: string, now = new Date()) {
  const result = await db.execute(sql`
    SELECT ${candidateColumns(now)} ${candidateJoins}
    WHERE a.id = ${appointmentId} AND a.salon_id = ${salonId}
      AND a.status = 'completed' AND a.completed_at IS NOT NULL AND a.deleted_at IS NULL
      AND s.is_active = true AND s.deleted_at IS NULL
      AND c.archived_at IS NULL AND c.merged_into_client_id IS NULL
    LIMIT 1
  `);
  const candidate = rows<Candidate>(result)[0];
  const timing = candidate && validCurrentRow(candidate) && evaluateRebookingCandidate(candidate, now);
  if (!candidate || !timing) {
    return null;
  }
  const consent = await getClientSmsPurposeEligibility({ salonId, phone: candidate.phone, purpose: 'salon_promotions' });
  if (consent.state !== 'enabled') {
    return null;
  }
  const bookingLink = buildSalonTenantPublicUrl('/book/service', { slug: candidate.slug, customDomain: candidate.custom_domain });
  const firstName = candidate.full_name?.trim().split(/\s+/)[0] || 'there';
  return {
    candidate,
    timing,
    message: renderRebookingReminder(candidate.message_template, {
      first_name: firstName,
      service_name: candidate.service_name || 'your service',
      salon_name: candidate.salon_name,
      booking_link: bookingLink,
    }),
  };
}

/** A bounded sweep; the unique intent key survives retry and concurrent cron runs. */
export async function materializeRebookingReminders(now = new Date()): Promise<{ queued: number; examined: number }> {
  const result = await db.execute(sql`
    SELECT a.id AS appointment_id, a.salon_id ${candidateJoins}
    WHERE config.enabled = true AND config.enabled_at IS NOT NULL
      AND a.status = 'completed' AND a.completed_at IS NOT NULL AND a.deleted_at IS NULL
      AND a.completed_at <= ${now}::timestamptz - interval '6 days'
      AND a.completed_at >= ${now}::timestamptz - interval '54 weeks'
      AND a.completed_at >= ${now}::timestamptz
        - (COALESCE(interval_override.interval_weeks, config.default_interval_weeks) * interval '1 week')
        - interval '8 days'
      AND s.is_active = true AND s.deleted_at IS NULL
      AND c.archived_at IS NULL AND c.merged_into_client_id IS NULL AND c.is_blocked IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM appointment newer
        WHERE newer.salon_id = a.salon_id
          AND (newer.salon_client_id = a.salon_client_id
            OR right(regexp_replace(newer.client_phone, '[^0-9]', '', 'g'), 10) = c.phone)
          AND newer.deleted_at IS NULL AND newer.status = 'completed'
          AND (COALESCE(newer.completed_at, newer.end_time), newer.id) > (a.completed_at, a.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM appointment upcoming
        WHERE upcoming.salon_id = a.salon_id
          AND (upcoming.salon_client_id = a.salon_client_id
            OR right(regexp_replace(upcoming.client_phone, '[^0-9]', '', 'g'), 10) = c.phone)
          AND upcoming.deleted_at IS NULL AND upcoming.end_time > ${now}
          AND upcoming.status IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment')
          AND (upcoming.status <> 'awaiting_payment' OR upcoming.deposit_hold_expires_at > ${now})
      )
      AND NOT EXISTS (
        SELECT 1 FROM communication_intent intent
        WHERE intent.dedupe_key = ('rebooking:' || a.salon_id || ':' || a.id)
      )
    ORDER BY a.completed_at + (COALESCE(interval_override.interval_weeks, config.default_interval_weeks) * interval '1 week'), a.id
    LIMIT ${CANDIDATE_LIMIT}
  `);
  let queued = 0;
  const candidates = rows<Pick<Candidate, 'appointment_id' | 'salon_id'>>(result);
  for (const row of candidates) {
    const context = await rebookingReminderSendContext(row.salon_id, row.appointment_id, now);
    if (!context) {
      continue;
    }
    const intent = await enqueueCommunicationIntent({
      salonId: row.salon_id,
      appointmentId: row.appointment_id,
      channel: 'sms',
      audience: 'client',
      eventType: 'rebooking_reminder',
      dedupeKey: `rebooking:${row.salon_id}:${row.appointment_id}`,
      recipient: context.candidate.phone,
      destinationCountry: 'CA',
      templateKey: 'client_rebooking_reminder',
      templateVersion: 'v1',
      variables: { clientId: context.candidate.client_id, message: context.message },
      schedulingRevision: context.timing.dueAt.toISOString(),
      scheduledFor: context.timing.dueAt,
      notAfter: context.timing.notAfter,
    });
    queued += Number(intent.created);
  }
  return { queued, examined: candidates.length };
}

export async function getRebookingReminderSettings(salonId: string): Promise<RebookingReminderSettings> {
  const [row] = await db.select().from(rebookingReminderSettingsSchema)
    .where(eq(rebookingReminderSettingsSchema.salonId, salonId)).limit(1);
  return row ?? defaultRebookingReminderSettings;
}

export async function saveRebookingReminderSettings(salonId: string, update: Omit<RebookingReminderSettings, 'enabledAt'>, now = new Date()) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction.select().from(rebookingReminderSettingsSchema)
      .where(eq(rebookingReminderSettingsSchema.salonId, salonId)).for('update').limit(1);
    const enabledAt = update.enabled
      ? current?.enabled ? current.enabledAt ?? now : now
      : null;
    const [saved] = await transaction.insert(rebookingReminderSettingsSchema)
      .values({ salonId, ...update, enabledAt })
      .onConflictDoUpdate({ target: rebookingReminderSettingsSchema.salonId, set: { ...update, enabledAt, updatedAt: now } })
      .returning();
    return saved!;
  });
}
