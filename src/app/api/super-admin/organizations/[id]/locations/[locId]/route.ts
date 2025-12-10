import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireSuperAdmin, logAuditAction } from '@/libs/superAdmin';
import { salonLocationSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const dayHoursSchema = z.object({ open: z.string(), close: z.string() }).nullable();

const businessHoursSchema = z.object({
  monday: dayHoursSchema,
  tuesday: dayHoursSchema,
  wednesday: dayHoursSchema,
  thursday: dayHoursSchema,
  friday: dayHoursSchema,
  saturday: dayHoursSchema,
  sunday: dayHoursSchema,
}).optional().nullable();

const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  businessHours: businessHoursSchema,
});

// =============================================================================
// GET /api/super-admin/organizations/[id]/locations/[locId] - Get single location
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; locId: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id, locId } = await params;

    // Get location
    const [location] = await db
      .select()
      .from(salonLocationSchema)
      .where(
        and(
          eq(salonLocationSchema.salonId, id),
          eq(salonLocationSchema.id, locId)
        )
      )
      .limit(1);

    if (!location) {
      return Response.json(
        { error: 'Location not found' },
        { status: 404 },
      );
    }

    return Response.json({
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        zipCode: location.zipCode,
        phone: location.phone,
        email: location.email,
        isPrimary: location.isPrimary,
        isActive: location.isActive,
        businessHours: location.businessHours,
        createdAt: location.createdAt.toISOString(),
        updatedAt: location.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching location:', error);
    return Response.json(
      { error: 'Failed to fetch location' },
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/super-admin/organizations/[id]/locations/[locId] - Update location
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; locId: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id, locId } = await params;
    const body = await request.json();

    const validated = updateLocationSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    // Check location exists
    const [existing] = await db
      .select()
      .from(salonLocationSchema)
      .where(
        and(
          eq(salonLocationSchema.salonId, id),
          eq(salonLocationSchema.id, locId)
        )
      )
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: 'Location not found' },
        { status: 404 },
      );
    }

    const validatedData = validated.data;

    // If setting as primary, unset other primaries
    if (validatedData.isPrimary) {
      await db
        .update(salonLocationSchema)
        .set({ isPrimary: false })
        .where(eq(salonLocationSchema.salonId, id));
    }

    // Build update object, filtering out undefined values
    const updates: Record<string, unknown> = {};
    if (validatedData.name !== undefined) updates.name = validatedData.name;
    if (validatedData.address !== undefined) updates.address = validatedData.address;
    if (validatedData.city !== undefined) updates.city = validatedData.city;
    if (validatedData.state !== undefined) updates.state = validatedData.state;
    if (validatedData.zipCode !== undefined) updates.zipCode = validatedData.zipCode;
    if (validatedData.phone !== undefined) updates.phone = validatedData.phone;
    if (validatedData.email !== undefined) updates.email = validatedData.email;
    if (validatedData.isPrimary !== undefined) updates.isPrimary = validatedData.isPrimary;
    if (validatedData.isActive !== undefined) updates.isActive = validatedData.isActive;
    if (validatedData.businessHours !== undefined) updates.businessHours = validatedData.businessHours;

    // Update location
    const [updated] = await db
      .update(salonLocationSchema)
      .set(updates)
      .where(eq(salonLocationSchema.id, locId))
      .returning();

    // Log the action
    await logAuditAction(id, 'location_updated', {
      previousValue: { name: existing.name },
      newValue: { name: updated!.name },
      details: `Updated location: ${updated!.name}`,
    });

    return Response.json({
      success: true,
      location: {
        id: updated!.id,
        name: updated!.name,
        address: updated!.address,
        city: updated!.city,
        state: updated!.state,
        zipCode: updated!.zipCode,
        phone: updated!.phone,
        email: updated!.email,
        isPrimary: updated!.isPrimary,
        isActive: updated!.isActive,
        businessHours: updated!.businessHours,
        createdAt: updated!.createdAt.toISOString(),
        updatedAt: updated!.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating location:', error);
    return Response.json(
      { error: 'Failed to update location' },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/super-admin/organizations/[id]/locations/[locId] - Delete location
// =============================================================================

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; locId: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id, locId } = await params;

    // Check location exists
    const [existing] = await db
      .select()
      .from(salonLocationSchema)
      .where(
        and(
          eq(salonLocationSchema.salonId, id),
          eq(salonLocationSchema.id, locId)
        )
      )
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: 'Location not found' },
        { status: 404 },
      );
    }

    // Don't allow deleting primary location if there are other locations
    if (existing.isPrimary) {
      const otherLocations = await db
        .select({ id: salonLocationSchema.id })
        .from(salonLocationSchema)
        .where(
          and(
            eq(salonLocationSchema.salonId, id),
            eq(salonLocationSchema.id, locId)
          )
        );

      if (otherLocations.length > 1) {
        return Response.json(
          { error: 'Cannot delete primary location. Set another location as primary first.' },
          { status: 400 },
        );
      }
    }

    // Delete location
    await db
      .delete(salonLocationSchema)
      .where(eq(salonLocationSchema.id, locId));

    // Log the action
    await logAuditAction(id, 'location_deleted', {
      previousValue: { name: existing.name, id: existing.id },
      details: `Deleted location: ${existing.name}`,
    });

    return Response.json({
      success: true,
      message: 'Location deleted',
      deletedId: locId,
    });
  } catch (error) {
    console.error('Error deleting location:', error);
    return Response.json(
      { error: 'Failed to delete location' },
      { status: 500 },
    );
  }
}
