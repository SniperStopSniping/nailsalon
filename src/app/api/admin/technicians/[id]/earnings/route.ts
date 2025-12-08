import { eq, and, sql, gte, lt } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { technicianSchema, appointmentSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getEarningsSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
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
// GET /api/admin/technicians/[id]/earnings - Get earnings data
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validated = getEarningsSchema.safeParse(queryParams);
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

    const { salonSlug, groupBy } = validated.data;

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
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

    // Verify technician exists and belongs to salon
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
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

    // Default date range: last 30 days if not specified
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    defaultFrom.setHours(0, 0, 0, 0);

    const fromDate = validated.data.from
      ? new Date(validated.data.from + 'T00:00:00')
      : defaultFrom;
    
    const toDate = validated.data.to
      ? new Date(validated.data.to + 'T23:59:59')
      : new Date(now.setHours(23, 59, 59, 999));

    const commissionRate = technician.commissionRate ? parseFloat(technician.commissionRate) : 0;

    // Get summary
    const summaryResult = await db
      .select({
        count: sql<number>`count(*)`,
        totalRevenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          gte(appointmentSchema.startTime, fromDate),
          lt(appointmentSchema.startTime, toDate),
          eq(appointmentSchema.status, 'completed'),
        ),
      );

    const totalRevenue = Number(summaryResult[0]?.totalRevenue ?? 0);
    const appointmentCount = Number(summaryResult[0]?.count ?? 0);
    const techEarned = Math.round(totalRevenue * commissionRate);
    const salonEarned = totalRevenue - techEarned;

    // Get time series based on groupBy
    let dateGroupSql;
    switch (groupBy) {
      case 'week':
        dateGroupSql = sql`date_trunc('week', ${appointmentSchema.startTime})`;
        break;
      case 'month':
        dateGroupSql = sql`date_trunc('month', ${appointmentSchema.startTime})`;
        break;
      case 'day':
      default:
        dateGroupSql = sql`date_trunc('day', ${appointmentSchema.startTime})`;
        break;
    }

    const seriesResult = await db
      .select({
        date: dateGroupSql.as('date'),
        count: sql<number>`count(*)`,
        totalRevenue: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, id),
          gte(appointmentSchema.startTime, fromDate),
          lt(appointmentSchema.startTime, toDate),
          eq(appointmentSchema.status, 'completed'),
        ),
      )
      .groupBy(dateGroupSql)
      .orderBy(dateGroupSql);

    const series = seriesResult.map(row => {
      const rowRevenue = Number(row.totalRevenue);
      const rowTechEarned = Math.round(rowRevenue * commissionRate);
      return {
        date: row.date ? new Date(row.date as string).toISOString().split('T')[0] : null,
        appointments: Number(row.count),
        totalRevenue: rowRevenue,
        techEarned: rowTechEarned,
        salonEarned: rowRevenue - rowTechEarned,
      };
    });

    return Response.json({
      data: {
        technicianId: id,
        technicianName: technician.name,
        commissionRate,
        dateRange: {
          from: fromDate.toISOString().split('T')[0],
          to: toDate.toISOString().split('T')[0],
        },
        groupBy,
        summary: {
          appointmentCount,
          totalRevenue,
          techEarned,
          salonEarned,
        },
        series,
      },
    });
  } catch (error) {
    console.error('Error fetching technician earnings:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch technician earnings',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
