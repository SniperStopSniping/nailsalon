import { eq } from 'drizzle-orm';
import twilio from 'twilio';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { salonSchema, salonTwilioConnectionSchema } from '@/models/Schema';

export async function POST(request: Request) {
  const form = await request.formData();
  const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  const signature = request.headers.get('x-twilio-signature') || '';
  if (!Env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(Env.TWILIO_AUTH_TOKEN, signature, request.url, params)) {
    return Response.json({ error: 'Invalid Twilio signature' }, { status: 403 });
  }
  const accountSid = params.AccountSid || params.account_sid;
  if (!accountSid) {
    return Response.json({ error: 'AccountSid is required' }, { status: 400 });
  }
  const [connection] = await db.select({ salonId: salonTwilioConnectionSchema.salonId }).from(salonTwilioConnectionSchema).where(eq(salonTwilioConnectionSchema.connectAccountSid, accountSid)).limit(1);
  if (connection) {
    await db.transaction(async (tx) => {
      await tx.update(salonTwilioConnectionSchema).set({ status: 'deauthorized', deauthorizedAt: new Date(), lastError: 'Twilio authorization was revoked' }).where(eq(salonTwilioConnectionSchema.salonId, connection.salonId));
      await tx.update(salonSchema).set({ smsRemindersEnabled: false }).where(eq(salonSchema.id, connection.salonId));
    });
  }
  return Response.json({ ok: true });
}
