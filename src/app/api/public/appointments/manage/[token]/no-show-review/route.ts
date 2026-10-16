import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { requestNoShowReviewInTx } from '@/libs/networkNoShowReview.server';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { appointmentAccessTokenSchema, appointmentSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const bodySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const ipLimit = checkEndpointRateLimit('customer-no-show-review-ip', getClientIp(request), 'BILLING');
  if (!ipLimit.allowed) {
    return rateLimitResponse(ipLimit.retryAfterMs);
  }
  const limit = checkEndpointRateLimit('customer-no-show-review', hashOpaqueToken(token), 'BILLING');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }
  const capability = await verifyAppointmentAccessToken(token);
  if (!capability) {
    return Response.json({ error: 'BOOKING_ACCESS_UNAVAILABLE' }, { status: 404, headers });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Explain the request in 10–500 characters.' }, { status: 400, headers });
  }
  try {
    const accepted = await db.transaction(async (tx) => {
      const now = new Date();
      const [appointment] = await tx.select().from(appointmentSchema)
        .where(and(eq(appointmentSchema.id, capability.appointmentId), eq(appointmentSchema.salonId, capability.salonId))).for('update').limit(1);
      // Recheck the capability under lock: expiry/revocation cannot race review intake.
      const [credential] = await tx.select({ id: appointmentAccessTokenSchema.id }).from(appointmentAccessTokenSchema)
        .where(and(eq(appointmentAccessTokenSchema.id, capability.tokenId), eq(appointmentAccessTokenSchema.tokenHash, hashOpaqueToken(token)), eq(appointmentAccessTokenSchema.salonId, capability.salonId), eq(appointmentAccessTokenSchema.appointmentId, capability.appointmentId), isNull(appointmentAccessTokenSchema.revokedAt), gt(appointmentAccessTokenSchema.expiresAt, now))).for('share').limit(1);
      if (!appointment || appointment.deletedAt || appointment.status !== 'no_show' || !credential) {
        return 'unavailable' as const;
      }
      return requestNoShowReviewInTx(tx, { salonId: capability.salonId, appointmentId: capability.appointmentId, reason: parsed.data.reason, now });
    });
    if (accepted === 'closed') {
      return Response.json({ error: 'REVIEW_ALREADY_COMPLETED', message: 'This review is already complete. Contact Luster support to request another review.' }, { status: 409, headers });
    }
    // Never disclose event existence, shared count, identity matches or reporting salons.
    return Response.json(accepted === 'requested' ? { requested: true, message: 'Review requested. Any eligible shared contribution from this appointment is suspended during review. Existing payments need a separate review.' } : { error: 'BOOKING_ACCESS_UNAVAILABLE' }, { status: accepted === 'requested' ? 200 : 404, headers });
  } catch {
    return Response.json({ error: 'Review could not be requested. Please try again.' }, { status: 503, headers });
  }
}
