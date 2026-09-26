import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { isNetworkNoShowPlatformActive } from '@/libs/networkNoShow.server';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';
import { appointmentSchema, networkNoShowAuditSchema, networkNoShowEventSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };
const querySchema = z.object({
  salon: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  state: z.enum(['all', 'counted', 'not_shared', 'suppressed', 'revoked', 'expired']).default('all'),
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
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const limit = checkEndpointRateLimit('network-no-show-records', guard.admin.id, 'GENERAL');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_QUERY' }, { status: 400, headers });
  }

  const { page, salon, state } = parsed.data;
  let platformActive: boolean;
  try {
    platformActive = await isNetworkNoShowPlatformActive();
  } catch {
    return Response.json({ error: 'NO_SHOW_RECORDS_UNAVAILABLE' }, { status: 503, headers });
  }
  const now = new Date();
  const conditions = [or(
    eq(appointmentSchema.status, 'no_show'),
    eq(appointmentSchema.cancelReason, 'admin_correction'),
    isNotNull(networkNoShowEventSchema.id),
  )!];
  if (salon) {
    conditions.push(or(ilike(salonSchema.name, `%${salon}%`), ilike(salonSchema.slug, `%${salon}%`))!);
  }
  if (state === 'counted') {
    conditions.push(platformActive
      ? and(eq(networkNoShowEventSchema.state, 'active'), sql`${networkNoShowEventSchema.expiresAt} > ${now}`)!
      : sql`false`);
  } else if (state === 'not_shared') {
    conditions.push(isNull(networkNoShowEventSchema.id));
  } else if (state === 'expired') {
    conditions.push(and(eq(networkNoShowEventSchema.state, 'active'), sql`${networkNoShowEventSchema.expiresAt} <= ${now}`)!);
  } else if (state === 'revoked') {
    conditions.push(or(eq(networkNoShowEventSchema.state, 'revoked'), eq(appointmentSchema.cancelReason, 'admin_correction'))!);
  } else if (state !== 'all') {
    conditions.push(eq(networkNoShowEventSchema.state, state));
  }

  try {
    const joinEvent = and(
      eq(networkNoShowEventSchema.salonId, appointmentSchema.salonId),
      eq(networkNoShowEventSchema.appointmentId, appointmentSchema.id),
    );
    const where = and(...conditions);
    const [totals, rows] = await Promise.all([
      db.select({ total: count() }).from(appointmentSchema)
        .innerJoin(salonSchema, eq(appointmentSchema.salonId, salonSchema.id))
        .leftJoin(networkNoShowEventSchema, joinEvent).where(where),
      db.select({
        appointmentId: appointmentSchema.id,
        salonId: appointmentSchema.salonId,
        salonName: salonSchema.name,
        salonSlug: salonSchema.slug,
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
        markedAt: networkNoShowEventSchema.markedAt,
        expiresAt: networkNoShowEventSchema.expiresAt,
        suppressionReason: networkNoShowEventSchema.suppressionReason,
      }).from(appointmentSchema)
        .innerJoin(salonSchema, eq(appointmentSchema.salonId, salonSchema.id))
        .leftJoin(networkNoShowEventSchema, joinEvent)
        .where(where)
        .orderBy(desc(appointmentSchema.endTime), desc(appointmentSchema.id))
        .limit(25).offset((page - 1) * 25),
    ]);

    await db.insert(networkNoShowAuditSchema).values({
      id: crypto.randomUUID(),
      salonId: null,
      actorId: guard.admin.id,
      actorRole: 'operator',
      action: `read:global_records:${state}:page_${page}`,
    });

    return Response.json({
      page,
      pageSize: 25,
      platformActive,
      total: totals[0]?.total ?? 0,
      items: rows.map(row => ({
        appointmentId: row.appointmentId,
        salonId: row.salonId,
        salonName: row.salonName,
        salonSlug: row.salonSlug,
        clientName: row.clientName,
        clientPhone: maskPhone(row.clientPhone),
        clientEmail: maskEmail(row.clientEmail),
        appointmentStatus: row.appointmentStatus,
        cancelReason: row.cancelReason,
        updatedAt: row.updatedAt,
        startTime: row.startTime,
        endTime: row.endTime,
        eventId: row.eventId,
        eventState: row.eventState,
        eventEligible: row.eventState === 'active' && Boolean(row.expiresAt && row.expiresAt > now),
        markedAt: row.markedAt,
        expiresAt: row.expiresAt,
        suppressionReason: row.suppressionReason,
        countsForNetwork: platformActive && row.eventState === 'active' && Boolean(row.expiresAt && row.expiresAt > now),
      })),
    }, { headers });
  } catch {
    return Response.json({ error: 'NO_SHOW_RECORDS_UNAVAILABLE' }, { status: 503, headers });
  }
}
