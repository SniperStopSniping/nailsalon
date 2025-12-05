import { eq, and, inArray, gte, asc } from 'drizzle-orm';

import { db } from '@/libs/DB';

export const dynamic = 'force-dynamic';
import { getSalonBySlug } from '@/libs/queries';
import {
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

// Default salon slug - in production this would come from subdomain
const DEFAULT_SALON_SLUG = 'nail-salon-no5';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/**
 * GET /api/client/next-appointment?phone=1234567890
 * Returns the client's next upcoming appointment with service and technician details
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
        { data: { appointment: null } },
        { status: 200 },
      );
    }

    // Find the next active appointment for this client (try multiple phone formats)
    const now = new Date();
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          inArray(appointmentSchema.clientPhone, phoneVariants),
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.status, ['pending', 'confirmed']),
          gte(appointmentSchema.startTime, now),
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

    return Response.json({
      data: {
        appointment: {
          id: appointment.id,
          startTime: appointment.startTime.toISOString(),
          endTime: appointment.endTime.toISOString(),
          status: appointment.status,
          totalPrice: appointment.totalPrice,
          totalDurationMinutes: appointment.totalDurationMinutes,
          clientPhone: appointment.clientPhone,
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

