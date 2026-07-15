import { eq, or } from 'drizzle-orm';
import twilio from 'twilio';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { communicationConsentSchema, salonTwilioConnectionSchema } from '@/models/Schema';

export async function POST(request: Request) {
  const form = await request.formData();
  const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  const signature = request.headers.get('x-twilio-signature') || '';
  if (!Env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(Env.TWILIO_AUTH_TOKEN, signature, request.url, params)) {
    return new Response('Forbidden', { status: 403 });
  }
  const from = (params.From || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const to = params.To || '';
  const accountSid = params.AccountSid || '';
  const body = (params.Body || '').trim().toUpperCase();
  const optOutType = (params.OptOutType || '').trim().toUpperCase();
  const [connection] = await db.select({ salonId: salonTwilioConnectionSchema.salonId }).from(salonTwilioConnectionSchema).where(or(eq(salonTwilioConnectionSchema.connectAccountSid, accountSid), eq(salonTwilioConnectionSchema.phoneNumber, to))).limit(1);
  const isStop = optOutType === 'STOP' || ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(body);
  const isStart = optOutType === 'START' || ['START', 'UNSTOP'].includes(body);
  if (connection && (isStop || isStart)) {
    const now = new Date();
    await db.insert(communicationConsentSchema).values({
      id: crypto.randomUUID(),
      salonId: connection.salonId,
      recipient: from,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: isStop ? 'revoked' : 'granted',
      wordingVersion: isStop ? 'twilio-stop-v1' : 'twilio-start-v1',
      source: 'twilio_inbound',
      grantedAt: isStart ? now : null,
      revokedAt: isStop ? now : null,
      metadata: { keyword: body, optOutType: optOutType || null },
    });
  }
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
}
