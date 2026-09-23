import type { CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';

import type { VoiceDraft } from './authority.server';
import type { VoiceContactState } from './conversation';

export type VoiceCheckpoint = {
  id: string;
  revision: number;
  fingerprint: string;
  expiresAt: string;
  language: 'en' | 'es';
  stage: 'pending' | 'committing' | 'committed' | 'revoked' | 'resuming' | 'resumed';
};

export type VoiceCallState = {
  booking: VoiceDraft;
  contact: VoiceContactState | null;
  callbackPending: boolean;
  consentHash: string | null;
  bookingStatus: CustomerBookingStatus | null;
  depositDelivery?: 'accepted' | 'pending' | 'failed' | 'unavailable' | 'not_required';
  confirmation?: VoiceCheckpoint | null;
};
