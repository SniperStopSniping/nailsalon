import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { salonSchema, salonTwilioConnectionSchema } from '@/models/Schema';

function authHeader(accountSid: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${Env.TWILIO_AUTH_TOKEN || ''}`).toString('base64')}`;
}

async function requireTwilioConnection(salonSlug: string) {
  const auth = await requireAdminSalon(salonSlug);
  if (auth.error || !auth.salon) {
    return { response: auth.error || Response.json({ error: 'Salon not found' }, { status: 404 }) } as const;
  }
  const [connection] = await db.select().from(salonTwilioConnectionSchema).where(eq(salonTwilioConnectionSchema.salonId, auth.salon.id)).limit(1);
  if (!connection) {
    return { response: Response.json({ error: 'Authorize Twilio first' }, { status: 409 }) } as const;
  }
  if (!Env.TWILIO_AUTH_TOKEN) {
    return { response: Response.json({ error: 'Twilio platform credentials are incomplete' }, { status: 503 }) } as const;
  }
  return { salon: auth.salon, connection } as const;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const salonSlug = url.searchParams.get('salonSlug');
  const areaCode = url.searchParams.get('areaCode');
  if (!salonSlug || !areaCode || !/^\d{3}$/.test(areaCode)) {
    return Response.json({ error: 'salonSlug and a three-digit areaCode are required' }, { status: 400 });
  }
  const context = await requireTwilioConnection(salonSlug);
  if ('response' in context) {
    return context.response;
  }
  const availableResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${context.connection.connectAccountSid}/AvailablePhoneNumbers/CA/Local.json?AreaCode=${areaCode}&SmsEnabled=true&PageSize=1`, { headers: { Authorization: authHeader(context.connection.connectAccountSid) } });
  const available = await availableResponse.json() as { available_phone_numbers?: Array<{ phone_number: string; locality?: string; region?: string }>; message?: string };
  if (!availableResponse.ok || !available.available_phone_numbers?.[0]) {
    return Response.json({ error: available.message || 'No SMS number is available in that area code' }, { status: 404 });
  }
  const priceResponse = Env.TWILIO_ACCOUNT_SID ? await fetch('https://pricing.twilio.com/v2/PhoneNumbers/Countries/CA', { headers: { Authorization: authHeader(Env.TWILIO_ACCOUNT_SID) } }) : null;
  const price = priceResponse?.ok ? await priceResponse.json() as { phone_number_prices?: Array<{ number_type: string; current_price: string; base_price: string }> } : null;
  const localPrice = price?.phone_number_prices?.find(item => item.number_type === 'local');
  return Response.json({ data: { number: available.available_phone_numbers[0], monthlyPrice: localPrice?.current_price || localPrice?.base_price || null, currency: 'USD' } });
}

const provisionSchema = z.object({ salonSlug: z.string(), areaCode: z.string().regex(/^\d{3}$/), confirmedMonthlyPrice: z.string().nullable().optional() });
export async function POST(request: Request) {
  const parsed = provisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid provisioning request' }, { status: 400 });
  }
  const context = await requireTwilioConnection(parsed.data.salonSlug);
  if ('response' in context) {
    return context.response;
  }
  if (context.connection.status === 'active') {
    return Response.json({ data: { phoneNumber: context.connection.phoneNumber, alreadyActive: true } });
  }
  const sid = context.connection.connectAccountSid;
  try {
    const availableResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/CA/Local.json?AreaCode=${parsed.data.areaCode}&SmsEnabled=true&PageSize=1`, { headers: { Authorization: authHeader(sid) } });
    const available = await availableResponse.json() as { available_phone_numbers?: Array<{ phone_number: string }>; message?: string };
    const phoneNumber = available.available_phone_numbers?.[0]?.phone_number;
    if (!availableResponse.ok || !phoneNumber) {
      throw new Error(available.message || 'No number is available');
    }
    const purchaseResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: { 'Authorization': authHeader(sid), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumber: phoneNumber }),
    });
    const purchased = await purchaseResponse.json() as { sid?: string; phone_number?: string; message?: string };
    if (!purchaseResponse.ok || !purchased.sid) {
      throw new Error(purchased.message || 'Twilio could not purchase the number');
    }
    const serviceResponse = await fetch('https://messaging.twilio.com/v1/Services', {
      method: 'POST',
      headers: { 'Authorization': authHeader(sid), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        FriendlyName: `${context.salon.name} reminders`,
        ...(Env.NEXT_PUBLIC_APP_URL
          ? {
              InboundRequestUrl: `${Env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/integrations/twilio/inbound`,
              InboundMethod: 'POST',
              UseInboundWebhookOnNumber: 'false',
            }
          : {}),
      }),
    });
    const service = await serviceResponse.json() as { sid?: string; message?: string };
    if (!serviceResponse.ok || !service.sid) {
      throw new Error(service.message || 'Twilio could not create a Messaging Service');
    }
    const attachResponse = await fetch(`https://messaging.twilio.com/v1/Services/${service.sid}/PhoneNumbers`, {
      method: 'POST',
      headers: { 'Authorization': authHeader(sid), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumberSid: purchased.sid }),
    });
    if (!attachResponse.ok) {
      throw new Error('Twilio could not attach the number to the Messaging Service');
    }
    await db.transaction(async (tx) => {
      await tx.update(salonTwilioConnectionSchema).set({ phoneNumber: purchased.phone_number || phoneNumber, messagingServiceSid: service.sid, status: 'active', lastError: null }).where(eq(salonTwilioConnectionSchema.salonId, context.salon.id));
      await tx.update(salonSchema).set({ smsRemindersEnabled: true }).where(eq(salonSchema.id, context.salon.id));
    });
    return Response.json({ data: { phoneNumber: purchased.phone_number || phoneNumber, messagingServiceSid: service.sid } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Twilio provisioning failed';
    await db.update(salonTwilioConnectionSchema).set({ status: 'degraded', lastError: message }).where(eq(salonTwilioConnectionSchema.salonId, context.salon.id));
    return Response.json({ error: message }, { status: 502 });
  }
}
