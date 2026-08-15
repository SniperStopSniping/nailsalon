import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { getCompletedRevenueRows } from '@/libs/financialReportingServer';
import { technicianSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

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

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

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

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }
    const bookingConfig = resolveBookingConfigFromSettings(
      salon.settings as SalonSettings | null | undefined,
    );

    // Step 16.3: Check if staffEarnings module is enabled
    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'staffEarnings' });
    if (moduleGuard) {
      return moduleGuard;
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
      ? new Date(`${validated.data.from}T00:00:00`)
      : defaultFrom;

    const toDate = validated.data.to
      ? new Date(`${validated.data.to}T23:59:59`)
      : new Date(now.setHours(23, 59, 59, 999));

    const commissionRate = technician.commissionRate ? Number.parseFloat(technician.commissionRate) : 0;

    const revenueRows = (await getCompletedRevenueRows({
      salonId: salon.id,
      currency: bookingConfig.currency,
      start: fromDate,
      end: toDate,
    })).filter(row => row.technicianId === id);
    const totalRevenue = revenueRows.reduce(
      (sum, row) => sum + row.serviceValueCents,
      0,
    );
    const appointmentCount = revenueRows.length;
    const techEarned = Math.round(totalRevenue * commissionRate);
    const salonEarned = totalRevenue - techEarned;

    const seriesMap = new Map<string, { count: number; totalRevenue: number }>();
    for (const row of revenueRows) {
      const date = new Date(row.startTime);
      if (groupBy === 'month') {
        date.setUTCDate(1);
      } else if (groupBy === 'week') {
        const day = date.getUTCDay();
        date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
      }
      const key = date.toISOString().slice(0, 10);
      const current = seriesMap.get(key) ?? { count: 0, totalRevenue: 0 };
      current.count += 1;
      current.totalRevenue += row.serviceValueCents;
      seriesMap.set(key, current);
    }
    const series = [...seriesMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, row]) => {
        const rowRevenue = row.totalRevenue;
        const rowTechEarned = Math.round(rowRevenue * commissionRate);
        return {
          date,
          appointments: row.count,
          totalRevenue: rowRevenue,
          techEarned: rowTechEarned,
          salonEarned: rowRevenue - rowTechEarned,
        };
      });

    return Response.json({
      data: {
        currency: bookingConfig.currency,
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
