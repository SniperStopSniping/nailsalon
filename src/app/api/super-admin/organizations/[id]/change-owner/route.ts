import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const changeOwnerSchema = z.object({
  clerkUserId: z.string().min(1, 'Clerk user ID is required'),
  email: z.string().email('Valid email is required'),
});

// =============================================================================
// POST /api/super-admin/organizations/[id]/change-owner - Change salon owner
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const validated = changeOwnerSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { clerkUserId, email } = validated.data;

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

    // Store previous owner info for audit log
    const previousOwner = {
      email: existing.ownerEmail,
      clerkUserId: existing.ownerClerkUserId,
    };

    // Update the owner
    const [updated] = await db
      .update(salonSchema)
      .set({
        ownerClerkUserId: clerkUserId,
        ownerEmail: email,
      })
      .where(eq(salonSchema.id, id))
      .returning();

    // Log the action
    await logAuditAction(id, 'owner_changed', {
      previousValue: previousOwner,
      newValue: { email, clerkUserId },
      details: `Owner changed from ${previousOwner.email || 'none'} to ${email}`,
    });

    return Response.json({
      success: true,
      message: 'Owner changed successfully',
      salon: {
        id: updated!.id,
        name: updated!.name,
        ownerEmail: updated!.ownerEmail,
        ownerClerkUserId: updated!.ownerClerkUserId,
      },
      previousOwner,
    });
  } catch (error) {
    console.error('Error changing owner:', error);
    return Response.json(
      { error: 'Failed to change owner' },
      { status: 500 },
    );
  }
}
