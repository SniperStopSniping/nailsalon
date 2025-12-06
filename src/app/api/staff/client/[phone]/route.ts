import { and, eq, desc, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  appointmentSchema,
  appointmentPhotoSchema,
  appointmentServicesSchema,
  clientPreferencesSchema,
  clientSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getClientProfileSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Helper to normalize phone to 10 digits
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// =============================================================================
// GET /api/staff/client/[phone] - Get client profile for staff view
// =============================================================================
// Returns client info, past appointments, photos, and preferences
// Scoped to salon for multi-tenancy
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: { phone: string } },
): Promise<Response> {
  try {
    const rawPhone = params.phone;
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    // Validate query params
    const validated = getClientProfileSchema.safeParse({ salonSlug });
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Get salon
    const salon = await getSalonBySlug(validated.data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Normalize phone number
    const normalizedPhone = normalizePhone(rawPhone);
    if (normalizedPhone.length !== 10) {
      return Response.json(
        {
          error: {
            code: 'INVALID_PHONE',
            message: 'Phone number must be 10 digits',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Phone variants for matching
    const phoneVariants = [
      normalizedPhone,
      `+1${normalizedPhone}`,
      `1${normalizedPhone}`,
    ];

    // Get client basic info
    const [client] = await db
      .select()
      .from(clientSchema)
      .where(inArray(clientSchema.phone, phoneVariants))
      .limit(1);

    // Get client preferences for this salon
    const [preferences] = await db
      .select()
      .from(clientPreferencesSchema)
      .where(
        and(
          eq(clientPreferencesSchema.salonId, salon.id),
          eq(clientPreferencesSchema.normalizedClientPhone, normalizedPhone),
        ),
      )
      .limit(1);

    // Get favorite technician name if set
    let favoriteTechName = null;
    if (preferences?.favoriteTechId) {
      const [tech] = await db
        .select({ name: technicianSchema.name })
        .from(technicianSchema)
        .where(eq(technicianSchema.id, preferences.favoriteTechId))
        .limit(1);
      favoriteTechName = tech?.name || null;
    }

    // Get all appointments for this client at this salon
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.clientPhone, phoneVariants),
        ),
      )
      .orderBy(desc(appointmentSchema.startTime));

    // Get services for each appointment
    const appointmentsWithServices = await Promise.all(
      appointments.map(async (appt) => {
        const apptServices = await db
          .select({
            serviceName: serviceSchema.name,
            priceAtBooking: appointmentServicesSchema.priceAtBooking,
          })
          .from(appointmentServicesSchema)
          .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
          .where(eq(appointmentServicesSchema.appointmentId, appt.id));

        // Get technician name
        let techName = null;
        if (appt.technicianId) {
          const [tech] = await db
            .select({ name: technicianSchema.name })
            .from(technicianSchema)
            .where(eq(technicianSchema.id, appt.technicianId))
            .limit(1);
          techName = tech?.name || null;
        }

        return {
          id: appt.id,
          startTime: appt.startTime.toISOString(),
          endTime: appt.endTime.toISOString(),
          status: appt.status,
          totalPrice: appt.totalPrice,
          technicianName: techName,
          services: apptServices.map((s) => s.serviceName),
        };
      }),
    );

    // Get all photos for this client at this salon
    const photos = await db
      .select()
      .from(appointmentPhotoSchema)
      .where(
        and(
          eq(appointmentPhotoSchema.salonId, salon.id),
          eq(appointmentPhotoSchema.normalizedClientPhone, normalizedPhone),
        ),
      )
      .orderBy(desc(appointmentPhotoSchema.createdAt));

    // Calculate stats
    const completedAppointments = appointments.filter((a) => a.status === 'completed');
    const totalSpent = completedAppointments.reduce((sum, a) => sum + a.totalPrice, 0);

    // Build response
    return Response.json({
      data: {
        client: {
          phone: normalizedPhone,
          name: client?.firstName || appointments[0]?.clientName || null,
          memberSince: client?.createdAt?.toISOString() || appointments[appointments.length - 1]?.createdAt.toISOString() || null,
        },
        stats: {
          totalVisits: completedAppointments.length,
          totalSpent,
          lastVisit: completedAppointments[0]?.startTime.toISOString() || null,
        },
        preferences: preferences
          ? {
              favoriteTechId: preferences.favoriteTechId,
              favoriteTechName,
              favoriteServices: preferences.favoriteServices,
              nailShape: preferences.nailShape,
              nailLength: preferences.nailLength,
              finishes: preferences.finishes,
              colorFamilies: preferences.colorFamilies,
              preferredBrands: preferences.preferredBrands,
              sensitivities: preferences.sensitivities,
              musicPreference: preferences.musicPreference,
              conversationLevel: preferences.conversationLevel,
              beveragePreference: preferences.beveragePreference,
              techNotes: preferences.techNotes,
              appointmentNotes: preferences.appointmentNotes,
            }
          : null,
        appointments: appointmentsWithServices,
        photos: photos.map((p) => ({
          id: p.id,
          appointmentId: p.appointmentId,
          photoType: p.photoType,
          imageUrl: p.imageUrl,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          createdAt: p.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching client profile:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch client profile',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

