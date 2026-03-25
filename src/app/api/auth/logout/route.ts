/**
 * Logout API Route
 *
 * Clears the client session cookies to log out the user.
 *
 * POST /api/auth/logout
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  CLIENT_SESSION_COOKIE,
  clearClientSessionCookies,
  deleteClientSession,
} from '@/libs/clientAuth';

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

    if (sessionId) {
      await deleteClientSession(sessionId);
    }

    await clearClientSessionCookies();

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
