import { and, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  disableNetworkNoShowSalonInTx,
  eraseNetworkNoShowSubjectInTx,
  suppressNetworkNoShowEventInTx,
  suppressNetworkNoShowSubjectInTx,
} from '@/libs/networkNoShow.server';
import { checkEndpointRateLimit, rateLimitResponse } from '@/libs/rateLimit';
import { networkNoShowAuditSchema, networkNoShowBookingBindingSchema, networkNoShowEventSchema, networkNoShowParticipationSchema, networkNoShowSubjectSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  action: z.enum(['inspect', 'cleanup_salon', 'enroll_salon', 'disable_salon', 'suppress_event', 'suppress_subject', 'erase_subject']),
  salonId: z.string().min(1).max(200),
  appointmentId: z.string().min(1).max(200).optional(),
  mode: z.enum(['plan', 'apply']).default('plan'),
}).strict();
const headers = { 'Cache-Control': 'no-store' };

/** Restricted operations only. No arbitrary contact search, imports or customer-facing records. */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }
  const limit = checkEndpointRateLimit('network-no-show-operations', guard.admin.id, 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
  }
  const { action, salonId, appointmentId, mode } = parsed.data;
  if (['suppress_event', 'suppress_subject', 'erase_subject'].includes(action) && !appointmentId) {
    return Response.json({ error: 'APPOINTMENT_REQUIRED' }, { status: 400, headers });
  }
  if (action === 'enroll_salon' && (process.env.NETWORK_NO_SHOW_ENABLED !== 'true' || (process.env.NETWORK_NO_SHOW_HMAC_KEY?.length ?? 0) < 32)) {
    return Response.json({ error: 'PLATFORM_NOT_READY' }, { status: 409, headers });
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [salon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('no key update').limit(1);
      if (!salon) {
        return null;
      }
      const [participation] = await tx.select().from(networkNoShowParticipationSchema).where(eq(networkNoShowParticipationSchema.salonId, salonId)).limit(1);
      const [binding] = appointmentId ? await tx.select().from(networkNoShowBookingBindingSchema).where(and(eq(networkNoShowBookingBindingSchema.salonId, salonId), eq(networkNoShowBookingBindingSchema.appointmentId, appointmentId))).limit(1) : [];
      const [event] = appointmentId ? await tx.select().from(networkNoShowEventSchema).where(and(eq(networkNoShowEventSchema.salonId, salonId), eq(networkNoShowEventSchema.appointmentId, appointmentId))).limit(1) : [];
      if ((action === 'suppress_event' && !event) || (['suppress_subject', 'erase_subject'].includes(action) && !binding?.subjectId)) {
        return null;
      }
      const now = new Date();
      if (mode === 'apply') {
        if (action === 'enroll_salon' && (!participation || participation.disabledAt)) {
          await tx.insert(networkNoShowParticipationSchema).values({ salonId, enabledAt: now, prospectiveAfter: now })
            .onConflictDoUpdate({ target: networkNoShowParticipationSchema.salonId, set: { enabledAt: now, prospectiveAfter: now, disabledAt: null, updatedAt: now } });
        } else if (action === 'disable_salon') {
          await disableNetworkNoShowSalonInTx(tx, { salonId, operatorId: guard.admin.id, now });
        } else if (action === 'cleanup_salon') {
          const graceCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          // The source uniqueness fence remains in the binding until its own
          // occurrence is too old to enter the 12-month window again.
          await tx.delete(networkNoShowEventSchema).where(and(eq(networkNoShowEventSchema.salonId, salonId), lt(networkNoShowEventSchema.expiresAt, graceCutoff)));
          const bindingCutoff = new Date(now);
          bindingCutoff.setUTCMonth(bindingCutoff.getUTCMonth() - 13);
          await tx.delete(networkNoShowBookingBindingSchema).where(and(
            eq(networkNoShowBookingBindingSchema.salonId, salonId),
            lt(networkNoShowBookingBindingSchema.createdAt, bindingCutoff),
            sql`not exists (select 1 from network_no_show_event e where e.salon_id = ${salonId} and e.appointment_id = ${networkNoShowBookingBindingSchema.appointmentId})`,
            sql`exists (select 1 from appointment a where a.salon_id = ${salonId} and a.id = ${networkNoShowBookingBindingSchema.appointmentId} and a.end_time < ${bindingCutoff})`,
          ));
          // Keep now-orphaned subjects until a dedicated subject-retention pass
          // can lock them before deleting their projection rows. This cleanup
          // must never invert the subject-first serialization order.
          await tx.delete(networkNoShowAuditSchema).where(and(
            eq(networkNoShowAuditSchema.salonId, salonId),
            lt(networkNoShowAuditSchema.createdAt, new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)),
            sql`${networkNoShowAuditSchema.eventId} is null`,
          ));
        } else if (action === 'suppress_event' && event) {
          await suppressNetworkNoShowEventInTx(tx, { eventId: event.id, operatorId: guard.admin.id, now, reason: 'accuracy_dispute' });
        } else if (action === 'suppress_subject' && binding?.subjectId) {
          await suppressNetworkNoShowSubjectInTx(tx, { subjectId: binding.subjectId, operatorId: guard.admin.id, now, reason: 'identity_conflict' });
        } else if (action === 'erase_subject' && binding?.subjectId) {
          await eraseNetworkNoShowSubjectInTx(tx, { subjectId: binding.subjectId, operatorId: guard.admin.id, now });
        }
      }
      await tx.insert(networkNoShowAuditSchema).values({ id: crypto.randomUUID(), salonId, actorId: guard.admin.id, actorRole: 'operator', action: `${mode}:${action}:${appointmentId ?? salonId}` });
      const [subject] = binding?.subjectId ? await tx.select({ state: networkNoShowSubjectSchema.state }).from(networkNoShowSubjectSchema).where(eq(networkNoShowSubjectSchema.id, binding.subjectId)).limit(1) : [];
      return { mode, action, applied: mode === 'apply' && action !== 'inspect', before: { participating: Boolean(participation && !participation.disabledAt), bindingState: binding?.state ?? null, eventState: event?.state ?? null }, subjectState: subject?.state ?? null };
    });
    return Response.json(result ?? { error: 'NOT_FOUND' }, { status: result ? 200 : 404, headers });
  } catch {
    return Response.json({ error: 'NETWORK_OPERATION_UNAVAILABLE' }, { status: 503, headers });
  }
}
