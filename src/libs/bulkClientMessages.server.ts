import 'server-only';

import { createHash } from 'node:crypto';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { type BulkMessageClient, type BulkMessageDraft, type BulkMessagePreview, type BulkMessageReceipt, matchesBulkMessageFilter } from '@/libs/bulkClientMessages';
import { ClientMessagingError, serializeSmsHistory } from '@/libs/clientMessaging';
import { getClientSmsPurposeEligibilityBatch } from '@/libs/clientSmsEligibility.server';
import type { CommunicationIntentDatabase } from '@/libs/communicationIntent';
import { applyQuietHours, computeSchedulingRevision } from '@/libs/communicationScheduling';
import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { db } from '@/libs/DB';
import { isValidPhone } from '@/libs/phone';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { prepareSmsBody } from '@/libs/smsSegments';
import type { SmsOperationalHealth } from '@/libs/textingStatus';
import { DEFAULT_BOOKING_TIME_ZONE } from '@/libs/timeZone';
import { communicationIntentSchema, notificationDeliverySchema, salonClientSchema, salonSchema } from '@/models/Schema';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function getBulkMessageClients(salonId: string, now = new Date(), database: CommunicationIntentDatabase = db, clientIds?: string[]): Promise<BulkMessageClient[]> {
  // Walk backwards from active records to include completed visits on merged
  // profiles. Every step and appointment lookup remains in this salon.
  const result = await database.execute(sql`
    WITH RECURSIVE lineage AS (
      SELECT c.id AS root_id, c.id, c.phone, 0 AS depth
      FROM salon_client c
      WHERE c.salon_id = ${salonId} AND c.archived_at IS NULL AND c.merged_into_client_id IS NULL
        ${clientIds ? sql`AND c.id IN (${sql.join(clientIds.map(id => sql`${id}`), sql`, `)})` : sql``}
      UNION ALL
      SELECT parent.root_id, child.id, child.phone, parent.depth + 1
      FROM salon_client child JOIN lineage parent ON child.merged_into_client_id = parent.id
      WHERE child.salon_id = ${salonId} AND parent.depth < 15
    )
    SELECT c.id, c.full_name, c.phone, c.is_blocked,
      (SELECT max(a.start_time) FROM appointment a
       WHERE a.salon_id = ${salonId} AND a.deleted_at IS NULL AND a.status = 'completed'
         AND a.start_time <= ${now}
         AND (a.salon_client_id IN (SELECT id FROM lineage WHERE root_id = c.id)
           OR (a.salon_client_id IS NULL AND right(regexp_replace(a.client_phone, '[^0-9]', '', 'g'), 10)
             IN (SELECT right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) FROM lineage WHERE root_id = c.id)))
      ) AS last_completed_at,
      EXISTS (SELECT 1 FROM appointment a
        WHERE a.salon_id = ${salonId} AND a.deleted_at IS NULL AND a.end_time > ${now}
          AND a.status IN ('pending', 'confirmed', 'in_progress', 'awaiting_payment')
          AND (a.status <> 'awaiting_payment' OR a.deposit_hold_expires_at > ${now})
          AND (a.salon_client_id IN (SELECT id FROM lineage WHERE root_id = c.id)
            OR right(regexp_replace(a.client_phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10))
      ) AS has_upcoming
    FROM salon_client c
    WHERE c.salon_id = ${salonId} AND c.archived_at IS NULL AND c.merged_into_client_id IS NULL
      ${clientIds ? sql`AND c.id IN (${sql.join(clientIds.map(id => sql`${id}`), sql`, `)})` : sql``}
    ORDER BY lower(COALESCE(c.full_name, '')), c.id
  `);
  const rows = result.rows as Array<{ id: string; full_name: string | null; phone: string; is_blocked: boolean | null; last_completed_at: Date | string | null; has_upcoming: boolean }>;
  const eligibility = await getClientSmsPurposeEligibilityBatch({ salonId, phones: rows.map(row => row.phone), purpose: 'salon_promotions', database });
  return rows.map((row) => {
    const phone = normalizeConsentRecipient(row.phone);
    const unavailableReason = row.is_blocked
      ? 'Blocked client'
      : !isValidPhone(phone)
          ? 'No valid mobile number'
          : !eligibility.get(phone) ? 'Promotional texts unavailable or opted out' : null;
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
      hasUpcomingAppointment: row.has_upcoming,
      eligible: unavailableReason === null,
      unavailableReason,
    };
  });
}

async function prepare(salonId: string, input: BulkMessageDraft, now: Date, database: CommunicationIntentDatabase): Promise<BulkMessagePreview> {
  const [salon] = await database.select().from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
  if (!salon?.isActive || salon.deletedAt) {
    throw new ClientMessagingError('SALON_UNAVAILABLE', 'This salon is unavailable.', 404);
  }
  const clients = await getBulkMessageClients(salonId, now, database, input.clientIds);
  const timeZone = salon.settings?.booking?.timezone || DEFAULT_BOOKING_TIME_ZONE;
  const phones = new Set<string>();
  const recipients = clients.filter((client) => {
    const phone = normalizeConsentRecipient(client.phone);
    if (!client.eligible || !matchesBulkMessageFilter(client, input.filter, now, timeZone) || phones.has(phone)) {
      return false;
    }
    phones.add(phone);
    return true;
  }).map(({ id, fullName, phone }) => ({ id, fullName, phone }));
  const { finalBody: body, segmentation } = prepareSmsBody(COMMUNICATION_TEMPLATES.client_manual_text!.render({ salonName: salon.name, message: input.message }));
  if (segmentation.segments > 10) {
    throw new ClientMessagingError('MESSAGE_TOO_LONG', 'Shorten this message before sending. It uses more than 10 credits per client.');
  }
  return {
    fingerprint: hash({ body, recipients, filter: input.filter }),
    body,
    recipients,
    skipped: input.clientIds.length - recipients.length,
    creditsPerText: segmentation.segments,
    totalCredits: segmentation.segments * recipients.length,
  };
}

export async function previewBulkClientMessage(salonId: string, input: BulkMessageDraft, now = new Date()) {
  return prepare(salonId, input, now, db);
}

async function readBatch(salonId: string, requestId: string, database: CommunicationIntentDatabase) {
  return database.select({ intent: communicationIntentSchema, delivery: notificationDeliverySchema })
    .from(communicationIntentSchema)
    .leftJoin(notificationDeliverySchema, and(eq(notificationDeliverySchema.id, communicationIntentSchema.deliveryId), eq(notificationDeliverySchema.salonId, salonId)))
    .where(and(eq(communicationIntentSchema.salonId, salonId), eq(communicationIntentSchema.eventType, 'manual_text'), sql`${communicationIntentSchema.variables}->>'bulkRequestId' = ${requestId}`))
    .orderBy(asc(communicationIntentSchema.id));
}

function receipt(requestId: string, rows: Awaited<ReturnType<typeof readBatch>>): BulkMessageReceipt {
  return {
    requestId,
    queued: rows.length,
    skipped: Number(rows[0]?.intent.variables.bulkSkipped ?? 0),
    totalCredits: Number(rows[0]?.intent.variables.bulkCredits ?? 0),
    messages: rows.map(({ intent, delivery }) => {
      const history = serializeSmsHistory(intent, delivery);
      return { id: intent.id, clientName: intent.variables.bulkClientName || 'Client', status: history.status, failureReason: history.failureReason };
    }),
  };
}

export async function getBulkMessageReceipt(salonId: string, requestId: string) {
  return receipt(requestId, await readBatch(salonId, requestId, db));
}

/** Commit the entire reviewed audience together. Only the existing worker sends. */
export async function queueBulkClientMessage(input: BulkMessageDraft & { salonId: string; requestId: string; previewFingerprint: string; sms: SmsOperationalHealth; now?: Date }) {
  const now = input.now ?? new Date();
  const payloadFingerprint = hash({ clientIds: [...input.clientIds].sort(), message: input.message, filter: input.filter, previewFingerprint: input.previewFingerprint });
  return db.transaction(async (tx) => {
    // Serializes concurrent submissions of one action, including an uncertain
    // HTTP retry. No partial batch can escape this transaction.
    const [salon] = await tx.select().from(salonSchema).where(eq(salonSchema.id, input.salonId)).for('update').limit(1);
    const existing = await readBatch(input.salonId, input.requestId, tx);
    if (existing.length) {
      if (existing.some(row => row.intent.variables.bulkFingerprint !== payloadFingerprint)) {
        throw new ClientMessagingError('IDEMPOTENCY_CONFLICT', 'This send was already used for another audience or message. Start a new message.', 409);
      }
      return receipt(input.requestId, existing);
    }
    if (!salon?.isActive || salon.deletedAt) {
      throw new ClientMessagingError('SALON_UNAVAILABLE', 'This salon is unavailable.', 404);
    }
    if (!input.sms.manualAvailable) {
      throw new ClientMessagingError(input.sms.blockingReason || 'SMS_UNAVAILABLE', input.sms.detail, 409);
    }
    const locked = await tx.select({ id: salonClientSchema.id }).from(salonClientSchema)
      .where(and(eq(salonClientSchema.salonId, input.salonId), inArray(salonClientSchema.id, input.clientIds)))
      .orderBy(asc(salonClientSchema.id)).for('update');
    if (locked.length !== input.clientIds.length) {
      throw new ClientMessagingError('CLIENT_NOT_FOUND', 'A selected client is unavailable in this salon. Review the audience again.', 404);
    }
    const preview = await prepare(input.salonId, input, now, tx);
    if (preview.fingerprint !== input.previewFingerprint) {
      throw new ClientMessagingError('AUDIENCE_CHANGED', 'The audience or message changed. Review it again before sending.', 409);
    }
    if (!preview.recipients.length) {
      throw new ClientMessagingError('NO_RECIPIENTS', 'Choose at least one client eligible for promotional texts.', 409);
    }
    if (input.sms.availableCredits !== null && input.sms.availableCredits < preview.totalCredits) {
      throw new ClientMessagingError('INSUFFICIENT_CREDITS', `This message needs ${preview.totalCredits} credits. Add credits or choose fewer clients.`, 409);
    }
    const settings = resolveCommunicationSettingsFromSettings(salon.settings);
    const timeZone = salon.settings?.booking?.timezone || DEFAULT_BOOKING_TIME_ZONE;
    // Bulk messages may be paced by the existing per-salon delivery limits.
    const notAfter = new Date(now.getTime() + 7 * 86400000);
    const quiet = applyQuietHours({ instant: now, quietHours: settings.quietHours, timeZone, notAfter });
    if (quiet.kind === 'stale') {
      throw new ClientMessagingError('QUIET_HOURS_STALE', 'Quiet hours leave no sending window for this message.');
    }
    const schedulingRevision = computeSchedulingRevision({ timeZone, quietHours: settings.quietHours, appointmentStart: null, appointmentUpdatedAt: null, smsEnabled: settings.sms.enabled, emailEnabled: settings.email.enabled });
    await tx.insert(communicationIntentSchema).values(preview.recipients.map(client => ({
      id: `ci_${crypto.randomUUID()}`,
      salonId: input.salonId,
      channel: 'sms' as const,
      eventType: 'manual_text' as const,
      audience: 'client' as const,
      dedupeKey: `bulk:${input.salonId}:${input.requestId}:${normalizeConsentRecipient(client.phone)}`,
      recipient: normalizeConsentRecipient(client.phone),
      destinationCountry: 'CA',
      templateKey: 'client_manual_text',
      templateVersion: 'v1',
      variables: {
        clientId: client.id,
        message: input.message,
        bulkRequestId: input.requestId,
        bulkFingerprint: payloadFingerprint,
        bulkClientName: client.fullName || 'Client',
        bulkCredits: String(preview.totalCredits),
        bulkSkipped: String(preview.skipped),
        bulkMinWeeks: input.filter.minWeeks === null ? '' : String(input.filter.minWeeks),
        bulkExcludeUpcoming: String(input.filter.excludeUpcoming),
      },
      schedulingRevision,
      scheduledFor: quiet.sendAt,
      availableAt: quiet.sendAt,
      notAfter,
    })));
    return receipt(input.requestId, await readBatch(input.salonId, input.requestId, tx));
  });
}

/** The final worker check also respects blocks and bookings made while queued. */
export async function bulkMessageRecipientStillEligible(input: { salonId: string; clientId: string; recipient: string; minWeeks: string; excludeUpcoming: string }, now = new Date()) {
  const [client] = await getBulkMessageClients(input.salonId, now, db, [input.clientId]);
  const [salon] = await db.select({ settings: salonSchema.settings }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).limit(1);
  const minWeeks = input.minWeeks === '' ? null : Number(input.minWeeks);
  if (minWeeks !== null && (!Number.isInteger(minWeeks) || minWeeks < 1 || minWeeks > 104)) {
    return false;
  }
  return Boolean(client?.eligible && normalizeConsentRecipient(client.phone) === normalizeConsentRecipient(input.recipient)
    && matchesBulkMessageFilter(client, { minWeeks, excludeUpcoming: input.excludeUpcoming !== 'false' }, now, salon?.settings?.booking?.timezone || DEFAULT_BOOKING_TIME_ZONE));
}
