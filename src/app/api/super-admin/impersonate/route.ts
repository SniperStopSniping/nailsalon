import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSuperAdminInfo, logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// Cookie name for impersonation (not exported - Next.js routes only allow specific exports)
const IMPERSONATE_COOKIE = 'sa_impersonate';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const impersonateSchema = z.object({
  salonId: z.string().min(1, 'Salon ID is required'),
});

// =============================================================================
// POST /api/super-admin/impersonate - Start impersonation session
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const body = await request.json();

    const validated = impersonateSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { salonId } = validated.data;

    // Check salon exists
    const [salon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, salonId))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    const adminInfo = await getSuperAdminInfo();

    // Set impersonation cookie
    const cookieStore = await cookies();
    const impersonateData = {
      salonId,
      salonSlug: salon.slug,
      salonName: salon.name,
      adminUserId: adminInfo?.userId,
      adminPhone: adminInfo?.phone,
      startedAt: new Date().toISOString(),
    };

    cookieStore.set(IMPERSONATE_COOKIE, JSON.stringify(impersonateData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 2, // 2 hours
      path: '/',
    });

    // Log the action
    await logAuditAction(salonId, 'updated', {
      details: `Impersonation started by ${adminInfo?.phone}`,
    });

    return Response.json({
      success: true,
      message: 'Impersonation session started',
      redirectUrl: `/admin?salon=${salon.slug}`,
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      },
    });
  } catch (error) {
    console.error('Error starting impersonation:', error);
    return Response.json(
      { error: 'Failed to start impersonation' },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/super-admin/impersonate - End impersonation session
// =============================================================================

export async function DELETE(): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const cookieStore = await cookies();

    // Get current impersonation data for logging
    const impersonateCookie = cookieStore.get(IMPERSONATE_COOKIE);
    if (impersonateCookie?.value) {
      try {
        const data = JSON.parse(impersonateCookie.value);
        if (data.salonId) {
          const adminInfo = await getSuperAdminInfo();
          await logAuditAction(data.salonId, 'updated', {
            details: `Impersonation ended by ${adminInfo?.phone}`,
          });
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // Clear the cookie
    cookieStore.delete(IMPERSONATE_COOKIE);

    return Response.json({
      success: true,
      message: 'Impersonation session ended',
      redirectUrl: '/super-admin',
    });
  } catch (error) {
    console.error('Error ending impersonation:', error);
    return Response.json(
      { error: 'Failed to end impersonation' },
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/super-admin/impersonate - Check current impersonation status
// =============================================================================

export async function GET(): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const cookieStore = await cookies();
    const impersonateCookie = cookieStore.get(IMPERSONATE_COOKIE);

    if (!impersonateCookie?.value) {
      return Response.json({
        isImpersonating: false,
        session: null,
      });
    }

    try {
      const data = JSON.parse(impersonateCookie.value);
      return Response.json({
        isImpersonating: true,
        session: data,
      });
    } catch {
      return Response.json({
        isImpersonating: false,
        session: null,
      });
    }
  } catch (error) {
    console.error('Error checking impersonation status:', error);
    return Response.json(
      { error: 'Failed to check impersonation status' },
      { status: 500 },
    );
  }
}
