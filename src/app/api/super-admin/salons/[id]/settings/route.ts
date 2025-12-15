/**
 * Super Admin Salon Settings API
 *
 * PATCH /api/super-admin/salons/[id]/settings
 *
 * Allows super admins to update:
 * - reviewsEnabled, rewardsEnabled (boolean toggles)
 * - billingMode ('NONE' | 'STRIPE')
 * - Per-salon loyalty points overrides (welcomeBonus, profileCompletion, referralReferee, referralReferrer)
 *
 * All changes are logged to the audit log with before/after diff.
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { getDefaultLoyaltyPoints, resolveSalonLoyaltyPoints } from '@/libs/loyalty';
import { requireSuperAdminGuard } from '@/libs/superAdmin';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateSettingsSchema = z.object({
  reviewsEnabled: z.boolean().optional(),
  rewardsEnabled: z.boolean().optional(),
  billingMode: z.enum(['NONE', 'STRIPE']).optional(),
  welcomeBonusPointsOverride: z.number().int().min(0).max(250000).nullable().optional(),
  profileCompletionPointsOverride: z.number().int().min(0).max(250000).nullable().optional(),
  referralRefereePointsOverride: z.number().int().min(0).max(250000).nullable().optional(),
  referralReferrerPointsOverride: z.number().int().min(0).max(250000).nullable().optional(),
});

// =============================================================================
// PATCH /api/super-admin/salons/[id]/settings - Update salon settings
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdminGuard();
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const { id: salonId } = await params;

    // 1. Validate request body
    const body = await request.json();
    const validated = updateSettingsSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const updates = validated.data;

    // 2. Fetch existing salon
    const [existingSalon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!existingSalon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 3. Build before/after diff for audit log (only changed fields)
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const dbUpdates: Record<string, unknown> = {};

    if (updates.reviewsEnabled !== undefined && updates.reviewsEnabled !== existingSalon.reviewsEnabled) {
      before.reviewsEnabled = existingSalon.reviewsEnabled;
      after.reviewsEnabled = updates.reviewsEnabled;
      dbUpdates.reviewsEnabled = updates.reviewsEnabled;
    }

    if (updates.rewardsEnabled !== undefined && updates.rewardsEnabled !== existingSalon.rewardsEnabled) {
      before.rewardsEnabled = existingSalon.rewardsEnabled;
      after.rewardsEnabled = updates.rewardsEnabled;
      dbUpdates.rewardsEnabled = updates.rewardsEnabled;
    }

    if (updates.billingMode !== undefined && updates.billingMode !== existingSalon.billingMode) {
      before.billingMode = existingSalon.billingMode;
      after.billingMode = updates.billingMode;
      dbUpdates.billingMode = updates.billingMode;
    }

    if (updates.welcomeBonusPointsOverride !== undefined && updates.welcomeBonusPointsOverride !== existingSalon.welcomeBonusPointsOverride) {
      before.welcomeBonusPointsOverride = existingSalon.welcomeBonusPointsOverride;
      after.welcomeBonusPointsOverride = updates.welcomeBonusPointsOverride;
      dbUpdates.welcomeBonusPointsOverride = updates.welcomeBonusPointsOverride;
    }

    if (updates.profileCompletionPointsOverride !== undefined && updates.profileCompletionPointsOverride !== existingSalon.profileCompletionPointsOverride) {
      before.profileCompletionPointsOverride = existingSalon.profileCompletionPointsOverride;
      after.profileCompletionPointsOverride = updates.profileCompletionPointsOverride;
      dbUpdates.profileCompletionPointsOverride = updates.profileCompletionPointsOverride;
    }

    if (updates.referralRefereePointsOverride !== undefined && updates.referralRefereePointsOverride !== existingSalon.referralRefereePointsOverride) {
      before.referralRefereePointsOverride = existingSalon.referralRefereePointsOverride;
      after.referralRefereePointsOverride = updates.referralRefereePointsOverride;
      dbUpdates.referralRefereePointsOverride = updates.referralRefereePointsOverride;
    }

    if (updates.referralReferrerPointsOverride !== undefined && updates.referralReferrerPointsOverride !== existingSalon.referralReferrerPointsOverride) {
      before.referralReferrerPointsOverride = existingSalon.referralReferrerPointsOverride;
      after.referralReferrerPointsOverride = updates.referralReferrerPointsOverride;
      dbUpdates.referralReferrerPointsOverride = updates.referralReferrerPointsOverride;
    }

    // 4. If no changes, return current state
    if (Object.keys(dbUpdates).length === 0) {
      const effectivePoints = resolveSalonLoyaltyPoints(existingSalon);
      const defaults = getDefaultLoyaltyPoints();

      return Response.json({
        settings: {
          reviewsEnabled: existingSalon.reviewsEnabled ?? true,
          rewardsEnabled: existingSalon.rewardsEnabled ?? true,
          billingMode: existingSalon.billingMode ?? 'NONE',
          welcomeBonusPointsOverride: existingSalon.welcomeBonusPointsOverride,
          profileCompletionPointsOverride: existingSalon.profileCompletionPointsOverride,
          referralRefereePointsOverride: existingSalon.referralRefereePointsOverride,
          referralReferrerPointsOverride: existingSalon.referralReferrerPointsOverride,
        },
        effectivePoints,
        defaults,
        subscriptionStatus: existingSalon.billingMode === 'STRIPE' ? existingSalon.stripeSubscriptionStatus : null,
      });
    }

    // 5. Update salon
    const [updatedSalon] = await db
      .update(salonSchema)
      .set(dbUpdates)
      .where(eq(salonSchema.id, salonId))
      .returning();

    // If update returns no row, the salon was deleted between validation and update
    if (!updatedSalon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 6. Write audit log
    void logAuditEvent({
      salonId,
      actorType: 'super_admin',
      action: 'settings_updated',
      entityType: 'salon',
      entityId: salonId,
      metadata: { before, after },
    });

    // 7. Return updated settings
    const effectivePoints = resolveSalonLoyaltyPoints(updatedSalon);
    const defaults = getDefaultLoyaltyPoints();

    return Response.json({
      settings: {
        reviewsEnabled: updatedSalon.reviewsEnabled ?? true,
        rewardsEnabled: updatedSalon.rewardsEnabled ?? true,
        billingMode: updatedSalon.billingMode ?? 'NONE',
        welcomeBonusPointsOverride: updatedSalon.welcomeBonusPointsOverride,
        profileCompletionPointsOverride: updatedSalon.profileCompletionPointsOverride,
        referralRefereePointsOverride: updatedSalon.referralRefereePointsOverride,
        referralReferrerPointsOverride: updatedSalon.referralReferrerPointsOverride,
      },
      effectivePoints,
      defaults,
      subscriptionStatus: updatedSalon.billingMode === 'STRIPE' ? updatedSalon.stripeSubscriptionStatus : null,
    });
  } catch (error) {
    console.error('Error updating salon settings:', error);
    return Response.json(
      { error: 'Failed to update salon settings' },
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/super-admin/salons/[id]/settings - Get salon settings
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdminGuard();
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const { id: salonId } = await params;

    // Fetch salon
    const [salon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    const effectivePoints = resolveSalonLoyaltyPoints(salon);
    const defaults = getDefaultLoyaltyPoints();

    return Response.json({
      settings: {
        reviewsEnabled: salon.reviewsEnabled ?? true,
        rewardsEnabled: salon.rewardsEnabled ?? true,
        billingMode: salon.billingMode ?? 'NONE',
        welcomeBonusPointsOverride: salon.welcomeBonusPointsOverride,
        profileCompletionPointsOverride: salon.profileCompletionPointsOverride,
        referralRefereePointsOverride: salon.referralRefereePointsOverride,
        referralReferrerPointsOverride: salon.referralReferrerPointsOverride,
      },
      effectivePoints,
      defaults,
      subscriptionStatus: salon.billingMode === 'STRIPE' ? salon.stripeSubscriptionStatus : null,
    });
  } catch (error) {
    console.error('Error fetching salon settings:', error);
    return Response.json(
      { error: 'Failed to fetch salon settings' },
      { status: 500 },
    );
  }
}
