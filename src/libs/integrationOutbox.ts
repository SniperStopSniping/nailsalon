import * as Sentry from '@sentry/nextjs';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  deleteGoogleCalendarEventForAppointment,
  type GoogleCalendarAppointmentEventInput,
  listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment,
} from '@/libs/googleCalendar';
import type {
  SalonNotificationCancellation,
  SalonNotificationEventKey,
  SalonNotificationPreviousSchedule,
  SalonNotificationSource,
} from '@/libs/salonNotificationEmail';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
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

type StaffRescheduleNotificationInput<T extends Date | string>
  = Record<'appointmentId' | 'salonId' | 'timeZone', string>
  & Record<'previousStartTime' | 'previousEndTime' | 'newStartTime' | 'newEndTime' | 'mutationVersion', T>;
type OutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The two D5-owned operations whose exhaustion is a money-visible event.
 * Runbook query 5b selects exactly these rows in `status='failed'`.
 */
const DEPOSIT_OUTBOX_OPERATIONS = new Set([
  'booking_confirmed_side_effects',
  'deposit_refund_notices',
]);

function parseStaffRescheduleNotificationPayload(
  value: unknown,
): StaffRescheduleNotificationInput<string> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const stringFields = ['appointmentId', 'salonId', 'timeZone'] as const;
  const timestampFields = [
    'previousStartTime',
    'previousEndTime',
    'newStartTime',
    'newEndTime',
    'mutationVersion',
  ] as const;
  if (
    stringFields.some(
      field => typeof payload[field] !== 'string' || !payload[field],
    )
  ) {
    return null;
  }
  try {
    new Intl.DateTimeFormat('en', {
      timeZone: payload.timeZone as string,
    }).format(0);
  } catch {
    return null;
  }
  for (const field of timestampFields) {
    const timestamp = payload[field];
    if (typeof timestamp !== 'string') {
      return null;
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
      return null;
    }
  }
  return payload as StaffRescheduleNotificationInput<string>;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');
}

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

/**
 * Transaction-handle variant of `enqueueGoogleCalendarUpsert`.
 *
 * The module-level version above is hard-bound to the global `db`, and its
 * follow-up appointment UPDATE would deadlock at application level if it were
 * called from inside a transaction that already holds that appointment's row
 * lock — which is exactly the situation D5's confirm is in. Calling it "with
 * the tx handle" was therefore not implementable without this variant.
 *
 * Enqueuing with the handle also makes the job commit ATOMICALLY with the state
 * change: a crash after the confirm CAS but before the enqueue cannot leave a
 * paid deposit whose calendar event was never scheduled.
 *
 * Same dedupe key as the module-level version, deliberately: a hold that later
 * confirms must not enqueue a second upsert for the same appointment and start
 * time.
 */
export async function enqueueGoogleCalendarUpsertWithHandle(
  database: OutboxTransaction,
  input: GoogleCalendarAppointmentEventInput,
  options?: { dedupeSuffix?: string },
) {
  const dedupeKey = `google:${input.appointmentId}:upsert:${input.startTime.toISOString()}${options?.dedupeSuffix ? `:${options.dedupeSuffix}` : ''}`;
  await database
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
  await database
    .update(appointmentSchema)
    .set({ googleCalendarSyncStatus: 'pending', googleCalendarSyncError: null })
    .where(
      and(
        eq(appointmentSchema.id, input.appointmentId),
        eq(appointmentSchema.salonId, input.salonId),
      ),
    );
}

/**
 * The durable confirmation side-effect batch for a paid deposit (D5, TX-B).
 *
 * The eight post-commit effects a deposit hold skipped at booking time are not
 * run inline at confirmation: the confirm may be driven by a Stripe webhook,
 * whose response budget is a retry decision, not a send budget. They run from
 * here instead — at-least-once, on the outbox's own failure axis, so a bounced
 * email can never mark the webhook event row retryable or roll the money write
 * back (invariant I10).
 *
 * Enqueued INSIDE TX-B with the handle, so the job and the `paid` transition
 * commit together.
 */
export async function enqueueDepositConfirmationSideEffects(
  database: OutboxTransaction,
  input: {
    salonId: string;
    appointmentId: string;
    depositId: string;
    manageUrl: string;
    smsConsentGranted: boolean;
    googleCalendarSyncEligible: boolean;
    appliedRewardId: string | null;
  },
) {
  await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'booking_confirmed_side_effects',
      // Keyed on the DEPOSIT, not the appointment: one deposit confirms once,
      // and a redelivery of the same session must not enqueue a second batch.
      dedupeKey: `deposit:${input.depositId}:confirmed-side-effects`,
      payload: {
        depositId: input.depositId,
        manageUrl: input.manageUrl,
        smsConsentGranted: input.smsConsentGranted,
        googleCalendarSyncEligible: input.googleCalendarSyncEligible,
        appliedRewardId: input.appliedRewardId,
      },
    })
    .onConflictDoNothing();
}

/**
 * The client and owner notices for a refunded deposit (D5, TX-D).
 *
 * Enqueued INSIDE TX-D rather than after commit: a crash between the refund
 * landing and the notice being scheduled would otherwise return the client's
 * money silently.
 *
 * `variant` selects the client copy. The fixed "the time is no longer
 * available" wording is FALSE for a waiver — there the salon waived the deposit
 * requirement and the booking still stands — and sending it would talk a client
 * out of an appointment they still have.
 */
export async function enqueueDepositRefundNotices(
  database: OutboxTransaction,
  input: {
    salonId: string;
    appointmentId: string;
    depositId: string;
    refundId: string;
    variant: 'slot_lost' | 'waiver';
  },
) {
  await database
    .insert(integrationOutboxSchema)
    .values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'deposit_refund_notices',
      dedupeKey: `deposit:${input.depositId}:refund-notices:${input.refundId}`,
      payload: {
        depositId: input.depositId,
        refundId: input.refundId,
        variant: input.variant,
      },
    })
    .onConflictDoNothing();
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

export async function enqueueStaffRescheduleNotification(database: OutboxTransaction, input: StaffRescheduleNotificationInput<Date>) {
  await database.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    provider: 'email',
    operation: 'staff_reschedule_notification',
    dedupeKey: `email:${input.appointmentId}:staff_reschedule:${input.previousStartTime.toISOString()}:${input.newStartTime.toISOString()}:${input.mutationVersion.toISOString()}`,
    payload: {
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      previousStartTime: input.previousStartTime.toISOString(),
      previousEndTime: input.previousEndTime.toISOString(),
      newStartTime: input.newStartTime.toISOString(),
      newEndTime: input.newEndTime.toISOString(),
      mutationVersion: input.mutationVersion.toISOString(),
      timeZone: input.timeZone,
    },
  }).onConflictDoNothing();
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
    remoteAppointmentMirrorsScanned: 0,
    remoteCancelledEventCandidates: 0,
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
      } else if (
        job.provider === 'email'
        && job.operation === 'booking_confirmed_side_effects'
      ) {
        // The confirmation batch for a paid deposit. The handler catches each
        // send individually and THROWS if any leg failed, so the job retries;
        // legs that already succeeded do not re-fire on the re-run, because
        // each carries its own dedupe key.
        const payload = job.payload as { depositId?: string };
        if (!job.appointmentId || !payload.depositId) {
          throw new Error('INVALID_DEPOSIT_SIDE_EFFECTS');
        }
        const { runDepositConfirmationSideEffects } = await import(
          '@/libs/deposits/depositOutboxHandlers'
        );
        await runDepositConfirmationSideEffects({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          payload: job.payload,
        });
        result = { status: 'synced' as const };
      } else if (
        job.provider === 'email'
        && job.operation === 'deposit_refund_notices'
      ) {
        const payload = job.payload as { depositId?: string };
        if (!job.appointmentId || !payload.depositId) {
          throw new Error('INVALID_DEPOSIT_REFUND_NOTICES');
        }
        const { runDepositRefundNotices } = await import(
          '@/libs/deposits/depositOutboxHandlers'
        );
        await runDepositRefundNotices({
          salonId: job.salonId,
          appointmentId: job.appointmentId,
          payload: job.payload,
        });
        result = { status: 'synced' as const };
      } else if (job.provider === 'email' && job.operation === 'staff_reschedule_notification') {
        const payload = parseStaffRescheduleNotificationPayload(job.payload);
        const loadCurrent = async () => {
          const [current] = await db.select({
            startTime: appointmentSchema.startTime,
            endTime: appointmentSchema.endTime,
            status: appointmentSchema.status,
            deletedAt: appointmentSchema.deletedAt,
            salonName: salonSchema.name,
          }).from(appointmentSchema)
            .innerJoin(salonSchema, eq(salonSchema.id, appointmentSchema.salonId))
            .where(and(
              eq(appointmentSchema.id, job.appointmentId!),
              eq(appointmentSchema.salonId, job.salonId),
            )).limit(1);
          return current;
        };
        const finishTerminal = async (status: 'cancelled' | 'failed', lastError: 'SUPERSEDED' | 'RECIPIENT_UNAVAILABLE' | 'INVALID_PAYLOAD') => db
          .update(integrationOutboxSchema).set({ status, processedAt: new Date(), lastError }).where(and(
            eq(integrationOutboxSchema.id, job.id),
            eq(integrationOutboxSchema.salonId, job.salonId),
            eq(integrationOutboxSchema.status, 'processing'),
          ));
        if (
          !payload
          || payload.appointmentId !== job.appointmentId
          || payload.salonId !== job.salonId
        ) {
          await finishTerminal('failed', 'INVALID_PAYLOAD');
          summary.failed += 1;
          continue;
        }
        const newStart = new Date(payload.newStartTime);
        const current = await loadCurrent();
        const isCurrent = (value: typeof current): value is NonNullable<typeof current> => Boolean(
          value && !value.deletedAt && ['pending', 'confirmed'].includes(value.status)
          && value.startTime.getTime() === newStart.getTime(),
        );
        if (!isCurrent(current)) {
          await finishTerminal('cancelled', 'SUPERSEDED');
          summary.succeeded += 1;
          continue;
        }
        const date = formatDateInTimeZone(payload.newStartTime, { weekday: 'long', month: 'long', day: 'numeric' }, payload.timeZone);
        const time = formatTimeInTimeZone(payload.newStartTime, {}, payload.timeZone);
        let superseded = false;
        const { sendAppointmentOperationalEmailOnce } = await import('@/libs/clientLifecycleStabilization');
        const delivery = await sendAppointmentOperationalEmailOnce({
          salonId: job.salonId,
          appointmentId: job.appointmentId!,
          purpose: 'client_appointment_rescheduled',
          eventVersion: [payload.previousStartTime, payload.previousEndTime, payload.newStartTime, payload.newEndTime, payload.mutationVersion].join(':'),
          retryFailed: true,
          prepare: async () => {
            const { mintAppointmentManageLink } = await import('@/libs/appointmentManageLink');
            const manageUrl = await mintAppointmentManageLink({
              id: job.appointmentId!,
              salonId: job.salonId,
              endTime: current.endTime,
            });
            return {
              subject: `${current.salonName} appointment rescheduled`,
              text: `Your ${current.salonName} appointment has been moved to ${date} at ${time}.\n\nView, reschedule, or cancel: ${manageUrl}`,
              html: `<p>Your <strong>${escapeHtml(current.salonName)}</strong> appointment has been moved to <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(manageUrl)}">View, reschedule, or cancel</a></p>`,
            };
          },
          validateBeforeDelivery: async () => {
            superseded = !isCurrent(await loadCurrent());
            return !superseded;
          },
          validationErrorCode: 'SUPERSEDED',
        });
        if (superseded) {
          await finishTerminal('cancelled', 'SUPERSEDED');
          summary.succeeded += 1;
          continue;
        }
        if (delivery.status === 'unavailable') {
          await finishTerminal('failed', 'RECIPIENT_UNAVAILABLE');
          summary.failed += 1;
          continue;
        }
        result = delivery.status === 'failed'
          ? { status: 'failed' as const, error: 'STAFF_RESCHEDULE_EMAIL_FAILED' }
          : { status: 'synced' as const };
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
        if (DEPOSIT_OUTBOX_OPERATIONS.has(job.operation)) {
          // The worker's own terminal is SILENT — it emails the salon owner and
          // stops. That is the right posture for a bounced confirmation, and the
          // wrong one for a deposit: these two jobs are the only notice a client
          // gets that their money moved, so their exhaustion needs an operator
          // signal, not just an owner email. Exactly one alert, ids only
          // (Sentry never receives payloads on this programme's money paths),
          // fired here because `final` is reached once per job by construction.
          Sentry.captureMessage('deposit_outbox_job_failed', {
            level: 'error',
            tags: { outbox_operation: job.operation },
            extra: {
              jobId: job.id,
              appointmentId: job.appointmentId,
              depositId: (job.payload as { depositId?: string }).depositId,
            },
          });
        }
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

  // Older failed cancellations can have lost both local identifiers while the
  // Google event still carries the private appointmentId/salonId metadata we
  // wrote when creating it. Query only those app-owned events, then verify the
  // appointment is terminal in our database before adding it to the repair
  // set. The private-property filter avoids scanning or touching unrelated
  // calendar entries.
  const connections = await db
    .select({
      salonId: salonGoogleCalendarConnectionSchema.salonId,
      destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId,
    })
    .from(salonGoogleCalendarConnectionSchema)
    .where(inArray(salonGoogleCalendarConnectionSchema.status, ['active', 'degraded']))
    .limit(Math.min(limit, 50));
  for (const connection of connections) {
    try {
      const remoteEvents = await listGoogleCalendarEventsForSalon({
        salonId: connection.salonId,
        calendarIds: [connection.destinationCalendarId],
        startTime: reconciliationCutoff,
        endTime: new Date(reconciliationCutoff.getTime() + 365 * 24 * 60 * 60 * 1000),
        privateExtendedProperties: [`salonId=${connection.salonId}`],
      });
      const appEvents = remoteEvents.filter(event => (
        event.status !== 'cancelled'
        && event.salonId === connection.salonId
        && Boolean(event.appointmentId)
      ));
      summary.remoteAppointmentMirrorsScanned += appEvents.length;
      const appointmentIds = [...new Set(appEvents.flatMap(event => (
        event.appointmentId ? [event.appointmentId] : []
      )))];
      if (!appointmentIds.length) {
        continue;
      }
      const storedAppointments = await db
        .select({
          id: appointmentSchema.id,
          status: appointmentSchema.status,
          canvasState: appointmentSchema.canvasState,
          deletedAt: appointmentSchema.deletedAt,
        })
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.salonId, connection.salonId),
          inArray(appointmentSchema.id, appointmentIds),
        ))
        .limit(reconciliationLimit);
      const appointmentsById = new Map(storedAppointments.map(appointment => [
        appointment.id,
        appointment,
      ]));
      for (const event of appEvents) {
        if (!event.appointmentId) {
          continue;
        }
        const appointment = appointmentsById.get(event.appointmentId);
        const safeToDelete = !appointment
          || Boolean(appointment.deletedAt)
          || ['cancelled', 'no_show'].includes(appointment.status)
          || ['cancelled', 'no_show'].includes(appointment.canvasState ?? '');
        if (!safeToDelete) {
          continue;
        }
        const key = `${connection.salonId}:${event.appointmentId}:${event.id}`;
        if (!cancelledMirrors.has(key)) {
          summary.remoteCancelledEventCandidates += 1;
        }
        cancelledMirrors.set(key, {
          appointmentId: event.appointmentId,
          salonId: connection.salonId,
          googleCalendarEventId: event.id,
        });
      }
    } catch (error) {
      summary.failedCancelledEvents += 1;
      console.error('[GoogleCalendar] Failed to discover orphaned appointment events:', {
        salonId: connection.salonId,
        error: safeJobError(error),
      });
    }
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
