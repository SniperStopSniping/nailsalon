import { getVoiceRuntimeConfig } from '@/libs/voiceReceptionist/config.server';
import { readVoiceForm, verifyVoiceTwilio } from '@/libs/voiceReceptionist/security.server';
import { finishVoiceCallFromProvider, getVoiceCallByProvider } from '@/libs/voiceReceptionist/storage.server';

export const runtime = 'nodejs';
export const maxDuration = 800;

const TERMINAL = new Set(['completed', 'canceled', 'failed', 'no-answer', 'busy']);
const CALL_SID = /^CA[0-9a-f]{32}$/i;

export async function POST(request: Request) {
  const config = getVoiceRuntimeConfig('phone');
  if (!config) {
    return new Response(null, { status: 404 });
  }
  const form = await readVoiceForm(request);
  if (!form || !verifyVoiceTwilio(request, form, config) || !CALL_SID.test(form.CallSid ?? '')) {
    return new Response(null, { status: 403 });
  }
  if (!TERMINAL.has(form.CallStatus ?? '')) {
    return new Response(null, { status: 204 });
  }
  const existing = await getVoiceCallByProvider(form.AccountSid!, form.CallSid!);
  if (!existing) {
    return new Response(null, { status: 204 });
  }
  const duration = Number.parseInt(form.CallDuration ?? '0', 10);
  await finishVoiceCallFromProvider(form.AccountSid!, form.CallSid!, Number.isFinite(duration) ? duration : 0);
  return new Response(null, { status: 204 });
}
