import 'server-only';

/** The public pilot is deliberately a single, exact salon slug. */
const ISLA_PILOT_SLUG = 'isla-nail-studio';

export const CUSTOMER_ASSISTANT_MODEL = 'gpt-5.6-luna';
export const CUSTOMER_ASSISTANT_REASONING_EFFORT = 'low' as const;

export type CustomerAssistantConfig = {
  apiKey: string;
  signingSecret: string;
};

/** Existing booking recovery survives disabling the conversational pilot. */
export function getCustomerBookingRecoverySecret(): string | null {
  const secret = process.env.CUSTOMER_ASSISTANT_SIGNING_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Customer AI has its own credentials and switch. It must never inherit an
 * owner credential or a permissive development fallback.
 */
export function getCustomerAssistantConfig(): CustomerAssistantConfig | null {
  if (process.env.CUSTOMER_ASSISTANT_ENABLED !== 'true') {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY_CUSTOMER?.trim();
  const signingSecret = process.env.CUSTOMER_ASSISTANT_SIGNING_SECRET?.trim();
  if (!apiKey || !signingSecret || signingSecret.length < 32) {
    return null;
  }

  return { apiKey, signingSecret };
}

export function isCustomerAssistantEnabledForSalon(slug: string): boolean {
  return getCustomerAssistantConfig() !== null && slug === ISLA_PILOT_SLUG;
}
