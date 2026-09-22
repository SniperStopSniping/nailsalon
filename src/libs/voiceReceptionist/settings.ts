import 'server-only';

import { getVoiceRuntimeConfig } from './config.server';

export const VOICE_RECEPTIONIST_VOICES = ['marin', 'cedar'] as const;
export const VOICE_RECEPTIONIST_LANGUAGES = ['auto', 'en', 'es'] as const;
export const VOICE_RECEPTIONIST_ANSWER_MODES = ['always', 'after_hours'] as const;

export type VoiceReceptionistVoice = (typeof VOICE_RECEPTIONIST_VOICES)[number];
export type VoiceReceptionistLanguage = (typeof VOICE_RECEPTIONIST_LANGUAGES)[number];
export type VoiceReceptionistAnswerMode = (typeof VOICE_RECEPTIONIST_ANSWER_MODES)[number];

export const VOICE_RECEPTIONIST_SUMMARY_RETENTION_DAYS = 30;

export function isVoiceReceptionistGloballyEnabled(): boolean {
  return process.env.VOICE_RECEPTIONIST_ENABLED === 'true';
}

export function voiceReceptionistReadiness(hasNumberRoute: boolean) {
  // Keep owner readiness aligned with the exact server configuration the
  // inbound transport will accept, including origin and credential validation.
  const providerReady = getVoiceRuntimeConfig('phone') !== null;
  const globallyEnabled = isVoiceReceptionistGloballyEnabled();
  return {
    globallyEnabled,
    providerReady,
    numberReady: hasNumberRoute,
    configured: globallyEnabled && providerReady && hasNumberRoute,
  };
}
