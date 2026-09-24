import { randomUUID } from 'node:crypto';

import { after } from 'next/server';
import { z } from 'zod';

import { requireAdminSalon, requireRealSalonOwner } from '@/libs/adminAuth';
import { getVoiceRuntimeConfig } from '@/libs/voiceReceptionist/config.server';
import { coordinateVoiceCall } from '@/libs/voiceReceptionist/coordinator.server';
import { buildVoiceSession, liveSessionPath, voiceLiveRequest, VoiceProviderError } from '@/libs/voiceReceptionist/live.server';
import { readVoiceBody, voiceRouteToken, voiceTokenHash } from '@/libs/voiceReceptionist/security.server';
import { bindLiveSession, claimVoiceLease, createVoiceCall, getVoiceCall, getVoiceSettings, releaseVoiceLease } from '@/libs/voiceReceptionist/storage.server';

export const runtime = 'nodejs';
export const maxDuration = 800;

const payloadSchema = z.object({ sdp: z.string().min(1).max(60_000) }).strict();
const endSchema = z.object({ callId: z.string().uuid() }).strict();

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}

async function owner(request: Request) {
  const slug = new URL(request.url).searchParams.get('salonSlug');
  if (!slug) {
    return null;
  }
  const access = await requireAdminSalon(slug);
  if (access.error || !access.salon) {
    return null;
  }
  const guard = await requireRealSalonOwner(access.salon.id);
  return guard.ok ? access.salon : null;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: { message: 'Invalid request origin.' } }, { status: 403 });
  }
  const config = getVoiceRuntimeConfig('browser');
  const salon = await owner(request);
  if (!config || !salon) {
    return Response.json({ error: { message: 'Mic sandbox is unavailable.' } }, { status: 503 });
  }
  const raw = await readVoiceBody(request);
  let parsed: ReturnType<typeof payloadSchema.safeParse>;
  try {
    parsed = raw ? payloadSchema.safeParse(JSON.parse(raw)) : payloadSchema.safeParse(null);
  } catch {
    parsed = payloadSchema.safeParse(null);
  }
  if (!parsed.success) {
    return Response.json({ error: { message: 'Invalid session offer.' } }, { status: 400 });
  }
  const id = randomUUID();
  const providerCallId = randomUUID();
  const routeExpiresAt = new Date(Date.now() + 180_000);
  const token = voiceRouteToken({ id, salonId: salon.id, providerCallId, routeExpiresAt }, config.signingSecret);
  let call;
  try {
    call = (await createVoiceCall({ id, salonId: salon.id, provider: 'browser', providerCallId, routeTokenHash: voiceTokenHash(token), routeExpiresAt })).call;
    const settings = await getVoiceSettings(salon.id);
    const live = await voiceLiveRequest(config, '', {
      session: buildVoiceSession(salon, { ...settings, bookingEnabled: false }, true),
      transport: { type: 'webrtc', sdp: parsed.data.sdp },
    });
    const response = await live.json() as { session?: { id?: unknown }; transport?: { sdp?: unknown } };
    const sessionId = typeof response.session?.id === 'string' ? response.session.id : null;
    if (!sessionId || typeof response.transport?.sdp !== 'string') {
      throw new Error('VOICE_SESSION_INVALID');
    }
    const bound = await bindLiveSession(call.id, salon.id, voiceTokenHash(token), sessionId);
    if (!bound) {
      throw new Error('VOICE_SESSION_BIND_FAILED');
    }
    const leaseToken = randomUUID();
    if (!await claimVoiceLease(call.id, leaseToken, 90_000)) {
      throw new Error('VOICE_LEASE_FAILED');
    }
    after(() => coordinateVoiceCall(call!.id, config, leaseToken));
    return Response.json({ callId: call.id, sessionId, sdp: response.transport.sdp }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // A provider status is enough to diagnose setup; never log SDP, credentials, or caller data.
    console.error(error instanceof VoiceProviderError
      ? `VOICE_SANDBOX_PROVIDER_STATUS_${error.status}`
      : 'VOICE_SANDBOX_SETUP_FAILED');
    return Response.json({ error: { message: 'Mic sandbox is unavailable. Start a new test to reconnect.' } }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return new Response(null, { status: 403 });
  }
  const config = getVoiceRuntimeConfig('browser');
  const salon = await owner(request);
  const raw = await readVoiceBody(request);
  let input: z.infer<typeof endSchema> | null = null;
  try {
    input = raw ? endSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!config || !salon || !input) {
    return new Response(null, { status: 404 });
  }
  const call = await getVoiceCall(input.callId, salon.id);
  if (!call || call.provider !== 'browser') {
    return new Response(null, { status: 404 });
  }
  if (call.liveSessionId) {
    await voiceLiveRequest(config, `${liveSessionPath(call.liveSessionId)}/hangup`).catch(() => undefined);
  }
  if (call.leaseToken) {
    await releaseVoiceLease(call.id, salon.id, call.leaseToken);
  }
  return new Response(null, { status: 204 });
}
