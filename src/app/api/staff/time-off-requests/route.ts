/**
 * Staff Time Off Requests API
 *
 * GET /api/staff/time-off-requests - List current tech's requests
 * POST /api/staff/time-off-requests - Submit a new request
 *
 * SECURITY:
 * - All identity derived from session (never trust client params)
 * - Staff can only create/view their own requests
 */

import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireStaffSession } from '@/libs/staffAuth';
import { timeOffRequestSchema, technicianSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// VALIDATION
// =============================================================================

const createRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  note: z.string().max(500).optional(),
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

// =============================================================================
// GET /api/staff/time-off-requests
// =============================================================================

export async function GET(): Promise<Response> {
  try {
    // 1. Require valid staff session
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { salonId, technicianId } = auth.session;

    // 2. Fetch requests for this technician (most recent first)
    const requests = await db
      .select({
        id: timeOffRequestSchema.id,
        startDate: timeOffRequestSchema.startDate,
        endDate: timeOffRequestSchema.endDate,
        note: timeOffRequestSchema.note,
        status: timeOffRequestSchema.status,
        decidedAt: timeOffRequestSchema.decidedAt,
        createdAt: timeOffRequestSchema.createdAt,
      })
      .from(timeOffRequestSchema)
      .where(
        and(
          eq(timeOffRequestSchema.technicianId, technicianId),
          eq(timeOffRequestSchema.salonId, salonId),
        ),
      )
      .orderBy(desc(timeOffRequestSchema.createdAt))
      .limit(50);

    return Response.json({
      data: {
        requests: requests.map((r) => ({
          id: r.id,
          startDate: r.startDate.toISOString().split('T')[0],
          endDate: r.endDate.toISOString().split('T')[0],
          note: r.note,
          status: r.status,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching time-off requests:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch time-off requests',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/staff/time-off-requests
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Require valid staff session
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { salonId, technicianId, technicianName } = auth.session;

    // 2. Parse and validate body
    const body = await request.json();
    const validated = createRequestSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { startDate, endDate, note } = validated.data;

    // 3. Validate date range
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');

    if (end < start) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'End date must be on or after start date',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Calculate days in range
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Max 60 days sanity check
    if (diffDays > 60) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Time off request cannot exceed 60 days',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Verify technician exists in this salon
    const [technician] = await db
      .select({ id: technicianSchema.id })
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, technicianId),
          eq(technicianSchema.salonId, salonId),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician profile not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 5. Create the request
    const requestId = `toreq_${nanoid()}`;

    const [newRequest] = await db
      .insert(timeOffRequestSchema)
      .values({
        id: requestId,
        salonId,
        technicianId,
        startDate: start,
        endDate: end,
        note: note || null,
        status: 'PENDING',
      })
      .returning();

    console.log(
      `[TimeOffRequest] Created request ${requestId} for ${technicianName} (${technicianId}): ${startDate} to ${endDate}`,
    );

    return Response.json(
      {
        data: {
          request: {
            id: newRequest!.id,
            startDate: newRequest!.startDate.toISOString().split('T')[0],
            endDate: newRequest!.endDate.toISOString().split('T')[0],
            note: newRequest!.note,
            status: newRequest!.status,
            createdAt: newRequest!.createdAt.toISOString(),
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating time-off request:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create time-off request',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
