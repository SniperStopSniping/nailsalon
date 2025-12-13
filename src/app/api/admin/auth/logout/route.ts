/**
 * Admin Logout API Route
 *
 * Clears admin session from DB and cookie.
 * Cookie is cleared with identical options to prevent sticking.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  ADMIN_SESSION_COOKIE,
  COOKIE_OPTIONS,
  deleteAdminSession,
} from '@/libs/adminAuth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

    // Delete session from DB if exists
    if (sessionId) {
      await deleteAdminSession(sessionId);
    }

    // Clear session cookie with identical options
    cookieStore.set(ADMIN_SESSION_COOKIE, '', {
      ...COOKIE_OPTIONS,
      maxAge: 0,
    });

    // Clear active salon cookie
    cookieStore.set('__active_salon_slug', '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Admin logout error:', error);

    // Still try to clear the cookies even if DB delete fails
    try {
      const cookieStore = await cookies();
      cookieStore.set(ADMIN_SESSION_COOKIE, '', {
        ...COOKIE_OPTIONS,
        maxAge: 0,
      });
      cookieStore.set('__active_salon_slug', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    } catch {
      // Ignore
    }

    return NextResponse.json(
      { error: 'Logout partially failed' },
      { status: 500 },
    );
  }
}
