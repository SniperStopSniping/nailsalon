import { and, eq, inArray, ne } from 'drizzle-orm';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { sendTransactionalEmail } from '@/libs/email';
import { enqueueGoogleCalendarDelete } from '@/libs/integrationOutbox';
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
import {
  appointmentAccessTokenSchema,
  appointmentSchema,
  appointmentServicesSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

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
