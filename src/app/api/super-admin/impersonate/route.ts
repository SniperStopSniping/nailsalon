import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { clearAdminImpersonationSession, getAdminImpersonationSession, setAdminImpersonationSession } from '@/libs/adminImpersonation';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { getSuperAdminInfo, logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { requireSuperAdminTestTools } from '@/libs/superAdminTestTools.server';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const impersonateSchema = z.object({
  salonId: z.string().min(1, 'Salon ID is required'),
  testTool: z.boolean().optional(),
});

// =============================================================================
// POST /api/super-admin/impersonate - Start impersonation session
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  const baseGuard = await requireSuperAdmin();
  if (baseGuard) {
    return baseGuard;
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

    if (validated.data.testTool) {
      const testTools = await requireSuperAdminTestTools();
      if (!testTools.ok) {
        return testTools.response;
      }
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
    if (!adminInfo) {
      return Response.json(
        { error: 'Super admin session not found' },
        { status: 401 },
      );
    }

    const impersonateData = {
      salonId,
      salonSlug: salon.slug,
      salonName: salon.name,
      adminUserId: adminInfo.userId,
      adminName: adminInfo.name,
      startedAt: new Date().toISOString(),
    };

    await setAdminImpersonationSession(impersonateData);

    // Log the action
    await logAuditAction(salonId, 'updated', {
      details: 'Super-admin impersonation started',
    });
    await logAuditEvent({
      salonId,
      actorType: 'super_admin',
      actorId: adminInfo.userId,
      action: 'impersonation_started',
      entityType: 'salon',
      entityId: salonId,
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
    // Get current impersonation data for logging
    const impersonation = await getAdminImpersonationSession();
    if (impersonation?.salonId) {
      const adminInfo = await getSuperAdminInfo();
      await logAuditAction(impersonation.salonId, 'updated', {
        details: 'Super-admin impersonation ended',
      });
      await logAuditEvent({
        salonId: impersonation.salonId,
        actorType: 'super_admin',
        actorId: adminInfo?.userId ?? impersonation.adminUserId,
        action: 'impersonation_ended',
        entityType: 'salon',
        entityId: impersonation.salonId,
      });
    }

    await clearAdminImpersonationSession();

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
    const impersonation = await getAdminImpersonationSession();
    if (!impersonation) {
      return Response.json({
        isImpersonating: false,
        session: null,
      });
    }

    return Response.json({
      isImpersonating: true,
      session: impersonation,
    });
  } catch (error) {
    console.error('Error checking impersonation status:', error);
    return Response.json(
      { error: 'Failed to check impersonation status' },
      { status: 500 },
    );
  }
}
