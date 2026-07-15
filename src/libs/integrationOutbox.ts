import { and, asc, eq, inArray, lte } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  deleteGoogleCalendarEventForAppointment,
  type GoogleCalendarAppointmentEventInput,
  syncGoogleCalendarEventForAppointment,
} from '@/libs/googleCalendar';
import { appointmentSchema, integrationOutboxSchema, salonSchema } from '@/models/Schema';

type SerializedGoogleEvent = Omit<GoogleCalendarAppointmentEventInput, 'startTime' | 'endTime'> & {
  startTime: string;
  endTime: string;
};

export async function enqueueGoogleCalendarUpsert(input: GoogleCalendarAppointmentEventInput) {
  const dedupeKey = `google:${input.appointmentId}:upsert:${input.startTime.toISOString()}`;
  await db.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    provider: 'google_calendar',
    operation: 'upsert_event',
    dedupeKey,
    payload: { ...input, startTime: input.startTime.toISOString(), endTime: input.endTime.toISOString() },
  }).onConflictDoNothing();
  await db.update(appointmentSchema).set({ googleCalendarSyncStatus: 'pending', googleCalendarSyncError: null }).where(and(eq(appointmentSchema.id, input.appointmentId), eq(appointmentSchema.salonId, input.salonId)));
}

export async function enqueueGoogleCalendarDelete(input: { appointmentId: string; salonId: string; googleCalendarEventId?: string | null }) {
  await db.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    provider: 'google_calendar',
    operation: 'delete_event',
    dedupeKey: `google:${input.appointmentId}:delete:${input.googleCalendarEventId || 'none'}`,
    payload: { googleCalendarEventId: input.googleCalendarEventId || null },
  }).onConflictDoNothing();
}

export async function processIntegrationOutbox(limit = 50) {
  const jobs = await db.select().from(integrationOutboxSchema).where(and(
    eq(integrationOutboxSchema.provider, 'google_calendar'),
    inArray(integrationOutboxSchema.status, ['pending', 'retry']),
    lte(integrationOutboxSchema.availableAt, new Date()),
  )).orderBy(asc(integrationOutboxSchema.createdAt)).limit(limit);
  const summary = { scanned: jobs.length, succeeded: 0, retried: 0, failed: 0 };
  for (const job of jobs) {
    const claimed = await db.update(integrationOutboxSchema).set({ status: 'processing', attempts: job.attempts + 1 }).where(and(
      eq(integrationOutboxSchema.id, job.id),
      eq(integrationOutboxSchema.salonId, job.salonId),
      inArray(integrationOutboxSchema.status, ['pending', 'retry']),
    )).returning();
    if (!claimed.length) {
      continue;
    }
    try {
      let result;
      if (job.operation === 'delete_event') {
        const payload = job.payload as { googleCalendarEventId?: string | null };
        result = await deleteGoogleCalendarEventForAppointment({ appointmentId: job.appointmentId!, salonId: job.salonId, googleCalendarEventId: payload.googleCalendarEventId });
      } else {
        const payload = job.payload as SerializedGoogleEvent;
        const [appointment] = await db.select({ googleCalendarEventId: appointmentSchema.googleCalendarEventId }).from(appointmentSchema).where(and(eq(appointmentSchema.id, job.appointmentId!), eq(appointmentSchema.salonId, job.salonId))).limit(1);
        result = await syncGoogleCalendarEventForAppointment({ ...payload, startTime: new Date(payload.startTime), endTime: new Date(payload.endTime), googleCalendarEventId: appointment?.googleCalendarEventId || payload.googleCalendarEventId });
      }
      if (result.status === 'failed') {
        throw new Error(result.error);
      }
      await db.update(integrationOutboxSchema).set({ status: 'completed', processedAt: new Date(), lastError: null }).where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
      ));
      summary.succeeded += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const final = attempts >= 8;
      await db.update(integrationOutboxSchema).set({
        status: final ? 'failed' : 'retry',
        lastError: error instanceof Error ? error.message : String(error),
        availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
      }).where(and(
        eq(integrationOutboxSchema.id, job.id),
        eq(integrationOutboxSchema.salonId, job.salonId),
      ));
      if (final) {
        summary.failed += 1;
        const [salon] = await db
          .select({ name: salonSchema.name, ownerEmail: salonSchema.ownerEmail, email: salonSchema.email })
          .from(salonSchema)
          .where(eq(salonSchema.id, job.salonId))
          .limit(1);
        const recipient = salon?.ownerEmail || salon?.email;
        if (recipient) {
          const { sendTransactionalEmail } = await import('@/libs/email');
          const text = `Google Calendar could not sync an appointment after several retries. The booking is still safe in Luster. Reconnect Calendar from the Luster area or contact support.\n\nAppointment: ${job.appointmentId || 'unknown'}\nError: ${error instanceof Error ? error.message : String(error)}`;
          await sendTransactionalEmail({
            to: recipient,
            subject: `${salon?.name || 'Your salon'} Google Calendar needs attention`,
            text,
            html: `<p>Google Calendar could not sync an appointment after several retries. The booking is still safe in Luster.</p><p>Reconnect Calendar from the Luster area or contact support.</p>`,
          }).catch(() => false);
        }
      } else {
        summary.retried += 1;
      }
    }
  }
  return summary;
}
