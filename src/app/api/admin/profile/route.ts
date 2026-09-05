/**
 * Admin Profile API Route
 *
 * GET  - Read the signed-in admin's profile (name + sign-in email).
 * POST - Update the admin's display name.
 *
 * AG-w2-settings-integrations-08: the email column used to be freely
 * rewritable here. `admin_user.email` is an identity-adoption key for Clerk
 * sign-in, and this route has no verification step, no confirmation mail and
 * no Clerk write — so anyone holding an owner session could point owner alerts
 * at an address they control. Until a verified change-of-address flow exists,
 * the address is READ-ONLY once set: it is returned so the owner can see it, a
 * matching value is accepted (so old clients keep working), and a different one
 * is refused in words instead of being written. An account that has no address
 * yet can still set one — that is the legacy phone-admin onboarding step at
 * `/admin-onboarding`, which is a first write, not a redirect of live alerts.
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { adminUserSchema } from '@/models/Schema';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  // Optional: a name-only edit must not require retyping the address
  // (AG-w2-settings-integrations-09). When present it must match the stored
  // address — see the module comment.
  email: z.string().trim().email('Invalid email address').optional(),
});

// Not exported: a Next route module may only export route handlers and the
// route segment config.
const EMAIL_IS_READ_ONLY_MESSAGE
  = 'Your sign-in email is managed by your account — contact support to change it.';

// =============================================================================
// GET /api/admin/profile - Read the signed-in admin's profile
// =============================================================================

export async function GET() {
  try {
    const admin = await getAdminSession();

    if (!admin) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    return NextResponse.json({
      user: {
        id: admin.id,
        phone: admin.phoneE164,
        name: admin.name,
        email: admin.email,
        emailEditable: false,
        isSuperAdmin: admin.isSuperAdmin,
        profileComplete: Boolean(admin.name && admin.email),
      },
    });
  } catch (error) {
    console.error('Admin profile read error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/admin/profile - Update admin profile (name only)
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
    const submittedEmail = rawEmail?.trim().toLowerCase() || null;
    const storedEmail = admin.email?.trim().toLowerCase() || null;
    const isFirstEmail = storedEmail === null && submittedEmail !== null;

    // Once an address is stored, a submitted one is only ever a confirmation
    // of it. Changing it needs a verified flow this route does not have.
    if (
      submittedEmail !== null
      && storedEmail !== null
      && submittedEmail !== storedEmail
    ) {
      return NextResponse.json(
        {
          error: EMAIL_IS_READ_ONLY_MESSAGE,
          code: 'EMAIL_READ_ONLY',
        },
        { status: 409 },
      );
    }

    if (isFirstEmail) {
      // Still refuse an address another admin already signs in with.
      const [existingEmail] = await db
        .select({ id: adminUserSchema.id })
        .from(adminUserSchema)
        .where(eq(adminUserSchema.email, submittedEmail as string))
        .limit(1);

      if (existingEmail && existingEmail.id !== admin.id) {
        return NextResponse.json(
          { error: 'This email is already in use by another admin' },
          { status: 409 },
        );
      }
    }

    // Update the admin profile (name, plus a first-time address)
    const [updated] = await db
      .update(adminUserSchema)
      .set(isFirstEmail ? { name, email: submittedEmail as string } : { name })
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
        emailEditable: false,
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
