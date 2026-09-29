import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalonFromRequest } from '@/libs/adminAuth';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { db } from '@/libs/DB';
import { setNetworkNoShowAuditActorInTx } from '@/libs/networkNoShowAudit.server';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';
import { appointmentAuditLogSchema, appointmentSchema, networkNoShowAuditSchema, networkNoShowEventSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const bodySchema = z.object({ appointmentId: z.string().min(1).max(200), expectedUpdatedAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(10).max(500) }).strict();

export async function POST(request: Request): Promise<Response> {
  const { salon, admin, error } = await requireAdminSalonFromRequest(request);
  if (error || !salon || !admin) {
    return error!;
  }
  const limit = checkEndpointRateLimit('owner-network-no-show-correct', admin.id, 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [appointment] = await tx.select({ id: appointmentSchema.id, status: appointmentSchema.status, updatedAt: appointmentSchema.updatedAt, deletedAt: appointmentSchema.deletedAt })
        .from(appointmentSchema).where(and(eq(appointmentSchema.salonId, salon.id), eq(appointmentSchema.id, parsed.data.appointmentId))).for('update').limit(1);
      if (!appointment) {
        return 'not_found';
      }
      if (appointment.status !== 'no_show' || appointment.deletedAt || appointment.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
        return 'conflict';
      }
      const now = new Date();
      await setNetworkNoShowAuditActorInTx(tx, admin.id, 'admin');
      await tx.update(appointmentSchema).set({ status: 'cancelled', canvasState: 'cancelled', cancelReason: 'admin_correction', canvasStateUpdatedAt: now, updatedAt: now })
        .where(and(eq(appointmentSchema.salonId, salon.id), eq(appointmentSchema.id, appointment.id)));
      const [event] = await tx.select({ id: networkNoShowEventSchema.id }).from(networkNoShowEventSchema)
        .where(and(eq(networkNoShowEventSchema.salonId, salon.id), eq(networkNoShowEventSchema.appointmentId, appointment.id))).limit(1);
      await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({ appointmentId: appointment.id, salonId: salon.id, action: 'admin_override', performedBy: admin.id, performedByRole: 'admin', performedByName: admin.name ?? undefined, previousValue: { status: 'no_show' }, newValue: { status: 'cancelled', cancelReason: 'admin_correction' }, reason: parsed.data.reason }));
      await tx.insert(networkNoShowAuditSchema).values({ id: crypto.randomUUID(), salonId: salon.id, eventId: event?.id ?? null, actorId: admin.id, actorRole: 'admin', action: `source_corrected:no_show_to_cancelled:${appointment.id}` });
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
