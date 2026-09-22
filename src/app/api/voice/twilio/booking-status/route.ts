import { handleVoiceCheckpoint } from '@/libs/voiceReceptionist/checkpoint.server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleVoiceCheckpoint(request, 'booking-status');
}
