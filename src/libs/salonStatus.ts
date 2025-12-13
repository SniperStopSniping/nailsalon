import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/libs/DB';
import {
  getEffectiveModuleEnabled,
  getEffectiveStaffVisibility,
  guardModuleOr403,
  resolveEntitlement,
} from '@/libs/featureGating';
import { salonSchema, type SalonStatus } from '@/models/Schema';
import type {
  FeatureKey,
  ModuleKey,
  SalonFeatures,
  SalonSettings,
} from '@/types/salonPolicy';

// Re-export from featureGating.ts for convenience
export {
  getEffectiveModuleEnabled,
  getEffectiveStaffVisibility,
  guardModuleOr403,
  resolveEntitlement,
};

// =============================================================================
// Salon Status Types
// =============================================================================

export type SalonStatusCheck = {
  exists: boolean;
  isActive: boolean;
  status: SalonStatus | null;
  isDeleted: boolean;
  redirectPath: string | null;
};

// =============================================================================
// Check Salon Status
// =============================================================================

/**
 * Check if a salon is accessible (not suspended, cancelled, or deleted)
 * Returns status information and redirect path if needed
 */
export async function checkSalonStatus(salonId: string): Promise<SalonStatusCheck> {
  const [salon] = await db
    .select({
      status: salonSchema.status,
      deletedAt: salonSchema.deletedAt,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return {
      exists: false,
      isActive: false,
      status: null,
      isDeleted: false,
      redirectPath: '/not-found',
    };
  }

  const status = (salon.status || 'active') as SalonStatus;
  const isDeleted = !!salon.deletedAt;

  // Check for deleted salon
  if (isDeleted) {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: true,
      redirectPath: '/cancelled',
    };
  }

  // Check for suspended status
  if (status === 'suspended') {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: false,
      redirectPath: '/suspended',
    };
  }

  // Check for cancelled status
  if (status === 'cancelled') {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: false,
      redirectPath: '/cancelled',
    };
  }

  // Active or trial status - allowed
  return {
    exists: true,
    isActive: true,
    status,
    isDeleted: false,
    redirectPath: null,
  };
}

/**
 * Check salon status by slug
 */
export async function checkSalonStatusBySlug(slug: string): Promise<SalonStatusCheck> {
  const [salon] = await db
    .select({
      id: salonSchema.id,
      status: salonSchema.status,
      deletedAt: salonSchema.deletedAt,
    })
    .from(salonSchema)
    .where(eq(salonSchema.slug, slug))
    .limit(1);

  if (!salon) {
    return {
      exists: false,
      isActive: false,
      status: null,
      isDeleted: false,
      redirectPath: '/not-found',
    };
  }

  return checkSalonStatus(salon.id);
}

/**
 * Require salon to be active - redirects if not
 * Use in server components or API routes
 */
export async function requireActiveSalon(salonId: string): Promise<void> {
  const status = await checkSalonStatus(salonId);

  if (status.redirectPath) {
    redirect(status.redirectPath);
  }
}

/**
 * Require salon to be active by slug - redirects if not
 */
export async function requireActiveSalonBySlug(slug: string): Promise<void> {
  const status = await checkSalonStatusBySlug(slug);

  if (status.redirectPath) {
    redirect(status.redirectPath);
  }
}

// =============================================================================
// API Response Helpers
// =============================================================================

/**
 * Create an error response for inactive salons (for API routes)
 */
export function createInactiveSalonResponse(status: SalonStatusCheck): Response {
  if (!status.exists) {
    return Response.json(
      { error: 'Salon not found' },
      { status: 404 },
    );
  }

  if (status.status === 'suspended') {
    return Response.json(
      { error: 'Salon is temporarily suspended', status: 'suspended' },
      { status: 403 },
    );
  }

  if (status.status === 'cancelled' || status.isDeleted) {
    return Response.json(
      { error: 'Salon is no longer active', status: 'cancelled' },
      { status: 410 }, // Gone
    );
  }

  return Response.json(
    { error: 'Salon is not accessible' },
    { status: 403 },
  );
}

/**
 * Guard API route - returns error response if salon is inactive
 */
export async function guardSalonApiRoute(salonId: string): Promise<Response | null> {
  const status = await checkSalonStatus(salonId);

  if (!status.isActive) {
    return createInactiveSalonResponse(status);
  }

  return null;
}

// =============================================================================
// Feature Toggle Checks
// =============================================================================

export type FeatureToggle = 'onlineBooking' | 'smsReminders' | 'rewards' | 'profilePage';

export type FeatureCheck = {
  enabled: boolean;
  redirectPath: string | null;
};

/**
 * Check if a specific feature is enabled for a salon.
 * Returns { enabled, redirectPath } - redirect to the disabled page if feature is off.
 *
 * @deprecated This is a wrapper for backward compatibility.
 * New code should use checkFeatureEntitlement() directly.
 *
 * IMPORTANT: This now routes through checkFeatureEntitlement() which uses
 * salon.features JSONB as source of truth (legacy booleans are fallback only).
 */
export async function checkFeatureEnabled(
  salonId: string,
  feature: FeatureToggle,
): Promise<FeatureCheck> {
  // Route through the entitlement resolver (features JSONB is source of truth)
  const check = await checkFeatureEntitlement(salonId, feature);

  // Map redirect paths for each feature
  const redirectPaths: Record<FeatureToggle, string> = {
    onlineBooking: '/booking-disabled',
    smsReminders: '', // SMS doesn't redirect, just silently skips
    rewards: '/rewards-disabled',
    profilePage: '/profile-disabled',
  };

  return {
    enabled: check.enabled,
    redirectPath: check.enabled ? null : redirectPaths[feature],
  };
}

/**
 * Check if SMS reminders are enabled for a salon.
 * Used internally by SMS functions to gate sending.
 *
 * Routes through checkFeatureEntitlement() - features JSONB is source of truth.
 */
export async function isSmsEnabled(salonId: string): Promise<boolean> {
  const check = await checkFeatureEntitlement(salonId, 'smsReminders');
  return check.enabled;
}

/**
 * Check if online booking is enabled for a salon.
 *
 * Routes through checkFeatureEntitlement() - features JSONB is source of truth.
 */
export async function isOnlineBookingEnabled(salonId: string): Promise<boolean> {
  const check = await checkFeatureEntitlement(salonId, 'onlineBooking');
  return check.enabled;
}

/**
 * Check if rewards are enabled for a salon.
 *
 * Routes through checkFeatureEntitlement() - features JSONB is source of truth.
 */
export async function isRewardsEnabled(salonId: string): Promise<boolean> {
  const check = await checkFeatureEntitlement(salonId, 'rewards');
  return check.enabled;
}

/**
 * Create a feature disabled API response
 */
export function createFeatureDisabledResponse(feature: FeatureToggle): Response {
  const messages: Record<FeatureToggle, string> = {
    onlineBooking: 'Online booking is not available for this salon',
    smsReminders: 'SMS reminders are not enabled for this salon',
    rewards: 'Rewards program is not available for this salon',
    profilePage: 'Public profile is not available for this salon',
  };

  return Response.json(
    { error: messages[feature], code: 'FEATURE_DISABLED' },
    { status: 403 },
  );
}

// =============================================================================
// Feature Entitlements (Step 16.1 - JSONB-based)
// =============================================================================

/**
 * Legacy flat feature defaults for backward compatibility.
 *
 * NOTE: The canonical nested defaults are in featureGating.ts (NESTED_FEATURE_DEFAULTS).
 * This flat structure is kept for backward compatibility with existing code.
 *
 * @deprecated Use featureGating.ts FEATURE_DEFAULTS for new code
 */
export const FEATURE_DEFAULTS = {
  // Starter tier (ON by default)
  onlineBooking: true,
  staffDashboard: true,
  photoUploads: true,
  clientProfiles: true,
  visibilityControls: true,
  // Pro tier (OFF by default)
  smsReminders: false,
  rewards: false,
  referrals: false,
  scheduleOverrides: false,
  clientFlags: false,
  clientBlocking: false,
  analyticsDashboard: false,
  // Elite tier (OFF by default)
  profilePage: false,
  multiLocation: false,
  advancedAnalytics: false,
  revenueReports: false,
  utilization: false,
  techPerformance: false,
  customBranding: false,
  apiAccess: false,
} as const;

/**
 * Resolve features with defaults applied (LEGACY FLAT STRUCTURE).
 * Merges salon's features JSONB with defaults.
 *
 * @deprecated For new code, use featureGating.ts helpers which support nested structure.
 */
export function resolveFeatures(features: SalonFeatures | null | undefined) {
  if (!features) {
    return { ...FEATURE_DEFAULTS };
  }

  return {
    // Starter
    onlineBooking: features.onlineBooking ?? FEATURE_DEFAULTS.onlineBooking,
    staffDashboard: features.staffDashboard ?? FEATURE_DEFAULTS.staffDashboard,
    photoUploads: features.photoUploads ?? FEATURE_DEFAULTS.photoUploads,
    clientProfiles: features.clientProfiles ?? FEATURE_DEFAULTS.clientProfiles,
    visibilityControls: features.visibilityControls ?? FEATURE_DEFAULTS.visibilityControls,
    // Pro
    smsReminders: features.smsReminders ?? FEATURE_DEFAULTS.smsReminders,
    rewards: features.rewards ?? FEATURE_DEFAULTS.rewards,
    referrals: features.referrals ?? FEATURE_DEFAULTS.referrals,
    scheduleOverrides: features.scheduleOverrides ?? FEATURE_DEFAULTS.scheduleOverrides,
    clientFlags: features.clientFlags ?? FEATURE_DEFAULTS.clientFlags,
    clientBlocking: features.clientBlocking ?? FEATURE_DEFAULTS.clientBlocking,
    analyticsDashboard: features.analyticsDashboard ?? FEATURE_DEFAULTS.analyticsDashboard,
    // Elite
    profilePage: features.profilePage ?? FEATURE_DEFAULTS.profilePage,
    multiLocation: features.multiLocation ?? FEATURE_DEFAULTS.multiLocation,
    advancedAnalytics: features.advancedAnalytics ?? FEATURE_DEFAULTS.advancedAnalytics,
    revenueReports: features.revenueReports ?? FEATURE_DEFAULTS.revenueReports,
    utilization: features.utilization ?? FEATURE_DEFAULTS.utilization,
    techPerformance: features.techPerformance ?? FEATURE_DEFAULTS.techPerformance,
    customBranding: features.customBranding ?? FEATURE_DEFAULTS.customBranding,
    apiAccess: features.apiAccess ?? FEATURE_DEFAULTS.apiAccess,
  };
}

/**
 * Check if a feature is enabled using the JSONB features column as source of truth.
 *
 * ENTITLEMENT LOGIC (Step 16.1 fix):
 * - features[key] is the SOURCE OF TRUTH for entitlements
 * - Legacy boolean columns are ONLY used if features[key] is undefined (migration path)
 * - This prevents accidentally granting paid features via legacy OR logic
 *
 * Priority:
 * 1. features[key] if defined (boolean) → use it
 * 2. features[key] undefined → fall back to legacy boolean (if exists)
 * 3. Neither defined → use default
 */
export async function checkFeatureEntitlement(
  salonId: string,
  feature: FeatureKey,
): Promise<{ enabled: boolean; reason?: string }> {
  const [salon] = await db
    .select({
      features: salonSchema.features,
      // Legacy columns - only used as fallback when features[key] is undefined
      onlineBookingEnabled: salonSchema.onlineBookingEnabled,
      smsRemindersEnabled: salonSchema.smsRemindersEnabled,
      rewardsEnabled: salonSchema.rewardsEnabled,
      profilePageEnabled: salonSchema.profilePageEnabled,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return { enabled: false, reason: 'Salon not found' };
  }

  const featuresJson = salon.features as SalonFeatures | null;

  // 1. Check features JSONB - this is the SOURCE OF TRUTH
  if (featuresJson) {
    const value = featuresJson[feature];
    // If explicitly set (true or false), use it
    if (typeof value === 'boolean') {
      return { enabled: value };
    }
    // If undefined in features, fall through to legacy check
  }

  // 2. Fall back to legacy boolean columns ONLY if features[key] was undefined
  // This is for migration path - salons that haven't been migrated to features JSONB yet
  const legacyMap: Partial<Record<FeatureKey, boolean | null>> = {
    onlineBooking: salon.onlineBookingEnabled,
    smsReminders: salon.smsRemindersEnabled,
    rewards: salon.rewardsEnabled,
    profilePage: salon.profilePageEnabled,
  };

  if (feature in legacyMap) {
    const legacyValue = legacyMap[feature];
    if (typeof legacyValue === 'boolean') {
      return { enabled: legacyValue };
    }
  }

  // 3. Use default (for features not in legacy columns)
  // Handle both flat keys and nested keys that don't exist in FEATURE_DEFAULTS
  const defaultValue = feature in FEATURE_DEFAULTS
    ? FEATURE_DEFAULTS[feature as keyof typeof FEATURE_DEFAULTS]
    : false;
  return { enabled: defaultValue };
}

/**
 * Guard API route by feature entitlement.
 * Returns 403 response if feature is disabled, null if allowed.
 */
export async function guardFeatureEntitlement(
  salonId: string,
  feature: FeatureKey,
): Promise<Response | null> {
  const check = await checkFeatureEntitlement(salonId, feature);

  if (!check.enabled) {
    const messages: Partial<Record<FeatureKey, string>> = {
      onlineBooking: 'Online booking is not available for this salon',
      smsReminders: 'SMS reminders are not enabled for this salon',
      rewards: 'Rewards program is not available for this salon',
      profilePage: 'Public profile is not available for this salon',
      multiLocation: 'Multi-location feature is not enabled for this salon',
      advancedAnalytics: 'Advanced analytics is not enabled for this salon',
      customBranding: 'Custom branding is not enabled for this salon',
      apiAccess: 'API access is not enabled for this salon',
    };

    return Response.json(
      {
        error: messages[feature] || `Feature '${feature}' is not enabled for this salon`,
        code: 'FEATURE_DISABLED',
        feature,
      },
      { status: 403 },
    );
  }

  return null;
}

/**
 * Flat resolved features type for backward compatibility.
 * @deprecated Use nested ResolvedSalonFeatures from salonPolicy.ts for new code.
 */
type LegacyResolvedFeatures = {
  [K in keyof typeof FEATURE_DEFAULTS]: boolean;
};

/**
 * Get all resolved features for a salon.
 * Useful for admin dashboards to show feature status.
 *
 * Uses same logic as checkFeatureEntitlement:
 * - features[key] is source of truth
 * - Legacy booleans only used if features[key] is undefined
 *
 * @deprecated Use featureGating.ts helpers for new code.
 */
export async function getSalonFeatures(salonId: string): Promise<LegacyResolvedFeatures | null> {
  const [salon] = await db
    .select({
      features: salonSchema.features,
      onlineBookingEnabled: salonSchema.onlineBookingEnabled,
      smsRemindersEnabled: salonSchema.smsRemindersEnabled,
      rewardsEnabled: salonSchema.rewardsEnabled,
      profilePageEnabled: salonSchema.profilePageEnabled,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return null;
  }

  const featuresJson = salon.features as SalonFeatures | null;

  // Helper to get feature value with correct priority
  const getFeatureValue = (
    featureKey: keyof typeof FEATURE_DEFAULTS,
    legacyValue: boolean | null,
  ): boolean => {
    // 1. Check features JSONB first (source of truth)
    if (featuresJson) {
      const value = featuresJson[featureKey];
      if (typeof value === 'boolean') {
        return value;
      }
    }
    // 2. Fall back to legacy if features[key] was undefined
    if (typeof legacyValue === 'boolean') {
      return legacyValue;
    }
    // 3. Use default
    return FEATURE_DEFAULTS[featureKey];
  };

  return {
    // Starter - these have legacy columns for backward compat
    onlineBooking: getFeatureValue('onlineBooking', salon.onlineBookingEnabled),
    staffDashboard: featuresJson?.staffDashboard ?? FEATURE_DEFAULTS.staffDashboard,
    photoUploads: featuresJson?.photoUploads ?? FEATURE_DEFAULTS.photoUploads,
    clientProfiles: featuresJson?.clientProfiles ?? FEATURE_DEFAULTS.clientProfiles,
    visibilityControls: featuresJson?.visibilityControls ?? FEATURE_DEFAULTS.visibilityControls,
    // Pro - smsReminders/rewards/profilePage have legacy columns
    smsReminders: getFeatureValue('smsReminders', salon.smsRemindersEnabled),
    rewards: getFeatureValue('rewards', salon.rewardsEnabled),
    referrals: featuresJson?.referrals ?? FEATURE_DEFAULTS.referrals,
    scheduleOverrides: featuresJson?.scheduleOverrides ?? FEATURE_DEFAULTS.scheduleOverrides,
    clientFlags: featuresJson?.clientFlags ?? FEATURE_DEFAULTS.clientFlags,
    clientBlocking: featuresJson?.clientBlocking ?? FEATURE_DEFAULTS.clientBlocking,
    analyticsDashboard: featuresJson?.analyticsDashboard ?? FEATURE_DEFAULTS.analyticsDashboard,
    // Elite - profilePage has legacy column
    profilePage: getFeatureValue('profilePage', salon.profilePageEnabled),
    multiLocation: featuresJson?.multiLocation ?? FEATURE_DEFAULTS.multiLocation,
    advancedAnalytics: featuresJson?.advancedAnalytics ?? FEATURE_DEFAULTS.advancedAnalytics,
    revenueReports: featuresJson?.revenueReports ?? FEATURE_DEFAULTS.revenueReports,
    utilization: featuresJson?.utilization ?? FEATURE_DEFAULTS.utilization,
    techPerformance: featuresJson?.techPerformance ?? FEATURE_DEFAULTS.techPerformance,
    customBranding: featuresJson?.customBranding ?? FEATURE_DEFAULTS.customBranding,
    apiAccess: featuresJson?.apiAccess ?? FEATURE_DEFAULTS.apiAccess,
  };
}

// =============================================================================
// Module Gating (Step 16.3 - Forwards to featureGating.ts)
// =============================================================================

/**
 * Check if a module is effectively enabled for a salon.
 *
 * EFFECTIVE RULE: effective = entitled AND adminEnabled
 * - entitled: resolved from salon.features via MODULE_TO_ENTITLEMENT mapping
 * - adminEnabled: salon.settings.modules[module] !== false
 *
 * NOTE: If entitled is false, module is disabled regardless of settings.modules value.
 *
 * This is a convenience wrapper that fetches salon data and calls getEffectiveModuleEnabled.
 * For pre-fetched data, use getEffectiveModuleEnabled directly from featureGating.ts.
 */
export async function isModuleEnabled(
  salonId: string,
  module: ModuleKey,
): Promise<boolean> {
  const [salon] = await db
    .select({
      features: salonSchema.features,
      settings: salonSchema.settings,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return false;
  }

  return getEffectiveModuleEnabled({
    features: salon.features as SalonFeatures | null,
    settings: salon.settings as SalonSettings | null,
    module,
  });
}
