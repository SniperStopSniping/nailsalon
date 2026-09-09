import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { ClientLifecycleStabilizationError } from '@/libs/clientLifecycleStabilization';
import { ClientMessagingError, getClientSmsHistory, queueClientSms, retryClientSms } from '@/libs/clientMessaging';
import { getSalonSmsReadiness } from '@/libs/integrationHealth';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
const sendSchema = z.object({
  salonSlug: z.string().min(1),
  message: z.string().trim().min(1).max(1000),
  requestId: z.string().uuid(),
  appointmentId: z.string().min(1).optional(),
}).strict();
const retrySchema = z.object({ salonSlug: z.string().min(1), intentId: z.string().min(1) }).strict();

function failure(error: unknown) {
  if (error instanceof ClientMessagingError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, ...NO_STORE });
  }
  if (error instanceof ClientLifecycleStabilizationError) {
    return Response.json({ error: { code: error.code, message: 'This client is unavailable in this salon.' } }, { status: 404, ...NO_STORE });
  }
  return Response.json({ error: { code: 'MESSAGING_UNAVAILABLE', message: 'Messaging could not be loaded. Try again.' } }, { status: 503, ...NO_STORE });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const query = new URL(request.url).searchParams;
  const slug = query.get('salonSlug');
  if (!slug) {
    return Response.json({ error: { message: 'A salon is required.' } }, { status: 400, ...NO_STORE });
  }
  const guard = await requireAdminSalon(slug);
  if (guard.error || !guard.salon) {
    return guard.error ?? Response.json({}, { status: 403, ...NO_STORE });
  }
  try {
    const { id } = await params;
    const [history, sms] = await Promise.all([
      getClientSmsHistory({ salonId: guard.salon.id, clientId: id, appointmentId: query.get('appointmentId') ?? undefined }),
      getSalonSmsReadiness(guard.salon.id),
    ]);
    return Response.json({ data: { history, sms } }, NO_STORE);
  } catch (error) {
    return failure(error);
  }
}

async function mutate(request: Request, clientId: string, retry: boolean) {
  const rate = checkEndpointRateLimit('communications/manual', getClientIp(request), 'GENERAL');
  if (!rate.allowed) {
    return rateLimitResponse(rate.retryAfterMs);
  }
  const parsed = (retry ? retrySchema : sendSchema).safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_MESSAGE', message: 'Enter a message of 1–1,000 characters with a valid send identifier.' } }, { status: 400, ...NO_STORE });
  }
  const guard = await requireAdminSalon(parsed.data.salonSlug);
  if (guard.error || !guard.salon) {
    return guard.error ?? Response.json({}, { status: 403, ...NO_STORE });
  }
  try {
    const sms = await getSalonSmsReadiness(guard.salon.id);
    if (retry && !sms.manualAvailable) {
      return Response.json({ error: { code: sms.blockingReason ?? 'SMS_UNAVAILABLE', message: sms.detail } }, { status: 409, ...NO_STORE });
    }
    const data = 'intentId' in parsed.data
      ? await retryClientSms({ salonId: guard.salon.id, clientId, intentId: parsed.data.intentId })
      : await queueClientSms({
        salonId: guard.salon.id,
        clientId,
        ...parsed.data,
        availability: { available: sms.manualAvailable, code: sms.blockingReason, message: sms.detail },
      });
    const history = await getClientSmsHistory({ salonId: guard.salon.id, clientId });
    return Response.json({ data: { ...data, history, sms } }, { status: 202, ...NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id, false);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id, true);
}
