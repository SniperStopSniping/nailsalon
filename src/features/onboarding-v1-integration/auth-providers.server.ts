import 'server-only';

import { Env } from '@/libs/Env';

import {
  FALLBACK_AUTH_PROVIDER_AVAILABILITY,
  type OnboardingAuthProviderAvailability,
} from './auth-providers';

const ENVIRONMENT_CACHE_TTL_MS = 60_000;
const ENVIRONMENT_FETCH_TIMEOUT_MS = 4_000;

type SocialConnectionSetting = {
  authenticatable?: boolean;
  enabled?: boolean;
};

type ClerkEnvironmentDocument = {
  user_settings?: {
    attributes?: {
      email_address?: {
        enabled?: boolean;
        used_for_first_factor?: boolean;
      };
    };
    social?: Record<string, SocialConnectionSetting | undefined>;
  };
};

/**
 * Derives the Clerk Frontend API origin from a publishable key. The key's
 * payload is the base64 of the frontend API host followed by a '$'.
 */
export const parseClerkFrontendApiOrigin = (
  publishableKey: string,
): string | null => {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=]+)$/u.exec(publishableKey.trim());
  if (!match) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(match[1] ?? '', 'base64').toString('utf8');
  } catch {
    return null;
  }
  const host = decoded.endsWith('$') ? decoded.slice(0, -1) : '';
  return /^[a-z0-9][a-z0-9.-]+[a-z0-9]$/iu.test(host) ? `https://${host}` : null;
};

const socialConnectionAvailable = (
  setting: SocialConnectionSetting | undefined,
): boolean => setting?.enabled === true && setting.authenticatable === true;

/** Maps Clerk's public environment document onto the gate's provider shape. */
export const deriveAuthProviderAvailability = (
  environment: ClerkEnvironmentDocument,
): OnboardingAuthProviderAvailability => {
  const social = environment.user_settings?.social ?? {};
  const emailAttribute = environment.user_settings?.attributes?.email_address;
  return {
    apple: socialConnectionAvailable(social.oauth_apple),
    email: emailAttribute?.enabled === true
      && emailAttribute.used_for_first_factor === true,
    google: socialConnectionAvailable(social.oauth_google),
    source: 'clerk-environment',
  };
};

type CachedAvailability = {
  expiresAt: number;
  value: OnboardingAuthProviderAvailability;
};

let cachedAvailability: CachedAvailability | null = null;

export const resetAuthProviderAvailabilityCacheForTests = (): void => {
  cachedAvailability = null;
};

export const fetchOnboardingAuthProviderAvailability = async (options: {
  fetcher?: typeof fetch;
  publishableKey?: string;
} = {}): Promise<OnboardingAuthProviderAvailability> => {
  const publishableKey = options.publishableKey
    ?? Env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const origin = parseClerkFrontendApiOrigin(publishableKey ?? '');
  if (!origin) {
    return FALLBACK_AUTH_PROVIDER_AVAILABILITY;
  }
  try {
    const response = await (options.fetcher ?? fetch)(
      `${origin}/v1/environment`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(ENVIRONMENT_FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return FALLBACK_AUTH_PROVIDER_AVAILABILITY;
    }
    const document = await response.json() as ClerkEnvironmentDocument;
    return deriveAuthProviderAvailability(document);
  } catch {
    return FALLBACK_AUTH_PROVIDER_AVAILABILITY;
  }
};

/**
 * Cached provider availability for the account gate. A short TTL keeps the
 * gate honest about configuration changes without a Frontend API round trip
 * on every render.
 */
export const getOnboardingAuthProviderAvailability = async ():
Promise<OnboardingAuthProviderAvailability> => {
  const now = Date.now();
  if (cachedAvailability && cachedAvailability.expiresAt > now) {
    return cachedAvailability.value;
  }
  const value = await fetchOnboardingAuthProviderAvailability();
  if (value.source === 'clerk-environment') {
    cachedAvailability = { expiresAt: now + ENVIRONMENT_CACHE_TTL_MS, value };
  }
  return value;
};
