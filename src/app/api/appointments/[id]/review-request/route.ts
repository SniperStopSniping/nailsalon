import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { getAppointmentReviewState, scheduleReviewRequest } from '@/libs/reviewRequests.server';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';

export const dynamic = 'force-dynamic';

async function run(request: Request, appointmentId: string, send: boolean) {
  const access = await requireAppointmentManagerAccess(appointmentId, {
    assignedOnly: true,
    salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
  });
  if (!access.ok) {
    return access.response;
  }
  if (send) {
    const rate = checkEndpointRateLimit('communications/review-request', getClientIp(request), 'GENERAL');
    if (!rate.allowed) {
      return rateLimitResponse(rate.retryAfterMs);
    }
  }
  try {
    if (send) {
      await db.transaction(tx => scheduleReviewRequest(tx, access.appointment.salonId, appointmentId, false));
    }
    const data = await getAppointmentReviewState(access.appointment.salonId, appointmentId);
    return Response.json({ data }, { status: send && data.status === 'scheduled' ? 202 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: { message: 'Review requests are unavailable. Try again.' } }, { status: 503 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(request, (await params).id, false);
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return run(request, (await params).id, true);
}
