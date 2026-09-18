import { and, eq, inArray, sql } from 'drizzle-orm';

import { requireAdminSalon } from '@/libs/adminAuth';
import {
  createAppointmentFromRequest,
  loadAppointmentDetailMaps,
  parseStatusParam,
  resolveAppointmentDateRange,
} from '@/libs/appointmentCreation.server';
import {
  getBookingConfigForSalon,
} from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { getEffectiveStaffVisibility } from '@/libs/featureGating';
import { redactAppointmentForStaff } from '@/libs/redact';
import { requireStaffSession } from '@/libs/staffAuth';
import {
  APPOINTMENT_STATUSES,
  appointmentSchema,
  salonSchema,
} from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return createAppointmentFromRequest(request);
}

// =============================================================================
// GET /api/appointments - Fetch appointments (for staff dashboard)
// =============================================================================
//
// SECURITY CONTRACT (Step 16.4 Hardening):
// =========================================
//
// STAFF REQUESTS (detected via staff session cookies):
//   - salonId: DERIVED FROM SESSION (query params IGNORED)
//   - technicianId: DERIVED FROM SESSION (query params IGNORED)
//   - ALLOWED query params (whitelist):
//     * date, startDate, endDate - date filtering
//     * status - status filtering (validated against APPOINTMENT_STATUSES)
//     * limit - pagination (max 100)
//   - IGNORED query params (blacklist - silently dropped):
//     * salonSlug, salonId, technicianId, includeDeleted, allTechs
//   - Response: REDACTED via getEffectiveStaffVisibility + redactAppointmentForStaff
//
// ADMIN REQUESTS (no staff session):
//   - Requires explicit admin auth for the resolved salonSlug
//   - Public/customer filter-driven reads are not allowed here
//
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);

    // ==========================================================================
    // SECURITY: Check for staff session FIRST
    // If present, staff context wins and query params for identity are ignored.
    // ==========================================================================
    const staffAuth = await requireStaffSession();

    if (staffAuth.ok) {
      // SECURITY: These values come ONLY from validated session
      const salonId = staffAuth.session.salonId;
      const technicianId = staffAuth.session.technicianId;

      // Fetch salon features + settings for visibility resolution
      const [salonData] = await db
        .select({
          features: salonSchema.features,
          settings: salonSchema.settings,
        })
        .from(salonSchema)
        .where(eq(salonSchema.id, salonId))
        .limit(1);
      const bookingConfig = await getBookingConfigForSalon(salonId);

      const salonFeatures = (salonData?.features as SalonFeatures) ?? null;
      const salonSettings = (salonData?.settings as SalonSettings) ?? null;

      // =====================================================================
      // STAFF PARAM WHITELIST: Only these query params are allowed for staff
      // All identity params (salonSlug, technicianId, salonId) are IGNORED
      // =====================================================================
      const dateParam = searchParams.get('date');
      const statusParam = searchParams.get('status');
      const startDateParam = searchParams.get('startDate');
      const endDateParam = searchParams.get('endDate');
      const limitParam = searchParams.get('limit');

      const { startOfDay, endOfDay } = resolveAppointmentDateRange({
        dateParam,
        startDateParam,
        endDateParam,
        timeZone: bookingConfig.timezone,
      });

      // Parse status filter with validation against allowed values
      const parsedStatuses = parseStatusParam(statusParam);

      // If caller provided statuses but ALL were invalid, reject with 400
      if (parsedStatuses !== null && parsedStatuses.length === 0) {
        return Response.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid status filter. Valid values: ${APPOINTMENT_STATUSES.join(', ')}`,
            },
          },
          { status: 400 },
        );
      }

      const statuses = parsedStatuses ?? ['confirmed', 'in_progress'];

      // Parse limit with cap for staff (prevent abuse)
      let limit = 50; // Default
      if (limitParam) {
        const parsed = Number.parseInt(limitParam, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          limit = Math.min(parsed, 100); // Cap at 100 for staff
        }
      }

      // Build query with session-derived identity (NEVER from params)
      const appointments = await db
        .select()
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salonId),
            eq(appointmentSchema.technicianId, technicianId),
            sql`${appointmentSchema.startTime} >= ${startOfDay}`,
            sql`${appointmentSchema.startTime} <= ${endOfDay}`,
            inArray(appointmentSchema.status, statuses),
          ),
        )
        .orderBy(appointmentSchema.startTime)
        .limit(limit);

      const appointmentIds = appointments.map(appt => appt.id);
      const { servicesByAppointmentId, photosByAppointmentId } = await loadAppointmentDetailMaps(appointmentIds);

      const appointmentsWithDetails = appointments.map((appt) => {
        const services = servicesByAppointmentId.get(appt.id) ?? [];
        const photos = photosByAppointmentId.get(appt.id) ?? [];

        // Build object with ONLY safe fields for staff
        // Note: cancelReason, internalNotes, paymentStatus, metadata are NOT included
        return {
          id: appt.id,
          clientName: appt.clientName,
          clientPhone: appt.clientPhone,
          startTime: appt.startTime.toISOString(),
          endTime: appt.endTime.toISOString(),
          status: appt.status,
          technicianId: appt.technicianId,
          totalPrice: appt.totalPrice,
          invoiceCurrency: appt.invoiceCurrency,
          totalDurationMinutes: appt.totalDurationMinutes,
          locationId: appt.locationId,
          services: services.map(s => ({ name: s.name })),
          photos,
        };
      });

      // Apply visibility redaction
      const visibility = getEffectiveStaffVisibility(salonFeatures, salonSettings);
      const redactedAppointments = appointmentsWithDetails.map(appt =>
        redactAppointmentForStaff(appt, visibility),
      );

      // Return staff response (early return - no fallthrough to admin path)
      return Response.json({
        data: {
          appointments: redactedAppointments,
        },
        meta: {
          slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
        },
      });
    }

    // =========================================================================
    // ADMIN REQUEST PATH
    // Explicit admin access only. Public/customer reads are not allowed here.
    // =========================================================================
    const dateParam = searchParams.get('date');
    const statusParam = searchParams.get('status');
    const salonSlug = searchParams.get('salonSlug');
    const technicianIdParam = searchParams.get('technicianId');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const limitParam = searchParams.get('limit');

    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Staff or admin authentication is required',
          },
        },
        { status: 401 },
      );
    }

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const salonId = salon.id;
    const technicianId = technicianIdParam;

    const { startOfDay, endOfDay } = resolveAppointmentDateRange({
      dateParam,
      startDateParam,
      endDateParam,
    });

    // Use same validation helper for admin path
    const parsedStatuses = parseStatusParam(statusParam);
    const statuses = parsedStatuses ?? ['confirmed', 'in_progress'];

    // Build where conditions for admin path
    const conditions = [
      sql`${appointmentSchema.startTime} >= ${startOfDay}`,
      sql`${appointmentSchema.startTime} <= ${endOfDay}`,
      inArray(appointmentSchema.status, statuses),
    ];

    if (salonId) {
      conditions.push(eq(appointmentSchema.salonId, salonId));
    }

    if (technicianId) {
      conditions.push(eq(appointmentSchema.technicianId, technicianId));
    }

    let query = db
      .select()
      .from(appointmentSchema)
      .where(and(...conditions))
      .orderBy(appointmentSchema.startTime);

    if (limitParam) {
      const limit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(limit) && limit > 0) {
        query = query.limit(limit) as typeof query;
      }
    }

    const appointments = await query;

    const appointmentIds = appointments.map(appt => appt.id);
    const { servicesByAppointmentId, photosByAppointmentId } = await loadAppointmentDetailMaps(appointmentIds);

    const appointmentsWithDetails = appointments.map((appt) => {
      const services = servicesByAppointmentId.get(appt.id) ?? [];
      const photos = photosByAppointmentId.get(appt.id) ?? [];

      // Admin gets full appointment data (no redaction)
      return {
        id: appt.id,
        clientName: appt.clientName,
        clientPhone: appt.clientPhone,
        startTime: appt.startTime.toISOString(),
        endTime: appt.endTime.toISOString(),
        status: appt.status,
        technicianId: appt.technicianId,
        totalPrice: appt.totalPrice,
        invoiceCurrency: appt.invoiceCurrency,
        cancelReason: appt.cancelReason,
        paymentStatus: appt.paymentStatus,
        services: services.map(s => ({ name: s.name })),
        photos,
      };
    });

    return Response.json({
      data: {
        appointments: appointmentsWithDetails,
      },
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch appointments',
        },
      },
      { status: 500 },
    );
  }
}
