/**
 * Policy Validation Schemas
 *
 * Zod schemas for validating policy inputs from API requests.
 * Used by both Super Admin and Salon Admin policy endpoints.
 */

import { z } from 'zod';

// =============================================================================
// ENUMS & CONSTANTS
// =============================================================================

export const PhotoRequirementModeSchema = z.enum(['off', 'optional', 'required']);
export type PhotoRequirementMode = z.infer<typeof PhotoRequirementModeSchema>;

export const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok'] as const;
export const AutoPostPlatformSchema = z.enum(ALLOWED_PLATFORMS);
export type AutoPostPlatform = z.infer<typeof AutoPostPlatformSchema>;

// =============================================================================
// SUPER ADMIN POLICY INPUT SCHEMA
// =============================================================================

export const SuperAdminPolicyInputSchema = z.object({
  // Photo requirements (all optional - undefined means "don't override salon")
  requireBeforePhotoToStart: PhotoRequirementModeSchema.optional(),
  requireAfterPhotoToFinish: PhotoRequirementModeSchema.optional(),
  requireAfterPhotoToPay: PhotoRequirementModeSchema.optional(),

  // Auto-post settings (optional overrides)
  autoPostEnabled: z.boolean().optional(),
  autoPostAiCaptionEnabled: z.boolean().optional(),
});

export type SuperAdminPolicyInput = z.infer<typeof SuperAdminPolicyInputSchema>;

// =============================================================================
// SALON POLICY INPUT SCHEMA
// =============================================================================

export const SalonPolicyInputSchema = z.object({
  // Photo requirements
  requireBeforePhotoToStart: PhotoRequirementModeSchema.default('off'),
  requireAfterPhotoToFinish: PhotoRequirementModeSchema.default('off'),
  requireAfterPhotoToPay: PhotoRequirementModeSchema.default('off'),

  // Auto-post settings
  autoPostEnabled: z.boolean().default(false),
  autoPostPlatforms: z.array(AutoPostPlatformSchema).default([]),
  autoPostIncludePrice: z.boolean().default(false),
  autoPostIncludeColor: z.boolean().default(false),
  autoPostIncludeBrand: z.boolean().default(false),
  autoPostAiCaptionEnabled: z.boolean().default(false),
});

export type SalonPolicyInput = z.infer<typeof SalonPolicyInputSchema>;

// =============================================================================
// NORMALIZATION HELPER
// =============================================================================

/**
 * Normalize policy input:
 * - Dedupe platforms
 * - Sort platforms for consistency
 * - Default missing arrays to []
 * - Ensure all booleans are explicit
 */
export function normalizePolicyInput<T extends Record<string, unknown>>(input: T): T {
  const result = { ...input };

  // Normalize autoPostPlatforms if present
  if ('autoPostPlatforms' in result && Array.isArray((result as Record<string, unknown>).autoPostPlatforms)) {
    // Dedupe and sort
    const platforms = [...new Set((result as Record<string, unknown>).autoPostPlatforms as string[])].sort();
    // Filter to only allowed platforms
    (result as Record<string, unknown>).autoPostPlatforms = platforms.filter(p =>
      ALLOWED_PLATFORMS.includes(p as AutoPostPlatform),
    );
  }

  return result;
}

/**
 * Normalize salon policy input specifically
 */
export function normalizeSalonPolicyInput(input: SalonPolicyInput): SalonPolicyInput {
  return {
    requireBeforePhotoToStart: input.requireBeforePhotoToStart ?? 'off',
    requireAfterPhotoToFinish: input.requireAfterPhotoToFinish ?? 'off',
    requireAfterPhotoToPay: input.requireAfterPhotoToPay ?? 'off',
    autoPostEnabled: input.autoPostEnabled ?? false,
    autoPostPlatforms: [...new Set(input.autoPostPlatforms ?? [])].sort() as AutoPostPlatform[],
    autoPostIncludePrice: input.autoPostIncludePrice ?? false,
    autoPostIncludeColor: input.autoPostIncludeColor ?? false,
    autoPostIncludeBrand: input.autoPostIncludeBrand ?? false,
    autoPostAiCaptionEnabled: input.autoPostAiCaptionEnabled ?? false,
  };
}

/**
 * Normalize super admin policy input specifically
 */
export function normalizeSuperAdminPolicyInput(
  input: SuperAdminPolicyInput,
): SuperAdminPolicyInput {
  // For super admin, undefined values are intentional (means "don't override")
  // Only normalize if values are explicitly set
  return {
    requireBeforePhotoToStart: input.requireBeforePhotoToStart,
    requireAfterPhotoToFinish: input.requireAfterPhotoToFinish,
    requireAfterPhotoToPay: input.requireAfterPhotoToPay,
    autoPostEnabled: input.autoPostEnabled,
    autoPostAiCaptionEnabled: input.autoPostAiCaptionEnabled,
  };
}
