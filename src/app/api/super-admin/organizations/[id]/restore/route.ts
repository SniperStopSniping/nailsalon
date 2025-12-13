import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema, type SalonStatus } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// POST /api/super-admin/organizations/[id]/restore - Restore a soft-deleted salon
// =============================================================================

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const { id } = await params;

    // Check salon exists
    const [existing] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Check if actually deleted
    if (!existing.deletedAt) {
      return Response.json(
        { error: 'Salon is not deleted' },
        { status: 400 },
      );
    }

    // Restore the salon
    const [updated] = await db
      .update(salonSchema)
      .set({
        deletedAt: null,
        deletedBy: null,
        status: 'active',
      })
      .where(eq(salonSchema.id, id))
      .returning();

    // Log the action
    await logAuditAction(id, 'restored', {
      previousValue: existing.status,
      newValue: 'active',
      details: 'Salon restored from soft delete',
    });

    return Response.json({
      success: true,
      message: 'Salon restored successfully',
      salon: {
        id: updated!.id,
        name: updated!.name,
        status: updated!.status as SalonStatus,
        deletedAt: null,
      },
    });
  } catch (error) {
    console.error('Error restoring salon:', error);
    return Response.json(
      { error: 'Failed to restore salon' },
      { status: 500 },
    );
  }
}
