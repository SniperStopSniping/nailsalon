/**
 * Admin Salon Settings API
 *
 * GET /api/admin/salon/settings?salonSlug=xxx
 * PATCH /api/admin/salon/settings?salonSlug=xxx
 *
 * Allows salon admins to:
 * - GET: View settings including effective points (read-only for points/billing)
 * - PATCH: Update ONLY reviewsEnabled and rewardsEnabled
 *
 * Any attempt to update billingMode or *PointsOverride returns 403 Forbidden.
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { getDefaultLoyaltyPoints, resolveSalonLoyaltyPoints } from '@/libs/loyalty';
import { getSalonBySlug } from '@/libs/queries';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

// Admin can ONLY update these fields
const adminUpdateSchema = z.object({
  reviewsEnabled: z.boolean().optional(),
  rewardsEnabled: z.boolean().optional(),
});

// Fields that are forbidden for admins to update (403 if present)
const FORBIDDEN_FIELDS = [
  'billingMode',
  'welcomeBonusPointsOverride',
  'profileCompletionPointsOverride',
  'referralRefereePointsOverride',
  'referralReferrerPointsOverride',
];

// =============================================================================
// GET /api/admin/salon/settings - Get salon settings
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        { error: 'salonSlug query parameter is required' },
        { status: 400 },
      );
    }

    // 1. Fetch salon by slug
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 2. Check admin authorization
    const guard = await requireAdmin(salon.id);
    if (!guard.ok) {
      return guard.response;
    }

    // 3. Resolve effective points
    const effectivePoints = resolveSalonLoyaltyPoints(salon);
    const defaults = getDefaultLoyaltyPoints();

    // 4. Return settings
    return Response.json({
      reviewsEnabled: salon.reviewsEnabled ?? true,
      rewardsEnabled: salon.rewardsEnabled ?? true,
      effectivePoints,
      defaults,
      billingMode: salon.billingMode ?? 'NONE',
      subscriptionStatus: salon.billingMode === 'STRIPE' ? salon.stripeSubscriptionStatus : null,
      // Indicate what the admin can/cannot edit
      canEditPoints: false,
      canEditBillingMode: false,
    });
  } catch (error) {
    console.error('Error fetching salon settings:', error);
    return Response.json(
      { error: 'Failed to fetch salon settings' },
      { status: 500 },
    );
  }
}

// =============================================================================
// PATCH /api/admin/salon/settings - Update salon settings (limited)
// =============================================================================

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        { error: 'salonSlug query parameter is required' },
        { status: 400 },
      );
    }

    // 1. Fetch salon by slug
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 2. Check admin authorization
    const guard = await requireAdmin(salon.id);
    if (!guard.ok) {
      return guard.response;
    }

    // 3. Parse request body
    const body = await request.json();

    // 4. Check for forbidden fields - return 403 if any are present
    for (const field of FORBIDDEN_FIELDS) {
      if (field in body) {
        return Response.json(
          {
            error: 'Forbidden',
            message: `You do not have permission to modify ${field}. Contact a super admin.`,
          },
          { status: 403 },
        );
      }
    }

    // 5. Validate allowed fields
    const validated = adminUpdateSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const updates = validated.data;

    // 6. Build before/after diff for audit log (only changed fields)
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const dbUpdates: Record<string, unknown> = {};

    if (updates.reviewsEnabled !== undefined && updates.reviewsEnabled !== salon.reviewsEnabled) {
      before.reviewsEnabled = salon.reviewsEnabled;
      after.reviewsEnabled = updates.reviewsEnabled;
      dbUpdates.reviewsEnabled = updates.reviewsEnabled;
    }

    if (updates.rewardsEnabled !== undefined && updates.rewardsEnabled !== salon.rewardsEnabled) {
      before.rewardsEnabled = salon.rewardsEnabled;
      after.rewardsEnabled = updates.rewardsEnabled;
      dbUpdates.rewardsEnabled = updates.rewardsEnabled;
    }

    // 7. If no changes, return current state
    if (Object.keys(dbUpdates).length === 0) {
      const effectivePoints = resolveSalonLoyaltyPoints(salon);
      const defaults = getDefaultLoyaltyPoints();

      return Response.json({
        reviewsEnabled: salon.reviewsEnabled ?? true,
        rewardsEnabled: salon.rewardsEnabled ?? true,
        effectivePoints,
        defaults,
        billingMode: salon.billingMode ?? 'NONE',
        subscriptionStatus: salon.billingMode === 'STRIPE' ? salon.stripeSubscriptionStatus : null,
        canEditPoints: false,
        canEditBillingMode: false,
      });
    }

    // 8. Update salon
    const [updatedSalon] = await db
      .update(salonSchema)
      .set(dbUpdates)
      .where(eq(salonSchema.id, salon.id))
      .returning();

    // If update returns no row, the salon was deleted between validation and update
    if (!updatedSalon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 9. Write audit log
    void logAuditEvent({
      salonId: salon.id,
      actorType: 'admin',
      actorId: guard.admin.id,
      action: 'settings_updated',
      entityType: 'salon',
      entityId: salon.id,
      metadata: { before, after },
    });

    // 10. Return updated settings
    const effectivePoints = resolveSalonLoyaltyPoints(updatedSalon);
    const defaults = getDefaultLoyaltyPoints();

    return Response.json({
      reviewsEnabled: updatedSalon.reviewsEnabled ?? true,
      rewardsEnabled: updatedSalon.rewardsEnabled ?? true,
      effectivePoints,
      defaults,
      billingMode: updatedSalon.billingMode ?? 'NONE',
      subscriptionStatus: updatedSalon.billingMode === 'STRIPE' ? updatedSalon.stripeSubscriptionStatus : null,
      canEditPoints: false,
      canEditBillingMode: false,
    });
  } catch (error) {
    console.error('Error updating salon settings:', error);
    return Response.json(
      { error: 'Failed to update salon settings' },
      { status: 500 },
    );
  }
}
