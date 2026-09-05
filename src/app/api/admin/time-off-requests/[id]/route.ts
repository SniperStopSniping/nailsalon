/**
 * Admin Time Off Request Decision API
 *
 * PATCH /api/admin/time-off-requests/[id] - Approve or deny a request
 *
 * SECURITY:
 * - Admin session required
 * - Admin must have access to the salon (enforced via session scope)
 * - Only PENDING requests can be updated
 * - Creates notification for the staff member on decision
 */

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { requireAdminSalonFromRequest } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  buildTimeOffDecisionNotification,
  createStaffNotification,
} from '@/libs/notifications';
import {
  dateOnlyToLocalDate,
  dateOnlyToUtcDate,
  toDateOnlyString,
} from '@/libs/timeOffDates';
import {
  adminUserSchema,
  appointmentSchema,
  technicianSchema,
  technicianTimeOffSchema,
  timeOffRequestSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// VALIDATION
// =============================================================================

const updateRequestSchema = z.object({
  status: z.enum(['APPROVED', 'DENIED']),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// PATCH /api/admin/time-off-requests/[id]
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const { salon, admin, error } = await requireAdminSalonFromRequest(request); // honours ?salonSlug= (membership-checked): a decision lands on the salon whose inbox is on screen
    if (error || !salon || !admin) {
      return error!;
    }

    // 2. Parse and validate body
    const body = await request.json();
    const validated = updateRequestSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data. Status must be APPROVED or DENIED.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { status } = validated.data;

    // 3. Fetch the request to verify it exists and check salon access
    const [existingRequest] = await db
      .select({
        id: timeOffRequestSchema.id,
        salonId: timeOffRequestSchema.salonId,
        technicianId: timeOffRequestSchema.technicianId,
        startDate: timeOffRequestSchema.startDate,
        endDate: timeOffRequestSchema.endDate,
        note: timeOffRequestSchema.note,
        status: timeOffRequestSchema.status,
      })
      .from(timeOffRequestSchema)
      .where(eq(timeOffRequestSchema.id, id))
      .limit(1);

    if (!existingRequest) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Time off request not found' } } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    if (existingRequest.salonId !== salon.id) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Time off request not found' } } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 5. Verify request is still PENDING
    if (existingRequest.status !== 'PENDING') {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot update request - already ${existingRequest.status.toLowerCase()}`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5b. Whole-day DATE columns: normalise once, up front. `technician_time_off`
    // stores real timestamps, and the product's convention for a whole-day block
    // is midnight UTC (ScheduleTab posts `new Date('YYYY-MM-DD').toISOString()`),
    // so the approval write must use the same instants.
    const startDateOnly = toDateOnlyString(existingRequest.startDate);
    const endDateOnly = toDateOnlyString(existingRequest.endDate);
    const blockStart = dateOnlyToUtcDate(startDateOnly);
    const blockEnd = dateOnlyToUtcDate(endDateOnly);

    if (!startDateOnly || !endDateOnly || !blockStart || !blockEnd) {
      console.error(
        `[TimeOffRequest] Request ${id} has an unreadable date range; refusing to decide it`,
      );
      return Response.json(
        {
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'This request has unreadable dates and cannot be decided.',
          },
        } satisfies ErrorResponse,
        { status: 422 },
      );
    }

    // 6. Update the request. An APPROVED decision must also create the
    // technician_time_off row that the availability engine reads —
    // approving a request without it would leave the technician bookable.
    // Both writes happen in one transaction so they can't diverge.
    const updatedRequest = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(timeOffRequestSchema)
        .set({
          status,
          decidedByAdminId: admin.id,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeOffRequestSchema.id, id))
        .returning();

      if (status === 'APPROVED') {
        // Idempotency: skip if an identical time-off block already exists
        // (e.g. the admin also entered it manually before approving).
        const [existingBlock] = await tx
          .select({ id: technicianTimeOffSchema.id })
          .from(technicianTimeOffSchema)
          .where(
            and(
              eq(technicianTimeOffSchema.technicianId, existingRequest.technicianId),
              eq(technicianTimeOffSchema.startDate, blockStart),
              eq(technicianTimeOffSchema.endDate, blockEnd),
            ),
          )
          .limit(1);

        if (!existingBlock) {
          await tx.insert(technicianTimeOffSchema).values({
            id: `timeoff_${nanoid()}`,
            technicianId: existingRequest.technicianId,
            salonId: existingRequest.salonId,
            startDate: blockStart,
            endDate: blockEnd,
            reason: null,
            notes: existingRequest.note
              ? `Approved staff request: ${existingRequest.note}`
              : 'Approved staff request',
          });
        }
      }

      return updated;
    });

    // 7. Get technician info for logging
    const [technician] = await db
      .select({ name: technicianSchema.name })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, existingRequest.technicianId))
      .limit(1);

    console.warn(
      `[TimeOffRequest] Admin ${admin.name || admin.id} ${status.toLowerCase()} request ${id} for ${technician?.name ?? existingRequest.technicianId}`,
    );

    // 8. Create notification for the staff member
    const { title, body: notifBody } = buildTimeOffDecisionNotification({
      status: status as 'APPROVED' | 'DENIED',
      startDate: startDateOnly,
      endDate: endDateOnly,
    });

    await createStaffNotification({
      salonId: existingRequest.salonId,
      technicianId: existingRequest.technicianId,
      type: 'TIME_OFF_DECISION',
      title,
      body: notifBody,
      metadata: {
        timeOffRequestId: id,
        status,
      },
    });

    return Response.json({
      data: {
        request: {
          id: updatedRequest!.id,
          startDate: toDateOnlyString(updatedRequest!.startDate) ?? startDateOnly,
          endDate: toDateOnlyString(updatedRequest!.endDate) ?? endDateOnly,
          note: updatedRequest!.note,
          status: updatedRequest!.status,
          decidedAt: updatedRequest!.decidedAt?.toISOString() ?? null,
          createdAt: updatedRequest!.createdAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error updating time-off request:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update time-off request',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/admin/time-off-requests/[id] - Get single request details + conflicts
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    const { salon, error } = await requireAdminSalonFromRequest(request);
    if (error || !salon) {
      return error!;
    }

    // 2. Fetch the request with decidedByAdminId
    const [existingRequest] = await db
      .select({
        id: timeOffRequestSchema.id,
        salonId: timeOffRequestSchema.salonId,
        technicianId: timeOffRequestSchema.technicianId,
        startDate: timeOffRequestSchema.startDate,
        endDate: timeOffRequestSchema.endDate,
        note: timeOffRequestSchema.note,
        status: timeOffRequestSchema.status,
        decidedAt: timeOffRequestSchema.decidedAt,
        decidedByAdminId: timeOffRequestSchema.decidedByAdminId,
        createdAt: timeOffRequestSchema.createdAt,
      })
      .from(timeOffRequestSchema)
      .where(eq(timeOffRequestSchema.id, id))
      .limit(1);

    if (!existingRequest) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Time off request not found' } } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    if (existingRequest.salonId !== salon.id) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Time off request not found' } } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 4. Get technician name
    const [technician] = await db
      .select({ name: technicianSchema.name })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, existingRequest.technicianId))
      .limit(1);

    // 4b. Whole-day DATE columns -> 'YYYY-MM-DD'. An unreadable range must not
    // take the detail sheet down with it.
    const startDateOnly = toDateOnlyString(existingRequest.startDate);
    const endDateOnly = toDateOnlyString(existingRequest.endDate);
    // Parsed as local midnight (not `new Date(dateOnly)`, which is midnight UTC
    // and lands on the previous day west of Greenwich) because appointment
    // start times are compared in the server's zone.
    const rangeStart = dateOnlyToLocalDate(startDateOnly);
    const rangeEndExclusive = dateOnlyToLocalDate(endDateOnly);

    if (!startDateOnly || !endDateOnly || !rangeStart || !rangeEndExclusive) {
      console.error(
        `[TimeOffRequest] Request ${id} has an unreadable date range`,
      );
      return Response.json(
        {
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'This request has unreadable dates.',
          },
        } satisfies ErrorResponse,
        { status: 422 },
      );
    }

    // 5. Count conflicting appointments (timestamp-safe date range)
    // Time-off dates are inclusive: startDate 00:00:00 to endDate+1 00:00:00
    rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);

    const [conflictResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, existingRequest.technicianId),
          eq(appointmentSchema.salonId, existingRequest.salonId),
          // Deposit holds occupy the technician's slot, so they are genuine
          // conflicts for a time-off window and must be counted here.
          inArray(appointmentSchema.status, ['pending', 'confirmed', 'awaiting_payment']),
          gte(appointmentSchema.startTime, rangeStart),
          lt(appointmentSchema.startTime, rangeEndExclusive),
        ),
      );

    // 6. Get decidedBy admin name if decision was made
    let decidedByName: string | null = null;
    if (existingRequest.decidedByAdminId) {
      const [decidedByAdmin] = await db
        .select({ name: adminUserSchema.name })
        .from(adminUserSchema)
        .where(eq(adminUserSchema.id, existingRequest.decidedByAdminId))
        .limit(1);
      decidedByName = decidedByAdmin?.name ?? 'Admin';
    }

    return Response.json({
      data: {
        request: {
          id: existingRequest.id,
          salonId: existingRequest.salonId,
          technicianId: existingRequest.technicianId,
          technicianName: technician?.name ?? null,
          startDate: startDateOnly,
          endDate: endDateOnly,
          note: existingRequest.note,
          status: existingRequest.status,
          decidedAt: existingRequest.decidedAt?.toISOString() ?? null,
          decidedBy: decidedByName,
          createdAt: existingRequest.createdAt.toISOString(),
        },
        conflicts: {
          appointmentCount: conflictResult?.count ?? 0,
          range: {
            from: startDateOnly,
            to: endDateOnly,
          },
        },
      },
    });
  } catch (error) {
    console.error('Error fetching time-off request:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch time-off request',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
