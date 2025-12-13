/**
 * DEV ONLY - Role Override API Route
 *
 * GET: Returns current dev role from cookie
 * POST: Sets or clears the dev role cookie
 *
 * Returns 404 in production to ensure this endpoint is unreachable.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  ALLOWED_ROLES,
  DEV_COOKIE_NAME,
  type DevRole,
  isDevModeServer,
  readDevRoleFromCookies,
} from '@/libs/devRole.server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// =============================================================================
// GET - Return current dev role
// =============================================================================

export async function GET() {
  // Guard: 404 in production
  if (!isDevModeServer()) {
    return new NextResponse(null, { status: 404 });
  }

  const role = readDevRoleFromCookies();

  return NextResponse.json(
    { role },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// =============================================================================
// POST - Set or clear dev role
// =============================================================================

export async function POST(request: Request) {
  // Guard: 404 in production
  if (!isDevModeServer()) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const body = await request.json();
    const { role } = body as { role: DevRole | null };

    // Validate role (don't allow garbage values)
    if (role !== null && !ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid role' },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();

    // Determine secure flag - check x-forwarded-proto for proxy scenarios
    // Fallback: force secure on non-localhost hosts
    const proto = request.headers.get('x-forwarded-proto');
    const host = request.headers.get('host') ?? '';
    const isLocalhost = host.includes('localhost') || host.startsWith('127.') || host.startsWith('192.168.') || host.startsWith('10.');
    const secure = proto
      ? proto === 'https'
      : !isLocalhost;

    if (role === null) {
      // Clear the cookie
      cookieStore.delete(DEV_COOKIE_NAME);
    } else {
      // Set the cookie
      cookieStore.set(DEV_COOKIE_NAME, role, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
      });
    }

    return NextResponse.json({ ok: true, role });
  } catch (error) {
    console.error('[DEV ROLE] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }
}
