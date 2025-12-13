/**
 * Legacy Time-Off API (Admin-Only)
 *
 * SECURITY NOTICE: This endpoint is now ADMIN-ONLY.
 * Staff must use /api/staff/time-off-requests (request-based workflow).
 *
 * GET /api/staff/time-off - List time-off entries (admin reads by technicianId)
 * POST /api/staff/time-off - Create time-off entry (admin direct write)
 */

import { and, eq, gte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

import { db } from '@/libs/DB';
import { getAdminSession } from '@/libs/adminAuth';
import { technicianSchema, technicianTimeOffSchema, TIME_OFF_REASONS } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const createTimeOffSchema = z.object({
  technicianId: z.string().min(1, 'Technician ID is required'),
  startDate: z.string().datetime({ message: 'Invalid start date format' }),
  endDate: z.string().datetime({ message: 'Invalid end date format' }),
  reason: z.enum(TIME_OFF_REASONS).optional(),
  notes: z.string().optional(),
});

const getTimeOffSchema = z.object({
  technicianId: z.string().min(1, 'Technician ID is required'),
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
// GET /api/staff/time-off - List time-off entries (ADMIN-ONLY)
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
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

    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');

    // Validate query params
    const validated = getTimeOffSchema.safeParse({ technicianId });
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

    // 2. Get technician and verify admin has access to their salon
    const [technician] = await db
      .select({
        id: technicianSchema.id,
        salonId: technicianSchema.salonId,
      })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, validated.data.technicianId))
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Enforce admin salon scope
    if (!admin.isSuperAdmin) {
      const hasAccess = admin.salons.some((s) => s.salonId === technician.salonId);
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

    // 4. Get time-off entries (only future or current)
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const timeOffEntries = await db
      .select()
      .from(technicianTimeOffSchema)
      .where(
        and(
          eq(technicianTimeOffSchema.technicianId, validated.data.technicianId),
          eq(technicianTimeOffSchema.salonId, technician.salonId),
          gte(technicianTimeOffSchema.endDate, now),
        ),
      )
      .orderBy(technicianTimeOffSchema.startDate);

    return Response.json({
      data: {
        timeOff: timeOffEntries.map((entry) => ({
          id: entry.id,
          startDate: entry.startDate.toISOString(),
          endDate: entry.endDate.toISOString(),
          reason: entry.reason,
          notes: entry.notes,
          createdAt: entry.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch time-off entries',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/staff/time-off - Create time-off entry (ADMIN-ONLY)
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
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

    const body = await request.json();
    const validated = createTimeOffSchema.safeParse(body);

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

    // 2. Get technician and verify admin has access to their salon
    const [technician] = await db
      .select({
        id: technicianSchema.id,
        salonId: technicianSchema.salonId,
        name: technicianSchema.name,
      })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, validated.data.technicianId))
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Enforce admin salon scope
    if (!admin.isSuperAdmin) {
      const hasAccess = admin.salons.some((s) => s.salonId === technician.salonId);
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

    // 4. Validate dates
    const startDate = new Date(validated.data.startDate);
    const endDate = new Date(validated.data.endDate);

    if (endDate < startDate) {
      return Response.json(
        {
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'End date must be after start date',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Create time-off entry
    const timeOffId = `timeoff_${nanoid()}`;

    const [newEntry] = await db
      .insert(technicianTimeOffSchema)
      .values({
        id: timeOffId,
        technicianId: validated.data.technicianId,
        salonId: technician.salonId,
        startDate,
        endDate,
        reason: validated.data.reason || null,
        notes: validated.data.notes || null,
      })
      .returning();

    console.log(
      `[TimeOff] Admin ${admin.name || admin.id} created time-off ${timeOffId} for ${technician.name} (${technician.id})`,
    );

    return Response.json(
      {
        data: {
          timeOff: {
            id: newEntry?.id,
            startDate: newEntry?.startDate.toISOString(),
            endDate: newEntry?.endDate.toISOString(),
            reason: newEntry?.reason,
            notes: newEntry?.notes,
            createdAt: newEntry?.createdAt.toISOString(),
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create time-off entry',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
