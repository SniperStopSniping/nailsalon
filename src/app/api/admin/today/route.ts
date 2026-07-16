import { and, asc, desc, eq, gte, inArray, isNull, lte, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { getSalonIntegrationHealth } from '@/libs/integrationHealth';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getDateKeyInTimeZone, getZonedDayBounds } from '@/libs/timeZone';
import {
  appointmentSchema,
  appointmentServicesSchema,
  googleCalendarEventSchema,
  notificationDeliverySchema,
  salonClientSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  salonSlug: z.string().trim().min(1),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Salon is required.' } }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }

  const now = new Date();
  const bookingConfig = await getBookingConfigForSalon(salon.id);
  const dateKey = getDateKeyInTimeZone(now, bookingConfig.timezone);
  const bounds = getZonedDayBounds(dateKey, bookingConfig.timezone);
  const endExclusive = new Date(bounds.endOfDay.getTime() + 1);

  const [appointments, dueClients, failedDeliveries, [googleReviewCount], integrationHealth] = await Promise.all([
    db
      .select({
        id: appointmentSchema.id,
        clientName: appointmentSchema.clientName,
        clientPhone: appointmentSchema.clientPhone,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        totalPrice: appointmentSchema.totalPrice,
        totalDurationMinutes: appointmentSchema.totalDurationMinutes,
        technicianName: technicianSchema.name,
      })
      .from(appointmentSchema)
      .leftJoin(technicianSchema, and(eq(appointmentSchema.technicianId, technicianSchema.id), eq(technicianSchema.salonId, salon.id)))
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        isNull(appointmentSchema.deletedAt),
        gte(appointmentSchema.startTime, bounds.startOfDay),
        lt(appointmentSchema.startTime, endExclusive),
        inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress', 'completed']),
      ))
      .orderBy(asc(appointmentSchema.startTime)),
    db
      .select({
        id: salonClientSchema.id,
        fullName: salonClientSchema.fullName,
        phone: salonClientSchema.phone,
        nextRebookDueAt: salonClientSchema.nextRebookDueAt,
        lastVisitAt: salonClientSchema.lastVisitAt,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
      })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salon.id),
        lte(salonClientSchema.nextRebookDueAt, endExclusive),
        or(eq(salonClientSchema.isBlocked, false), isNull(salonClientSchema.isBlocked)),
      ))
      .orderBy(asc(salonClientSchema.nextRebookDueAt))
      .limit(6),
    db
      .select({
        appointmentId: notificationDeliverySchema.appointmentId,
        errorCode: notificationDeliverySchema.errorCode,
        updatedAt: notificationDeliverySchema.updatedAt,
      })
      .from(notificationDeliverySchema)
      .innerJoin(appointmentSchema, and(
        eq(notificationDeliverySchema.appointmentId, appointmentSchema.id),
        eq(appointmentSchema.salonId, salon.id),
      ))
      .where(and(
        eq(notificationDeliverySchema.salonId, salon.id),
        eq(notificationDeliverySchema.channel, 'email'),
        eq(notificationDeliverySchema.status, 'failed'),
        eq(notificationDeliverySchema.retryable, true),
        gte(appointmentSchema.startTime, bounds.startOfDay),
      ))
      .orderBy(desc(notificationDeliverySchema.updatedAt))
      .limit(6),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(googleCalendarEventSchema)
      .where(and(
        eq(googleCalendarEventSchema.salonId, salon.id),
        eq(googleCalendarEventSchema.reviewStatus, 'needs_review'),
        isNull(googleCalendarEventSchema.deletedAt),
        gte(googleCalendarEventSchema.endTime, now),
      )),
    getSalonIntegrationHealth(salon.id),
  ]);

  const appointmentIds = appointments.map(appointment => appointment.id);
  const serviceRows = appointmentIds.length
    ? await db
        .select({
          appointmentId: appointmentServicesSchema.appointmentId,
          snapshotName: appointmentServicesSchema.nameSnapshot,
          liveName: serviceSchema.name,
        })
        .from(appointmentServicesSchema)
        .leftJoin(serviceSchema, and(
          eq(appointmentServicesSchema.serviceId, serviceSchema.id),
          eq(serviceSchema.salonId, salon.id),
        ))
        .where(inArray(appointmentServicesSchema.appointmentId, appointmentIds))
    : [];
  const services = new Map<string, string[]>();
  for (const row of serviceRows) {
    const names = services.get(row.appointmentId) ?? [];
    names.push(row.snapshotName || row.liveName || 'Service');
    services.set(row.appointmentId, names);
  }

  return Response.json({
    data: {
      date: dateKey,
      timeZone: bookingConfig.timezone,
      appointments: appointments.map(appointment => ({
        ...appointment,
        startTime: appointment.startTime.toISOString(),
        endTime: appointment.endTime.toISOString(),
        services: services.get(appointment.id) ?? ['Service'],
      })),
      dueClients: dueClients.map(client => ({
        ...client,
        nextRebookDueAt: client.nextRebookDueAt?.toISOString() ?? null,
        lastVisitAt: client.lastVisitAt?.toISOString() ?? null,
      })),
      failedConfirmations: failedDeliveries.map(delivery => ({
        ...delivery,
        updatedAt: delivery.updatedAt.toISOString(),
      })),
      googleEventsNeedingReview: Number(googleReviewCount?.count ?? 0),
      integrationHealth,
      links: {
        publicUrl: buildSalonTenantPublicUrl('/', salon),
        bookingUrl: buildSalonTenantPublicUrl('/book', salon),
        findBookingUrl: buildSalonTenantPublicUrl('/find-booking', salon),
      },
    },
  });
}
