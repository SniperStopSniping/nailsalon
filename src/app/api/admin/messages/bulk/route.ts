import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { bulkMessageDraftSchema } from '@/libs/bulkClientMessages';
import { getBulkMessageClients, getBulkMessageReceipt, previewBulkClientMessage, queueBulkClientMessage } from '@/libs/bulkClientMessages.server';
import { ClientMessagingError } from '@/libs/clientMessaging';
import { getSalonSmsReadiness } from '@/libs/integrationHealth';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { hasExactRequestOrigin } from '@/libs/requestOriginGuard';
import { DEFAULT_BOOKING_TIME_ZONE } from '@/libs/timeZone';

export const dynamic = 'force-dynamic';
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
const schema = z.discriminatedUnion('action', [
  bulkMessageDraftSchema.extend({ action: z.literal('preview') }),
  bulkMessageDraftSchema.extend({ action: z.literal('send'), requestId: z.string().uuid(), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
]);

function failure(error: unknown) {
  if (error instanceof ClientMessagingError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, ...NO_STORE });
  }
  return Response.json({ error: { code: 'MESSAGING_UNAVAILABLE', message: 'Messaging could not be loaded. Try again.' } }, { status: 503, ...NO_STORE });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const slug = query.get('salonSlug');
  if (!slug) {
    return Response.json({ error: { message: 'A salon is required.' } }, { status: 400, ...NO_STORE });
  }
  const { salon, error } = await requireAdminSalon(slug);
  if (error || !salon) {
    return error ?? Response.json({}, { status: 403, ...NO_STORE });
  }
  try {
    const requestId = query.get('requestId');
    if (requestId) {
      if (!z.string().uuid().safeParse(requestId).success) {
        return Response.json({ error: { message: 'Invalid message identifier.' } }, { status: 400, ...NO_STORE });
      }
      return Response.json({ data: { receipt: await getBulkMessageReceipt(salon.id, requestId) } }, NO_STORE);
    }
    const now = new Date();
    const [clients, sms] = await Promise.all([getBulkMessageClients(salon.id, now), getSalonSmsReadiness(salon.id)]);
    return Response.json({ data: { clients, sms, asOf: now.toISOString(), timeZone: salon.settings?.booking?.timezone || DEFAULT_BOOKING_TIME_ZONE, bookingUrl: buildSalonTenantPublicUrl('/book/service', { slug: salon.slug, customDomain: salon.customDomain }) } }, NO_STORE);
  } catch (cause) {
    return failure(cause);
  }
}

export async function POST(request: Request) {
  if (!hasExactRequestOrigin(request)) {
    return Response.json({ error: { message: 'Refresh the page and try again.' } }, { status: 403, ...NO_STORE });
  }
  const rate = checkEndpointRateLimit('communications/bulk', getClientIp(request), 'GENERAL');
  if (!rate.allowed) {
    return rateLimitResponse(rate.retryAfterMs);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_MESSAGE', message: 'Choose up to 1,000 clients and enter a message of 1–1,000 characters.' } }, { status: 400, ...NO_STORE });
  }
  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error ?? Response.json({}, { status: 403, ...NO_STORE });
  }
  try {
    if (parsed.data.action === 'preview') {
      return Response.json({ data: { preview: await previewBulkClientMessage(salon.id, parsed.data) } }, NO_STORE);
    }
    const sms = await getSalonSmsReadiness(salon.id);
    const receipt = await queueBulkClientMessage({ ...parsed.data, salonId: salon.id, sms });
    return Response.json({ data: { receipt } }, { status: 202, ...NO_STORE });
  } catch (cause) {
    return failure(cause);
  }
}
