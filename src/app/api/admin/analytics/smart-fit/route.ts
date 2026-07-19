import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { revenueCentsSql } from '@/libs/revenueSql';
import { SMART_FIT_DISCOUNT_TYPE } from '@/libs/smartFit';
import { resolveSmartFitConfig } from '@/libs/smartFitConfig';
import type { SmartFitReportResponse } from '@/libs/smartFitReporting';
import {
  bucketKeyForDateKey,
  resolveSmartFitReportingRange,
  SMART_FIT_REPORTED_STATUSES,
} from '@/libs/smartFitReporting';
import { getDateKeyInTimeZone, getZonedDayBounds } from '@/libs/timeZone';
import {
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional().default('weekly'),
  // Optional anchor date (YYYY-MM-DD); defaults to today in the salon timezone.
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// Response type: SmartFitReportResponse in src/libs/smartFitReporting.ts.

const FALLBACK_SERVICE_NAME = 'Service no longer on the menu';
const FALLBACK_TECHNICIAN_NAME = 'Former team member';
const UNASSIGNED_TECHNICIAN_NAME = 'Unassigned';
const RECENT_LIMIT = 10;

// =============================================================================
// GET /api/admin/analytics/smart-fit - Smart Fit usage reporting
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const validated = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
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

    // Owner/admin authorization + salon scoping. Same guard chain as the
    // analytics dashboard this report lives in.
    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'analyticsDashboard' });
    if (moduleGuard) {
      return moduleGuard;
    }

    const settings = (salon.settings as SalonSettings | null | undefined) ?? null;
    const bookingConfig = resolveBookingConfigFromSettings(settings);
    const timezone = bookingConfig.timezone;
    const anchor = validated.data.anchor ?? getDateKeyInTimeZone(new Date(), timezone);

    const range = resolveSmartFitReportingRange(period, anchor);
    if (!range) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid anchor date',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Salon-timezone day bounds; the exclusive end is the NEXT day's midnight.
    const rangeStart = getZonedDayBounds(range.startKey, timezone).startOfDay;
    const rangeEnd = getZonedDayBounds(range.endKeyExclusive, timezone).startOfDay;

    // The one Smart Fit attribution predicate: persisted snapshot metadata.
    // See src/libs/smartFitReporting.ts for the full semantics.
    const smartFitInRange = and(
      eq(appointmentSchema.salonId, salon.id),
      eq(appointmentSchema.discountType, SMART_FIT_DISCOUNT_TYPE),
      gte(appointmentSchema.startTime, rangeStart),
      lt(appointmentSchema.startTime, rangeEnd),
    );
    const includedStatuses = [...SMART_FIT_REPORTED_STATUSES];
    const includedFilter = inArray(appointmentSchema.status, includedStatuses);
    const revenue = revenueCentsSql();

    const [metricsResult, technicianRows, appointmentRows, serviceRows] = await Promise.all([
      db
        .select({
          appointments: sql<number>`count(*) FILTER (WHERE ${includedFilter})::int`,
          discountGivenCents: sql<number>`COALESCE(sum(${appointmentSchema.discountAmountCents}) FILTER (WHERE ${includedFilter}), 0)::int`,
          bookedRevenueCents: sql<number>`COALESCE(sum(${revenue}) FILTER (WHERE ${includedFilter}), 0)::int`,
          completedCount: sql<number>`count(*) FILTER (WHERE ${eq(appointmentSchema.status, 'completed')})::int`,
          upcomingCount: sql<number>`count(*) FILTER (WHERE ${inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress'])})::int`,
          cancelledCount: sql<number>`count(*) FILTER (WHERE ${eq(appointmentSchema.status, 'cancelled')})::int`,
          noShowCount: sql<number>`count(*) FILTER (WHERE ${eq(appointmentSchema.status, 'no_show')})::int`,
        })
        .from(appointmentSchema)
        .where(smartFitInRange),
      db
        .select({
          technicianId: appointmentSchema.technicianId,
          technicianName: technicianSchema.name,
          appointments: sql<number>`count(*)::int`,
          revenueCents: sql<number>`COALESCE(sum(${revenue}), 0)::int`,
          discountCents: sql<number>`COALESCE(sum(${appointmentSchema.discountAmountCents}), 0)::int`,
        })
        .from(appointmentSchema)
        .leftJoin(technicianSchema, eq(appointmentSchema.technicianId, technicianSchema.id))
        .where(and(smartFitInRange, includedFilter))
        .groupBy(appointmentSchema.technicianId, technicianSchema.name)
        .orderBy(sql`count(*) DESC`, sql`${technicianSchema.name} ASC NULLS LAST`, sql`${appointmentSchema.technicianId} ASC NULLS LAST`),
      db
        .select({
          id: appointmentSchema.id,
          startTime: appointmentSchema.startTime,
          status: appointmentSchema.status,
          clientName: appointmentSchema.clientName,
          technicianId: appointmentSchema.technicianId,
          subtotalBeforeDiscountCents: appointmentSchema.subtotalBeforeDiscountCents,
          discountAmountCents: appointmentSchema.discountAmountCents,
          totalPrice: appointmentSchema.totalPrice,
          revenueCents: sql<number>`${revenue}::int`,
        })
        .from(appointmentSchema)
        .where(and(smartFitInRange, includedFilter))
        .orderBy(desc(appointmentSchema.startTime), desc(appointmentSchema.id)),
      db
        .select({
          appointmentId: appointmentServicesSchema.appointmentId,
          serviceId: appointmentServicesSchema.serviceId,
          nameSnapshot: appointmentServicesSchema.nameSnapshot,
          priceCentsSnapshot: appointmentServicesSchema.priceCentsSnapshot,
          liveServiceName: serviceSchema.name,
        })
        .from(appointmentServicesSchema)
        .innerJoin(appointmentSchema, eq(appointmentServicesSchema.appointmentId, appointmentSchema.id))
        .leftJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
        .where(and(smartFitInRange, includedFilter)),
    ]);

    const metrics = metricsResult[0] ?? {
      appointments: 0,
      discountGivenCents: 0,
      bookedRevenueCents: 0,
      completedCount: 0,
      upcomingCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
    };
    const averageDiscountCents = metrics.appointments > 0
      ? Math.round(metrics.discountGivenCents / metrics.appointments)
      : 0;

    // ==========================================================================
    // Trend series: bucket per salon-local start date (server-side, bounded to
    // this salon's Smart Fit rows in range — never shipped raw to the browser).
    // ==========================================================================

    const seriesByBucket = new Map<string, { appointments: number; discountCents: number; revenueCents: number }>();
    for (const bucket of range.buckets) {
      seriesByBucket.set(bucket.key, { appointments: 0, discountCents: 0, revenueCents: 0 });
    }
    for (const row of appointmentRows) {
      const dateKey = getDateKeyInTimeZone(row.startTime, timezone);
      const bucketKey = bucketKeyForDateKey(range, dateKey);
      const bucket = bucketKey ? seriesByBucket.get(bucketKey) : undefined;
      if (!bucket) {
        continue;
      }
      bucket.appointments += 1;
      bucket.discountCents += row.discountAmountCents ?? 0;
      bucket.revenueCents += row.revenueCents;
    }
    const series = range.buckets.map(bucket => ({
      key: bucket.key,
      label: bucket.label,
      ...seriesByBucket.get(bucket.key)!,
    }));

    // ==========================================================================
    // Service breakdown: one primary service per appointment (highest booked
    // price, deterministic tie-break) so multi-service rows never double count.
    // Historical snapshot names win over live records; both gone → fallback.
    // ==========================================================================

    const primaryServiceByAppointment = new Map<string, { serviceId: string; name: string; priceCents: number }>();
    for (const row of serviceRows) {
      const name = row.nameSnapshot ?? row.liveServiceName ?? FALLBACK_SERVICE_NAME;
      const priceCents = row.priceCentsSnapshot ?? -1;
      const current = primaryServiceByAppointment.get(row.appointmentId);
      if (
        !current
        || priceCents > current.priceCents
        || (priceCents === current.priceCents && row.serviceId < current.serviceId)
      ) {
        primaryServiceByAppointment.set(row.appointmentId, { serviceId: row.serviceId, name, priceCents });
      }
    }

    const serviceAggregates = new Map<string, { name: string; appointments: number; revenueCents: number; discountCents: number }>();
    for (const row of appointmentRows) {
      const primary = primaryServiceByAppointment.get(row.id);
      if (!primary) {
        continue;
      }
      const existing = serviceAggregates.get(primary.serviceId)
        ?? { name: primary.name, appointments: 0, revenueCents: 0, discountCents: 0 };
      existing.appointments += 1;
      existing.revenueCents += row.revenueCents;
      existing.discountCents += row.discountAmountCents ?? 0;
      serviceAggregates.set(primary.serviceId, existing);
    }
    const services = Array.from(serviceAggregates.entries())
      .map(([serviceId, aggregate]) => ({ serviceId, ...aggregate }))
      .sort((a, b) =>
        b.appointments - a.appointments
        || a.name.localeCompare(b.name)
        || a.serviceId.localeCompare(b.serviceId))
      .map(({ serviceId: _serviceId, ...aggregate }) => aggregate);

    // ==========================================================================
    // Technician breakdown + recent list
    // ==========================================================================

    const technicianNameById = new Map<string, string>();
    const technicians = technicianRows.map((row) => {
      const name = row.technicianId
        ? (row.technicianName ?? FALLBACK_TECHNICIAN_NAME)
        : UNASSIGNED_TECHNICIAN_NAME;
      if (row.technicianId) {
        technicianNameById.set(row.technicianId, name);
      }
      return {
        name,
        appointments: row.appointments,
        revenueCents: row.revenueCents,
        discountCents: row.discountCents,
      };
    });

    const recent = appointmentRows.slice(0, RECENT_LIMIT).map((row) => {
      const discountCents = row.discountAmountCents ?? 0;
      return {
        startTime: row.startTime.toISOString(),
        clientName: row.clientName,
        serviceName: primaryServiceByAppointment.get(row.id)?.name ?? FALLBACK_SERVICE_NAME,
        technicianName: row.technicianId
          ? (technicianNameById.get(row.technicianId) ?? FALLBACK_TECHNICIAN_NAME)
          : UNASSIGNED_TECHNICIAN_NAME,
        subtotalCents: row.subtotalBeforeDiscountCents ?? (row.totalPrice + discountCents),
        discountCents,
        finalCents: row.revenueCents,
        status: row.status,
      };
    });

    const config = resolveSmartFitConfig(settings);

    return Response.json({
      data: {
        config: { enabled: config.enabled },
        metrics: {
          appointments: metrics.appointments,
          discountGivenCents: metrics.discountGivenCents,
          bookedRevenueCents: metrics.bookedRevenueCents,
          averageDiscountCents,
          completedCount: metrics.completedCount,
          upcomingCount: metrics.upcomingCount,
          cancelledCount: metrics.cancelledCount,
          noShowCount: metrics.noShowCount,
        },
        series,
        services,
        technicians,
        recent,
        period,
        anchor,
        dateRange: {
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
        },
        timezone,
        currency: bookingConfig.currency,
      } satisfies SmartFitReportResponse,
    });
  } catch (error) {
    console.error('Error fetching Smart Fit report:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch Smart Fit report',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
