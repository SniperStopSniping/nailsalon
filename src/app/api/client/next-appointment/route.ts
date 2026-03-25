import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';

import { requireClientApiSession, requireClientSalonFromQuery } from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { buildDirectionsDestination, resolveDirectionsLocation } from '@/libs/directions';
import { getLocationById, getPrimaryLocation } from '@/libs/queries';
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
 * GET /api/client/next-appointment
 * Returns the client's next upcoming appointment with service and technician details
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

    // Find the next active appointment for this client (try multiple phone formats)
    const now = new Date();
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          inArray(appointmentSchema.clientPhone, auth.phoneVariants),
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress']),
          gte(appointmentSchema.startTime, now),
          isNull(appointmentSchema.deletedAt),
        ),
      )
      .orderBy(asc(appointmentSchema.startTime))
      .limit(1);

    const appointment = appointments[0];

    if (!appointment) {
      return Response.json(
        { data: { appointment: null } },
        { status: 200 },
      );
    }

    // Get the services for this appointment
    const appointmentServices = await db
      .select({
        serviceId: appointmentServicesSchema.serviceId,
        priceAtBooking: appointmentServicesSchema.priceAtBooking,
        durationAtBooking: appointmentServicesSchema.durationAtBooking,
      })
      .from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointment.id));

    // Get service details
    const serviceIds = appointmentServices.map(as => as.serviceId);
    const services = serviceIds.length > 0
      ? await db
        .select()
        .from(serviceSchema)
        .where(inArray(serviceSchema.id, serviceIds))
      : [];

    // Get technician details if assigned
    let technician = null;
    if (appointment.technicianId) {
      const techs = await db
        .select()
        .from(technicianSchema)
        .where(eq(technicianSchema.id, appointment.technicianId))
        .limit(1);
      technician = techs[0] ?? null;
    }

    const salonDirectionsFallback = buildDirectionsDestination({
      address: salon.address,
      city: salon.city,
      state: salon.state,
      zipCode: salon.zipCode,
    })
      ? {
          id: appointment.locationId ?? `salon_${salon.id}`,
          name: salon.name,
          address: salon.address,
          city: salon.city,
          state: salon.state,
          zipCode: salon.zipCode,
        }
      : null;

    const appointmentLocation = appointment.locationId
      ? await getLocationById(appointment.locationId, salon.id)
      : null;
    const primaryLocation = buildDirectionsDestination(appointmentLocation)
      ? null
      : await getPrimaryLocation(salon.id);
    const resolvedLocation = resolveDirectionsLocation(appointmentLocation, primaryLocation);

    const location = resolvedLocation
      ? {
          id: resolvedLocation.id,
          name: resolvedLocation.name,
          address: resolvedLocation.address,
          city: resolvedLocation.city,
          state: resolvedLocation.state,
          zipCode: resolvedLocation.zipCode,
        }
      : salonDirectionsFallback;

    return Response.json({
      data: {
        appointment: {
          id: appointment.id,
          startTime: appointment.startTime.toISOString(),
          endTime: appointment.endTime.toISOString(),
          status: appointment.status,
          totalPrice: appointment.totalPrice,
          totalDurationMinutes: appointment.totalDurationMinutes,
          locationId: appointment.locationId,
        },
        services: services.map(s => ({
          id: s.id,
          name: s.name,
          price: appointmentServices.find(as => as.serviceId === s.id)?.priceAtBooking ?? s.price,
          duration: appointmentServices.find(as => as.serviceId === s.id)?.durationAtBooking ?? s.durationMinutes,
          imageUrl: s.imageUrl,
        })),
        technician: technician
          ? {
              id: technician.id,
              name: technician.name,
              avatarUrl: technician.avatarUrl,
            }
          : null,
        location,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching next appointment:', error);

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
