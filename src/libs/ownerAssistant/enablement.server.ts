import 'server-only';

import { redis } from '@/core/redis/redisClient';
import { Env } from '@/libs/Env';

import {
  OWNER_ASSISTANT_DEFAULT_MODEL,
  OWNER_ASSISTANT_TOOL_NAMES,
  type OwnerAssistantToolName,
} from './contracts';

/**
 * Owner Assistant switches and entitlement (docs/OWNER_ASSISTANT_CHAT.md §2).
 *
 * Everything here fails CLOSED: an unset switch, an unparsable allowlist and a
 * missing key all mean "dark", never "on". `isOwnerAssistantEnabledForSalon`
 * decides admission (404 when false); `getOwnerAssistantAvailability` decides
 * whether an admitted owner gets an answer or an honest unavailable banner.
 */

type SalonEntitlementInput = {
  slug?: string | null;
  features?: unknown;
};

function isGloballyEnabled(): boolean {
  return Env.OWNER_ASSISTANT_ENABLED === 'true';
}

/** Trimmed, lowercased slugs; empty entries dropped. */
export function parseSalonAllowlist(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0);
}

export function hasOwnerAssistantFeature(features: unknown): boolean {
  if (!features || typeof features !== 'object') {
    return false;
  }
  const ai = (features as { ai?: unknown }).ai;
  if (!ai || typeof ai !== 'object') {
    return false;
  }
  return (ai as { ownerAssistant?: unknown }).ownerAssistant === true;
}

/**
 * Global switch AND the pilot allowlist. `salon.features.ai.ownerAssistant`
 * is reserved (typed, defaulted false) but deliberately NOT consulted in this
 * slice: the super-admin organization PATCH writes the whole `features`
 * object, so reading the key here would create a second activation path that
 * bypasses the allowlist. A dedicated, audited writer must land before the
 * key becomes an entitlement source; `hasOwnerAssistantFeature` stays for it.
 */
export function isOwnerAssistantEnabledForSalon(salon: SalonEntitlementInput | null | undefined): boolean {
  if (!isGloballyEnabled() || !salon) {
    return false;
  }

  const slug = salon.slug?.trim().toLowerCase() ?? '';
  return slug.length > 0
    && parseSalonAllowlist(Env.OWNER_ASSISTANT_SALON_ALLOWLIST).includes(slug);
}

/**
 * The signing secret for the conversation token.
 *
 * Production REQUIRES an explicit secret: falling back to a derived value
 * there would make the conversation binding only as strong as an unrelated
 * key's exposure. Non-production mirrors `getStateSecret` in
 * `src/libs/lusterSecurity.ts` exactly so a developer never has to provision
 * one to try the feature.
 */
export function getOwnerAssistantSigningSecret(): string {
  const configured = Env.OWNER_ASSISTANT_SIGNING_SECRET?.trim();
  if (!configured && Env.NODE_ENV === 'production') {
    throw new Error('OWNER_ASSISTANT_SIGNING_SECRET is required in production');
  }
  return configured || `development:${Env.CLERK_SECRET_KEY}`;
}

export function getOwnerAssistantApiKey(): string | null {
  return Env.OPENAI_API_KEY_OWNER?.trim() || null;
}

export type OwnerAssistantAvailability =
  | { available: true }
  | { available: false; reason: 'not_configured' | 'redis_unavailable' };

/**
 * Can an admitted owner actually get an answer right now? Key present, signing
 * secret resolvable, Redis client constructed (the per-turn reservation makes
 * the real liveness check, and reports `redis_unavailable` itself).
 */
export function getOwnerAssistantAvailability(): OwnerAssistantAvailability {
  if (!getOwnerAssistantApiKey()) {
    return { available: false, reason: 'not_configured' };
  }

  try {
    getOwnerAssistantSigningSecret();
  } catch {
    return { available: false, reason: 'not_configured' };
  }

  if (!redis) {
    return { available: false, reason: 'redis_unavailable' };
  }

  return { available: true };
}

/**
 * Intersection of `OWNER_ASSISTANT_TOOLS` with the known tool names. An unset
 * variable yields NO tools: the assistant may still converse, but it must say
 * it cannot check anything.
 */
export function getEnabledToolNames(): OwnerAssistantToolName[] {
  const requested = new Set(
    (Env.OWNER_ASSISTANT_TOOLS ?? '')
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0),
  );

  return OWNER_ASSISTANT_TOOL_NAMES.filter(name => requested.has(name));
}

export function getModelId(): string {
  return Env.OWNER_ASSISTANT_MODEL?.trim() || OWNER_ASSISTANT_DEFAULT_MODEL;
}

export function getJsonMode(): 'schema' | 'prompt' {
  return Env.OWNER_ASSISTANT_JSON_MODE === 'prompt' ? 'prompt' : 'schema';
}

/** Reasoning depth sent to the provider; 'low' unless an operator overrides it. */
export function getReasoningEffort(): 'none' | 'low' | 'medium' {
  const configured = Env.OWNER_ASSISTANT_REASONING_EFFORT;
  return configured === 'none' || configured === 'medium' ? configured : 'low';
}
