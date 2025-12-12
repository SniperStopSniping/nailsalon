/**
 * Staff Logout API Route
 *
 * Clears the staff session cookies to log out the technician.
 *
 * POST /api/staff/logout
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const cookieStore = await cookies();

    // Clear all staff-related cookies by setting them to empty with immediate expiry
    cookieStore.set('staff_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    cookieStore.set('staff_phone', '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    cookieStore.set('staff_name', '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    cookieStore.set('staff_salon', '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Staff logout error:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 },
    );
  }
}
