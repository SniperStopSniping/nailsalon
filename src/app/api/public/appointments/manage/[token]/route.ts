import { and, eq, inArray, ne } from 'drizzle-orm';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import {
  AppointmentManageError,
  runAppointmentManageMutation,
} from '@/libs/appointmentManage';
import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { sendTransactionalEmail } from '@/libs/email';
import { enqueueGoogleCalendarDelete, enqueueGoogleCalendarUpsert } from '@/libs/integrationOutbox';
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  getDateKeyInTimeZone,
  getZonedDayBounds,
} from '@/libs/timeZone';
import {
  appointmentAccessTokenSchema,
  appointmentSchema,
  appointmentServicesSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

async function loadManagedAppointment(token: string) {
  const capability = await verifyAppointmentAccessToken(token);
  if (!capability) {
    return null;
  }
  const serviceRows = await db
    .select({ nameSnapshot: appointmentServicesSchema.nameSnapshot, name: serviceSchema.name })
    .from(appointmentServicesSchema)
    .innerJoin(appointmentSchema, and(
      eq(appointmentSchema.id, appointmentServicesSchema.appointmentId),
      eq(appointmentSchema.salonId, capability.salonId),
    ))
    .leftJoin(serviceSchema, eq(serviceSchema.id, appointmentServicesSchema.serviceId))
    .where(eq(appointmentServicesSchema.appointmentId, capability.appointmentId));
  const [details] = await db
    .select({
      salonName: salonSchema.name,
      salonSlug: salonSchema.slug,
      salonCustomDomain: salonSchema.customDomain,
      salonEmail: salonSchema.email,
      technicianName: technicianSchema.name,
    })
    .from(appointmentSchema)
    .innerJoin(salonSchema, eq(salonSchema.id, appointmentSchema.salonId))
    .leftJoin(technicianSchema, and(eq(technicianSchema.id, appointmentSchema.technicianId), eq(technicianSchema.salonId, appointmentSchema.salonId)))
    .where(and(eq(appointmentSchema.id, capability.appointmentId), eq(appointmentSchema.salonId, capability.salonId)))
    .limit(1);
  return details
    ? {
        capability,
        details,
        serviceNames: serviceRows.map(row => row.nameSnapshot || row.name || 'Appointment'),
      }
    : null;
}

export async function GET(_request: Request, context: { params: { token: string } }) {
  const managed = await loadManagedAppointment(context.params.token);
  if (!managed) {
    return Response.json({ error: { code: 'MANAGE_LINK_INVALID', message: 'This appointment link is invalid or expired.' } }, { status: 404 });
  }
  const { appointment } = managed.capability;
  return Response.json({ data: {
    appointment: {
      id: appointment.id,
      clientName: appointment.clientName,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      totalPrice: appointment.totalPrice,
    },
    salon: { name: managed.details.salonName, slug: managed.details.salonSlug },
    technicianName: managed.details.technicianName,
    serviceNames: managed.serviceNames,
    expiresAt: managed.capability.expiresAt,
  } });
}

/**
 * Customer-initiated reschedule.
 *
 * Authority comes ONLY from the capability token in the path: it resolves the
 * appointment and salon server-side, so no appointment id is accepted from the
 * client and a token can never reach another salon's rows. The move itself
 * delegates to the same engine staff use — it updates the existing row in
 * place (identity, client, services, add-ons and pricing preserved) and
 * re-validates availability inside the transaction with the appointment
 * excluded from its own conflict check, so a slot claimed between display and
 * submit fails atomically instead of double-booking.
 */
export async function POST(request: Request, context: { params: { token: string } }) {
  const body = await request.json().catch(() => null) as { action?: string; startTime?: unknown } | null;
  if (body?.action !== 'reschedule') {
    return Response.json({ error: { code: 'INVALID_ACTION', message: 'Only rescheduling is supported here.' } }, { status: 400 });
  }
  if (typeof body.startTime !== 'string' || !body.startTime.trim()) {
    return Response.json({ error: { code: 'START_TIME_REQUIRED', message: 'A new start time is required.' } }, { status: 400 });
  }
  const startTime = new Date(body.startTime);
  if (Number.isNaN(startTime.getTime())) {
    return Response.json({ error: { code: 'START_TIME_INVALID', message: 'That start time could not be read.' } }, { status: 400 });
  }

  const managed = await loadManagedAppointment(context.params.token);
  if (!managed) {
    return Response.json({ error: { code: 'MANAGE_LINK_INVALID', message: 'This appointment link is invalid or expired.' } }, { status: 404 });
  }
  const { appointment } = managed.capability;
  if (!['pending', 'confirmed'].includes(appointment.status)) {
    return Response.json({ error: { code: 'APPOINTMENT_NOT_ACTIVE', message: 'This appointment is no longer active.' } }, { status: 409 });
  }

  const bookingConfig = resolveBookingConfigFromSettings(managed.capability.salonSettings);
  if (!getClientChangePolicy(appointment.startTime, bookingConfig).canChange) {
    return Response.json({ error: { code: 'CHANGE_WINDOW_CLOSED', message: `Online changes close ${bookingConfig.clientChangeCutoffHours} hours before the appointment. Please contact the salon.` } }, { status: 409 });
  }

  // Submitting the current time is not a reschedule. Return truthfully and
  // touch nothing: no write, no calendar sync, no notification.
  if (startTime.getTime() === appointment.startTime.getTime()) {
    return Response.json({ data: { status: 'unchanged', appointmentId: appointment.id } });
  }

  if (startTime.getTime() <= Date.now()) {
    return Response.json({ error: { code: 'START_TIME_IN_PAST', message: 'Choose a time in the future.' } }, { status: 400 });
  }

  // Only times on the salon's published slot grid are accepted — the grid the
  // availability endpoint anchors to the salon-local start of day.
  const { startOfDay } = getZonedDayBounds(
    getDateKeyInTimeZone(startTime, bookingConfig.timezone),
    bookingConfig.timezone,
  );
  const offsetMinutes = (startTime.getTime() - startOfDay.getTime()) / 60000;
  if (!Number.isInteger(offsetMinutes) || offsetMinutes % bookingConfig.slotIntervalMinutes !== 0) {
    return Response.json({ error: { code: 'START_TIME_OFF_GRID', message: 'Choose one of the offered times.' } }, { status: 400 });
  }

  // Captured before the move so the salon alert reports the real previous
  // schedule rather than the row's post-update state.
  const previousSchedule = {
    appointmentId: appointment.id,
    startTime: appointment.startTime.toISOString(),
    endTime: appointment.endTime.toISOString(),
    technicianName: managed.details.technicianName,
    serviceSummary: managed.serviceNames.join(', ') || 'Appointment',
    discountLabel: appointment.discountLabel,
    discountAmountCents: appointment.discountAmountCents ?? 0,
    totalPriceCents: appointment.totalPrice,
  };

  // Availability hides Google-busy times; the submit must re-assert that, with
  // this appointment's own mirrored event excluded (it is moving, not staying).
  // The engine below owns the CRM-side conflict check inside its transaction.
  try {
    const { hasGoogleCalendarConflict } = await import('@/libs/googleCalendar');
    const googleConflict = await hasGoogleCalendarConflict({
      salonId: managed.capability.salonId,
      startTime,
      endTime: new Date(startTime.getTime() + appointment.totalDurationMinutes * 60 * 1000),
      timeZone: bookingConfig.timezone,
      excludeAppointmentId: managed.capability.appointmentId,
    });
    if (googleConflict) {
      return Response.json({ error: { code: 'APPOINTMENT_CONFLICT', message: 'That time was just taken. Please pick another.' } }, { status: 409 });
    }
  } catch (googleError) {
    // Fail closed, exactly like the booking endpoint: never move a customer
    // onto a slot we could not verify.
    console.error('[AppointmentManageLink] Google availability check failed during reschedule', {
      salonId: managed.capability.salonId,
      error: googleError,
    });
    return Response.json({ error: { code: 'AVAILABILITY_UNVERIFIED', message: 'We could not confirm that time. Please try again shortly.' } }, { status: 503 });
  }

  let result;
  try {
    result = await runAppointmentManageMutation({
      appointmentId: managed.capability.appointmentId,
      salonId: managed.capability.salonId,
      operation: 'move',
      startTime,
      // Customers move their own booking in time only. They never reassign
      // the technician, and the engine keeps the existing one.
      canReassignTechnician: false,
    });
  } catch (error) {
    if (error instanceof AppointmentManageError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error('[AppointmentManageLink] Reschedule failed', {
      salonId: managed.capability.salonId,
      appointmentId: managed.capability.appointmentId,
      error,
    });
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'The appointment could not be moved. Please try again.' } }, { status: 500 });
  }

  // The capability is bound to the appointment id, which did not change — the
  // customer keeps the same private link across the move.
  await enqueueGoogleCalendarUpsert({
    appointmentId: result.calendarEvent.id,
    salonId: managed.capability.salonId,
    salonName: managed.details.salonName,
    clientName: result.calendarEvent.clientName,
    clientPhone: result.calendarEvent.clientPhone,
    serviceNames: [result.calendarEvent.serviceLabel],
    technicianName: result.calendarEvent.technicianName,
    startTime: new Date(result.calendarEvent.startTime),
    endTime: new Date(result.calendarEvent.endTime),
    totalPrice: result.calendarEvent.totalPrice,
    totalDurationMinutes: result.calendarEvent.totalDurationMinutes,
    timeZone: result.calendarEvent.timeZone,
    locationName: result.calendarEvent.locationName,
    locationAddress: result.calendarEvent.locationAddress,
    googleCalendarEventId: result.calendarEvent.googleCalendarEventId,
  });

  // Salon side: deduped on (appointment, event, previous schedule), so a retry
  // of the same move never produces a second alert.
  try {
    await sendSalonNotificationEmail({
      salonId: managed.capability.salonId,
      appointmentId: managed.capability.appointmentId,
      event: 'rescheduled',
      source: 'client_manage_link',
      previous: previousSchedule,
    });
  } catch (notificationError) {
    console.error('[SALON NOTIFICATION] Reschedule alert failed after the move committed:', {
      salonId: managed.capability.salonId,
      appointmentId: managed.capability.appointmentId,
      error: notificationError,
    });
  }

  // Customer side.
  if (appointment.clientEmail) {
    const timeZone = bookingConfig.timezone;
    const newStart = new Date(result.detail.appointment.startTime);
    const date = formatDateInTimeZone(newStart.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }, timeZone);
    const time = formatTimeInTimeZone(newStart.toISOString(), {}, timeZone);
    const manageUrl = buildAppointmentManageUrl(
      { slug: managed.details.salonSlug, customDomain: managed.details.salonCustomDomain },
      context.params.token,
    );
    const text = `Your ${managed.details.salonName} appointment has been moved to ${date} at ${time}.\n\nView, reschedule, or cancel: ${manageUrl}`;
    try {
      await sendTransactionalEmail({
        to: appointment.clientEmail,
        subject: `${managed.details.salonName} appointment rescheduled`,
        text,
        html: `<p>Your <strong>${escapeHtml(managed.details.salonName)}</strong> appointment has been moved to <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(manageUrl)}">View, reschedule, or cancel</a></p>`,
      });
    } catch (emailError) {
      console.error('[AppointmentManageLink] Reschedule confirmation email failed after the move committed:', {
        salonId: managed.capability.salonId,
        appointmentId: managed.capability.appointmentId,
        error: emailError,
      });
    }
  }

  return Response.json({ data: {
    status: 'rescheduled',
    appointmentId: result.detail.appointment.id,
    startTime: result.detail.appointment.startTime,
    endTime: result.detail.appointment.endTime,
  } });
}

export async function PATCH(request: Request, context: { params: { token: string } }) {
  const body = await request.json().catch(() => null) as { action?: string; reason?: string } | null;
  if (body?.action !== 'cancel') {
    return Response.json({ error: { code: 'INVALID_ACTION', message: 'Only cancellation is supported here.' } }, { status: 400 });
  }
  const managed = await loadManagedAppointment(context.params.token);
  if (!managed) {
    return Response.json({ error: { code: 'MANAGE_LINK_INVALID', message: 'This appointment link is invalid or expired.' } }, { status: 404 });
  }
  const bookingConfig = resolveBookingConfigFromSettings(managed.capability.salonSettings);
  if (!getClientChangePolicy(managed.capability.appointment.startTime, bookingConfig).canChange) {
    return Response.json({ error: { code: 'CHANGE_WINDOW_CLOSED', message: `Online changes close ${bookingConfig.clientChangeCutoffHours} hours before the appointment. Please contact the salon.` } }, { status: 409 });
  }

  const [cancelled] = await db
    .update(appointmentSchema)
    .set({ status: 'cancelled', cancelReason: body.reason?.trim() || 'client_request', updatedAt: new Date() })
    .where(and(
      eq(appointmentSchema.id, managed.capability.appointmentId),
      eq(appointmentSchema.salonId, managed.capability.salonId),
      inArray(appointmentSchema.status, ['pending', 'confirmed']),
    ))
    .returning();
  if (!cancelled) {
    return Response.json({ error: { code: 'APPOINTMENT_NOT_ACTIVE', message: 'This appointment is no longer active.' } }, { status: 409 });
  }
  await enqueueGoogleCalendarDelete({ appointmentId: cancelled.id, salonId: cancelled.salonId, googleCalendarEventId: cancelled.googleCalendarEventId });

  // The capability remains valid so the customer can see the cancellation.
  // Revoke any other stale capabilities for the same appointment.
  await db.update(appointmentAccessTokenSchema)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(appointmentAccessTokenSchema.salonId, managed.capability.salonId),
      eq(appointmentAccessTokenSchema.appointmentId, managed.capability.appointmentId),
      ne(appointmentAccessTokenSchema.id, managed.capability.tokenId),
    ));

  // The status guard above means `cancelled` is only set on a real transition,
  // so an already-cancelled appointment returns 409 and never re-notifies.
  // Failures here must not undo a cancellation the client already saw succeed.
  try {
    await sendSalonNotificationEmail({
      salonId: cancelled.salonId,
      appointmentId: cancelled.id,
      event: 'cancelled',
      source: 'client_manage_link',
      cancellation: {
        reason: cancelled.cancelReason,
        cancelledAt: (cancelled.updatedAt ?? new Date()).toISOString(),
      },
    });
  } catch (notificationError) {
    console.error('[SALON NOTIFICATION] Cancellation alert failed after the cancellation committed:', {
      salonId: cancelled.salonId,
      appointmentId: cancelled.id,
      error: notificationError,
    });
  }

  if (managed.capability.appointment.clientEmail) {
    const text = `Your appointment with ${managed.details.salonName} has been cancelled.`;
    await sendTransactionalEmail({
      to: managed.capability.appointment.clientEmail,
      subject: `${managed.details.salonName} appointment cancelled`,
      text,
      html: `<p>${text}</p>`,
    });
  }
  return Response.json({ data: { status: 'cancelled' } });
}
