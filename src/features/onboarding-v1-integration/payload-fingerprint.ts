import type { OnboardingPersistedSnapshot } from './contracts';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
};

const fnv1a = (input: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Browser/server-stable stale-draft marker. This is UX integrity evidence,
 * never an authorization credential; Clerk membership and revision CAS remain
 * the security boundary.
 */
export const fingerprintOnboardingPayload = (
  snapshot: OnboardingPersistedSnapshot,
): string => {
  const serialized = JSON.stringify(stableValue(snapshot));
  return `${fnv1a(serialized, 0x811C9DC5)}${fnv1a(serialized, 0x9E3779B9)}`;
};
