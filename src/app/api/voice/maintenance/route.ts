import { after } from 'next/server';

import { getVoiceRuntimeConfig } from '@/libs/voiceReceptionist/config.server';
import { coordinateVoiceCall } from '@/libs/voiceReceptionist/coordinator.server';
import { reconcileUnresolvedVoiceBookings } from '@/libs/voiceReceptionist/recovery.server';
import { cleanupExpiredVoiceCallData, expireOverdueVoiceCalls, listExpiredVoiceCallsForRecovery } from '@/libs/voiceReceptionist/storage.server';

export const runtime = 'nodejs';
export const maxDuration = 800;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response(null, { status: 401 });
  }
  const phoneConfig = getVoiceRuntimeConfig('phone');
  if (phoneConfig) {
    await reconcileUnresolvedVoiceBookings(phoneConfig.signingSecret);
  }
  const [cleaned, expired, recoverable] = await Promise.all([cleanupExpiredVoiceCallData(), expireOverdueVoiceCalls(), listExpiredVoiceCallsForRecovery()]);
  after(async () => {
    await Promise.allSettled(recoverable.map(async (call) => {
      const config = getVoiceRuntimeConfig(call.provider === 'browser' ? 'browser' : 'phone');
      if (config) {
        await coordinateVoiceCall(call.id, config);
      }
    }));
  });
  return Response.json({ data: { cleaned: cleaned.length, expired: expired.length, recoveryQueued: recoverable.length } }, { headers: { 'Cache-Control': 'no-store' } });
}
