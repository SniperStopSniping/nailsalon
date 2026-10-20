import { z } from 'zod';

import { requireAdminSalon, requireRealSalonOwner } from '@/libs/adminAuth';
import { hasExactRequestOrigin } from '@/libs/requestOriginGuard';
import { voiceReceptionistReadiness } from '@/libs/voiceReceptionist/settings';
import {
  getVoiceSettings,
  listVoiceCalls,
  listVoiceNumberRoutes,
} from '@/libs/voiceReceptionist/storage.server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ salonSlug: z.string().min(1) });

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
      retired: true,
      settings,
      readiness: voiceReceptionistReadiness(routes.length > 0),
      calls: calls.map(serializeCall),
    } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: { message: 'Voice receptionist settings are unavailable.' } }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasExactRequestOrigin(request)) {
    return Response.json({ error: { message: 'Invalid request origin.' } }, { status: 403 });
  }
  const context = await ownerContext(request);
  if (context.error || !context.salon) {
    return context.error!;
  }
  return Response.json({ error: { code: 'VOICE_RECEPTIONIST_RETIRED', message: 'The AI phone receptionist is retired. Standard online booking remains available.' } }, { status: 410 });
}
