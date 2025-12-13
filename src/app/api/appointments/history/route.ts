import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * GET /api/appointments/history?phone=1234567890
 * Returns ALL appointments for a client, sorted newest to oldest.
 * Includes all statuses: pending, confirmed, cancelled, completed, no_show
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const phone = url.searchParams.get('phone');

    if (!phone) {
      return Response.json(
        {
          error: {
            code: 'MISSING_PHONE',
            message: 'Phone number is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Normalize phone to handle different formats
    // Include 10-digit version (strip leading 1 if 11 digits) to match stored format
    const normalizedPhone = phone.replace(/\D/g, '');
    const tenDigitPhone = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
      ? normalizedPhone.slice(1)
      : normalizedPhone;
    const phoneVariants = [
      phone,
      normalizedPhone,
      tenDigitPhone,
      `+1${tenDigitPhone}`,
      `+${normalizedPhone}`,
    ];

    // Get the salon
    const salon = await getSalonBySlug(DEFAULT_SALON_SLUG);
    if (!salon) {
      return Response.json(
        { data: { appointments: [] } },
        { status: 200 },
      );
    }

    // Find ALL appointments for this client, sorted by newest first
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          inArray(appointmentSchema.clientPhone, phoneVariants),
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
