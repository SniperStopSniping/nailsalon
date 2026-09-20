import { and, eq } from 'drizzle-orm';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin } from '@/libs/customerAssistant/http.server';
import { db } from '@/libs/DB';
import { mintNextVisitOfferLink } from '@/libs/nextVisitOffer.server';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { nextVisitOfferSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ token: string }> };
async function resolve(request: Request, context: Context) {
  const limit = checkEndpointRateLimit('public/retention-campaigns', getClientIp(request), 'REFERRAL');
  if (!limit.allowed) {
    return { response: rateLimitResponse(limit.retryAfterMs) };
  }
  const { token } = await context.params;
  const capability = await verifyAppointmentAccessToken(token);
  if (!capability || capability.appointment.status !== 'completed') {
    return { response: Response.json({ data: { offer: null } }, { headers: CUSTOMER_NO_STORE }) };
  }
  return { capability };
}
export async function GET(request: Request, context: Context) {
  const access = await resolve(request, context);
  if (access.response) {
    return access.response;
  }
  const { capability } = access;
  const [offer] = await db.select().from(nextVisitOfferSchema).where(and(
    eq(nextVisitOfferSchema.salonId, capability.salonId),
    eq(nextVisitOfferSchema.sourceAppointmentId, capability.appointmentId),
  )).limit(1);
  const available = offer?.state === 'available' && offer.expiresAt > new Date();
  return Response.json({ data: { offer: available ? { deadlineDate: offer.deadlineDate, settings: offer.settingsSnapshot, currency: offer.currency } : null } }, { headers: CUSTOMER_NO_STORE });
}
export async function POST(request: Request, context: Context) {
  if (!isCustomerSameOrigin(request)) {
    return Response.json({ error: 'Unavailable' }, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const access = await resolve(request, context);
  if (access.response) {
    return access.response;
  }
  const { capability } = access;
  const issued = await mintNextVisitOfferLink(db, { salonId: capability.salonId, sourceAppointmentId: capability.appointmentId });
  const [salon] = issued
    ? await db.select({ slug: salonSchema.slug, customDomain: salonSchema.customDomain }).from(salonSchema)
      .where(eq(salonSchema.id, capability.salonId)).limit(1)
    : [];
  return Response.json({ data: { offer: issued && salon ? { bookingUrl: buildSalonTenantPublicUrl(`/book?campaign=${encodeURIComponent(issued.token)}`, salon) } : null } }, { headers: CUSTOMER_NO_STORE });
}
