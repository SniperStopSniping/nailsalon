import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { isFullAccess, redactClientForStaff } from '@/libs/redact';
import { getEffectiveVisibility } from '@/libs/visibilityPolicy';
import {
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  clientPreferencesSchema,
  clientSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonVisibilityPolicy } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getClientProfileSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

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

    // Get salon with visibility policy
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

    // Fetch salon visibility policy for staff redaction
    const [salonData] = await db
      .select({ visibility: salonSchema.visibility })
      .from(salonSchema)
      .where(eq(salonSchema.id, salon.id))
      .limit(1);
    const salonVisibilityPolicy = (salonData?.visibility as SalonVisibilityPolicy) ?? null;

    // Get effective visibility for staff role
    const visibility = getEffectiveVisibility(salonVisibilityPolicy, 'staff');

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
          services: apptServices.map(s => s.serviceName),
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
    const completedAppointments = appointments.filter(a => a.status === 'completed');
    const totalSpent = completedAppointments.reduce((sum, a) => sum + a.totalPrice, 0);

    // ==========================================================================
    // REDACTION: Apply visibility policy for staff requests
    // This is a staff-only endpoint, so always apply staff visibility rules
    // ==========================================================================

    // Build client object with redaction applied
    const fullClient = {
      id: normalizedPhone, // Use phone as ID for redaction
      phone: normalizedPhone,
      fullName: client?.firstName || appointments[0]?.clientName || null,
      name: client?.firstName || appointments[0]?.clientName || null,
      memberSince: client?.createdAt?.toISOString() || appointments[appointments.length - 1]?.createdAt.toISOString() || null,
      // History fields (controlled by showClientHistory)
      totalVisits: completedAppointments.length,
      totalSpent,
      lastVisitAt: completedAppointments[0]?.startTime.toISOString() || null,
    };

    // Apply redaction to client data
    let redactedClient: Record<string, unknown>;
    let redactedStats: Record<string, unknown>;

    if (isFullAccess(visibility)) {
      // This shouldn't happen for staff, but handle gracefully
      redactedClient = {
        phone: fullClient.phone,
        name: fullClient.name,
        memberSince: fullClient.memberSince,
      };
      redactedStats = {
        totalVisits: fullClient.totalVisits,
        totalSpent: fullClient.totalSpent,
        lastVisit: fullClient.lastVisitAt,
      };
    } else {
      // Apply staff visibility rules
      const redacted = redactClientForStaff(fullClient, visibility);

      // Build client response (only include allowed fields)
      redactedClient = { id: fullClient.id };
      if ('phone' in redacted) {
        redactedClient.phone = redacted.phone;
      }
      if ('name' in redacted || 'fullName' in redacted) {
        redactedClient.name = redacted.name ?? redacted.fullName;
      }
      if ('memberSince' in redacted) {
        redactedClient.memberSince = redacted.memberSince;
      }

      // Build stats response (controlled by showClientHistory)
      redactedStats = {};
      if (visibility.showClientHistory) {
        redactedStats.totalVisits = fullClient.totalVisits;
        redactedStats.totalSpent = fullClient.totalSpent;
        redactedStats.lastVisit = fullClient.lastVisitAt;
      }
    }

    // Build preferences response (notes controlled by showClientNotes)
    let preferencesResponse = null;
    if (preferences) {
      preferencesResponse = {
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
      } as Record<string, unknown>;

      // Only include notes if visibility allows
      if (!isFullAccess(visibility) && visibility.showClientNotes) {
        preferencesResponse.techNotes = preferences.techNotes;
        preferencesResponse.appointmentNotes = preferences.appointmentNotes;
      } else if (isFullAccess(visibility)) {
        preferencesResponse.techNotes = preferences.techNotes;
        preferencesResponse.appointmentNotes = preferences.appointmentNotes;
      }
    }

    // Redact appointment prices if needed
    let finalAppointments = appointmentsWithServices;
    if (!isFullAccess(visibility) && !visibility.showAppointmentPrice) {
      finalAppointments = appointmentsWithServices.map(({ totalPrice, ...rest }) => rest) as typeof appointmentsWithServices;
    }

    // Build response
    return Response.json({
      data: {
        client: redactedClient,
        stats: redactedStats,
        preferences: preferencesResponse,
        appointments: finalAppointments,
        photos: photos.map(p => ({
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
