import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  adminSalonMembershipSchema,
  adminUserSchema,
  salonSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// POST /api/super-admin/organizations/[id]/owner - Transfer ownership
// =============================================================================

const transferOwnerSchema = z.object({
  adminId: z.string().min(1, 'Admin ID is required'),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id: salonId } = await params;

  try {
    // Parse and validate body
    const body = await request.json();
    const validated = transferOwnerSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { adminId } = validated.data;

    // Verify salon exists
    const [salon] = await db
      .select({ id: salonSchema.id, name: salonSchema.name })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Verify target admin has membership for this salon
    const [targetMembership] = await db
      .select()
      .from(adminSalonMembershipSchema)
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.adminId, adminId),
        ),
      )
      .limit(1);

    if (!targetMembership) {
      return NextResponse.json(
        { error: 'Admin is not a member of this salon' },
        { status: 400 },
      );
    }

    // If already owner, nothing to do
    if (targetMembership.role === 'owner') {
      return NextResponse.json(
        { error: 'Admin is already the owner' },
        { status: 400 },
      );
    }

    // Get admin user details for response
    const [adminUser] = await db
      .select({ name: adminUserSchema.name, phoneE164: adminUserSchema.phoneE164 })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.id, adminId))
      .limit(1);

    // Demote all current owners to admin
    await db
      .update(adminSalonMembershipSchema)
      .set({ role: 'admin' })
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.role, 'owner'),
        ),
      );

    // Promote target admin to owner
    await db
      .update(adminSalonMembershipSchema)
      .set({ role: 'owner' })
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.adminId, adminId),
        ),
      );

    return NextResponse.json({
      success: true,
      message: `${adminUser?.name || 'Admin'} is now the owner of ${salon.name}`,
    });
  } catch (error) {
    console.error('Error transferring ownership:', error);
    return NextResponse.json(
      { error: 'Failed to transfer ownership' },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/super-admin/organizations/[id]/owner - Remove/demote owner
// =============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id: salonId } = await params;

  try {
    // Verify salon exists
    const [salon] = await db
      .select({ id: salonSchema.id, name: salonSchema.name })
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Get the body to determine action
    let action: 'demote' | 'remove' = 'demote';
    try {
      const body = await request.json();
      if (body.action === 'remove') {
        action = 'remove';
      }
    } catch {
      // No body provided, default to demote
    }

    // Find current owner membership
    const [ownerMembership] = await db
      .select()
      .from(adminSalonMembershipSchema)
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.role, 'owner'),
        ),
      )
      .limit(1);

    if (!ownerMembership) {
      return NextResponse.json(
        { error: 'No owner found for this salon' },
        { status: 404 },
      );
    }

    if (action === 'remove') {
      // Check if there are other admins before removing the owner
      const otherAdmins = await db
        .select({ adminId: adminSalonMembershipSchema.adminId })
        .from(adminSalonMembershipSchema)
        .where(eq(adminSalonMembershipSchema.salonId, salonId));

      if (otherAdmins.length <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin. Add another admin first.' },
          { status: 400 },
        );
      }

      // Completely remove the membership (user loses access to this salon)
      await db
        .delete(adminSalonMembershipSchema)
        .where(
          and(
            eq(adminSalonMembershipSchema.salonId, salonId),
            eq(adminSalonMembershipSchema.adminId, ownerMembership.adminId),
          ),
        );

      return NextResponse.json({
        success: true,
        action: 'removed',
        message: `Owner removed from ${salon.name}. They no longer have access.`,
      });
    } else {
      // Check there's at least one other owner before demoting
      const [ownerCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(adminSalonMembershipSchema)
        .where(
          and(
            eq(adminSalonMembershipSchema.salonId, salonId),
            eq(adminSalonMembershipSchema.role, 'owner'),
          ),
        );

      const ownerCount = Number(ownerCountRow?.count ?? 0);

      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last owner. Promote another admin first.' },
          { status: 400 },
        );
      }

      // Demote to admin
      await db
        .update(adminSalonMembershipSchema)
        .set({ role: 'admin' })
        .where(
          and(
            eq(adminSalonMembershipSchema.salonId, salonId),
            eq(adminSalonMembershipSchema.adminId, ownerMembership.adminId),
          ),
        );

      return NextResponse.json({
        success: true,
        action: 'demoted',
        message: `Owner demoted to admin for ${salon.name}.`,
      });
    }
  } catch (error) {
    console.error('Error removing owner:', error);
    return NextResponse.json(
      { error: 'Failed to remove owner' },
      { status: 500 },
    );
  }
}
