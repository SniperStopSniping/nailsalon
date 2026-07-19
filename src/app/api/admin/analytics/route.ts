import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { getAnalyticsDateRange } from '@/libs/analyticsDateRange';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { revenueCentsSql } from '@/libs/revenueSql';
import {
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';
import type { AnalyticsResponse } from '@/types/admin';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional().default('weekly'),
  // Optional anchor date (YYYY-MM-DD) for navigating to past/future periods
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
// HELPERS
// =============================================================================

// Date-range computation lives in @/libs/analyticsDateRange (salon-timezone
// aware — Prompt 9 audit fix; route files cannot export helpers).

/**
 * Bucket completed-appointment revenue into an evenly spaced series over
 * [start, end) so the dashboard chart reflects real sales, not a placeholder.
 */
function buildRevenueSeries(
  rows: Array<{ startTime: Date; totalPrice: number | null }>,
  start: Date,
  end: Date,
  period: string,
): number[] {
  const bucketCount = period === 'yearly'
    ? 12
    : period === 'monthly'
      ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
      : 7;

  const series = Array.from({ length: bucketCount }, () => 0);
  const rangeMs = end.getTime() - start.getTime();
  if (rangeMs <= 0) {
    return series;
  }

  for (const row of rows) {
    const t = new Date(row.startTime).getTime();
    const index = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(((t - start.getTime()) / rangeMs) * bucketCount)),
    );
    series[index] = (series[index] ?? 0) + (row.totalPrice ?? 0);
  }

  return series;
}

// Re-export the response type for consumers
export type { AnalyticsResponse };

// =============================================================================
// GET /api/admin/analytics - Get dashboard analytics
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = querySchema.safeParse(queryParams);
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

    const { salonSlug, period, anchor } = validated.data;

    // Verify user owns this salon
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    // Step 16.3: Check if analyticsDashboard module is enabled
    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'analyticsDashboard' });
    if (moduleGuard) {
      return moduleGuard;
    }

    const salonTimeZone = resolveBookingConfigFromSettings(
      (salon.settings as Parameters<typeof resolveBookingConfigFromSettings>[0]) ?? null,
    ).timezone;
    const { start, end, previousStart, previousEnd } = getAnalyticsDateRange(period, salonTimeZone, anchor);

    const [
      currentRevenueResult,
      previousRevenueResult,
      appointmentStats,
      staffPerformance,
      serviceMix,
      revenueRows,
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`COALESCE(sum(${revenueCentsSql()}), 0)::int`,
          tips: sql<number>`COALESCE(sum(${appointmentSchema.tipCents}), 0)::int`,
          taxCollected: sql<number>`COALESCE(sum(${appointmentSchema.taxAmountCents}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salon.id),
            eq(appointmentSchema.status, 'completed'),
            gte(appointmentSchema.startTime, start),
            lt(appointmentSchema.startTime, end),
          ),
        ),
      db
        .select({
          total: sql<number>`COALESCE(sum(${revenueCentsSql()}), 0)::int`,
        })
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salon.id),
            eq(appointmentSchema.status, 'completed'),
            gte(appointmentSchema.startTime, previousStart),
            lt(appointmentSchema.startTime, previousEnd),
          ),
        ),
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'completed')::int`,
          noShows: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'no_show')::int`,
          upcoming: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} IN ('pending', 'confirmed') AND ${appointmentSchema.startTime} >= now())::int`,
        })
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salon.id),
            gte(appointmentSchema.startTime, start),
            lt(appointmentSchema.startTime, end),
          ),
        ),
      db
        .select({
          id: technicianSchema.id,
          name: technicianSchema.name,
          role: technicianSchema.role,
          avatarUrl: technicianSchema.avatarUrl,
          revenue: sql<number>`COALESCE(sum(${revenueCentsSql()}), 0)::int`,
          appointmentCount: sql<number>`count(${appointmentSchema.id})::int`,
        })
        .from(technicianSchema)
        .leftJoin(
          appointmentSchema,
          and(
            eq(appointmentSchema.technicianId, technicianSchema.id),
            eq(appointmentSchema.status, 'completed'),
            gte(appointmentSchema.startTime, start),
            lt(appointmentSchema.startTime, end),
          ),
        )
        .where(
          and(
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.isActive, true),
          ),
        )
        .groupBy(technicianSchema.id)
        .orderBy(sql`sum(${revenueCentsSql()}) DESC NULLS LAST`)
        .limit(5),
      db
        .select({
          serviceId: serviceSchema.id,
          serviceName: serviceSchema.name,
          category: serviceSchema.category,
          count: sql<number>`count(*)::int`,
        })
        .from(appointmentServicesSchema)
        .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
        .innerJoin(appointmentSchema, eq(appointmentServicesSchema.appointmentId, appointmentSchema.id))
        .where(
          and(
            eq(appointmentSchema.salonId, salon.id),
            inArray(appointmentSchema.status, ['completed', 'confirmed', 'pending']),
            gte(appointmentSchema.startTime, start),
            lt(appointmentSchema.startTime, end),
          ),
        )
        .groupBy(serviceSchema.id)
        .orderBy(sql`count(*) DESC`)
        .limit(4),
      db
        .select({
          startTime: appointmentSchema.startTime,
          totalPrice: sql<number>`${revenueCentsSql()}::int`,
        })
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salon.id),
            eq(appointmentSchema.status, 'completed'),
            gte(appointmentSchema.startTime, start),
            lt(appointmentSchema.startTime, end),
          ),
        ),
    ]);

    const revenueSeries = buildRevenueSeries(revenueRows, start, end, period);

    const currentRevenue = currentRevenueResult[0]?.total ?? 0;
    const previousRevenue = previousRevenueResult[0]?.total ?? 0;
    const revenueTrend = previousRevenue > 0
      ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
      : currentRevenue > 0 ? 100 : 0;

    // Calculate utilization (appointments as percentage of capacity)
    // Assume 8 hours per day, 1 appointment = 1 hour average
    const hoursInPeriod = period === 'daily' ? 8 : period === 'weekly' ? 40 : period === 'monthly' ? 160 : 1920;

    const staffWithUtilization = staffPerformance.map((tech, index) => {
      const utilizationPercent = Math.min(Math.round((tech.appointmentCount / hoursInPeriod) * 100), 100);
      const colors = ['#fa709a', '#43e97b', '#66a6ff', '#f6d365', '#a18cd1'];
      return {
        id: tech.id,
        name: tech.name,
        role: tech.role || 'Technician',
        avatarUrl: tech.avatarUrl,
        revenue: tech.revenue,
        appointmentCount: tech.appointmentCount,
        utilization: utilizationPercent,
        color: colors[index % colors.length],
      };
    });

    const totalServiceCount = serviceMix.reduce((sum, s) => sum + s.count, 0);
    const serviceColors: Record<string, string> = {
      hands: '#F97316',
      feet: '#3B82F6',
      combo: '#8B5CF6',
    };

    const formattedServiceMix = serviceMix.map(service => ({
      label: service.serviceName,
      percent: totalServiceCount > 0 ? Math.round((service.count / totalServiceCount) * 100) : 0,
      color: serviceColors[service.category] || '#9CA3AF',
      count: service.count,
    }));

    // ==========================================================================
    // Format Response
    // ==========================================================================

    return Response.json({
      data: {
        revenue: {
          total: currentRevenue,
          tips: currentRevenueResult[0]?.tips ?? 0,
          taxCollected: currentRevenueResult[0]?.taxCollected ?? 0,
          trend: revenueTrend,
          completed: currentRevenueResult[0]?.count ?? 0,
          series: revenueSeries,
        },
        appointments: {
          total: appointmentStats[0]?.total ?? 0,
          completed: appointmentStats[0]?.completed ?? 0,
          noShows: appointmentStats[0]?.noShows ?? 0,
          upcoming: appointmentStats[0]?.upcoming ?? 0,
        },
        staff: staffWithUtilization,
        services: formattedServiceMix,
        period,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch analytics',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
