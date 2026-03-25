/**
 * Validate Session API Route
 *
 * Validates the client session cookie and returns the authenticated phone number.
 * Used to restore session state on page load.
 *
 * GET /api/auth/validate-session
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  CLIENT_SESSION_COOKIE,
  clearClientSessionCookies,
  getClientSession,
  refreshClientSession,
  setClientSessionCookies,
} from '@/libs/clientAuth';

export const dynamic = 'force-dynamic';

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function GET() {
  // DEV ONLY: In dev mode, always proceed to normal session validation
  // regardless of dev role. This allows testing client flows even when
  // viewing as admin/super_admin. The dev role switcher is for admin
  // dashboards, not for blocking client session validation.

  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

    if (!sessionId) {
      return NextResponse.json({
        valid: false,
        reason: 'No session cookie',
      });
    }

    const session = await getClientSession();

    if (!session) {
      await clearClientSessionCookies();

      return NextResponse.json({
        valid: false,
        reason: 'Invalid or expired session',
      });
    }

    await refreshClientSession(session.sessionId);
    await setClientSessionCookies({
      sessionId: session.sessionId,
      phone: session.phone,
      clientName: session.clientName,
    });

    return NextResponse.json({
      valid: true,
      phone: session.phone,
      clientName: session.clientName,
      clientEmail: session.clientEmail,
    });
  } catch (error) {
    console.error('Validate session error:', error);

    return NextResponse.json(
      { valid: false, reason: 'Server error' },
      { status: 500 },
    );
  }
}
