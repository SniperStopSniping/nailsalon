import { and, desc, eq, inArray } from 'drizzle-orm';

import { requireClientApiSession, requireClientSalonFromQuery } from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import {
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * GET /api/appointments/history
 * Returns ALL appointments for a client, sorted newest to oldest.
 * Includes all statuses: pending, confirmed, cancelled, completed, no_show
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }
    const salonGuard = await requireClientSalonFromQuery(url.searchParams);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    // Find ALL appointments for this client, sorted by newest first
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          inArray(appointmentSchema.clientPhone, auth.phoneVariants),
          eq(appointmentSchema.salonId, salon.id),
        ),
      )
      .orderBy(desc(appointmentSchema.startTime));

    if (appointments.length === 0) {
      return Response.json(
        { data: { appointments: [] } },
        { status: 200 },
      );
    }

    // Get all appointment IDs for batch fetching services
    const appointmentIds = appointments.map(a => a.id);

    // Batch fetch all appointment services
    const allAppointmentServices = await db
      .select({
        appointmentId: appointmentServicesSchema.appointmentId,
        serviceId: appointmentServicesSchema.serviceId,
        priceAtBooking: appointmentServicesSchema.priceAtBooking,
        durationAtBooking: appointmentServicesSchema.durationAtBooking,
      })
      .from(appointmentServicesSchema)
      .where(inArray(appointmentServicesSchema.appointmentId, appointmentIds));

    // Get unique service IDs
    const serviceIds = [...new Set(allAppointmentServices.map(as => as.serviceId))];

    // Batch fetch all services
    const services = serviceIds.length > 0
      ? await db
        .select()
        .from(serviceSchema)
        .where(inArray(serviceSchema.id, serviceIds))
      : [];

    // Create service lookup map
    const serviceMap = new Map(services.map(s => [s.id, s]));

    // Get unique technician IDs
    const technicianIds = [...new Set(appointments.map(a => a.technicianId).filter(Boolean))] as string[];

    // Batch fetch all technicians
    const technicians = technicianIds.length > 0
      ? await db
        .select()
        .from(technicianSchema)
        .where(inArray(technicianSchema.id, technicianIds))
      : [];

    // Create technician lookup map
    const technicianMap = new Map(technicians.map(t => [t.id, t]));

    // Build response with all details
    const appointmentsWithDetails = appointments.map((appointment) => {
      // Get services for this appointment
      const apptServices = allAppointmentServices.filter(
        as => as.appointmentId === appointment.id,
      );

      const servicesData = apptServices.map((as) => {
        const service = serviceMap.get(as.serviceId);
        return {
          id: as.serviceId,
          name: service?.name ?? 'Unknown Service',
          price: as.priceAtBooking,
          duration: as.durationAtBooking,
          imageUrl: service?.imageUrl ?? null,
        };
      });

      // Get technician
      const technician = appointment.technicianId
        ? technicianMap.get(appointment.technicianId)
        : null;

      return {
        id: appointment.id,
        startTime: appointment.startTime.toISOString(),
        endTime: appointment.endTime.toISOString(),
        status: appointment.status,
        cancelReason: appointment.cancelReason,
        totalPrice: appointment.totalPrice,
        totalDurationMinutes: appointment.totalDurationMinutes,
        locationId: appointment.locationId,
        services: servicesData,
        technician: technician
          ? {
              id: technician.id,
              name: technician.name,
              avatarUrl: technician.avatarUrl,
            }
          : null,
      };
    });

    return Response.json({
      data: {
        appointments: appointmentsWithDetails,
      },
      meta: {
        timestamp: new Date().toISOString(),
        count: appointmentsWithDetails.length,
      },
    });
  } catch (error) {
    console.error('Error fetching appointment history:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
