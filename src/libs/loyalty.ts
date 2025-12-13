/**
 * Loyalty Points Resolver
 *
 * Resolves effective loyalty points for a salon, using per-salon overrides
 * when present and valid, otherwise falling back to system defaults.
 */

import { LOYALTY_POINTS } from '@/utils/AppConfig';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_POINTS = 0;
const MAX_POINTS = 250_000;

// =============================================================================
// TYPES
// =============================================================================

export type SalonOverrides = {
  welcomeBonusPointsOverride?: number | null;
  profileCompletionPointsOverride?: number | null;
  referralRefereePointsOverride?: number | null;
  referralReferrerPointsOverride?: number | null;
};

export type ResolvedLoyaltyPoints = {
  welcomeBonus: number;
  profileCompletion: number;
  referralReferee: number;
  referralReferrer: number;
};

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Resolve effective loyalty points for a salon.
 * Uses override if present and valid, otherwise falls back to default.
 * Clamps values to [0, 250000] range.
 *
 * @param salon - Salon object with optional override fields
 * @returns Resolved points values for all loyalty point types
 */
export function resolveSalonLoyaltyPoints(salon: SalonOverrides): ResolvedLoyaltyPoints {
  const clamp = (override: number | null | undefined, fallback: number): number => {
    // If override is null/undefined, use fallback
    if (override == null) {
      return fallback;
    }
    // Convert to number and check if finite
    const num = Number(override);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    // Clamp to valid range
    return Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.floor(num)));
  };

  return {
    welcomeBonus: clamp(salon.welcomeBonusPointsOverride, LOYALTY_POINTS.WELCOME_BONUS),
    profileCompletion: clamp(salon.profileCompletionPointsOverride, LOYALTY_POINTS.PROFILE_COMPLETION),
    referralReferee: clamp(salon.referralRefereePointsOverride, LOYALTY_POINTS.REFERRAL_REFEREE_BONUS),
    referralReferrer: clamp(salon.referralReferrerPointsOverride, LOYALTY_POINTS.REFERRAL_REFERRER_BONUS),
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get default loyalty points (no overrides).
 * Useful for display purposes.
 */
export function getDefaultLoyaltyPoints(): ResolvedLoyaltyPoints {
  return {
    welcomeBonus: LOYALTY_POINTS.WELCOME_BONUS,
    profileCompletion: LOYALTY_POINTS.PROFILE_COMPLETION,
    referralReferee: LOYALTY_POINTS.REFERRAL_REFEREE_BONUS,
    referralReferrer: LOYALTY_POINTS.REFERRAL_REFERRER_BONUS,
  };
}
