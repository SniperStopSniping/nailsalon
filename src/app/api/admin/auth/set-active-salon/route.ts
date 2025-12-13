/**
 * Set Active Salon API Route
 *
 * Sets the __active_salon_slug httpOnly cookie to persist salon selection.
 * Validates user has membership in the requested salon (or is super admin).
 */

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const COOKIE_NAME = '__active_salon_slug';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function POST(request: Request) {
  try {
    // Get real admin session (not dev mock)
    const admin = await getAdminSession();

    if (!admin) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    // Parse body (handle empty body gracefully)
    let body: { salonSlug?: string } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const salonSlug = (body.salonSlug as string)?.trim().toLowerCase();

    if (!salonSlug) {
      return NextResponse.json(
        { error: 'salonSlug is required' },
        { status: 400 },
      );
    }

    // Validate salon exists
    const [salon] = await db
      .select({ id: salonSchema.id, slug: salonSchema.slug })
      .from(salonSchema)
      .where(eq(salonSchema.slug, salonSlug))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Validate membership (super admin can access any salon)
    if (!admin.isSuperAdmin) {
      const hasMembership = admin.salons.some(
        s => s.salonSlug?.toLowerCase() === salonSlug,
      );
      if (!hasMembership) {
        return NextResponse.json(
          { error: 'You do not have access to this salon' },
          { status: 403 },
        );
      }
    }

    // Compute secure flag (proxy-aware)
    const proto = request.headers.get('x-forwarded-proto');
    const secure = proto ? proto === 'https' : new URL(request.url).protocol === 'https:';

    // Set the cookie
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, salonSlug, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      secure,
    });

    return NextResponse.json(
      { ok: true, salonSlug },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Set active salon error:', error);
    return NextResponse.json(
      { error: 'Failed to set active salon' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    // Compute secure flag (proxy-aware)
    const proto = request.headers.get('x-forwarded-proto');
    const secure = proto ? proto === 'https' : new URL(request.url).protocol === 'https:';

    // Clear the cookie
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0, // Expire immediately
      secure,
    });

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Clear active salon error:', error);
    return NextResponse.json(
      { error: 'Failed to clear active salon' },
      { status: 500 },
    );
  }
}
