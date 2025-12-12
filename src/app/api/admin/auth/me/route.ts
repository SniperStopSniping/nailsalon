/**
 * Admin Me API Route
 *
 * Returns the current admin user's profile and salon memberships.
 * Reads from session cookie.
 */

import { NextResponse } from 'next/server';

import { getAdminSession } from '@/libs/adminAuth';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await getAdminSession();

    if (!admin) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    // Profile is complete when both name and email are set
    const profileComplete = Boolean(admin.name && admin.email);

    return NextResponse.json({
      user: {
        id: admin.id,
        phone: admin.phoneE164,
        name: admin.name,
        email: admin.email,
        isSuperAdmin: admin.isSuperAdmin,
        profileComplete,
        salons: admin.salons.map((s) => ({
          id: s.salonId,
          slug: s.salonSlug,
          name: s.salonName,
          role: s.role,
        })),
      },
    });
  } catch (error) {
    console.error('Admin me error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
