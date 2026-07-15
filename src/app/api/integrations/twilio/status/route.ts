import { and, eq } from 'drizzle-orm';
import twilio from 'twilio';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { notificationDeliverySchema } from '@/models/Schema';

const RETRYABLE_ERROR_CODES = new Set(['30001', '30008']);
const DELIVERY_STATES = new Set([
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'read',
  'canceled',
]);

export async function POST(request: Request) {
  const form = await request.formData();
  const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  const signature = request.headers.get('x-twilio-signature') || '';
  if (!Env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(Env.TWILIO_AUTH_TOKEN, signature, request.url, params)) {
    return Response.json({ error: 'Invalid Twilio signature' }, { status: 403 });
  }

  const deliveryId = new URL(request.url).searchParams.get('deliveryId');
  const providerMessageId = params.MessageSid || params.SmsSid;
  const providerStatus = (params.MessageStatus || params.SmsStatus || '').toLowerCase();
  if (!deliveryId || !providerMessageId || !DELIVERY_STATES.has(providerStatus)) {
    return Response.json({ error: 'Invalid delivery callback' }, { status: 400 });
  }

  const [delivery] = await db
    .select({ salonId: notificationDeliverySchema.salonId })
    .from(notificationDeliverySchema)
    .where(eq(notificationDeliverySchema.id, deliveryId))
    .limit(1);
  if (!delivery) {
    return new Response(null, { status: 204 });
  }

  const errorCode = params.ErrorCode || null;
  await db
    .update(notificationDeliverySchema)
    .set({
      providerMessageId,
      status: providerStatus,
      errorCode,
      errorMessage: params.ErrorMessage || null,
      retryable: errorCode ? RETRYABLE_ERROR_CODES.has(errorCode) : null,
    })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, delivery.salonId),
    ));

  return new Response(null, { status: 204 });
}
