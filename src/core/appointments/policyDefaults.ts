/**
 * Policy Defaults
 *
 * Default values for super admin and salon policies.
 * Used when no policy row exists in the database.
 */

import type { SalonPolicyInput, SuperAdminPolicyInput } from './policySchemas';

// =============================================================================
// DEFAULT SUPER ADMIN POLICY
// =============================================================================

/**
 * Default super admin policy.
 * All values are undefined, meaning "don't override salon settings".
 */
export const DEFAULT_SUPER_ADMIN_POLICY: SuperAdminPolicyInput = {
  requireBeforePhotoToStart: undefined,
  requireAfterPhotoToFinish: undefined,
  requireAfterPhotoToPay: undefined,
  autoPostEnabled: undefined,
  autoPostAiCaptionEnabled: undefined,
};

// =============================================================================
// DEFAULT SALON POLICY
// =============================================================================

/**
 * Default salon policy.
 * Conservative defaults: all photo requirements off, autopost disabled.
 */
export const DEFAULT_SALON_POLICY: SalonPolicyInput = {
  requireBeforePhotoToStart: 'off',
  requireAfterPhotoToFinish: 'off',
  requireAfterPhotoToPay: 'off',
  autoPostEnabled: false,
  autoPostPlatforms: [],
  autoPostIncludePrice: false,
  autoPostIncludeColor: false,
  autoPostIncludeBrand: false,
  autoPostAiCaptionEnabled: false,
};
