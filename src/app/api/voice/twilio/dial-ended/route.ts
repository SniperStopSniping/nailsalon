import { getVoiceRuntimeConfig } from '@/libs/voiceReceptionist/config.server';
import { readVoiceForm, verifyVoiceTwilio } from '@/libs/voiceReceptionist/security.server';
import { finishVoiceCallFromProvider, getVoiceCallByProvider } from '@/libs/voiceReceptionist/storage.server';

export const runtime = 'nodejs';
export const maxDuration = 800;

const TERMINAL = new Set(['completed', 'canceled', 'failed', 'no-answer', 'busy']);
// A Dial action requests the next TwiML document; it is not a status webhook.
function dialEndedResponse() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const CALL_SID = /^CA[0-9a-f]{32}$/i;

export async function POST(request: Request) {
  const config = getVoiceRuntimeConfig('phone');
  if (!config) {
    return new Response(null, { status: 404 });
  }
  const form = await readVoiceForm(request);
  const dialStatus = form?.DialCallStatus ?? form?.CallStatus;
  if (!form || !verifyVoiceTwilio(request, form, config) || !CALL_SID.test(form.CallSid ?? '')) {
    return new Response(null, { status: 403 });
  }
  if (!TERMINAL.has(dialStatus ?? '')) {
    return dialEndedResponse();
  }
  const existing = await getVoiceCallByProvider(form.AccountSid!, form.CallSid!);
  if (!existing || existing.status === 'awaiting_confirmation') {
    return dialEndedResponse();
  }
  const duration = Number.parseInt(form.DialCallDuration ?? form.CallDuration ?? '0', 10);
  await finishVoiceCallFromProvider(form.AccountSid!, form.CallSid!, Number.isFinite(duration) ? duration : 0);
  return dialEndedResponse();
}
