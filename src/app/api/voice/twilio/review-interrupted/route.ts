import { handleVoiceCheckpoint } from '@/libs/voiceReceptionist/checkpoint.server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export function POST(request: Request) {
  return handleVoiceCheckpoint(request, 'review-interrupted');
}
