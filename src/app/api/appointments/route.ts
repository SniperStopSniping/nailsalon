import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug, getServicesByIds, getTechnicianById } from '@/libs/queries';
import { sendBookingConfirmationToClient, sendBookingNotificationToTech } from '@/libs/SMS';
import {
  appointmentSchema,
  appointmentServicesSchema,
  type Appointment,
  type AppointmentService,
  type Service,
} from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const createAppointmentSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  serviceIds: z.array(z.string()).min(1, 'At least one service is required'),
  technicianId: z.string().nullable(), // null = "any artist"
  clientPhone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  clientName: z.string().optional(),
  startTime: z.string().datetime({ message: 'Invalid datetime format. Use ISO 8601.' }),
});

type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface AppointmentResponse {
  appointment: Appointment;
  services: Array<{
    service: Service;
    priceAtBooking: number;
    durationAtBooking: number;
  }>;
  technician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  salon: {
    id: string;
    name: string;
    slug: string;
  };
}

interface SuccessResponse {
  data: AppointmentResponse;
  meta: {
    timestamp: string;
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// =============================================================================
// POST /api/appointments - Create a new appointment
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = createAppointmentSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const data: CreateAppointmentRequest = parsed.data;

    // 2. Resolve salon from slug
    const salon = await getSalonBySlug(data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon with slug "${data.salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Validate services belong to salon
    const services = await getServicesByIds(data.serviceIds, salon.id);

    if (services.length !== data.serviceIds.length) {
      const foundIds = new Set(services.map(s => s.id));
      const missingIds = data.serviceIds.filter(id => !foundIds.has(id));
      return Response.json(
        {
          error: {
            code: 'INVALID_SERVICES',
            message: 'One or more services not found for this salon',
            details: { missingServiceIds: missingIds },
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Validate technician (if provided) belongs to salon
    let technician = null;
    if (data.technicianId && data.technicianId !== 'any') {
      technician = await getTechnicianById(data.technicianId, salon.id);
      if (!technician) {
        return Response.json(
          {
            error: {
              code: 'INVALID_TECHNICIAN',
              message: `Technician "${data.technicianId}" not found for this salon`,
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 5. Calculate total price and duration
    const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
    const totalDurationMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);

    // 6. Compute endTime from startTime + total duration
    const startTime = new Date(data.startTime);
    const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000);

    // 7. Generate appointment ID
    const appointmentId = `appt_${crypto.randomUUID()}`;

    // 8. Insert appointment
    const [appointment] = await db
      .insert(appointmentSchema)
      .values({
        id: appointmentId,
        salonId: salon.id,
        technicianId: technician?.id ?? null,
        clientPhone: data.clientPhone,
        clientName: data.clientName,
        startTime,
        endTime,
        status: 'pending',
        totalPrice,
        totalDurationMinutes,
      })
      .returning();

    if (!appointment) {
      throw new Error('Failed to create appointment');
    }

    // 9. Insert appointment services (with price/duration snapshot)
    const appointmentServices: AppointmentService[] = [];
    for (const service of services) {
      const [apptService] = await db
        .insert(appointmentServicesSchema)
        .values({
          id: `apptSvc_${crypto.randomUUID()}`,
          appointmentId: appointment.id,
          serviceId: service.id,
          priceAtBooking: service.price,
          durationAtBooking: service.durationMinutes,
        })
        .returning();

      if (apptService) {
        appointmentServices.push(apptService);
      }
    }

    // 10. Send SMS notifications (stub functions)
    await sendBookingConfirmationToClient({
      phone: data.clientPhone,
      clientName: data.clientName,
      appointmentId: appointment.id,
      salonName: salon.name,
      services: services.map(s => s.name),
      technicianName: technician?.name ?? 'Any available artist',
      startTime: startTime.toISOString(),
      totalPrice,
    });

    if (technician) {
      await sendBookingNotificationToTech({
        technicianId: technician.id,
        technicianName: technician.name,
        appointmentId: appointment.id,
        clientName: data.clientName ?? 'Guest',
        clientPhone: data.clientPhone,
        services: services.map(s => s.name),
        startTime: startTime.toISOString(),
        totalDurationMinutes,
      });
    }

    // 11. Build and return response
    const response: SuccessResponse = {
      data: {
        appointment,
        services: services.map((service) => {
          const apptService = appointmentServices.find(as => as.serviceId === service.id);
          return {
            service,
            priceAtBooking: apptService?.priceAtBooking ?? service.price,
            durationAtBooking: apptService?.durationAtBooking ?? service.durationMinutes,
          };
        }),
        technician: technician
          ? {
              id: technician.id,
              name: technician.name,
              avatarUrl: technician.avatarUrl,
            }
          : null,
        salon: {
          id: salon.id,
          name: salon.name,
          slug: salon.slug,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating appointment:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while creating the appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

