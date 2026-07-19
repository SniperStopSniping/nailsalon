import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  buildAppointmentReminderQueue,
  buildRetentionQueue,
  type CommunicationSnapshot,
  normalizeRetentionPhone,
  type RetentionAppointmentSnapshot,
  type RetentionClientSnapshot,
} from '@/libs/retentionAssistant';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import { revenueCentsSql } from '@/libs/revenueSql';
import {
  appointmentSchema,
  appointmentServicesSchema,
  clientCommunicationSchema,
  communicationConsentSchema,
  notificationDeliverySchema,
  retentionCampaignRedemptionSchema,
  retentionCampaignSchema,
  salonClientSchema,
} from '@/models/Schema';
import type { ClientCommunicationKind, ClientCommunicationStatus } from '@/types/retention';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/admin/marketing — the Marketing workspace's data in one request.
// =============================================================================
// Follow-up groups reuse the SAME live retention/reminder engine as the Today
// workspace (no second computation path), enriched with the last completed
// service and transactional-SMS consent visibility. Results report ONLY
// measurable facts: the manual outreach ledger (client_communication), minted/
// redeemed win-back campaigns joined to their booked appointments (final
// completed revenue via revenueCentsSql — tax reported separately, never as
// revenue), and automatic transactional deliveries (notification_delivery).
// Nothing here estimates link clicks or manual delivery — those are not
// measurable and are deliberately absent.
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
});

const RESULTS_WINDOW_DAYS = 30;

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid marketing query.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - RESULTS_WINDOW_DAYS * 86_400_000);

  const [settings, clientRows, appointmentRows, communicationRows] = await Promise.all([
    getRetentionSettingsForSalon(salon.id),
    db
      .select({
        id: salonClientSchema.id,
        fullName: salonClientSchema.fullName,
        phone: salonClientSchema.phone,
        lastVisitAt: salonClientSchema.lastVisitAt,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
        isBlocked: salonClientSchema.isBlocked,
      })
      .from(salonClientSchema)
      .where(eq(salonClientSchema.salonId, salon.id))
      .limit(5000),
    db
      .select({
        id: appointmentSchema.id,
        salonClientId: appointmentSchema.salonClientId,
        clientName: appointmentSchema.clientName,
        clientPhone: appointmentSchema.clientPhone,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        dayBeforeReminderSentAt: appointmentSchema.dayBeforeReminderSentAt,
        sameDayReminderSentAt: appointmentSchema.sameDayReminderSentAt,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        isNull(appointmentSchema.deletedAt),
        or(
          and(
            gt(appointmentSchema.startTime, now),
            inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress']),
          ),
          eq(appointmentSchema.status, 'in_progress'),
        ),
      ))
      .limit(5000),
    db
      .select({
        id: clientCommunicationSchema.id,
        salonClientId: clientCommunicationSchema.salonClientId,
        appointmentId: clientCommunicationSchema.appointmentId,
        kind: clientCommunicationSchema.kind,
        status: clientCommunicationSchema.status,
        snoozedUntil: clientCommunicationSchema.snoozedUntil,
        createdAt: clientCommunicationSchema.createdAt,
      })
      .from(clientCommunicationSchema)
      .where(eq(clientCommunicationSchema.salonId, salon.id))
      .orderBy(desc(clientCommunicationSchema.createdAt))
      .limit(10000),
  ]);

  const clients: RetentionClientSnapshot[] = clientRows;
  const appointments: RetentionAppointmentSnapshot[] = appointmentRows.map(appointment => ({
    id: appointment.id,
    salonClientId: appointment.salonClientId,
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    reminderSentAt: appointment.sameDayReminderSentAt ?? appointment.dayBeforeReminderSentAt,
  }));
  const communications: CommunicationSnapshot[] = communicationRows.map(row => ({
    id: row.id,
    salonClientId: row.salonClientId,
    appointmentId: row.appointmentId,
    kind: row.kind as ClientCommunicationKind,
    status: row.status as ClientCommunicationStatus,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
  }));

  // The ONE follow-up computation path (same engine as the Today workspace).
  const retention = buildRetentionQueue({
    clients,
    futureAppointments: appointments,
    communications,
    defaultRebookDays: settings.defaultRebookDays,
    now,
  });
  const appointmentReminders = buildAppointmentReminderQueue({
    clients,
    appointments,
    communications,
    reminderLeadHours: settings.reminderLeadHours,
    now,
  });

  // ---------------------------------------------------------------------------
  // Enrichment: last completed service + transactional-SMS consent visibility.
  // Consent is DISPLAY ONLY here — the manual composer never requires it, and
  // its presence never turns anything automatic.
  // ---------------------------------------------------------------------------
  const queuedClientIds = [...new Set(retention.map(item => item.clientId))];

  let lastServiceByClient = new Map<string, { name: string; visitedAt: Date }>();
  if (queuedClientIds.length > 0) {
    const lastCompletedRows = await db
      .select({
        salonClientId: appointmentSchema.salonClientId,
        appointmentId: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        serviceName: appointmentServicesSchema.nameSnapshot,
      })
      .from(appointmentSchema)
      .leftJoin(
        appointmentServicesSchema,
        eq(appointmentServicesSchema.appointmentId, appointmentSchema.id),
      )
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        eq(appointmentSchema.status, 'completed'),
        inArray(appointmentSchema.salonClientId, queuedClientIds),
      ))
      .orderBy(desc(appointmentSchema.startTime))
      .limit(2000);

    lastServiceByClient = new Map();
    for (const row of lastCompletedRows) {
      if (!row.salonClientId || lastServiceByClient.has(row.salonClientId)) {
        continue;
      }
      if (row.serviceName) {
        lastServiceByClient.set(row.salonClientId, {
          name: row.serviceName,
          visitedAt: row.startTime,
        });
      }
    }
  }

  const queuedPhones = [...new Set(
    retention
      .map(item => normalizeRetentionPhone(item.phone))
      .filter((phone): phone is string => Boolean(phone)),
  )];
  const consentByPhone = new Map<string, boolean>();
  if (queuedPhones.length > 0) {
    const consentRows = await db
      .select({
        recipient: communicationConsentSchema.recipient,
        status: communicationConsentSchema.status,
        createdAt: communicationConsentSchema.createdAt,
      })
      .from(communicationConsentSchema)
      .where(and(
        eq(communicationConsentSchema.salonId, salon.id),
        eq(communicationConsentSchema.channel, 'sms'),
        eq(communicationConsentSchema.purpose, 'appointment_transactional'),
        inArray(communicationConsentSchema.recipient, queuedPhones),
      ))
      .orderBy(desc(communicationConsentSchema.createdAt));
    for (const row of consentRows) {
      // Rows are newest-first; the first row per recipient is authoritative.
      if (!consentByPhone.has(row.recipient)) {
        consentByPhone.set(row.recipient, row.status === 'granted');
      }
    }
  }

  const followupItem = (item: (typeof retention)[number]) => ({
    clientId: item.clientId,
    clientName: item.clientName,
    phone: item.phone,
    stage: item.stage,
    dueAt: item.dueAt.toISOString(),
    lastVisitAt: item.lastVisitAt.toISOString(),
    lastServiceName: lastServiceByClient.get(item.clientId)?.name ?? null,
    // Queue membership already excludes anyone with an upcoming or in-progress
    // appointment — stated explicitly so the UI can say so honestly.
    hasUpcomingAppointment: false,
    smsConsent: consentByPhone.get(normalizeRetentionPhone(item.phone) ?? '') ?? false,
    channel: 'manual_text' as const,
  });

  // ---------------------------------------------------------------------------
  // Results — measurable facts only.
  // ---------------------------------------------------------------------------
  const [outreachCounts, campaignRows, automaticCounts] = await Promise.all([
    db
      .select({
        kind: clientCommunicationSchema.kind,
        status: clientCommunicationSchema.status,
        count: sql<number>`count(*)::int`,
      })
      .from(clientCommunicationSchema)
      .where(and(
        eq(clientCommunicationSchema.salonId, salon.id),
        gte(clientCommunicationSchema.createdAt, windowStart),
      ))
      .groupBy(clientCommunicationSchema.kind, clientCommunicationSchema.status),
    db
      .select({
        stage: retentionCampaignSchema.stage,
        minted: sql<number>`count(*)::int`,
        redeemed: sql<number>`count(*) FILTER (WHERE ${retentionCampaignSchema.redeemedAt} IS NOT NULL)::int`,
      })
      .from(retentionCampaignSchema)
      .where(eq(retentionCampaignSchema.salonId, salon.id))
      .groupBy(retentionCampaignSchema.stage),
    db
      .select({
        channel: notificationDeliverySchema.channel,
        status: notificationDeliverySchema.status,
        count: sql<number>`count(*)::int`,
      })
      .from(notificationDeliverySchema)
      .where(and(
        eq(notificationDeliverySchema.salonId, salon.id),
        gte(notificationDeliverySchema.createdAt, windowStart),
      ))
      .groupBy(notificationDeliverySchema.channel, notificationDeliverySchema.status),
  ]);

  // Campaign outcomes: redemption rows joined to their appointments. Revenue
  // uses the Phase-3 finalized values (net of tax; comp counts zero); tax is
  // reported separately and NEVER added to revenue.
  const campaignOutcomes = await db
    .select({
      stage: retentionCampaignSchema.stage,
      discountGivenCents: sql<number>`COALESCE(sum(${retentionCampaignRedemptionSchema.discountAmountCents}), 0)::int`,
      completedCount: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'completed')::int`,
      completedRevenueCents: sql<number>`COALESCE(sum(${revenueCentsSql()}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
      completedTaxCents: sql<number>`COALESCE(sum(${appointmentSchema.taxAmountCents}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
    })
    .from(retentionCampaignRedemptionSchema)
    .innerJoin(
      retentionCampaignSchema,
      eq(retentionCampaignSchema.id, retentionCampaignRedemptionSchema.campaignId),
    )
    .innerJoin(
      appointmentSchema,
      eq(appointmentSchema.id, retentionCampaignRedemptionSchema.appointmentId),
    )
    .where(eq(retentionCampaignRedemptionSchema.salonId, salon.id))
    .groupBy(retentionCampaignSchema.stage);

  const outcomesByStage = new Map(campaignOutcomes.map(row => [row.stage, row]));

  return Response.json({
    data: {
      followups: {
        groups: [
          {
            id: 'rebook',
            title: 'Due to return',
            items: retention.filter(item => item.stage === 'rebook').map(followupItem),
          },
          {
            id: 'promo_6w',
            title: 'Win-back — stage 1',
            items: retention.filter(item => item.stage === 'promo_6w').map(followupItem),
          },
          {
            id: 'promo_8w',
            title: 'Win-back — stage 2',
            items: retention.filter(item => item.stage === 'promo_8w').map(followupItem),
          },
        ],
        reminders: appointmentReminders.map(item => ({
          clientId: item.clientId,
          clientName: item.clientName,
          phone: item.phone,
          appointmentId: item.appointmentId,
          startTime: item.startTime.toISOString(),
          dueAt: item.dueAt.toISOString(),
        })),
      },
      results: {
        windowDays: RESULTS_WINDOW_DAYS,
        outreach: outreachCounts,
        campaigns: campaignRows.map(row => ({
          stage: row.stage,
          minted: row.minted,
          redeemed: row.redeemed,
          discountGivenCents: outcomesByStage.get(row.stage)?.discountGivenCents ?? 0,
          completedCount: outcomesByStage.get(row.stage)?.completedCount ?? 0,
          completedRevenueCents: outcomesByStage.get(row.stage)?.completedRevenueCents ?? 0,
          completedTaxCents: outcomesByStage.get(row.stage)?.completedTaxCents ?? 0,
        })),
        automatic: automaticCounts,
      },
    },
  });
}
