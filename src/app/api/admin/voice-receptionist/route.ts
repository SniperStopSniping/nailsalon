import { z } from 'zod';

import { requireAdminSalon, requireRealSalonOwner } from '@/libs/adminAuth';
import { voiceReceptionistReadiness } from '@/libs/voiceReceptionist/settings';
import {
  getVoiceSettings,
  listVoiceCalls,
  listVoiceNumberRoutes,
  updateVoiceSettings,
} from '@/libs/voiceReceptionist/storage.server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ salonSlug: z.string().min(1) });
const updateSchema = z.object({
  enabled: z.boolean().optional(),
  bookingEnabled: z.boolean().optional(),
  greeting: z.string().trim().max(300).nullable().optional(),
  voice: z.enum(['marin', 'cedar']).optional(),
  language: z.enum(['auto', 'en', 'es']).optional(),
  answerMode: z.enum(['always', 'after_hours']).optional(),
  callbackEnabled: z.boolean().optional(),
}).strict();

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}

async function ownerContext(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return { error: Response.json({ error: { message: 'A salon is required.' } }, { status: 400 }) };
  }
  const access = await requireAdminSalon(parsed.data.salonSlug);
  if (access.error || !access.salon) {
    return { error: access.error ?? Response.json({}, { status: 403 }) };
  }
  const owner = await requireRealSalonOwner(access.salon.id);
  if (!owner.ok) {
    return { error: owner.response };
  }
  return { salon: access.salon };
}

function serializeCall(call: Awaited<ReturnType<typeof listVoiceCalls>>[number]) {
  return {
    id: call.id,
    provider: call.provider,
    callerNumber: call.callerNumber,
    status: call.status,
    outcome: call.outcome,
    summary: call.summary,
    appointmentId: call.appointmentId,
    callbackRequested: call.callbackRequested,
    durationSeconds: call.durationSeconds,
    createdAt: call.createdAt,
    endedAt: call.endedAt,
  };
}

export async function GET(request: Request) {
  const context = await ownerContext(request);
  if (context.error || !context.salon) {
    return context.error!;
  }
  try {
    const [settings, routes, calls] = await Promise.all([
      getVoiceSettings(context.salon.id),
      listVoiceNumberRoutes(context.salon.id),
      listVoiceCalls(context.salon.id),
    ]);
    return Response.json({ data: {
      settings,
      readiness: voiceReceptionistReadiness(routes.length > 0),
      calls: calls.map(serializeCall),
    } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: { message: 'Voice receptionist settings are unavailable.' } }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: { message: 'Invalid request origin.' } }, { status: 403 });
  }
  const context = await ownerContext(request);
  if (context.error || !context.salon) {
    return context.error!;
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { message: parsed.error.issues[0]?.message ?? 'Invalid voice receptionist settings.' } }, { status: 400 });
  }
  try {
    const routes = await listVoiceNumberRoutes(context.salon.id);
    const readiness = voiceReceptionistReadiness(routes.length > 0);
    if (parsed.data.enabled && !readiness.configured) {
      return Response.json({ error: { message: 'Voice receptionist needs a provisioned phone number and global rollout before it can be turned on.' } }, { status: 409 });
    }
    const settings = await updateVoiceSettings(context.salon.id, parsed.data);
    return Response.json({ data: { settings, readiness } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: { message: 'Voice receptionist settings could not be saved.' } }, { status: 503 });
  }
}
