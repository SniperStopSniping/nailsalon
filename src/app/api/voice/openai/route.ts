import { randomUUID } from 'node:crypto';

import { after } from 'next/server';

import { getSalonById } from '@/libs/queries';
import { getVoiceRuntimeConfig } from '@/libs/voiceReceptionist/config.server';
import { coordinateVoiceCall } from '@/libs/voiceReceptionist/coordinator.server';
import { buildVoiceSession, liveSessionPath, voiceLiveRequest } from '@/libs/voiceReceptionist/live.server';
import { readVoiceBody, verifyVoiceOpenAiWebhook, voiceRouteFromSipHeaders, voiceTokenHash } from '@/libs/voiceReceptionist/security.server';
import { bindLiveSession, claimVoiceLease, getVoiceCall, getVoiceSettings, setVoiceCallTransportState } from '@/libs/voiceReceptionist/storage.server';

export const runtime = 'nodejs';
export const maxDuration = 800;

type Incoming = {
  type?: unknown;
  data?: { type?: unknown; session_id?: unknown; sip_headers?: unknown; headers?: unknown };
};

export async function POST(request: Request) {
  const config = getVoiceRuntimeConfig('phone');
  if (!config) {
    return new Response(null, { status: 404 });
  }
  const raw = await readVoiceBody(request);
  if (!raw || !verifyVoiceOpenAiWebhook(raw, request.headers, config.webhookSecret)) {
    return new Response(null, { status: 401 });
  }
  let event: Incoming;
  try {
    event = JSON.parse(raw) as Incoming;
  } catch {
    return new Response(null, { status: 400 });
  }
  const data = event.data;
  if (event.type !== 'live.transport.incoming' || data?.type !== 'sip' || typeof data.session_id !== 'string' || !/^[\w-]{1,200}$/.test(data.session_id)) {
    return new Response(null, { status: 400 });
  }
  const token = voiceRouteFromSipHeaders(data.sip_headers ?? data.headers);
  if (!token) {
    return new Response(null, { status: 403 });
  }
  const callId = token.split('.', 1)[0]!;
  const existing = await getVoiceCall(callId);
  if (!existing || existing.provider !== 'twilio' || existing.routeTokenHash !== voiceTokenHash(token)) {
    return new Response(null, { status: 403 });
  }
  if (existing.liveSessionId === data.session_id && !['created', 'accepting'].includes(existing.status)) {
    return new Response(null, { status: 204 });
  }
  const salon = await getSalonById(existing.salonId);
  const settings = salon ? await getVoiceSettings(salon.id) : null;
  if (!salon || salon.publicationStatus !== 'published' || !salon.onlineBookingEnabled || !settings?.enabled) {
    return new Response(null, { status: 403 });
  }
  let call;
  try {
    call = await bindLiveSession(existing.id, existing.salonId, voiceTokenHash(token), data.session_id);
  } catch {
    return new Response(null, { status: 409 });
  }
  if (!call) {
    return new Response(null, { status: 403 });
  }
  const leaseToken = randomUUID();
  if (!await claimVoiceLease(call.id, leaseToken, 90_000)) {
    return new Response(null, { status: 409 });
  }
  try {
    await voiceLiveRequest(config, `${liveSessionPath(data.session_id)}/accept`, { session: buildVoiceSession(salon, settings, false) });
  } catch {
    await voiceLiveRequest(config, `${liveSessionPath(data.session_id)}/hangup`).catch(() => undefined);
    await setVoiceCallTransportState(call.id, call.salonId, data.session_id, 'dropped');
    return new Response(null, { status: 503 });
  }
  if (!await setVoiceCallTransportState(call.id, call.salonId, data.session_id, 'connected')) {
    return new Response(null, { status: 409 });
  }
  after(() => coordinateVoiceCall(call!.id, config, leaseToken));
  return new Response(null, { status: 204 });
}
