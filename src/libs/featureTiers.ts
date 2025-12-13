/**
 * Feature Tier Presets
 *
 * Defines the feature packages for Starter, Pro, and Elite tiers.
 * These presets are used by Super Admin to quickly apply tier features to a salon.
 *
 * IMPORTANT: When applying a tier, MERGE with existing features (don't overwrite).
 * This preserves any custom/future keys that may have been added.
 */

import type { SalonFeatures } from '@/types/salonPolicy';

// =============================================================================
// TIER PRESETS
// =============================================================================

/**
 * Starter Tier - Core salon operations
 *
 * Includes basic features needed to run a salon:
 * - Online booking
 * - Staff dashboard
 * - Photo uploads
 * - Client profiles
 * - Visibility controls (admin can control what staff sees)
 */
export const STARTER_FEATURES: SalonFeatures = {
  // Core operations
  onlineBooking: true,
  staffDashboard: true,
  photoUploads: true,
  clientProfiles: true,
  visibilityControls: true,
  // Pro features OFF
  smsReminders: false,
  rewards: false,
  referrals: false,
  scheduleOverrides: false,
  clientFlags: false,
  clientBlocking: false,
  analyticsDashboard: false,
  // Elite features OFF
  profilePage: false,
  multiLocation: false,
  advancedAnalytics: false,
  revenueReports: false,
  utilization: false,
  techPerformance: false,
  customBranding: false,
  apiAccess: false,
};

/**
 * Pro Tier - Marketing & client management
 *
 * Includes Starter + marketing and client management features:
 * - SMS reminders
 * - Rewards/referral program
 * - Schedule overrides for staff
 * - Client flags (VIP, etc.)
 * - Client blocking
 * - Basic analytics dashboard
 */
export const PRO_FEATURES: SalonFeatures = {
  // Starter features ON
  onlineBooking: true,
  staffDashboard: true,
  photoUploads: true,
  clientProfiles: true,
  visibilityControls: true,
  // Pro features ON
  smsReminders: true,
  rewards: true,
  referrals: true,
  scheduleOverrides: true,
  clientFlags: true,
  clientBlocking: true,
  analyticsDashboard: true,
  // Elite features OFF
  profilePage: false,
  multiLocation: false,
  advancedAnalytics: false,
  revenueReports: false,
  utilization: false,
  techPerformance: false,
  customBranding: false,
  apiAccess: false,
};

/**
 * Elite Tier - Advanced analytics & integrations
 *
 * Includes Pro + advanced features:
 * - Public profile page
 * - Multi-location support
 * - Advanced analytics
 * - Revenue reports
 * - Utilization tracking
 * - Technician performance metrics
 * - Custom branding
 * - API access for integrations
 */
export const ELITE_FEATURES: SalonFeatures = {
  // Starter features ON
  onlineBooking: true,
  staffDashboard: true,
  photoUploads: true,
  clientProfiles: true,
  visibilityControls: true,
  // Pro features ON
  smsReminders: true,
  rewards: true,
  referrals: true,
  scheduleOverrides: true,
  clientFlags: true,
  clientBlocking: true,
  analyticsDashboard: true,
  // Elite features ON
  profilePage: true,
  multiLocation: true,
  advancedAnalytics: true,
  revenueReports: true,
  utilization: true,
  techPerformance: true,
  customBranding: true,
  apiAccess: true,
};

// =============================================================================
// TIER HELPERS
// =============================================================================

export type FeatureTier = 'starter' | 'pro' | 'elite';

/**
 * Get the preset features for a tier.
 */
export function getTierPreset(tier: FeatureTier): SalonFeatures {
  const presets: Record<FeatureTier, SalonFeatures> = {
    starter: STARTER_FEATURES,
    pro: PRO_FEATURES,
    elite: ELITE_FEATURES,
  };
  return presets[tier];
}

/**
 * Apply a tier preset to existing features.
 * MERGES the preset with existing features (does not overwrite).
 *
 * @param existing - Current features (may be null/undefined)
 * @param tier - The tier to apply
 * @returns Merged features object
 */
export function applyTierPreset(
  existing: SalonFeatures | null | undefined,
  tier: FeatureTier,
): SalonFeatures {
  const preset = getTierPreset(tier);
  // MERGE: existing features + tier preset (preset wins on conflicts)
  return { ...(existing ?? {}), ...preset };
}

/**
 * Detect which tier best matches the current features.
 * Useful for showing "Current tier: Pro" in UI.
 */
export function detectCurrentTier(features: SalonFeatures | null | undefined): FeatureTier | 'custom' {
  if (!features) {
    return 'starter';
  }

  // Check Elite first (most features)
  const eliteKeys: (keyof SalonFeatures)[] = [
    'advancedAnalytics',
    'revenueReports',
    'utilization',
    'techPerformance',
    'apiAccess',
  ];
  const hasElite = eliteKeys.some(key => features[key] === true);
  if (hasElite) {
    return 'elite';
  }

  // Check Pro
  const proKeys: (keyof SalonFeatures)[] = [
    'smsReminders',
    'rewards',
    'referrals',
    'scheduleOverrides',
    'clientFlags',
    'clientBlocking',
    'analyticsDashboard',
  ];
  const hasPro = proKeys.some(key => features[key] === true);
  if (hasPro) {
    return 'pro';
  }

  // Default to Starter
  return 'starter';
}
