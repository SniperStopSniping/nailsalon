import 'server-only';

export const VOICE_MODEL = 'gpt-live-1';
export const VOICE_CALL_LIMIT_SECONDS = 600;
export const VOICE_SESSION_PRICE_USD_PER_MINUTE = 0.05;

export type VoiceRuntimeConfig = {
  apiKey: string;
  signingSecret: string;
  webhookSecret: string;
  projectId: string;
  origin: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
};

function value(name: string): string {
  const text = process.env[name]?.trim() ?? '';
  return text === '[SENSITIVE]' ? '' : text;
}

/** Independent voice credentials and switches never activate customer/owner AI or billing. */
export function getVoiceRuntimeConfig(channel: 'phone' | 'browser'): VoiceRuntimeConfig | null {
  if (value(channel === 'phone' ? 'VOICE_RECEPTIONIST_ENABLED' : 'VOICE_RECEPTIONIST_SANDBOX_ENABLED') !== 'true') {
    return null;
  }
  const config = {
    apiKey: value('OPENAI_API_KEY_VOICE'),
    signingSecret: value('VOICE_RECEPTIONIST_SIGNING_SECRET'),
    webhookSecret: value('OPENAI_VOICE_WEBHOOK_SECRET'),
    projectId: value('OPENAI_PROJECT_ID_VOICE'),
    origin: value('VOICE_RECEPTIONIST_WEBHOOK_ORIGIN'),
    twilioAccountSid: value('TWILIO_VOICE_ACCOUNT_SID'),
    twilioAuthToken: value('TWILIO_VOICE_AUTH_TOKEN'),
  };
  try {
    const origin = new URL(config.origin);
    if (origin.origin !== config.origin || (origin.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && origin.hostname === 'localhost'))) {
      return null;
    }
  } catch {
    return null;
  }
  if (!config.apiKey || config.signingSecret.length < 32) {
    return null;
  }
  if (channel === 'phone' && (!config.webhookSecret || !/^proj_[\w-]+$/.test(config.projectId) || !/^AC[0-9a-f]{32}$/i.test(config.twilioAccountSid) || !config.twilioAuthToken)) {
    return null;
  }
  return config;
}
