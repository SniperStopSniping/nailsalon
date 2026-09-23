import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { createConfirmationRebookingHandoff } from '@/libs/confirmationRebooking.server';
import { CUSTOMER_NO_STORE } from '@/libs/customerAssistant/http.server';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { resolveRebookingPromptSettings } from '@/libs/rebookingPromptSettings';
import { AllLocales } from '@/utils/AppConfig';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

function unavailable(): Response {
  return Response.json({
    error: { code: 'NEXT_BOOKING_UNAVAILABLE', message: 'Next booking is unavailable for this appointment.' },
  }, { status: 404, headers: CUSTOMER_NO_STORE });
}

function resolveLocale(request: Request): string {
  const locale = new URL(request.url).searchParams.get('locale');
  return locale && AllLocales.includes(locale) ? locale : 'en';
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const limit = checkEndpointRateLimit('public/confirmation-next-booking', getClientIp(request), 'REFERRAL');
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterMs);
  }

  const capability = await verifyAppointmentAccessToken((await context.params).token);
  const appointment = capability?.appointment;
  const settings = capability ? resolveRebookingPromptSettings(capability.salonSettings) : null;
  if (!capability
    || !appointment
    || appointment.id !== capability.appointmentId
    || appointment.salonId !== capability.salonId
    || appointment.status !== 'confirmed'
    || appointment.deletedAt
    || !settings?.enabled) {
    return unavailable();
  }

  const bookingConfig = resolveBookingConfigFromSettings(capability.salonSettings);
  const handoff = await createConfirmationRebookingHandoff({
    appointment,
    salonSlug: capability.salonSlug,
    locale: resolveLocale(request),
    salonTimeZone: bookingConfig.timezone,
    settings,
  });
  return Response.json({ data: handoff }, { headers: CUSTOMER_NO_STORE });
}
