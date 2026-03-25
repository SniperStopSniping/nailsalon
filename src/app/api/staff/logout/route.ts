/**
 * Staff Logout API Route
 *
 * Clears the staff session cookies to log out the technician.
 *
 * POST /api/staff/logout
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  STAFF_SESSION_COOKIE,
  clearStaffSessionCookies,
  deleteStaffSession,
} from '@/libs/staffAuth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(STAFF_SESSION_COOKIE)?.value;

    if (sessionId) {
      await deleteStaffSession(sessionId);
    }

    await clearStaffSessionCookies();

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
