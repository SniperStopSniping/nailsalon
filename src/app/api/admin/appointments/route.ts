/**
 * Admin Appointments List API
 *
 * GET /api/admin/appointments
 * Returns appointments for the authenticated admin's active salon.
 *
 * salonId is ALWAYS derived from session + __active_salon_slug cookie.
 * NEVER accepts salonId from query params.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { APPOINTMENT_STATUSES, appointmentSchema, appointmentServicesSchema, salonSchema, serviceSchema, technicianSchema } from '@/models/Schema';

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

async function getActiveSalonId(): Promise<{
  salonId: string | null;
  error: Response | null;
}> {
  const admin = await getAdminSession();

  if (!admin) {
    return {
      salonId: null,
      error: Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies ErrorResponse,
        { status: 401 },
      ),
    };
  }

  const cookieStore = await cookies();
  const activeSalonSlug = cookieStore.get('__active_salon_slug')?.value;

  // Super admins can access any salon if slug is set
  if (admin.isSuperAdmin && activeSalonSlug) {
    const [salon] = await db
      .select({ id: salonSchema.id })
      .from(salonSchema)
      .where(eq(salonSchema.slug, activeSalonSlug))
      .limit(1);

    if (salon) {
      return { salonId: salon.id, error: null };
    }
  }

  // Regular admins: find matching salon from memberships
  if (activeSalonSlug) {
    const membership = admin.salons.find(
      s => s.salonSlug?.toLowerCase() === activeSalonSlug.toLowerCase(),
    );
    if (membership) {
      return { salonId: membership.salonId, error: null };
    }
  }

  // Fallback: first salon in memberships
  if (admin.salons.length > 0) {
    return { salonId: admin.salons[0]!.salonId, error: null };
  }

  return {
    salonId: null,
    error: Response.json(
      { error: { code: 'NO_SALON_ACCESS', message: 'No salon access' } } satisfies ErrorResponse,
      { status: 403 },
    ),
  };
}

function startOfUtcDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { salonId, error } = await getActiveSalonId();
    if (error || !salonId) {
      return error!;
    }

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

    // Build time window
    let start: Date;
    let endExclusive: Date;
    let orderBy = desc(appointmentSchema.startTime);

    if (date) {
      start = startOfUtcDay(date);
      endExclusive = addUtcDays(start, 1);
      orderBy = asc(appointmentSchema.startTime);
    } else if (startDate) {
      start = startOfUtcDay(startDate);
      if (endDate) {
        const endDay = startOfUtcDay(endDate);
        endExclusive = addUtcDays(endDay, 1);
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
    }

    const appointments = await db
      .select({
        id: appointmentSchema.id,
        clientName: appointmentSchema.clientName,
        clientPhone: appointmentSchema.clientPhone,
        technicianId: appointmentSchema.technicianId,
        technicianName: technicianSchema.name,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
        createdAt: appointmentSchema.createdAt,
      })
      .from(appointmentSchema)
      .leftJoin(technicianSchema, eq(appointmentSchema.technicianId, technicianSchema.id))
      .where(and(...whereClauses))
      .orderBy(orderBy)
      .limit(limit);

    if (appointments.length === 0) {
      return Response.json({ data: { appointments: [] } }, { status: 200 });
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
      createdAt: a.createdAt.toISOString(),
      services: servicesByAppointment.get(a.id) ?? [],
      technician: a.technicianId && a.technicianName
        ? { id: a.technicianId, name: a.technicianName }
        : null,
    }));

    return Response.json({ data: { appointments: payload } }, { status: 200 });
  } catch (err) {
    console.error('[AdminAppointments] failed', err);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch appointments' } } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
