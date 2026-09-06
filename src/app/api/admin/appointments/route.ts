/**
 * Admin Appointments List API
 *
 * GET /api/admin/appointments
 * Returns appointments for the authenticated admin's active salon.
 *
 * salonId is ALWAYS derived from a membership-checked salon: the slug the URL
 * names (`?salonSlug=` / `?salon=`) when it names one, otherwise the active
 * admin salon selection. NEVER accepts a salonId from query params.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalonFromRequest } from '@/libs/adminAuth';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import type { BusinessHours } from '@/libs/bookingPolicy';
import { resolveBookingHoursCeiling } from '@/libs/bookingPolicy';
import type { CalendarBlockedSlot, CalendarSchedule, CalendarTimeOff } from '@/libs/calendarSchedule';
import { db } from '@/libs/DB';
import { getPrimaryLocation, getTechniciansBySalonId } from '@/libs/queries';
import { toDateOnlyString } from '@/libs/timeOffDates';
import { getZonedDayBounds } from '@/libs/timeZone';
import { normalizeWeeklySchedule } from '@/libs/weeklySchedule';
import {
  APPOINTMENT_STATUSES,
  appointmentSchema,
  appointmentServicesSchema,
  serviceSchema,
  technicianBlockedSlotSchema,
  technicianSchema,
  technicianTimeOffSchema,
  type WeeklySchedule,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

type ErrorResponse = {
  error: { code: string; message: string; details?: unknown };
};

// Helper: treat null/"" as undefined so .default() kicks in
const coerceStrOrUndefined = (v: unknown) => (v == null || v === '' ? undefined : v);

const querySchema = z.object({
  // Day view convenience
  date: z.preprocess(coerceStrOrUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  // Range view convenience (used by notifications/activity)
  startDate: z.preprocess(coerceStrOrUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.preprocess(coerceStrOrUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  status: z.preprocess(coerceStrOrUndefined, z.string().optional()),
  limit: z.preprocess(coerceStrOrUndefined, z.coerce.number().int().min(1).max(200).default(200)),
});

/**
 * The availability authorities the owner calendar has to draw: opening hours
 * (primary location, falling back to the salon row — the same resolution the
 * booking engine uses), approved time off overlapping the requested range, and
 * blocked slots. Additive on the response; every pre-existing field is
 * untouched.
 *
 * `technician_time_off` / `technician_blocked_slot` are read defensively: a
 * database without those relations still returns a calendar rather than a 500,
 * which is how `loadBookingPolicy` treats them too.
 */
async function loadCalendarSchedule(args: {
  salonId: string;
  salonBusinessHours: BusinessHours;
  technicians: Array<{ id: string; name: string; weeklySchedule: WeeklySchedule | null }>;
  rangeStart: Date;
  rangeEndExclusive: Date;
}): Promise<CalendarSchedule> {
  const technicianIds = args.technicians.map(technician => technician.id);

  const primaryLocation = await getPrimaryLocation(args.salonId).catch(() => null);
  const ceiling = resolveBookingHoursCeiling({
    location: primaryLocation
      ? { id: primaryLocation.id, businessHours: primaryLocation.businessHours ?? null }
      : null,
    salonBusinessHours: args.salonBusinessHours,
  });

  let timeOff: CalendarTimeOff[] = [];
  let blockedSlots: CalendarBlockedSlot[] = [];

  if (technicianIds.length > 0) {
    const [timeOffRows, blockedRows] = await Promise.all([
      db
        .select({
          id: technicianTimeOffSchema.id,
          technicianId: technicianTimeOffSchema.technicianId,
          startDate: technicianTimeOffSchema.startDate,
          endDate: technicianTimeOffSchema.endDate,
          reason: technicianTimeOffSchema.reason,
        })
        .from(technicianTimeOffSchema)
        .where(
          and(
            eq(technicianTimeOffSchema.salonId, args.salonId),
            inArray(technicianTimeOffSchema.technicianId, technicianIds),
            lte(technicianTimeOffSchema.startDate, args.rangeEndExclusive),
            gte(technicianTimeOffSchema.endDate, args.rangeStart),
          ),
        )
        .catch((error: unknown) => {
          console.warn('[AdminAppointments] technician_time_off unavailable', error);
          return [];
        }),
      db
        .select({
          id: technicianBlockedSlotSchema.id,
          technicianId: technicianBlockedSlotSchema.technicianId,
          dayOfWeek: technicianBlockedSlotSchema.dayOfWeek,
          startTime: technicianBlockedSlotSchema.startTime,
          endTime: technicianBlockedSlotSchema.endTime,
          specificDate: technicianBlockedSlotSchema.specificDate,
          label: technicianBlockedSlotSchema.label,
          isRecurring: technicianBlockedSlotSchema.isRecurring,
        })
        .from(technicianBlockedSlotSchema)
        .where(
          and(
            eq(technicianBlockedSlotSchema.salonId, args.salonId),
            inArray(technicianBlockedSlotSchema.technicianId, technicianIds),
            // Recurring blocks apply to every week in view; a one-off block
            // only matters when its own date is inside the range.
            or(
              isNull(technicianBlockedSlotSchema.specificDate),
              and(
                gte(technicianBlockedSlotSchema.specificDate, args.rangeStart),
                lt(technicianBlockedSlotSchema.specificDate, args.rangeEndExclusive),
              ),
            ),
          ),
        )
        .catch((error: unknown) => {
          console.warn('[AdminAppointments] technician_blocked_slot unavailable', error);
          return [];
        }),
    ]);

    timeOff = timeOffRows.flatMap((row) => {
      const startDate = toDateOnlyString(row.startDate);
      const endDate = toDateOnlyString(row.endDate);
      if (!startDate || !endDate) {
        return [];
      }
      return [{ id: row.id, technicianId: row.technicianId, startDate, endDate, reason: row.reason ?? null }];
    });

    blockedSlots = blockedRows.map(row => ({
      id: row.id,
      technicianId: row.technicianId,
      dayOfWeek: row.dayOfWeek ?? null,
      startTime: row.startTime,
      endTime: row.endTime,
      specificDate: toDateOnlyString(row.specificDate),
      label: row.label ?? null,
      isRecurring: row.isRecurring ?? true,
    }));
  }

  return {
    businessHours: ceiling.businessHours,
    businessHoursSource: ceiling.source,
    technicians: args.technicians.map(technician => ({
      id: technician.id,
      name: technician.name,
      weeklySchedule: technician.weeklySchedule,
    })),
    timeOff,
    blockedSlots,
  };
}

function parseStatuses(statusParam: string | undefined): string[] | null {
  if (!statusParam) {
    return null;
  }
  const allowed = new Set<string>(APPOINTMENT_STATUSES);
  const statuses = statusParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => allowed.has(s));
  return statuses;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { salon, error } = await requireAdminSalonFromRequest(request);
    if (error || !salon) {
      return error!;
    }
    const salonId = salon.id;

    const { searchParams } = new URL(request.url);
    const validated = querySchema.safeParse({
      date: searchParams.get('date'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      status: searchParams.get('status'),
      limit: searchParams.get('limit'),
    });

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

    const { date, startDate, endDate, status, limit } = validated.data;
    const statuses = parseStatuses(status);
    const bookingConfig = await getBookingConfigForSalon(salonId);

    // Build time window
    let start: Date;
    let endExclusive: Date;
    let orderBy = desc(appointmentSchema.startTime);

    if (date) {
      const bounds = getZonedDayBounds(date, bookingConfig.timezone);
      start = bounds.startOfDay;
      endExclusive = new Date(bounds.endOfDay.getTime() + 1);
      orderBy = asc(appointmentSchema.startTime);
    } else if (startDate) {
      start = getZonedDayBounds(startDate, bookingConfig.timezone).startOfDay;
      if (endDate) {
        const endBounds = getZonedDayBounds(endDate, bookingConfig.timezone);
        endExclusive = new Date(endBounds.endOfDay.getTime() + 1);
      } else {
        endExclusive = new Date();
      }
    } else {
      // Default: last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      start = sevenDaysAgo;
      endExclusive = new Date();
    }

    const whereClauses = [
      eq(appointmentSchema.salonId, salonId),
      isNull(appointmentSchema.deletedAt),
      gte(appointmentSchema.startTime, start),
      lt(appointmentSchema.startTime, endExclusive),
    ];
    if (statuses && statuses.length > 0) {
      whereClauses.push(inArray(appointmentSchema.status, statuses));
    } else {
      // No explicit status filter: exclude deposit holds. Callers that want to
      // see holds (the calendar, the day list, the walk-in view) ask for
      // 'awaiting_payment' by name. An unfiltered consumer — notifications
      // being the one that matters — must not have unpaid holds appear in it as
      // though they were bookings.
      whereClauses.push(ne(appointmentSchema.status, 'awaiting_payment'));
    }

    const [appointments, technicians] = await Promise.all([
      db
        .select({
          id: appointmentSchema.id,
          clientName: appointmentSchema.clientName,
          clientPhone: appointmentSchema.clientPhone,
          technicianId: appointmentSchema.technicianId,
          technicianName: technicianSchema.name,
          startTime: appointmentSchema.startTime,
          endTime: appointmentSchema.endTime,
          status: appointmentSchema.status,
          totalPrice: appointmentSchema.totalPrice,
          totalDurationMinutes: appointmentSchema.totalDurationMinutes,
          locationId: appointmentSchema.locationId,
          createdAt: appointmentSchema.createdAt,
        })
        .from(appointmentSchema)
        .leftJoin(technicianSchema, eq(appointmentSchema.technicianId, technicianSchema.id))
        .where(and(...whereClauses))
        .orderBy(orderBy)
        .limit(limit),
      getTechniciansBySalonId(salonId),
    ]);

    // The calendar draws closed days, time off and blocked windows from the
    // same authorities the booking engine enforces, so it rides along with the
    // appointments it has to be consistent with (one round trip, one tenant
    // check) rather than becoming three more client fetches.
    const schedule = await loadCalendarSchedule({
      salonId,
      salonBusinessHours: salon.businessHours ?? null,
      technicians: technicians.map(technician => ({
        id: technician.id,
        name: technician.name,
        weeklySchedule: normalizeWeeklySchedule(technician.weeklySchedule),
      })),
      rangeStart: start,
      rangeEndExclusive: endExclusive,
    });
    const technicianPayload = schedule.technicians.map(technician => ({
      id: technician.id,
      name: technician.name,
      weeklySchedule: technician.weeklySchedule,
    }));

    if (appointments.length === 0) {
      return Response.json({
        data: {
          appointments: [],
          technicians: technicianPayload,
          schedule,
        },
        meta: {
          slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
          timeZone: bookingConfig.timezone,
        },
      }, { status: 200 });
    }

    const appointmentIds = appointments.map(a => a.id);

    const apptServices = await db
      .select({
        appointmentId: appointmentServicesSchema.appointmentId,
        serviceName: serviceSchema.name,
      })
      .from(appointmentServicesSchema)
      .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
      .where(inArray(appointmentServicesSchema.appointmentId, appointmentIds));

    const servicesByAppointment = new Map<string, Array<{ name: string }>>();
    for (const row of apptServices) {
      const list = servicesByAppointment.get(row.appointmentId) ?? [];
      list.push({ name: row.serviceName });
      servicesByAppointment.set(row.appointmentId, list);
    }

    const payload = appointments.map(a => ({
      id: a.id,
      clientName: a.clientName,
      clientPhone: a.clientPhone,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString(),
      status: a.status,
      totalPrice: a.totalPrice,
      totalDurationMinutes: a.totalDurationMinutes,
      locationId: a.locationId,
      createdAt: a.createdAt.toISOString(),
      services: servicesByAppointment.get(a.id) ?? [],
      technician: a.technicianId && a.technicianName
        ? { id: a.technicianId, name: a.technicianName }
        : null,
    }));

    return Response.json({
      data: {
        appointments: payload,
        technicians: technicianPayload,
        schedule,
      },
      meta: {
        slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
        timeZone: bookingConfig.timezone,
      },
    }, { status: 200 });
  } catch (err) {
    console.error('[AdminAppointments] failed', err);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch appointments' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
