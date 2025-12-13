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

import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getAdminSession } from '@/libs/adminAuth';
import {
  createStaffNotification,
  buildTimeOffDecisionNotification,
} from '@/libs/notifications';
import { timeOffRequestSchema, technicianSchema } from '@/models/Schema';

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

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// =============================================================================
// PATCH /api/admin/time-off-requests/[id]
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    // 1. Require valid admin session
    const admin = await getAdminSession();
    if (!admin) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' } } satisfies ErrorResponse,
        { status: 401 },
      );
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

    // 4. EDIT 3: Enforce admin salon scope from session
    if (!admin.isSuperAdmin) {
      const hasAccess = admin.salons.some((s) => s.salonId === existingRequest.salonId);
      if (!hasAccess) {
        return Response.json(
          { error: { code: 'FORBIDDEN', message: 'No access to this salon' } } satisfies ErrorResponse,
          { status: 403 },
        );
      }
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

    // 6. Update the request
    const [updatedRequest] = await db
      .update(timeOffRequestSchema)
      .set({
        status,
        decidedByAdminId: admin.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(timeOffRequestSchema.id, id))
      .returning();

    // 7. Get technician info for logging
    const [technician] = await db
      .select({ name: technicianSchema.name })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, existingRequest.technicianId))
      .limit(1);

    console.log(
      `[TimeOffRequest] Admin ${admin.name || admin.id} ${status.toLowerCase()} request ${id} for ${technician?.name ?? existingRequest.technicianId}`,
    );

    // 8. Create notification for the staff member
    const { title, body: notifBody } = buildTimeOffDecisionNotification({
      status: status as 'APPROVED' | 'DENIED',
      startDate: existingRequest.startDate,
      endDate: existingRequest.endDate,
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
          startDate: updatedRequest!.startDate.toISOString().split('T')[0],
          endDate: updatedRequest!.endDate.toISOString().split('T')[0],
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
// GET /api/admin/time-off-requests/[id] - Get single request details
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;

    // 1. Require valid admin session
    const admin = await getAdminSession();
    if (!admin) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' } } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    // 2. Fetch the request
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

    // 3. Enforce admin salon scope
    if (!admin.isSuperAdmin) {
      const hasAccess = admin.salons.some((s) => s.salonId === existingRequest.salonId);
      if (!hasAccess) {
        return Response.json(
          { error: { code: 'FORBIDDEN', message: 'No access to this salon' } } satisfies ErrorResponse,
          { status: 403 },
        );
      }
    }

    // 4. Get technician name
    const [technician] = await db
      .select({ name: technicianSchema.name })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, existingRequest.technicianId))
      .limit(1);

    return Response.json({
      data: {
        request: {
          id: existingRequest.id,
          salonId: existingRequest.salonId,
          technicianId: existingRequest.technicianId,
          technicianName: technician?.name ?? null,
          startDate: existingRequest.startDate.toISOString().split('T')[0],
          endDate: existingRequest.endDate.toISOString().split('T')[0],
          note: existingRequest.note,
          status: existingRequest.status,
          decidedAt: existingRequest.decidedAt?.toISOString() ?? null,
          createdAt: existingRequest.createdAt.toISOString(),
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
