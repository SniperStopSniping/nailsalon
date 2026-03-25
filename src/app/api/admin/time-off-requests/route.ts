/**
 * Admin Time Off Requests API
 *
 * GET /api/admin/time-off-requests - List requests for the admin's active salon
 *
 * SECURITY:
 * - Admin session required
 * - Only returns requests for salons the admin has access to
 */

import { and, desc, eq } from 'drizzle-orm';

import { requireActiveAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  salonSchema,
  technicianSchema,
  timeOffRequestSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

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
// GET /api/admin/time-off-requests
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { salon, error } = await requireActiveAdminSalon();
    if (error || !salon) {
      return error!;
    }

    // 2. Parse query params
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status'); // 'PENDING' | 'APPROVED' | 'DENIED' | null (all)

    // 4. Build query conditions
    const conditions = [eq(timeOffRequestSchema.salonId, salon.id)];

    if (statusFilter && ['PENDING', 'APPROVED', 'DENIED'].includes(statusFilter)) {
      conditions.push(eq(timeOffRequestSchema.status, statusFilter));
    }

    // 5. Fetch requests with technician and salon info
    const requests = await db
      .select({
        id: timeOffRequestSchema.id,
        salonId: timeOffRequestSchema.salonId,
        salonName: salonSchema.name,
        technicianId: timeOffRequestSchema.technicianId,
        technicianName: technicianSchema.name,
        startDate: timeOffRequestSchema.startDate,
        endDate: timeOffRequestSchema.endDate,
        note: timeOffRequestSchema.note,
        status: timeOffRequestSchema.status,
        decidedAt: timeOffRequestSchema.decidedAt,
        createdAt: timeOffRequestSchema.createdAt,
      })
      .from(timeOffRequestSchema)
      .innerJoin(technicianSchema, eq(timeOffRequestSchema.technicianId, technicianSchema.id))
      .innerJoin(salonSchema, eq(timeOffRequestSchema.salonId, salonSchema.id))
      .where(and(...conditions))
      .orderBy(desc(timeOffRequestSchema.createdAt))
      .limit(100);

    return Response.json({
      data: {
        requests: requests.map(r => ({
          id: r.id,
          salonId: r.salonId,
          salonName: r.salonName,
          technicianId: r.technicianId,
          technicianName: r.technicianName,
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
    console.error('Error fetching admin time-off requests:', error);
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
