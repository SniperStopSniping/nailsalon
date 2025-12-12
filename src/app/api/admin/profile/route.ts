/**
 * Admin Profile API Route
 *
 * Allows admins to update their profile (name and email).
 * Used during onboarding and profile management.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getAdminSession } from '@/libs/adminAuth';
import { adminUserSchema } from '@/models/Schema';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  email: z.string().email('Invalid email address'),
});

// =============================================================================
// POST /api/admin/profile - Update admin profile
// =============================================================================

export async function POST(request: Request) {
  try {
    const admin = await getAdminSession();

    if (!admin) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    // Parse and validate body
    const body = await request.json();
    const validated = updateProfileSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { name, email: rawEmail } = validated.data;
    const email = rawEmail.trim().toLowerCase();

    // Check if email is already taken by another admin
    const [existingEmail] = await db
      .select({ id: adminUserSchema.id })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.email, email))
      .limit(1);

    if (existingEmail && existingEmail.id !== admin.id) {
      return NextResponse.json(
        { error: 'This email is already in use by another admin' },
        { status: 409 },
      );
    }

    // Update the admin profile
    const [updated] = await db
      .update(adminUserSchema)
      .set({
        name,
        email,
      })
      .where(eq(adminUserSchema.id, admin.id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        phone: updated.phoneE164,
        name: updated.name,
        email: updated.email,
        isSuperAdmin: updated.isSuperAdmin,
        profileComplete: Boolean(updated.name && updated.email),
      },
    });
  } catch (error) {
    console.error('Admin profile update error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
