import { and, count, desc, eq, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalonFromRequest } from '@/libs/adminAuth';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { isNetworkNoShowPlatformActive } from '@/libs/networkNoShow.server';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';
import { appointmentSchema, networkNoShowEventSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  salonSlug: z.string().trim().min(1).max(100).optional(),
  salon: z.string().trim().min(1).max(100).optional(),
}).strict();

function maskPhone(phone: string): string {
  const lastFour = phone.replace(/\D/g, '').slice(-4);
  return lastFour ? `••• ${lastFour}` : 'Unavailable';
}

function maskEmail(email: string | null): string | null {
  if (!email) {
    return null;
  }
  const [local, domain] = email.split('@');
  return local && domain ? `${local[0]}•••@${domain}` : null;
}

export async function GET(request: Request): Promise<Response> {
  const { salon, admin, error } = await requireAdminSalonFromRequest(request);
  if (error || !salon || !admin) {
    return error!;
  }
  const limit = checkEndpointRateLimit('owner-network-no-show-records', admin.id, 'GENERAL');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_QUERY' }, { status: 400, headers });
  }

  let platformActive: boolean;
  try {
    platformActive = await isNetworkNoShowPlatformActive();
  } catch {
    return Response.json({ error: 'NO_SHOW_RECORDS_UNAVAILABLE' }, { status: 503, headers });
  }
  const now = new Date();
  const joinEvent = and(eq(networkNoShowEventSchema.salonId, appointmentSchema.salonId), eq(networkNoShowEventSchema.appointmentId, appointmentSchema.id));
  const where = and(eq(appointmentSchema.salonId, salon.id), or(eq(appointmentSchema.status, 'no_show'), eq(appointmentSchema.cancelReason, 'admin_correction'), isNotNull(networkNoShowEventSchema.id))!);
  try {
    const [totalResult, rows] = await Promise.all([
      db.select({ total: count() }).from(appointmentSchema).leftJoin(networkNoShowEventSchema, joinEvent).where(where),
      db.select({
        appointmentId: appointmentSchema.id,
        clientName: appointmentSchema.clientName,
        clientPhone: appointmentSchema.clientPhone,
        clientEmail: appointmentSchema.clientEmail,
        appointmentStatus: appointmentSchema.status,
        cancelReason: appointmentSchema.cancelReason,
        updatedAt: appointmentSchema.updatedAt,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        eventId: networkNoShowEventSchema.id,
        eventState: networkNoShowEventSchema.state,
        expiresAt: networkNoShowEventSchema.expiresAt,
        markedAt: networkNoShowEventSchema.markedAt,
      }).from(appointmentSchema).leftJoin(networkNoShowEventSchema, joinEvent).where(where).orderBy(desc(appointmentSchema.endTime), desc(appointmentSchema.id)).limit(25).offset((parsed.data.page - 1) * 25),
    ]);
    const { timezone } = resolveBookingConfigFromSettings((salon.settings as Parameters<typeof resolveBookingConfigFromSettings>[0]) ?? null);
    return Response.json({ page: parsed.data.page, pageSize: 25, total: totalResult[0]?.total ?? 0, platformActive, timeZone: timezone, items: rows.map(row => ({
      ...row,
      clientPhone: maskPhone(row.clientPhone),
      clientEmail: maskEmail(row.clientEmail),
      eventEligible: row.eventState === 'active' && Boolean(row.expiresAt && row.expiresAt > now),
      countsForNetwork: platformActive && row.eventState === 'active' && Boolean(row.expiresAt && row.expiresAt > now),
    })) }, { headers });
  } catch {
    return Response.json({ error: 'NO_SHOW_RECORDS_UNAVAILABLE' }, { status: 503, headers });
  }
}
