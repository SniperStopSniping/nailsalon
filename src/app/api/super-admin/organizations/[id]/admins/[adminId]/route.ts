/**
 * Super Admin - Manage Individual Admin Membership
 *
 * DELETE - Remove an admin from a salon
 * POST - Promote admin to owner
 */

import { eq, and, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/adminAuth';
import {
  salonSchema,
  adminSalonMembershipSchema,
  adminUserSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// DELETE /api/super-admin/organizations/[id]/admins/[adminId] - Remove admin
// =============================================================================

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; adminId: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id: salonId, adminId } = await params;

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

    // Find the membership to remove
    const [membership] = await db
      .select({
        adminId: adminSalonMembershipSchema.adminId,
        role: adminSalonMembershipSchema.role,
      })
      .from(adminSalonMembershipSchema)
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.adminId, adminId),
        ),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json(
        { error: 'Admin membership not found' },
        { status: 404 },
      );
    }

    // If removing an owner, check there's at least one other owner
    if (membership.role === 'owner') {
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
          { error: 'Cannot remove the last owner. Transfer ownership first or promote another admin.' },
          { status: 400 },
        );
      }
    }

    // Delete the membership
    await db
      .delete(adminSalonMembershipSchema)
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.adminId, adminId),
        ),
      );

    return NextResponse.json({
      success: true,
      message: `Admin removed from ${salon.name}`,
    });
  } catch (error) {
    console.error('Error removing admin:', error);
    return NextResponse.json(
      { error: 'Failed to remove admin' },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/super-admin/organizations/[id]/admins/[adminId] - Promote to owner
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; adminId: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id: salonId, adminId } = await params;

  try {
    // Parse body for action
    const body = await request.json().catch(() => ({}));
    const action = body.action as 'promote' | 'demote' | undefined;

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

    // Find the membership
    const [membership] = await db
      .select({
        adminId: adminSalonMembershipSchema.adminId,
        role: adminSalonMembershipSchema.role,
      })
      .from(adminSalonMembershipSchema)
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, salonId),
          eq(adminSalonMembershipSchema.adminId, adminId),
        ),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json(
        { error: 'Admin membership not found' },
        { status: 404 },
      );
    }

    // Get admin details for response
    const [adminUser] = await db
      .select({
        name: adminUserSchema.name,
        phoneE164: adminUserSchema.phoneE164,
      })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.id, adminId))
      .limit(1);

    if (action === 'demote') {
      // Demote owner to admin
      if (membership.role !== 'owner') {
        return NextResponse.json(
          { error: 'Admin is not an owner' },
          { status: 400 },
        );
      }

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

      await db
        .update(adminSalonMembershipSchema)
        .set({ role: 'admin' })
        .where(
          and(
            eq(adminSalonMembershipSchema.salonId, salonId),
            eq(adminSalonMembershipSchema.adminId, adminId),
          ),
        );

      return NextResponse.json({
        success: true,
        action: 'demoted',
        message: `${adminUser?.name || 'Admin'} demoted to admin`,
      });
    } else {
      // Promote admin to owner (default action)
      if (membership.role === 'owner') {
        return NextResponse.json(
          { error: 'Admin is already an owner' },
          { status: 400 },
        );
      }

      // Demote current owner(s) to admin first
      await db
        .update(adminSalonMembershipSchema)
        .set({ role: 'admin' })
        .where(
          and(
            eq(adminSalonMembershipSchema.salonId, salonId),
            eq(adminSalonMembershipSchema.role, 'owner'),
          ),
        );

      // Promote this admin to owner
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
        action: 'promoted',
        message: `${adminUser?.name || 'Admin'} is now the owner of ${salon.name}`,
      });
    }
  } catch (error) {
    console.error('Error updating admin role:', error);
    return NextResponse.json(
      { error: 'Failed to update admin role' },
      { status: 500 },
    );
  }
}
