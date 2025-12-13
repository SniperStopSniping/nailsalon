import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
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
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional().default('daily'),
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

/**
 * Calculate date ranges for the requested period.
 *
 * TODO: This uses the server's local timezone for date boundaries.
 * If appointments.startTime is stored in UTC, this can cause off-by-one
 * errors around midnight.
 *
 * Consider either:
 * 1. Using the salon's timezone (e.g. salon.timezone) and converting to UTC
 *    before querying, or
 * 2. Storing a pre-normalized "analytics_date" (YYYY-MM-DD) on appointments
 *    and grouping by that instead of timestamps.
 */
function getDateRange(period: string): { start: Date; end: Date; previousStart: Date; previousEnd: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let start: Date;
  const end: Date = tomorrow;
  let previousStart: Date;
  let previousEnd: Date;

  switch (period) {
    case 'weekly': {
      const dayOfWeek = today.getDay();
      start = new Date(today);
      start.setDate(today.getDate() - dayOfWeek);
      previousStart = new Date(start);
      previousStart.setDate(previousStart.getDate() - 7);
      previousEnd = new Date(start);
      break;
    }
    case 'monthly': {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      previousEnd = new Date(start);
      break;
    }
    case 'yearly': {
      start = new Date(today.getFullYear(), 0, 1);
      previousStart = new Date(today.getFullYear() - 1, 0, 1);
      previousEnd = new Date(start);
      break;
    }
    case 'daily':
    default: {
      start = today;
      previousStart = new Date(today);
      previousStart.setDate(previousStart.getDate() - 1);
      previousEnd = new Date(today);
      break;
    }
  }

  return { start, end, previousStart, previousEnd };
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

    const { salonSlug, period } = validated.data;

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

    const { start, end, previousStart, previousEnd } = getDateRange(period);

    // ==========================================================================
    // Revenue Stats
    // ==========================================================================

    // Current period revenue
    const currentRevenueResult = await db
      .select({
        total: sql<number>`COALESCE(sum(${appointmentSchema.totalPrice}), 0)::int`,
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
      );

    // Previous period revenue (for trend calculation)
    const previousRevenueResult = await db
      .select({
        total: sql<number>`COALESCE(sum(${appointmentSchema.totalPrice}), 0)::int`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          eq(appointmentSchema.status, 'completed'),
          gte(appointmentSchema.startTime, previousStart),
          lt(appointmentSchema.startTime, previousEnd),
        ),
      );

    const currentRevenue = currentRevenueResult[0]?.total ?? 0;
    const previousRevenue = previousRevenueResult[0]?.total ?? 0;
    const revenueTrend = previousRevenue > 0
      ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
      : currentRevenue > 0 ? 100 : 0;

    // ==========================================================================
    // Appointment Stats
    // ==========================================================================

    const appointmentStats = await db
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
      );

    // ==========================================================================
    // Staff Performance (Top 3 by revenue)
    // ==========================================================================

    const staffPerformance = await db
      .select({
        id: technicianSchema.id,
        name: technicianSchema.name,
        role: technicianSchema.role,
        avatarUrl: technicianSchema.avatarUrl,
        revenue: sql<number>`COALESCE(sum(${appointmentSchema.totalPrice}), 0)::int`,
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
      .orderBy(sql`sum(${appointmentSchema.totalPrice}) DESC NULLS LAST`)
      .limit(5);

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

    // ==========================================================================
    // Service Mix (Top services by appointment count)
    // ==========================================================================

    const serviceMix = await db
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
      .limit(4);

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
          trend: revenueTrend,
          completed: currentRevenueResult[0]?.count ?? 0,
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
