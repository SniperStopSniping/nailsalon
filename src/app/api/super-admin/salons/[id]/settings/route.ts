/**
 * Super Admin Salon Settings API
 *
 * PATCH /api/super-admin/salons/[id]/settings
 *
 * Allows super admins to update:
 * - reviewsEnabled, rewardsEnabled (boolean toggles)
 * - billingMode ('NONE' | 'STRIPE')
 *
 * All changes are logged to the audit log with before/after diff.
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateSettingsSchema = z.object({
  reviewsEnabled: z.boolean().optional(),
  rewardsEnabled: z.boolean().optional(),
  billingMode: z.enum(['NONE', 'STRIPE']).optional(),
});

// =============================================================================
// PATCH /api/super-admin/salons/[id]/settings - Update salon settings
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
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

    // 4. If no changes, return current state
    if (Object.keys(dbUpdates).length === 0) {
      return Response.json({
        settings: {
          reviewsEnabled: existingSalon.reviewsEnabled ?? true,
          rewardsEnabled: existingSalon.rewardsEnabled ?? true,
          billingMode: existingSalon.billingMode ?? 'NONE',
        },
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
    return Response.json({
      settings: {
        reviewsEnabled: updatedSalon.reviewsEnabled ?? true,
        rewardsEnabled: updatedSalon.rewardsEnabled ?? true,
        billingMode: updatedSalon.billingMode ?? 'NONE',
      },
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
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
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

    return Response.json({
      settings: {
        reviewsEnabled: salon.reviewsEnabled ?? true,
        rewardsEnabled: salon.rewardsEnabled ?? true,
        billingMode: salon.billingMode ?? 'NONE',
      },
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
