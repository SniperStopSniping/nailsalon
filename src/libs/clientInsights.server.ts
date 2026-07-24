import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  buildClientInsightsSnapshot,
  type ClientInsightsSnapshotResult,
} from '@/libs/clientInsights';
import { db } from '@/libs/DB';
import { getCompletedOutstandingRows } from '@/libs/financialReportingServer';
import type { CommunicationSnapshot } from '@/libs/retentionAssistant';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import {
  appointmentSchema,
  clientCommunicationSchema,
  salonClientSchema,
} from '@/models/Schema';
import type { ClientCommunicationKind, ClientCommunicationStatus } from '@/types/retention';

const INSIGHTS_APPOINTMENT_STATUSES: string[] = [
  'completed',
  'cancelled',
  'pending',
  'confirmed',
  'in_progress',
];

const RETENTION_KINDS: ClientCommunicationKind[] = [
  'rebook',
  'promo_6w',
  'promo_8w',
];

export async function getClientInsightsSnapshot(args: {
  salonId: string;
  timeZone: string;
  now?: Date;
}): Promise<ClientInsightsSnapshotResult> {
  const now = args.now ?? new Date();
  const [settings, clients, appointments, communicationRows, outstanding] = await Promise.all([
    getRetentionSettingsForSalon(args.salonId),
    db
      .select({
        id: salonClientSchema.id,
        fullName: salonClientSchema.fullName,
        phone: salonClientSchema.phone,
        email: salonClientSchema.email,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
        isBlocked: salonClientSchema.isBlocked,
      })
      .from(salonClientSchema)
      .where(eq(salonClientSchema.salonId, args.salonId)),
    db
      .select({
        id: appointmentSchema.id,
        salonClientId: appointmentSchema.salonClientId,
        clientName: appointmentSchema.clientName,
        clientPhone: appointmentSchema.clientPhone,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        updatedAt: appointmentSchema.updatedAt,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, args.salonId),
        isNull(appointmentSchema.deletedAt),
        inArray(appointmentSchema.status, INSIGHTS_APPOINTMENT_STATUSES),
      )),
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
      .where(and(
        eq(clientCommunicationSchema.salonId, args.salonId),
        inArray(clientCommunicationSchema.kind, RETENTION_KINDS),
      )),
    getCompletedOutstandingRows({
      salonId: args.salonId,
      asOf: now,
    }),
  ]);

  const communications: CommunicationSnapshot[] = communicationRows.map(row => ({
    id: row.id,
    salonClientId: row.salonClientId,
    appointmentId: row.appointmentId,
    kind: row.kind as ClientCommunicationKind,
    status: row.status as ClientCommunicationStatus,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
  }));

  return buildClientInsightsSnapshot({
    clients,
    appointments,
    communications,
    outstanding,
    defaultRebookDays: settings.defaultRebookDays,
    timeZone: args.timeZone,
    now,
  });
}
