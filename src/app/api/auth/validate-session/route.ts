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

export const dynamic = 'force-dynamic';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Decode and validate the session token
 * Returns the phone number if valid, null otherwise
 */
function decodeSessionToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [phone, timestamp] = decoded.split(':');

    // Validate phone format (E.164)
    if (!phone || !phone.startsWith('+1') || phone.length !== 12) {
      return null;
    }

    // Validate timestamp exists and is a number
    if (!timestamp || Number.isNaN(Number(timestamp))) {
      return null;
    }

    // Check if session is older than 1 year (expired)
    const sessionAge = Date.now() - Number(timestamp);
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (sessionAge > oneYearMs) {
      return null;
    }

    return phone;
  } catch {
    return null;
  }
}

/**
 * Generate a refreshed session token with current timestamp
 */
function generateSessionToken(phone: string): string {
  const timestamp = Date.now();
  const data = `${phone}:${timestamp}`;
  return Buffer.from(data).toString('base64');
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function GET() {
  // DEV ONLY: Check for role override
  if (process.env.NODE_ENV !== 'production') {
    const {
      isDevModeServer,
      readDevRoleFromCookies,
      getMockValidateSessionResponse,
    } = await import('@/libs/devRole.server');
    if (isDevModeServer()) {
      const devRole = readDevRoleFromCookies();
      if (devRole === 'client') {
        return NextResponse.json(getMockValidateSessionResponse(), {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      // If a different dev role is set, return invalid session
      if (devRole) {
        return NextResponse.json({
          valid: false,
          reason: 'Dev role mismatch',
        });
      }
    }
  }

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('client_session');

    if (!sessionCookie?.value) {
      return NextResponse.json({
        valid: false,
        reason: 'No session cookie',
      });
    }

    const phone = decodeSessionToken(sessionCookie.value);

    if (!phone) {
      // Invalid or expired session - clear cookies
      cookieStore.delete('client_session');
      cookieStore.delete('client_phone');

      return NextResponse.json({
        valid: false,
        reason: 'Invalid or expired session',
      });
    }

    // Session is valid - refresh the cookies (rolling session)
    const newToken = generateSessionToken(phone);
    cookieStore.set('client_session', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    cookieStore.set('client_phone', phone, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return NextResponse.json({
      valid: true,
      phone,
    });
  } catch (error) {
    console.error('Validate session error:', error);

    return NextResponse.json(
      { valid: false, reason: 'Server error' },
      { status: 500 },
    );
  }
}
