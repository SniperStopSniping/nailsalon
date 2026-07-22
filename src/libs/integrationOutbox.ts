import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  deleteGoogleCalendarEventForAppointment,
  type GoogleCalendarAppointmentEventInput,
  syncGoogleCalendarEventForAppointment,
} from '@/libs/googleCalendar';
import type {
  SalonNotificationCancellation,
  SalonNotificationEventKey,
  SalonNotificationPreviousSchedule,
  SalonNotificationSource,
} from '@/libs/salonNotificationEmail';
import {
  appointmentSchema,
  googleCalendarEventSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonGoogleCalendarConnectionSchema,
  salonSchema,
} from '@/models/Schema';

type SerializedGoogleEvent = Omit<
  GoogleCalendarAppointmentEventInput,
  'startTime' | 'endTime'
> & {
  startTime: string;
  endTime: string;
};

function safeJobError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(
      /(authorization|cookie|password|secret|token|code)=([^&\s]+)/gi,
      '$1=[redacted]',
    )
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
}

export async function enqueueGoogleCalendarUpsert(
  input: GoogleCalendarAppointmentEventInput,
  options?: { dedupeSuffix?: string },
) {
  const dedupeKey = `google:${input.appointmentId}:upsert:${input.startTime.toISOString()}${options?.dedupeSuffix ? `:${options.dedupeSuffix}` : ''}`;
  await db
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'google_calendar',
      operation: 'upsert_event',
      dedupeKey,
      payload: {
        ...input,
        startTime: input.startTime.toISOString(),
        endTime: input.endTime.toISOString(),
      },
    })
    .onConflictDoNothing();
  await db
    .update(appointmentSchema)
    .set({ googleCalendarSyncStatus: 'pending', googleCalendarSyncError: null })
    .where(
      and(
        eq(appointmentSchema.id, input.appointmentId),
        eq(appointmentSchema.salonId, input.salonId),
      ),
    );
}

export async function enqueueGoogleCalendarDelete(input: {
  appointmentId: string;
  salonId: string;
  googleCalendarEventId?: string | null;
}) {
  await db
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: `google:${input.appointmentId}:delete:${input.googleCalendarEventId || 'none'}`,
      payload: { googleCalendarEventId: input.googleCalendarEventId || null },
    })
    .onConflictDoNothing();
}

export async function processIntegrationOutbox(limit = 50) {
  // A Vercel invocation can end after a job is claimed but before it is marked
  // complete. Reclaim only jobs that have been abandoned for long enough that
  // another healthy worker cannot still be processing them.
  await db
    .update(integrationOutboxSchema)
    .set({
      status: 'retry',
      availableAt: new Date(),
      lastError: 'WORKER_INTERRUPTED',
    })
    .where(
      and(
        eq(integrationOutboxSchema.status, 'processing'),
        lt(
          integrationOutboxSchema.updatedAt,
          new Date(Date.now() - 15 * 60_000),
        ),
      ),
    );

  const jobs = await db
    .select()
    .from(integrationOutboxSchema)
    .where(
      and(
        inArray(integrationOutboxSchema.provider, ['google_calendar', 'email']),
        inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        lte(integrationOutboxSchema.availableAt, new Date()),
      ),
    )
    .orderBy(asc(integrationOutboxSchema.createdAt))
    .limit(limit);
  const summary = {
    scanned: jobs.length,
    succeeded: 0,
    retried: 0,
    failed: 0,
    cancelledEventCandidates: 0,
    reconciledCancelledEvents: 0,
    skippedCancelledEvents: 0,
    failedCancelledEvents: 0,
  };
  for (const job of jobs) {
    const claimed = await db
      .update(integrationOutboxSchema)
      .set({ status: 'processing', attempts: job.attempts + 1 })
      .where(
        and(
          eq(integrationOutboxSchema.id, job.id),
          eq(integrationOutboxSchema.salonId, job.salonId),
          inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        ),
      )
      .returning();
    if (!claimed.length) {
      continue;
    }
    try {
      let result;
      if (
        job.provider === 'email'
        && job.operation === 'retry_booking_confirmation'
      ) {
        const payload = job.payload as { deliveryId?: string };
        if (!job.appointmentId || !payload.deliveryId) {
          throw new Error('INVALID_BOOKING_EMAIL_RETRY');
        }
        const { retryCustomerBookingConfirmationEmail } = await import(
          '@/libs/customerBookingEmail'
        );
        await retryCustomerBookingConfirmationEmail({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          deliveryId: payload.deliveryId,
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'retry_salon_notification'
      ) {
        const payload = job.payload as {
          deliveryId?: string;
          event?: SalonNotificationEventKey;
          source?: SalonNotificationSource;
          previous?: SalonNotificationPreviousSchedule | null;
          cancellation?: SalonNotificationCancellation | null;
        };
        if (!job.appointmentId || !payload.deliveryId || !payload.event) {
          throw new Error('INVALID_SALON_NOTIFICATION_RETRY');
        }
        const { retrySalonNotificationEmail } = await import(
          '@/libs/salonNotificationEmail'
        );
        await retrySalonNotificationEmail({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          deliveryId: payload.deliveryId,
          event: payload.event,
          source: payload.source ?? 'unknown',
          previous: payload.previous ?? undefined,
          cancellation: payload.cancellation ?? undefined,
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'retry_booking_recovery'
      ) {
        const payload = job.payload as {
          deliveryId?: string;
          appointmentIds?: string[];
        };
        if (!payload.deliveryId || !payload.appointmentIds?.length) {
          throw new Error('INVALID_BOOKING_RECOVERY_RETRY');
        }
        const { retryBookingRecoveryEmail } = await import(
          '@/libs/bookingRecoveryEmail'
        );
        await retryBookingRecoveryEmail({
          salonId: job.salonId,
          deliveryId: payload.deliveryId,
          appointmentIds: payload.appointmentIds,
        });
        result = { status: 'synced' as const };
      } else if (job.operation === 'delete_event') {
        const payload = job.payload as {
          googleCalendarEventId?: string | null;
        };
        result = await deleteGoogleCalendarEventForAppointment({
          appointmentId: job.appointmentId!,
          salonId: job.salonId,
          googleCalendarEventId: payload.googleCalendarEventId,
        });
      } else {
        const payload = job.payload as SerializedGoogleEvent;
        const [appointment] = await db
          .select({
            googleCalendarEventId: appointmentSchema.googleCalendarEventId,
            status: appointmentSchema.status,
            deletedAt: appointmentSchema.deletedAt,
          })
          .from(appointmentSchema)
          .where(
            and(
              eq(appointmentSchema.id, job.appointmentId!),
              eq(appointmentSchema.salonId, job.salonId),
            ),
          )
          .limit(1);
        if (
          !appointment
          || appointment.deletedAt
          || appointment.status === 'cancelled'
          || appointment.status === 'no_show'
        ) {
          result = await deleteGoogleCalendarEventForAppointment({
            appointmentId: job.appointmentId!,
            salonId: job.salonId,
            googleCalendarEventId:
              appointment?.googleCalendarEventId || payload.googleCalendarEventId,
          });
        } else {
          result = await syncGoogleCalendarEventForAppointment({
            ...payload,
            startTime: new Date(payload.startTime),
            endTime: new Date(payload.endTime),
            googleCalendarEventId:
              appointment.googleCalendarEventId || payload.googleCalendarEventId,
          });
        }
      }
      if (result.status === 'failed') {
        throw new Error(result.error);
      }
      await db
        .update(integrationOutboxSchema)
        .set({ status: 'completed', processedAt: new Date(), lastError: null })
        .where(
          and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
          ),
        );
      summary.succeeded += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const final = attempts >= 8;
      await db
        .update(integrationOutboxSchema)
        .set({
          status: final ? 'failed' : 'retry',
          lastError: safeJobError(error),
          availableAt: new Date(
            Date.now() + Math.min(60, 2 ** attempts) * 60_000,
          ),
        })
        .where(
          and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
          ),
        );
      if (final) {
        summary.failed += 1;
        if (job.provider === 'email') {
          const deliveryId = (job.payload as { deliveryId?: string })
            .deliveryId;
          if (deliveryId) {
            await db
              .update(notificationDeliverySchema)
              .set({ retryable: false })
              .where(
                and(
                  eq(notificationDeliverySchema.id, deliveryId),
                  eq(notificationDeliverySchema.salonId, job.salonId),
                ),
              );
          }
        }
        const [salon] = await db
          .select({
            name: salonSchema.name,
            ownerEmail: salonSchema.ownerEmail,
            email: salonSchema.email,
          })
          .from(salonSchema)
          .where(eq(salonSchema.id, job.salonId))
          .limit(1);
        const recipient = salon?.ownerEmail || salon?.email;
        if (recipient) {
          const { sendTransactionalEmail } = await import('@/libs/email');
          const isEmail = job.provider === 'email';
          const isSalonNotification
            = job.operation === 'retry_salon_notification';
          const notice = isSalonNotification
            ? {
                subject: `${salon?.name || 'Your salon'} appointment alerts need attention`,
                text: `Luster could not deliver a salon appointment alert after several retries. The appointment itself is unaffected and still safe in Luster. Check the notification email address in Settings → Notifications.\n\nAppointment: ${job.appointmentId || 'unknown'}`,
                html: `<p>Luster could not deliver a salon appointment alert after several retries. The appointment itself is unaffected and still safe in Luster.</p><p>Check the notification email address in Settings &rarr; Notifications.</p>`,
              }
            : isEmail
              ? {
                  subject: `${salon?.name || 'Your salon'} client email needs attention`,
                  text: `Luster could not deliver a client booking confirmation after several retries. The appointment is still safe in Luster. Open the appointment to verify the email address and resend the confirmation.\n\nAppointment: ${job.appointmentId || 'unknown'}`,
                  html: `<p>Luster could not deliver a client booking confirmation after several retries. The appointment is still safe.</p><p>Open the appointment, verify the email address, and resend the confirmation.</p>`,
                }
              : {
                  subject: `${salon?.name || 'Your salon'} Google Calendar needs attention`,
                  text: `Google Calendar could not sync an appointment after several retries. The booking is still safe in Luster. Reconnect Calendar from the Luster area or contact support.\n\nAppointment: ${job.appointmentId || 'unknown'}`,
                  html: `<p>Google Calendar could not sync an appointment after several retries. The booking is still safe in Luster.</p><p>Reconnect Calendar from the Luster area or contact support.</p>`,
                };
          await sendTransactionalEmail({
            to: recipient,
            subject: notice.subject,
            text: notice.text,
            html: notice.html,
          }).catch(() => false);
        }
      } else {
        summary.retried += 1;
      }
    }
  }

  // Past mirrors cannot block a future booking, and allowing them into this
  // bounded repair batch can permanently starve a recently cancelled future
  // appointment. Prefer the newest future cancellations and scan a wider but
  // still bounded set so one salon's history cannot monopolize the worker.
  const reconciliationLimit = Math.min(Math.max(limit * 4, 200), 500);
  const reconciliationCutoff = new Date();
  const [appointmentMirrors, linkedMirrors] = await Promise.all([
    db
      .select({
        appointmentId: appointmentSchema.id,
        salonId: appointmentSchema.salonId,
        googleCalendarEventId: appointmentSchema.googleCalendarEventId,
      })
      .from(appointmentSchema)
      .innerJoin(
        salonGoogleCalendarConnectionSchema,
        eq(salonGoogleCalendarConnectionSchema.salonId, appointmentSchema.salonId),
      )
      .where(and(
        inArray(appointmentSchema.status, ['cancelled', 'no_show']),
        gte(appointmentSchema.endTime, reconciliationCutoff),
        isNotNull(appointmentSchema.googleCalendarEventId),
        inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
      ))
      .orderBy(desc(appointmentSchema.updatedAt))
      .limit(reconciliationLimit),
    db
      .select({
        appointmentId: appointmentSchema.id,
        salonId: appointmentSchema.salonId,
        googleCalendarEventId: googleCalendarEventSchema.googleEventId,
      })
      .from(appointmentSchema)
      .innerJoin(
        googleCalendarEventSchema,
        and(
          eq(googleCalendarEventSchema.salonId, appointmentSchema.salonId),
          eq(googleCalendarEventSchema.appointmentId, appointmentSchema.id),
        ),
      )
      .innerJoin(
        salonGoogleCalendarConnectionSchema,
        eq(salonGoogleCalendarConnectionSchema.salonId, appointmentSchema.salonId),
      )
      .where(and(
        inArray(appointmentSchema.status, ['cancelled', 'no_show']),
        gte(appointmentSchema.endTime, reconciliationCutoff),
        isNull(googleCalendarEventSchema.deletedAt),
        ne(googleCalendarEventSchema.googleStatus, 'cancelled'),
        eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
        inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
        inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']),
      ))
      .orderBy(desc(appointmentSchema.updatedAt))
      .limit(reconciliationLimit),
  ]);

  const cancelledMirrors = new Map<string, (typeof appointmentMirrors)[number]>();
  for (const appointment of [...appointmentMirrors, ...linkedMirrors]) {
    if (!appointment.googleCalendarEventId) {
      continue;
    }
    cancelledMirrors.set(
      `${appointment.salonId}:${appointment.appointmentId}:${appointment.googleCalendarEventId}`,
      appointment,
    );
  }
  summary.cancelledEventCandidates = cancelledMirrors.size;

  for (const appointment of cancelledMirrors.values()) {
    try {
      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: appointment.appointmentId,
        salonId: appointment.salonId,
        googleCalendarEventId: appointment.googleCalendarEventId,
      });
      if (result.status === 'deleted') {
        summary.reconciledCancelledEvents += 1;
      } else if (result.status === 'disabled') {
        summary.skippedCancelledEvents += 1;
      } else {
        summary.failedCancelledEvents += 1;
      }
    } catch (error) {
      summary.failedCancelledEvents += 1;
      console.error('[GoogleCalendar] Failed to reconcile a cancelled appointment event:', {
        appointmentId: appointment.appointmentId,
        salonId: appointment.salonId,
        error: safeJobError(error),
      });
    }
  }

  return summary;
}
