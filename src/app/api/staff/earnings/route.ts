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

import { eq } from 'drizzle-orm';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { getCompletedRevenueRows } from '@/libs/financialReportingServer';
import { requireStaffApiSession } from '@/libs/staffApiGuards';
import { salonSchema, technicianSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type EarningsResponse = {
  data: {
    currency: string;
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
    const auth = await requireStaffApiSession();
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
    const [salonMoneySettings] = await db
      .select({ settings: salonSchema.settings })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);
    const bookingConfig = resolveBookingConfigFromSettings(
      salonMoneySettings?.settings as SalonSettings | null | undefined,
    );

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

    const revenueRows = (await getCompletedRevenueRows({
      salonId,
      currency: bookingConfig.currency,
      start: fromDate,
      end: toDate,
    })).filter(row => row.technicianId === technicianId);
    const totalGrossSales = revenueRows.reduce(
      (sum, row) => sum + row.serviceValueCents,
      0,
    );
    const totalTips = revenueRows.reduce(
      (sum, row) => sum + row.tipCents,
      0,
    );
    const appointmentCount = revenueRows.length;

    // EDIT 1: If no commission model/rate, earnings = 0 (NOT grossSales)
    const totalEarnings = commissionRate > 0
      ? Math.round(totalGrossSales * commissionRate)
      : 0;

    const dailyMap = new Map<
      string,
      { grossSales: number; tips: number; appointmentCount: number }
    >();
    for (const row of revenueRows) {
      const date = row.startTime.toISOString().slice(0, 10);
      const current = dailyMap.get(date) ?? {
        grossSales: 0,
        tips: 0,
        appointmentCount: 0,
      };
      current.grossSales += row.serviceValueCents;
      current.tips += row.tipCents;
      current.appointmentCount += 1;
      dailyMap.set(date, current);
    }
    const daily = [...dailyMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, row]) => {
        const dayGrossSales = row.grossSales;
        // EDIT 1: If no commission model/rate, earnings = 0
        const dayEarnings = commissionRate > 0
          ? Math.round(dayGrossSales * commissionRate)
          : 0;

        return {
          date,
          grossSales: dayGrossSales,
          tips: row.tips,
          earnings: dayEarnings,
          appointmentCount: row.appointmentCount,
        };
      });

    // 7. Build response (LOCKED SHAPE)
    // NOTE: commissionRate is NEVER returned to staff
    const response: EarningsResponse = {
      data: {
        currency: bookingConfig.currency,
        range: {
          from: formatDateISO(fromDate),
          to: formatDateISO(toDate),
        },
        totals: {
          grossSales: totalGrossSales,
          tips: totalTips,
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
