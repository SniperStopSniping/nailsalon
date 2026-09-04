import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { loadBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { db } from '@/libs/DB';
import { getCompletedFinancialResolution } from '@/libs/financialReportingServer';
import { isFullAccess, redactClientForStaff } from '@/libs/redact';
import { requireStaffOrAdminSalonAccess } from '@/libs/routeAccessGuards';
import { getEffectiveVisibility } from '@/libs/visibilityPolicy';
import {
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  clientPreferencesSchema,
  clientSchema,
  salonClientSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonSettings, SalonVisibilityPolicy } from '@/types/salonPolicy';

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

export async function GET(request: Request, props: { params: Promise<{ phone: string }> }): Promise<Response> {
  const params = await props.params;
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

    const access = await requireStaffOrAdminSalonAccess(validated.data.salonSlug);
    if (!access.ok) {
      return access.response;
    }
    const { salon } = access;
    const bookingConfig = resolveBookingConfigFromSettings(
      salon.settings as SalonSettings | null | undefined,
    );

    // Fetch salon visibility policy for staff redaction
    const [salonData] = await db
      .select({ visibility: salonSchema.visibility })
      .from(salonSchema)
      .where(eq(salonSchema.id, salon.id))
      .limit(1);
    const salonVisibilityPolicy = (salonData?.visibility as SalonVisibilityPolicy) ?? null;

    const visibility = getEffectiveVisibility(
      salonVisibilityPolicy,
      access.actorRole === 'admin' ? 'admin' : 'staff',
    );

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

    // Google review flag lives on the per-salon client record
    const [salonClientRow] = await db
      .select({ hasGoogleReview: salonClientSchema.hasGoogleReview })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salon.id),
        inArray(salonClientSchema.phone, phoneVariants),
      ))
      .limit(1);

    // Tenant isolation: the global client record (name, member-since) is only
    // exposed when this phone number has a relationship with THIS salon.
    // An unscoped lookup let staff of any salon read another salon's client
    // name by typing their phone number.
    const [client] = salonClientRow
      ? await db
        .select()
        .from(clientSchema)
        .where(inArray(clientSchema.phone, phoneVariants))
        .limit(1)
      : [undefined];

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
    const appointmentWhereClauses = [
      eq(appointmentSchema.salonId, salon.id),
      inArray(appointmentSchema.clientPhone, phoneVariants),
      ...(access.actorRole === 'staff'
        ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
        : []),
    ];

    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(and(...appointmentWhereClauses))
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

        const financial = await loadBookingEmailFinancialSummary({
          salonId: salon.id,
          appointmentId: appt.id,
        });
        const financialResolved = financial !== null
          && financial.depositBlockedCode === null;

        return {
          id: appt.id,
          startTime: appt.startTime.toISOString(),
          endTime: appt.endTime.toISOString(),
          status: appt.status,
          // A non-null summary may still represent an unresolved deposit. Do
          // not let the legacy scalar or the summary's zero-credit fallback
          // escape as if it were a settled customer balance.
          totalPrice: financialResolved ? appt.totalPrice : null,
          currency: financial?.currency ?? appt.invoiceCurrency ?? null,
          financialState: financialResolved ? 'resolved' as const : 'blocked' as const,
          financialBlockCode: financial?.depositBlockedCode
            ?? (financial === null
              ? 'FINANCIAL_SNAPSHOT_RECONCILIATION_REQUIRED'
              : null),
          financial: financialResolved ? financial : null,
          technicianName: techName,
          services: apptServices.map(s => s.serviceName),
        };
      }),
    );

    // Get all photos for this client at this salon
    const appointmentIds = appointments.map(appt => appt.id);
    const photos = appointmentIds.length === 0
      ? []
      : await db
        .select()
        .from(appointmentPhotoSchema)
        .where(
          and(
            eq(appointmentPhotoSchema.salonId, salon.id),
            inArray(appointmentPhotoSchema.appointmentId, appointmentIds),
          ),
        )
        .orderBy(desc(appointmentPhotoSchema.createdAt));

    // Calculate stats
    const completedAppointments = appointments.filter(a => a.status === 'completed');
    const completedFinancialResolution = await getCompletedFinancialResolution({
      salonId: salon.id,
      currency: bookingConfig.currency,
      asOf: new Date(),
      clientPhoneVariants: phoneVariants,
      technicianId: access.actorRole === 'staff'
        ? access.session.technicianId
        : undefined,
    });
    const completedFinancialRows = completedFinancialResolution.resolvedRows;
    const settledCompletedFinancialRows = completedFinancialRows.filter(
      row => row.financiallySettled,
    );
    const totalSpent = completedFinancialResolution.unresolvedRows.length > 0
      ? null
      : settledCompletedFinancialRows.reduce(
        (sum, row) => sum + row.serviceValueCents,
        0,
      );

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
      totalSpent: totalSpent ?? 0,
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
        hasGoogleReview: Boolean(salonClientRow?.hasGoogleReview),
      };
      redactedStats = {
        totalVisits: fullClient.totalVisits,
        totalSpent,
        currency: bookingConfig.currency,
        spendState: totalSpent === null ? 'under_review' : 'resolved',
        lastVisit: fullClient.lastVisitAt,
      };
    } else {
      // Apply staff visibility rules
      const redacted = redactClientForStaff(fullClient, visibility);

      // Build client response (only include allowed fields)
      // hasGoogleReview is not sensitive client PII — always include it.
      redactedClient = { id: fullClient.id, hasGoogleReview: Boolean(salonClientRow?.hasGoogleReview) };
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
        redactedStats.totalSpent = totalSpent;
        redactedStats.currency = bookingConfig.currency;
        redactedStats.spendState = totalSpent === null
          ? 'under_review'
          : 'resolved';
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
      finalAppointments = appointmentsWithServices.map(({
        totalPrice: _totalPrice,
        currency: _currency,
        financial: _financial,
        ...rest
      }) => rest) as typeof appointmentsWithServices;
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
