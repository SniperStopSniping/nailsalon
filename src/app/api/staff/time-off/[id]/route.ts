/**
 * Legacy Time-Off Entry API (Admin-Only)
 *
 * SECURITY NOTICE: This endpoint is now ADMIN-ONLY.
 * Staff must use /api/staff/time-off-requests (request-based workflow).
 *
 * GET /api/staff/time-off/[id] - Get a specific time-off entry
 * DELETE /api/staff/time-off/[id] - Delete a time-off entry
 */

import { eq } from 'drizzle-orm';

import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { technicianTimeOffSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

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

// =============================================================================
// DELETE /api/staff/time-off/[id] - Delete a time-off entry (ADMIN-ONLY)
// =============================================================================

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: timeOffId } = await params;

    // 1. Require admin session
    const admin = await getAdminSession();
    if (!admin) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Admin authentication required. Staff should use /api/staff/time-off-requests',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    // 2. Get the time-off entry to verify it exists and get salonId
    const [existingEntry] = await db
      .select({
        id: technicianTimeOffSchema.id,
        salonId: technicianTimeOffSchema.salonId,
        technicianId: technicianTimeOffSchema.technicianId,
      })
      .from(technicianTimeOffSchema)
      .where(eq(technicianTimeOffSchema.id, timeOffId))
      .limit(1);

    if (!existingEntry) {
      return Response.json(
        {
          error: {
            code: 'TIME_OFF_NOT_FOUND',
            message: 'Time-off entry not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Enforce admin salon scope
    if (!admin.isSuperAdmin) {
      const hasAccess = admin.salons.some(s => s.salonId === existingEntry.salonId);
      if (!hasAccess) {
        return Response.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'No access to this salon',
            },
          } satisfies ErrorResponse,
          { status: 403 },
        );
      }
    }

    // 4. Delete the entry
    await db
      .delete(technicianTimeOffSchema)
      .where(eq(technicianTimeOffSchema.id, timeOffId));

    console.warn(
      `[TimeOff] Admin ${admin.name || admin.id} deleted time-off ${timeOffId}`,
    );

    return Response.json({
      data: {
        deleted: true,
        id: timeOffId,
      },
    });
  } catch (error) {
    console.error('Error deleting time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete time-off entry',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/staff/time-off/[id] - Get a specific time-off entry (ADMIN-ONLY)
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: timeOffId } = await params;

    // 1. Require admin session
    const admin = await getAdminSession();
    if (!admin) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Admin authentication required. Staff should use /api/staff/time-off-requests',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    // 2. Get the time-off entry
    const [entry] = await db
      .select()
      .from(technicianTimeOffSchema)
      .where(eq(technicianTimeOffSchema.id, timeOffId))
      .limit(1);

    if (!entry) {
      return Response.json(
        {
          error: {
            code: 'TIME_OFF_NOT_FOUND',
            message: 'Time-off entry not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Enforce admin salon scope
    if (!admin.isSuperAdmin) {
      const hasAccess = admin.salons.some(s => s.salonId === entry.salonId);
      if (!hasAccess) {
        return Response.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'No access to this salon',
            },
          } satisfies ErrorResponse,
          { status: 403 },
        );
      }
    }

    return Response.json({
      data: {
        timeOff: {
          id: entry.id,
          technicianId: entry.technicianId,
          salonId: entry.salonId,
          startDate: entry.startDate.toISOString(),
          endDate: entry.endDate.toISOString(),
          reason: entry.reason,
          notes: entry.notes,
          createdAt: entry.createdAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch time-off entry',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
