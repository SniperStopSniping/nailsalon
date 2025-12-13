/**
 * Policy Repository
 *
 * Database access layer for policy management.
 * Uses Drizzle ORM following existing repo patterns.
 */

import { desc, eq } from 'drizzle-orm';

import { db as defaultDb } from '@/libs/DB';
import {
  autopostQueueSchema,
  salonPoliciesSchema,
  superAdminPoliciesSchema,
} from '@/models/Schema';

import { DEFAULT_SALON_POLICY, DEFAULT_SUPER_ADMIN_POLICY } from './policyDefaults';
import type { AutoPostPlatform, SalonPolicyInput, SuperAdminPolicyInput } from './policySchemas';

// =============================================================================
// TYPES
// =============================================================================

export type SuperAdminPolicyRow = {
  id: string;
  requireBeforePhotoToStart: string | null;
  requireAfterPhotoToFinish: string | null;
  requireAfterPhotoToPay: string | null;
  autoPostEnabled: boolean | null;
  autoPostAiCaptionEnabled: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type SalonPolicyRow = {
  salonId: string;
  requireBeforePhotoToStart: string;
  requireAfterPhotoToFinish: string;
  requireAfterPhotoToPay: string;
  autoPostEnabled: boolean;
  autoPostPlatforms: string[];
  autoPostIncludePrice: boolean;
  autoPostIncludeColor: boolean;
  autoPostIncludeBrand: boolean;
  autoPostAiCaptionEnabled: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type AutopostFailure = {
  id: string;
  platform: string;
  status: string;
  error: string | null;
  retryCount: number;
  processedAt: Date | null;
  createdAt: Date | null;
};

// =============================================================================
// SUPER ADMIN POLICY
// =============================================================================

const SUPER_ADMIN_SINGLETON_ID = 'singleton';

/**
 * Get the super admin policy singleton row.
 * Returns defaults if no row exists.
 */
export async function getSuperAdminPolicy(
  db = defaultDb,
): Promise<SuperAdminPolicyRow & { isDefault: boolean }> {
  const [row] = await db
    .select()
    .from(superAdminPoliciesSchema)
    .where(eq(superAdminPoliciesSchema.id, SUPER_ADMIN_SINGLETON_ID))
    .limit(1);

  if (row) {
    return { ...row, isDefault: false };
  }

  // Return defaults
  return {
    id: SUPER_ADMIN_SINGLETON_ID,
    requireBeforePhotoToStart: DEFAULT_SUPER_ADMIN_POLICY.requireBeforePhotoToStart ?? null,
    requireAfterPhotoToFinish: DEFAULT_SUPER_ADMIN_POLICY.requireAfterPhotoToFinish ?? null,
    requireAfterPhotoToPay: DEFAULT_SUPER_ADMIN_POLICY.requireAfterPhotoToPay ?? null,
    autoPostEnabled: DEFAULT_SUPER_ADMIN_POLICY.autoPostEnabled ?? null,
    autoPostAiCaptionEnabled: DEFAULT_SUPER_ADMIN_POLICY.autoPostAiCaptionEnabled ?? null,
    createdAt: null,
    updatedAt: null,
    isDefault: true,
  };
}

/**
 * Upsert the super admin policy singleton.
 */
export async function upsertSuperAdminPolicy(
  db = defaultDb,
  input: SuperAdminPolicyInput,
): Promise<SuperAdminPolicyRow> {
  const now = new Date();

  const [existing] = await db
    .select({ id: superAdminPoliciesSchema.id })
    .from(superAdminPoliciesSchema)
    .where(eq(superAdminPoliciesSchema.id, SUPER_ADMIN_SINGLETON_ID))
    .limit(1);

  if (existing) {
    // Update
    const [updated] = await db
      .update(superAdminPoliciesSchema)
      .set({
        requireBeforePhotoToStart: input.requireBeforePhotoToStart ?? null,
        requireAfterPhotoToFinish: input.requireAfterPhotoToFinish ?? null,
        requireAfterPhotoToPay: input.requireAfterPhotoToPay ?? null,
        autoPostEnabled: input.autoPostEnabled ?? null,
        autoPostAiCaptionEnabled: input.autoPostAiCaptionEnabled ?? null,
        updatedAt: now,
      })
      .where(eq(superAdminPoliciesSchema.id, SUPER_ADMIN_SINGLETON_ID))
      .returning();

    return updated!;
  }

  // Insert
  const [inserted] = await db
    .insert(superAdminPoliciesSchema)
    .values({
      id: SUPER_ADMIN_SINGLETON_ID,
      requireBeforePhotoToStart: input.requireBeforePhotoToStart ?? null,
      requireAfterPhotoToFinish: input.requireAfterPhotoToFinish ?? null,
      requireAfterPhotoToPay: input.requireAfterPhotoToPay ?? null,
      autoPostEnabled: input.autoPostEnabled ?? null,
      autoPostAiCaptionEnabled: input.autoPostAiCaptionEnabled ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return inserted!;
}

// =============================================================================
// SALON POLICY
// =============================================================================

/**
 * Get salon policy for a specific salon.
 * Returns defaults if no row exists.
 */
export async function getSalonPolicy(
  db = defaultDb,
  salonId: string,
): Promise<SalonPolicyRow & { isDefault: boolean }> {
  const [row] = await db
    .select()
    .from(salonPoliciesSchema)
    .where(eq(salonPoliciesSchema.salonId, salonId))
    .limit(1);

  if (row) {
    return {
      salonId: row.salonId,
      requireBeforePhotoToStart: row.requireBeforePhotoToStart ?? 'off',
      requireAfterPhotoToFinish: row.requireAfterPhotoToFinish ?? 'off',
      requireAfterPhotoToPay: row.requireAfterPhotoToPay ?? 'off',
      autoPostEnabled: row.autoPostEnabled ?? false,
      autoPostPlatforms: (row.autoPostPlatforms ?? []) as string[],
      autoPostIncludePrice: row.autoPostIncludePrice ?? false,
      autoPostIncludeColor: row.autoPostIncludeColor ?? false,
      autoPostIncludeBrand: row.autoPostIncludeBrand ?? false,
      autoPostAiCaptionEnabled: row.autoPostAiCaptionEnabled ?? false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isDefault: false,
    };
  }

  // Return defaults
  return {
    salonId,
    ...DEFAULT_SALON_POLICY,
    createdAt: null,
    updatedAt: null,
    isDefault: true,
  };
}

/**
 * Upsert salon policy for a specific salon.
 */
export async function upsertSalonPolicy(
  db = defaultDb,
  salonId: string,
  input: SalonPolicyInput,
): Promise<SalonPolicyRow> {
  const now = new Date();

  const [existing] = await db
    .select({ salonId: salonPoliciesSchema.salonId })
    .from(salonPoliciesSchema)
    .where(eq(salonPoliciesSchema.salonId, salonId))
    .limit(1);

  if (existing) {
    // Update
    const [updated] = await db
      .update(salonPoliciesSchema)
      .set({
        requireBeforePhotoToStart: input.requireBeforePhotoToStart,
        requireAfterPhotoToFinish: input.requireAfterPhotoToFinish,
        requireAfterPhotoToPay: input.requireAfterPhotoToPay,
        autoPostEnabled: input.autoPostEnabled,
        autoPostPlatforms: input.autoPostPlatforms as AutoPostPlatform[],
        autoPostIncludePrice: input.autoPostIncludePrice,
        autoPostIncludeColor: input.autoPostIncludeColor,
        autoPostIncludeBrand: input.autoPostIncludeBrand,
        autoPostAiCaptionEnabled: input.autoPostAiCaptionEnabled,
        updatedAt: now,
      })
      .where(eq(salonPoliciesSchema.salonId, salonId))
      .returning();

    return {
      salonId: updated!.salonId,
      requireBeforePhotoToStart: updated!.requireBeforePhotoToStart ?? 'off',
      requireAfterPhotoToFinish: updated!.requireAfterPhotoToFinish ?? 'off',
      requireAfterPhotoToPay: updated!.requireAfterPhotoToPay ?? 'off',
      autoPostEnabled: updated!.autoPostEnabled ?? false,
      autoPostPlatforms: (updated!.autoPostPlatforms ?? []) as string[],
      autoPostIncludePrice: updated!.autoPostIncludePrice ?? false,
      autoPostIncludeColor: updated!.autoPostIncludeColor ?? false,
      autoPostIncludeBrand: updated!.autoPostIncludeBrand ?? false,
      autoPostAiCaptionEnabled: updated!.autoPostAiCaptionEnabled ?? false,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    };
  }

  // Insert
  const [inserted] = await db
    .insert(salonPoliciesSchema)
    .values({
      salonId,
      requireBeforePhotoToStart: input.requireBeforePhotoToStart,
      requireAfterPhotoToFinish: input.requireAfterPhotoToFinish,
      requireAfterPhotoToPay: input.requireAfterPhotoToPay,
      autoPostEnabled: input.autoPostEnabled,
      autoPostPlatforms: input.autoPostPlatforms as AutoPostPlatform[],
      autoPostIncludePrice: input.autoPostIncludePrice,
      autoPostIncludeColor: input.autoPostIncludeColor,
      autoPostIncludeBrand: input.autoPostIncludeBrand,
      autoPostAiCaptionEnabled: input.autoPostAiCaptionEnabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    salonId: inserted!.salonId,
    requireBeforePhotoToStart: inserted!.requireBeforePhotoToStart ?? 'off',
    requireAfterPhotoToFinish: inserted!.requireAfterPhotoToFinish ?? 'off',
    requireAfterPhotoToPay: inserted!.requireAfterPhotoToPay ?? 'off',
    autoPostEnabled: inserted!.autoPostEnabled ?? false,
    autoPostPlatforms: (inserted!.autoPostPlatforms ?? []) as string[],
    autoPostIncludePrice: inserted!.autoPostIncludePrice ?? false,
    autoPostIncludeColor: inserted!.autoPostIncludeColor ?? false,
    autoPostIncludeBrand: inserted!.autoPostIncludeBrand ?? false,
    autoPostAiCaptionEnabled: inserted!.autoPostAiCaptionEnabled ?? false,
    createdAt: inserted!.createdAt,
    updatedAt: inserted!.updatedAt,
  };
}

// =============================================================================
// AUTOPOST FAILURE LOOKUP
// =============================================================================

/**
 * Get the latest failed autopost row.
 * If salonId is provided, scopes to that salon.
 * Otherwise returns global last failure.
 */
export async function getLatestAutopostFailure(
  db = defaultDb,
  options?: { salonId?: string },
): Promise<AutopostFailure | null> {
  const query = db
    .select({
      id: autopostQueueSchema.id,
      platform: autopostQueueSchema.platform,
      status: autopostQueueSchema.status,
      error: autopostQueueSchema.error,
      retryCount: autopostQueueSchema.retryCount,
      processedAt: autopostQueueSchema.processedAt,
      createdAt: autopostQueueSchema.createdAt,
    })
    .from(autopostQueueSchema)
    .where(eq(autopostQueueSchema.status, 'failed'))
    .orderBy(desc(autopostQueueSchema.processedAt))
    .limit(1);

  // Note: Drizzle doesn't support conditional where chaining easily,
  // so we handle salonId filtering separately
  if (options?.salonId) {
    const [row] = await db
      .select({
        id: autopostQueueSchema.id,
        platform: autopostQueueSchema.platform,
        status: autopostQueueSchema.status,
        error: autopostQueueSchema.error,
        retryCount: autopostQueueSchema.retryCount,
        processedAt: autopostQueueSchema.processedAt,
        createdAt: autopostQueueSchema.createdAt,
      })
      .from(autopostQueueSchema)
      .where(eq(autopostQueueSchema.salonId, options.salonId))
      .orderBy(desc(autopostQueueSchema.processedAt))
      .limit(1);

    if (!row || row.status !== 'failed') {
      return null;
    }

    return row;
  }

  const [row] = await query;
  return row ?? null;
}
