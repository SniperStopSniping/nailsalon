/**
 * Logout API Route
 *
 * Clears the client session cookies to log out the user.
 *
 * POST /api/auth/logout
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST() {
  try {
    const cookieStore = await cookies();

    // Clear both session cookies by setting maxAge to 0
    cookieStore.set('client_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    cookieStore.set('client_phone', '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    cookieStore.set('client_name', '', {
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
    console.error('Logout error:', error);

    return NextResponse.json(
      { success: false, error: 'Failed to logout' },
      { status: 500 },
    );
  }
}
