import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { appendSalonSlug } from '@/libs/bookingParams';
import { db } from '@/libs/DB';
import {
  getEffectiveModuleEnabled,
  getEffectiveStaffVisibility,
  guardModuleOr403,
  isReferralsProgramEnabled,
  isRewardsProgramEnabled,
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
  isPublished?: boolean;
  redirectPath: string | null;
};

export type CheckSalonStatusOptions = {
  /**
   * When true, skip the "not published" -> /not-found redirect below.
   *
   * This exists so callers that sit inside `[locale]/[slug]/layout.tsx`'s
   * tree (the booking-step pages) can defer to the SAME authorization
   * decision the layout already made via
   * `resolveDraftSalonAccess()`/`resolveOwnerPreviewContext()`
   * (`@/libs/ownerPreview`) instead of running an independent, unaware
   * publication check that would re-404 an authorized owner/impersonating
   * super admin who the layout just let through. Deleted/suspended/
   * cancelled checks below are NOT skipped by this flag — an owner
   * previewing a draft salon still gets redirected if it's since been
   * suspended or cancelled.
   *
   * Callers MUST derive this from `resolveDraftSalonAccess()` (or
   * equivalent), never from an ad-hoc check, so there remains only one
   * authorization matrix for the draft-salon 404 gate.
   */
  allowUnpublishedPreview?: boolean;
};

// =============================================================================
// Check Salon Status
// =============================================================================

/**
 * Check if a salon is accessible (not suspended, cancelled, or deleted)
 * Returns status information and redirect path if needed
 */
export async function checkSalonStatus(
  salonId: string,
  options?: CheckSalonStatusOptions,
): Promise<SalonStatusCheck> {
  const [salon] = await db
    .select({
      status: salonSchema.status,
      deletedAt: salonSchema.deletedAt,
      publicationStatus: salonSchema.publicationStatus,
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
      isPublished: false,
      redirectPath: '/not-found',
    };
  }

  const status = (salon.status || 'active') as SalonStatus;
  const isDeleted = !!salon.deletedAt;
  const isPublished = salon.publicationStatus === 'published';

  if (!isPublished && !options?.allowUnpublishedPreview) {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted,
      isPublished: false,
      redirectPath: '/not-found',
    };
  }

  // Check for deleted salon
  if (isDeleted) {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: true,
      isPublished,
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
      isPublished,
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
      isPublished,
      redirectPath: '/cancelled',
    };
  }

  // Active or trial status - allowed
  return {
    exists: true,
    isActive: true,
    status,
    isDeleted: false,
    isPublished,
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
      publicationStatus: salonSchema.publicationStatus,
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
      isPublished: false,
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

export type FeatureToggle = 'onlineBooking' | 'smsReminders' | 'rewards' | 'referrals' | 'profilePage';

export type FeatureCheck = {
  enabled: boolean;
  redirectPath: string | null;
};

export type TenantRedirectOptions = {
  salonSlug?: string | null;
  routeSalonSlug?: string | null;
  locale?: string | null;
};

export function buildTenantRedirectPath(
  redirectPath: string | null,
  options?: TenantRedirectOptions,
): string | null {
  if (!redirectPath) {
    return null;
  }

  return appendSalonSlug(
    redirectPath,
    options?.salonSlug ?? options?.routeSalonSlug ?? null,
    {
      routeSalonSlug: options?.routeSalonSlug,
      locale: options?.locale,
    },
  );
}

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
    referrals: '/rewards-disabled',
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
    referrals: 'Referrals are not available for this salon',
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
  onlineBooking: true,
  staffDashboard: true,
  photoUploads: true,
  clientProfiles: true,
  visibilityControls: true,
  // Sending still depends on a salon's SMS allowance and consent settings.
  smsReminders: true,
  rewards: true,
  referrals: true,
  scheduleOverrides: true,
  clientFlags: true,
  clientBlocking: true,
  analyticsDashboard: true,
  profilePage: true,
  multiLocation: true,
  advancedAnalytics: true,
  revenueReports: true,
  utilization: true,
  techPerformance: true,
  customBranding: true,
  apiAccess: true,
} as const;

/**
 * Resolve features with defaults applied (LEGACY FLAT STRUCTURE).
 * Merges salon's features JSONB with defaults.
 *
 * @deprecated For new code, use featureGating.ts helpers which support nested structure.
 */
export function resolveFeatures(features: SalonFeatures | null | undefined) {
  // These three flat flags are longstanding operational controls. The other
  // flat booleans were commercial presets and now resolve to included access.
  return {
    ...FEATURE_DEFAULTS,
    onlineBooking: resolveEntitlement(features, 'booking', 'onlineBooking'),
    staffDashboard: resolveEntitlement(features, 'booking', 'staffDashboard'),
    clientProfiles: resolveEntitlement(features, 'clients', 'clientProfiles'),
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
      settings: salonSchema.settings,
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
  const settingsJson = salon.settings as SalonSettings | null;

  if (feature === 'rewards') {
    return {
      enabled: isRewardsProgramEnabled({
        features: featuresJson,
        settings: settingsJson,
        rewardsEnabled: salon.rewardsEnabled,
      }),
    };
  }

  if (feature === 'referrals') {
    return {
      enabled: isReferralsProgramEnabled({
        features: featuresJson,
        settings: settingsJson,
        rewardsEnabled: salon.rewardsEnabled,
      }),
    };
  }

  if (feature === 'smsReminders') {
    return { enabled: resolveEntitlement(featuresJson, 'marketing', 'smsReminders') };
  }

  if (feature === 'onlineBooking') {
    // The column is the public-booking switch. A false value always wins;
    // otherwise the shared resolver preserves explicit nested/flat controls.
    if (salon.onlineBookingEnabled === false) {
      return { enabled: false };
    }
    return { enabled: resolveEntitlement(featuresJson, 'booking', 'onlineBooking') };
  }

  // Flat values and legacy columns were former commercial presets. Owner
  // module settings are resolved separately, so these rows cannot keep a
  // built feature unavailable for an existing free salon.
  const defaultValue = feature in FEATURE_DEFAULTS
    ? resolveFeatures(featuresJson)[feature as keyof typeof FEATURE_DEFAULTS]
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
  return {
    ...resolveFeatures(salon.features as SalonFeatures | null),
    onlineBooking: salon.onlineBookingEnabled === false
      ? false
      : resolveEntitlement(salon.features as SalonFeatures | null, 'booking', 'onlineBooking'),
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
