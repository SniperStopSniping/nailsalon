import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { setNetworkNoShowAuditActorInTx } from '@/libs/networkNoShowAudit.server';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';
import { appointmentAuditLogSchema, appointmentSchema, networkNoShowAuditSchema, networkNoShowEventSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };
const requestSchema = z.object({
  salonId: z.string().min(1).max(200),
  appointmentId: z.string().min(1).max(200),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(10).max(500),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const limit = checkEndpointRateLimit('network-no-show-correct', guard.admin.id, 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
  }

  const { salonId, appointmentId, expectedUpdatedAt, reason } = parsed.data;
  try {
    const result = await db.transaction(async (tx) => {
      const [appointment] = await tx.select({
        id: appointmentSchema.id,
        status: appointmentSchema.status,
        updatedAt: appointmentSchema.updatedAt,
        deletedAt: appointmentSchema.deletedAt,
      }).from(appointmentSchema)
        .where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId)))
        .for('update').limit(1);
      if (!appointment) {
        return 'not_found';
      }
      if (appointment.status !== 'no_show' || appointment.deletedAt || appointment.updatedAt.toISOString() !== expectedUpdatedAt) {
        return 'conflict';
      }

      await setNetworkNoShowAuditActorInTx(tx, guard.admin.id, 'operator');
      await tx.update(appointmentSchema).set({
        status: 'cancelled',
        canvasState: 'cancelled',
        cancelReason: 'admin_correction',
        canvasStateUpdatedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId)));

      const [event] = await tx.select({ id: networkNoShowEventSchema.id })
        .from(networkNoShowEventSchema)
        .where(and(eq(networkNoShowEventSchema.salonId, salonId), eq(networkNoShowEventSchema.appointmentId, appointmentId)))
        .limit(1);
      await tx.insert(appointmentAuditLogSchema).values({
        id: crypto.randomUUID(),
        appointmentId,
        salonId,
        action: 'admin_override',
        performedBy: guard.admin.id,
        performedByRole: 'admin',
        previousValue: { status: 'no_show' },
        newValue: { status: 'cancelled', cancelReason: 'admin_correction' },
        reason,
      });
      await tx.insert(networkNoShowAuditSchema).values({
        id: crypto.randomUUID(),
        salonId,
        eventId: event?.id ?? null,
        actorId: guard.admin.id,
        actorRole: 'operator',
        action: `source_corrected:no_show_to_cancelled:${appointmentId}`,
      });
      return 'applied';
    });
    if (result === 'not_found') {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers });
    }
    if (result === 'conflict') {
      return Response.json({ error: 'RECORD_CHANGED_REFRESH_REQUIRED' }, { status: 409, headers });
    }
    return Response.json({ corrected: true }, { headers });
  } catch {
    return Response.json({ error: 'NO_SHOW_CORRECTION_UNAVAILABLE' }, { status: 503, headers });
  }
}
