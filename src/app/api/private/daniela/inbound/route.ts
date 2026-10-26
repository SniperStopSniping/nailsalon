import { after } from 'next/server';

import { getDanielaConfig } from '@/libs/danielaAutomation/config';
import { EMPTY_TWIML, greetingTwiml } from '@/libs/danielaAutomation/policy';
import { validateSignature } from '@/libs/danielaAutomation/providers';
import { dispatchPending } from '@/libs/danielaAutomation/service';
import { recordInbound } from '@/libs/danielaAutomation/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const config = getDanielaConfig();
  if (!config) {
    return new Response('Not found', { status: 404 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('Invalid content type', { status: 415 });
  }
  const text = await request.text();
  if (text.length > 32_000) {
    return new Response('Payload too large', { status: 413 });
  }
  const params = Object.fromEntries(new URLSearchParams(text));
  if (!validateSignature(config, request, params) || params.To !== config.fromNumber) {
    return new Response('Forbidden', { status: 403 });
  }
  const isCall = !!params.CallSid && !params.MessageSid && !params.SmsSid;
  const sid = isCall ? params.CallSid : params.MessageSid || params.SmsSid;
  if (!sid || !(isCall ? /^CA[\da-f]{32}$/iu : /^SM[\da-f]{32}$/iu).test(sid)) {
    return new Response('Invalid event', { status: 400 });
  }
  try {
    await recordInbound(config, { kind: isCall ? 'call' : 'sms', providerSid: sid, from: params.From || '', body: params.Body || '', optOutType: params.OptOutType });
  } catch {
    // Return non-2xx so Twilio retries; no successful greeting promise if persistence failed.
    return new Response('Temporarily unavailable', { status: 503 });
  }
  after(async () => {
    try {
      await dispatchPending(config);
    } catch { /* Durable pending work is recovered by cron. */ }
  });
  return new Response(isCall ? greetingTwiml(config.greeting) : EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } });
}
