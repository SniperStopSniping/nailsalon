/**
 * Staff Earnings API
 *
 * GET /api/staff/earnings
 *
 * Returns earnings data for the logged-in staff member.
 * Module-gated: requires staffEarnings module to be enabled.
 *
 * Query params:
 * - from: ISO date (optional, defaults to start of current month)
 * - to: ISO date (optional, defaults to end of current month)
 *
 * SECURITY:
 * - All identity derived from session (never trust client params)
 * - Module gated server-side via guardModuleOr403
 * - Never returns commissionRate or other forbidden fields
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { requireStaffSession } from '@/libs/staffAuth';
import { appointmentSchema, technicianSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type EarningsResponse = {
  data: {
    range: {
      from: string;
      to: string;
    };
    totals: {
      grossSales: number;
      tips: number;
      earnings: number;
      appointmentCount: number;
    };
    daily: Array<{
      date: string;
      grossSales: number;
      tips: number;
      earnings: number;
      appointmentCount: number;
    }>;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// HELPERS
// =============================================================================

function getMonthRange(offset: number = 0): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

function parseDate(dateStr: string): Date | null {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

// =============================================================================
// GET /api/staff/earnings
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Require valid staff session
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { salonId, technicianId } = auth.session;

    // 2. Check module is enabled (BEFORE any data access)
    const moduleGuard = await guardModuleOr403({
      salonId,
      module: 'staffEarnings',
    });
    if (moduleGuard) {
      return moduleGuard;
    }

    // 3. Parse query params for date range
    const url = new URL(request.url);
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    let fromDate: Date;
    let toDate: Date;

    if (fromParam && toParam) {
      const parsedFrom = parseDate(fromParam);
      const parsedTo = parseDate(toParam);

      if (!parsedFrom || !parsedTo) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid date format. Use ISO format (YYYY-MM-DD)',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }

      fromDate = parsedFrom;
      fromDate.setHours(0, 0, 0, 0);

      toDate = parsedTo;
      toDate.setHours(23, 59, 59, 999);
    } else {
      // Default to current month
      const range = getMonthRange(0);
      fromDate = range.from;
      toDate = range.to;
    }

    // 4. Get technician's commission rate
    const [technician] = await db
      .select({
        commissionRate: technicianSchema.commissionRate,
      })
      .from(technicianSchema)
      .where(eq(technicianSchema.id, technicianId))
      .limit(1);

    // Parse commission rate (null/undefined/0 = no commission model)
    const commissionRate = technician?.commissionRate
      ? Number.parseFloat(technician.commissionRate)
      : 0;

    // 5. Get totals for the period
    const totalsResult = await db
      .select({
        count: sql<number>`count(*)`,
        grossSales: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, technicianId),
          eq(appointmentSchema.salonId, salonId),
          eq(appointmentSchema.status, 'completed'),
          gte(appointmentSchema.startTime, fromDate),
          lt(appointmentSchema.startTime, toDate),
        ),
      );

    const totalGrossSales = Number(totalsResult[0]?.grossSales ?? 0);
    const appointmentCount = Number(totalsResult[0]?.count ?? 0);

    // EDIT 1: If no commission model/rate, earnings = 0 (NOT grossSales)
    const totalEarnings = commissionRate > 0
      ? Math.round(totalGrossSales * commissionRate)
      : 0;

    // 6. Get daily breakdown
    const dailyResult = await db
      .select({
        date: sql<string>`date_trunc('day', ${appointmentSchema.startTime})::date`,
        count: sql<number>`count(*)`,
        grossSales: sql<number>`coalesce(sum(${appointmentSchema.totalPrice}), 0)`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.technicianId, technicianId),
          eq(appointmentSchema.salonId, salonId),
          eq(appointmentSchema.status, 'completed'),
          gte(appointmentSchema.startTime, fromDate),
          lt(appointmentSchema.startTime, toDate),
        ),
      )
      .groupBy(sql`date_trunc('day', ${appointmentSchema.startTime})::date`)
      .orderBy(sql`date_trunc('day', ${appointmentSchema.startTime})::date`);

    const daily = dailyResult.map((row) => {
      const dayGrossSales = Number(row.grossSales);
      // EDIT 1: If no commission model/rate, earnings = 0
      const dayEarnings = commissionRate > 0
        ? Math.round(dayGrossSales * commissionRate)
        : 0;

      return {
        date: row.date ?? '',
        grossSales: dayGrossSales,
        tips: 0, // Tips not tracked yet
        earnings: dayEarnings,
        appointmentCount: Number(row.count),
      };
    });

    // 7. Build response (LOCKED SHAPE)
    // NOTE: commissionRate is NEVER returned to staff
    const response: EarningsResponse = {
      data: {
        range: {
          from: formatDateISO(fromDate),
          to: formatDateISO(toDate),
        },
        totals: {
          grossSales: totalGrossSales,
          tips: 0, // Tips not tracked yet
          earnings: totalEarnings,
          appointmentCount,
        },
        daily,
      },
    };

    return Response.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error fetching staff earnings:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch earnings',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
