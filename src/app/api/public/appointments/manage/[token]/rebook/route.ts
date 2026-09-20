import { createHash } from 'node:crypto';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { CUSTOMER_NO_STORE, isCustomerSameOrigin } from '@/libs/customerAssistant/http.server';
import { db } from '@/libs/DB';
import { getAvailableNextVisitOfferForSourceAppointment, mintNextVisitOfferLink } from '@/libs/nextVisitOffer.server';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { resolveRebookingPromptSettings } from '@/libs/rebookingPromptSettings';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };
type Capability = NonNullable<Awaited<ReturnType<typeof verifyAppointmentAccessToken>>>;
type Access = { response: Response } | { capability: Capability };

function promptKey(salonId: string, appointmentId: string): string {
  // This stable UI key is never stored server-side and cannot be used as a capability.
  return createHash('sha256').update(`rebooking-prompt:v1:${salonId}:${appointmentId}`, 'utf8').digest('hex');
}

function genericBookingUrl(capability: Capability): string {
  return buildSalonTenantPublicUrl('/book/service', {
    slug: capability.salonSlug,
    customDomain: capability.salonCustomDomain,
  });
}

async function resolve(request: Request, context: Context): Promise<Access> {
  const limit = checkEndpointRateLimit('public/rebooking-prompt', getClientIp(request), 'REFERRAL');
  if (!limit.allowed) {
    return { response: rateLimitResponse(limit.retryAfterMs) };
  }
  const { token } = await context.params;
  const capability = await verifyAppointmentAccessToken(token);
  const appointment = capability?.appointment;
  if (!capability
    || !appointment
    || appointment.status !== 'completed'
    || !appointment.completedAt
    || appointment.deletedAt) {
    return { response: Response.json({ error: { code: 'REBOOK_UNAVAILABLE', message: 'Rebooking is unavailable for this appointment.' } }, { status: 404, headers: CUSTOMER_NO_STORE }) };
  }
  return { capability };
}

async function currentOffer(capability: Capability) {
  if (!resolveRebookingPromptSettings(capability.salonSettings).enabled) {
    return null;
  }
  return getAvailableNextVisitOfferForSourceAppointment(db, {
    salonId: capability.salonId,
    sourceAppointmentId: capability.appointmentId,
  });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await resolve(request, context);
  if ('response' in access) {
    return access.response;
  }
  const promptEnabled = resolveRebookingPromptSettings(access.capability.salonSettings).enabled;
  const offer = promptEnabled ? await currentOffer(access.capability) : null;
  return Response.json({
    data: {
      promptEnabled,
      promptKey: promptKey(access.capability.salonId, access.capability.appointmentId),
      bookingUrl: genericBookingUrl(access.capability),
      offer: offer
        ? { deadlineDate: offer.deadlineDate, currency: offer.currency, settings: offer.settingsSnapshot }
        : null,
    },
  }, { headers: CUSTOMER_NO_STORE });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!isCustomerSameOrigin(request)) {
    return Response.json({ error: { code: 'REBOOK_UNAVAILABLE', message: 'Rebooking is unavailable.' } }, { status: 403, headers: CUSTOMER_NO_STORE });
  }
  const access = await resolve(request, context);
  if ('response' in access) {
    return access.response;
  }
  const offer = await currentOffer(access.capability);
  const issued = offer
    ? await mintNextVisitOfferLink(db, {
      salonId: access.capability.salonId,
      sourceAppointmentId: access.capability.appointmentId,
    })
    : null;
  const bookingUrl = issued
    ? buildSalonTenantPublicUrl(`/book?campaign=${encodeURIComponent(issued.token)}`, {
      slug: access.capability.salonSlug,
      customDomain: access.capability.salonCustomDomain,
    })
    : genericBookingUrl(access.capability);
  return Response.json({ data: { bookingUrl } }, { headers: CUSTOMER_NO_STORE });
}
