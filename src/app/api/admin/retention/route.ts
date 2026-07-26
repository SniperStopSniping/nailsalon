import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import {
  buildActiveTerminalSalonClientMap,
  ClientLifecycleStabilizationError,
  getSalonClientLineageIdsWithHandle,
  getSalonClientPhoneAliasesWithHandle,
  lockTerminalSalonClientWithHandle,
  resolveTerminalSalonClient,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { normalizePhone } from '@/libs/phone';
import {
  buildAppointmentReminderQueue,
  buildCommunicationStatusTimestamps,
  buildRetentionQueue,
  canTransitionCommunicationStatus,
  communicationMutationSchema,
  type CommunicationSnapshot,
  normalizeRetentionPhone,
  type RetentionAppointmentSnapshot,
  type RetentionClientSnapshot,
  sanitizeCommunicationMessageSnapshot,
} from '@/libs/retentionAssistant';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import {
  appointmentSchema,
  clientCommunicationSchema,
  salonClientContactAliasSchema,
  salonClientSchema,
} from '@/models/Schema';
import type { ClientCommunicationKind, ClientCommunicationStatus, RetentionStage } from '@/types/retention';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200).optional(),
});

const RETENTION_KINDS: ClientCommunicationKind[] = ['rebook', 'promo_6w', 'promo_8w'];
const ACTIVE_RETENTION_STATUSES: ClientCommunicationStatus[] = ['prepared', 'snoozed'];

type CommunicationRow = typeof clientCommunicationSchema.$inferSelect;

function serializeCommunication(
  row: CommunicationRow,
  clientId = row.salonClientId,
) {
  return {
    id: row.id,
    clientId,
    appointmentId: row.appointmentId,
    kind: row.kind,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    messageSnapshot: row.messageSnapshot,
    metadata: row.metadata ?? {},
    preparedAt: row.preparedAt?.toISOString() ?? null,
    markedSentAt: row.markedSentAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCommunicationSnapshots(rows: CommunicationRow[]): CommunicationSnapshot[] {
  return rows.map(row => ({
    id: row.id,
    salonClientId: row.salonClientId,
    appointmentId: row.appointmentId,
    kind: row.kind as ClientCommunicationKind,
    status: row.status as ClientCommunicationStatus,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
  }));
}

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid retention query.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }

  let historyTerminalClientId: string | null = null;
  let historyLineageClientIds = new Set<string>();
  if (parsed.data.clientId) {
    try {
      const terminal = await resolveTerminalSalonClient({
        salonId: salon.id,
        clientId: parsed.data.clientId,
        allowArchived: true,
      });
      const lineageIds = await getSalonClientLineageIdsWithHandle(db, {
        salonId: salon.id,
        terminalClientId: terminal.id,
      });
      historyTerminalClientId = terminal.id;
      historyLineageClientIds = new Set(lineageIds);
    } catch (historyError) {
      if (!(historyError instanceof ClientLifecycleStabilizationError)) {
        throw historyError;
      }
      return Response.json({ error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found.' } }, { status: 404 });
    }
  }

  const now = new Date();
  const [
    settings,
    clientRows,
    aliasRows,
    appointmentRows,
    communicationRows,
    historyCommunicationRows,
  ] = await Promise.all([
    getRetentionSettingsForSalon(salon.id),
    db
      .select({
        id: salonClientSchema.id,
        fullName: salonClientSchema.fullName,
        phone: salonClientSchema.phone,
        lastVisitAt: salonClientSchema.lastVisitAt,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
        isBlocked: salonClientSchema.isBlocked,
        archivedAt: salonClientSchema.archivedAt,
        mergedIntoClientId: salonClientSchema.mergedIntoClientId,
      })
      .from(salonClientSchema)
      .where(eq(salonClientSchema.salonId, salon.id))
      .limit(5000),
    db
      .select({
        salonClientId: salonClientContactAliasSchema.salonClientId,
        kind: salonClientContactAliasSchema.kind,
        normalizedValue: salonClientContactAliasSchema.normalizedValue,
      })
      .from(salonClientContactAliasSchema)
      .where(eq(salonClientContactAliasSchema.salonId, salon.id)),
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
        // Future pending/confirmed bookings, plus any in_progress visit
        // (even one started early or running past its slot) — all of these
        // must suppress retention outreach for the client.
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
      .select()
      .from(clientCommunicationSchema)
      .where(eq(clientCommunicationSchema.salonId, salon.id))
      .orderBy(desc(clientCommunicationSchema.createdAt))
      .limit(10000),
    historyTerminalClientId
      ? db
        .select()
        .from(clientCommunicationSchema)
        .where(and(
          eq(clientCommunicationSchema.salonId, salon.id),
          inArray(
            clientCommunicationSchema.salonClientId,
            [...historyLineageClientIds],
          ),
        ))
        .orderBy(desc(clientCommunicationSchema.createdAt))
        .limit(100)
      : Promise.resolve([] as CommunicationRow[]),
  ]);

  const terminalBySource = buildActiveTerminalSalonClientMap(
    clientRows.map(client => ({
      id: client.id,
      archivedAt: client.archivedAt,
      mergedIntoClientId: client.mergedIntoClientId,
    })),
  );
  const activeClientRows = clientRows.filter(
    client => terminalBySource.get(client.id) === client.id,
  );
  const activeClientById = new Map(
    activeClientRows.map(client => [client.id, client]),
  );
  const terminalIdsByPhone = new Map<string, Set<string>>();
  const addPhoneIdentity = (value: string, terminalClientId: string) => {
    const normalizedPhone = normalizePhone(value);
    if (normalizedPhone.length !== 10) {
      return;
    }
    const terminalIds = terminalIdsByPhone.get(normalizedPhone)
      ?? new Set<string>();
    terminalIds.add(terminalClientId);
    terminalIdsByPhone.set(normalizedPhone, terminalIds);
  };
  for (const client of clientRows) {
    const terminalClientId = terminalBySource.get(client.id);
    if (terminalClientId) {
      addPhoneIdentity(client.phone, terminalClientId);
    }
  }
  for (const alias of aliasRows) {
    if (alias.kind !== 'phone') {
      continue;
    }
    const terminalClientId = terminalBySource.get(alias.salonClientId);
    if (terminalClientId) {
      addPhoneIdentity(alias.normalizedValue, terminalClientId);
    }
  }
  const uniqueTerminalByPhone = new Map<string, string>();
  for (const [normalizedPhone, terminalIds] of terminalIdsByPhone) {
    if (terminalIds.size === 1) {
      uniqueTerminalByPhone.set(normalizedPhone, [...terminalIds][0]!);
    }
  }
  const resolveAppointmentClientId = (appointment: {
    salonClientId: string | null;
    clientPhone: string;
  }): string | null => {
    if (appointment.salonClientId !== null) {
      return terminalBySource.get(appointment.salonClientId) ?? null;
    }
    return uniqueTerminalByPhone.get(normalizePhone(
      appointment.clientPhone,
    )) ?? null;
  };

  const clients: RetentionClientSnapshot[] = activeClientRows;
  const appointments: RetentionAppointmentSnapshot[] = appointmentRows.flatMap(
    (appointment) => {
      const terminalClientId = resolveAppointmentClientId(appointment);
      const terminalClient = terminalClientId
        ? activeClientById.get(terminalClientId)
        : null;
      return terminalClientId && terminalClient
        ? [{
            id: appointment.id,
            salonClientId: terminalClientId,
            clientName: appointment.clientName,
            // This is an operational destination only. The stored appointment
            // snapshot remains unchanged.
            clientPhone: terminalClient.phone,
            startTime: appointment.startTime,
            endTime: appointment.endTime,
            status: appointment.status,
            reminderSentAt:
              appointment.sameDayReminderSentAt
              ?? appointment.dayBeforeReminderSentAt,
          }]
        : [];
    },
  );
  const communications = toCommunicationSnapshots(communicationRows)
    .flatMap((communication) => {
      const terminalClientId = terminalBySource.get(
        communication.salonClientId,
      );
      return terminalClientId
        ? [{ ...communication, salonClientId: terminalClientId }]
        : [];
    });

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

  const history = historyTerminalClientId
    ? historyCommunicationRows.map(row =>
      serializeCommunication(row, historyTerminalClientId))
    : [];

  return Response.json({
    data: {
      retention: retention.map(item => ({
        ...item,
        dueAt: item.dueAt.toISOString(),
        lastVisitAt: item.lastVisitAt.toISOString(),
      })),
      appointmentReminders: appointmentReminders.map(item => ({
        ...item,
        startTime: item.startTime.toISOString(),
        endTime: item.endTime.toISOString(),
        dueAt: item.dueAt.toISOString(),
      })),
      history,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_JSON', message: 'A JSON request body is required.' } }, { status: 400 });
  }

  const parsed = communicationMutationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid communication update.', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }
  const admin = await getAdminSession();
  if (!admin) {
    return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } }, { status: 401 });
  }

  const now = new Date();
  const safeMessageSnapshot = sanitizeCommunicationMessageSnapshot(parsed.data.messageSnapshot);
  const settings = await getRetentionSettingsForSalon(salon.id);
  const communicationId = `comm_${crypto.randomUUID()}`;
  let result:
    | { ok: true; communication: CommunicationRow | undefined }
    | { ok: false; response: Response };

  try {
    result = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const terminal = await lockTerminalSalonClientWithHandle(tx, {
          salonId: salon.id,
          clientId: parsed.data.clientId,
        });
        const [client] = await tx
          .select({
            id: salonClientSchema.id,
            phone: salonClientSchema.phone,
            lastVisitAt: salonClientSchema.lastVisitAt,
          })
          .from(salonClientSchema)
          .where(and(
            eq(salonClientSchema.id, terminal.id),
            eq(salonClientSchema.salonId, salon.id),
          ))
          .limit(1);
        if (!client) {
          return {
            ok: false as const,
            response: Response.json(
              { error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found.' } },
              { status: 404 },
            ),
          };
        }
        const lineageIds = await getSalonClientLineageIdsWithHandle(tx, {
          salonId: salon.id,
          terminalClientId: terminal.id,
        });
        const aliasPhones = await getSalonClientPhoneAliasesWithHandle(tx, {
          salonId: salon.id,
          clientIds: lineageIds,
        });
        const ownedPhones = new Set(
          [client.phone, ...aliasPhones]
            .map(normalizeRetentionPhone)
            .filter(Boolean),
        );

        let appointment: {
          id: string;
          startTime: Date;
          salonClientId: string | null;
          clientPhone: string;
        } | null = null;
        if (parsed.data.appointmentId) {
          const appointmentRows = await tx
            .select({
              id: appointmentSchema.id,
              startTime: appointmentSchema.startTime,
              salonClientId: appointmentSchema.salonClientId,
              clientPhone: appointmentSchema.clientPhone,
            })
            .from(appointmentSchema)
            .where(and(
              eq(appointmentSchema.id, parsed.data.appointmentId),
              eq(appointmentSchema.salonId, salon.id),
              isNull(appointmentSchema.deletedAt),
            ))
            .limit(1);
          appointment = appointmentRows[0] ?? null;
          const belongsToClient = appointment && (
            (
              appointment.salonClientId !== null
              && lineageIds.includes(appointment.salonClientId)
            )
            || (
              appointment.salonClientId === null
              && ownedPhones.has(normalizeRetentionPhone(appointment.clientPhone))
            )
          );
          if (!appointment || !belongsToClient) {
            return {
              ok: false as const,
              response: Response.json(
                { error: { code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found for this client.' } },
                { status: 404 },
              ),
            };
          }
        }

        const dueAt = parsed.data.kind === 'reminder' && appointment
          ? new Date(appointment.startTime.getTime() - settings.reminderLeadHours * 3_600_000)
          : client.lastVisitAt && RETENTION_KINDS.includes(parsed.data.kind)
            ? new Date(client.lastVisitAt.getTime() + (
              parsed.data.kind === 'promo_8w'
                ? 56
                : parsed.data.kind === 'promo_6w'
                  ? 42
                  : settings.defaultRebookDays
            ) * 86_400_000)
            : null;

        const [latest] = await tx
          .select()
          .from(clientCommunicationSchema)
          .where(and(
            eq(clientCommunicationSchema.salonId, salon.id),
            eq(clientCommunicationSchema.salonClientId, terminal.id),
            eq(clientCommunicationSchema.kind, parsed.data.kind),
            parsed.data.appointmentId
              ? eq(clientCommunicationSchema.appointmentId, parsed.data.appointmentId)
              : isNull(clientCommunicationSchema.appointmentId),
          ))
          .orderBy(desc(clientCommunicationSchema.createdAt))
          .limit(1);

        // A manually completed follow-up after a not-sent or expired snooze is a
        // new outcome, not a rewrite of the earlier honest state. Other existing
        // consumers retain the shared transition rules unchanged.
        const shouldCreateConvertedOutcome = Boolean(
          latest
          && parsed.data.status === 'converted'
          && ['not_sent', 'snoozed'].includes(latest.status),
        );
        const shouldUpdateLatest = Boolean(latest && !shouldCreateConvertedOutcome && (
          ['prepared', 'not_sent', 'snoozed'].includes(latest.status)
          || (latest.status === 'marked_sent' && parsed.data.status === 'converted')
          || latest.status === parsed.data.status
        ));

        if (
          shouldUpdateLatest
          && latest
          && !canTransitionCommunicationStatus(
            latest.status as ClientCommunicationStatus,
            parsed.data.status,
          )
        ) {
          return {
            ok: false as const,
            response: Response.json({
              error: {
                code: 'INVALID_STATUS_TRANSITION',
                message: `Cannot change communication from ${latest.status} to ${parsed.data.status}.`,
              },
            }, { status: 409 }),
          };
        }

        const timestamps = buildCommunicationStatusTimestamps(parsed.data.status, now, {
          kind: parsed.data.kind,
          appointmentStartTime: appointment?.startTime,
        });

        if (RETENTION_KINDS.includes(parsed.data.kind)) {
          await tx
            .update(clientCommunicationSchema)
            .set({
              status: 'dismissed',
              dismissedAt: now,
              snoozedUntil: null,
              metadata: {
                reason: 'superseded_by_retention_stage',
                campaignStage: parsed.data.kind as RetentionStage,
              },
              updatedAt: now,
            })
            .where(and(
              eq(clientCommunicationSchema.salonId, salon.id),
              eq(clientCommunicationSchema.salonClientId, terminal.id),
              inArray(clientCommunicationSchema.kind, RETENTION_KINDS),
              inArray(clientCommunicationSchema.status, ACTIVE_RETENTION_STATUSES),
              shouldUpdateLatest && latest
                ? ne(clientCommunicationSchema.id, latest.id)
                : ne(clientCommunicationSchema.kind, parsed.data.kind),
            ));
        }

        let savedCommunication: CommunicationRow | undefined;
        if (shouldUpdateLatest && latest) {
          const [updated] = await tx
            .update(clientCommunicationSchema)
            .set({
              status: parsed.data.status,
              dueAt,
              messageSnapshot: safeMessageSnapshot === undefined
                ? latest.messageSnapshot
                : safeMessageSnapshot,
              ...timestamps,
              updatedAt: now,
            })
            .where(and(
              eq(clientCommunicationSchema.id, latest.id),
              eq(clientCommunicationSchema.salonId, salon.id),
              eq(clientCommunicationSchema.salonClientId, terminal.id),
            ))
            .returning();
          savedCommunication = updated;
        } else {
          const [created] = await tx
            .insert(clientCommunicationSchema)
            .values({
              id: communicationId,
              salonId: salon.id,
              salonClientId: terminal.id,
              appointmentId: appointment?.id ?? null,
              kind: parsed.data.kind,
              status: parsed.data.status,
              dueAt,
              messageSnapshot: safeMessageSnapshot ?? null,
              actorAdminId: admin.id,
              ...timestamps,
            })
            .returning();
          savedCommunication = created;
        }

        if (parsed.data.status === 'marked_sent') {
          await tx
            .update(salonClientSchema)
            .set({ lastContactAt: now, updatedAt: now })
            .where(and(
              eq(salonClientSchema.id, terminal.id),
              eq(salonClientSchema.salonId, salon.id),
            ));
        }

        return { ok: true as const, communication: savedCommunication };
      }),
    );
  } catch (error) {
    if (error instanceof ClientLifecycleStabilizationError) {
      return Response.json(
        { error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found.' } },
        { status: 404 },
      );
    }
    throw error;
  }

  if (!result.ok) {
    return result.response;
  }
  const communication = result.communication;

  if (!communication) {
    return Response.json({ error: { code: 'UPDATE_FAILED', message: 'Communication could not be saved.' } }, { status: 500 });
  }

  return Response.json({ data: { communication: serializeCommunication(communication) } });
}
