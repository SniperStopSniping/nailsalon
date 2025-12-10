import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireSuperAdmin, getSuperAdminInfo, logAuditAction } from '@/libs/superAdmin';
import {
  salonSchema,
  technicianSchema,
  appointmentSchema,
  appointmentServicesSchema,
  appointmentPhotoSchema,
  serviceSchema,
  technicianServicesSchema,
  technicianTimeOffSchema,
  technicianBlockedSlotSchema,
  referralSchema,
  rewardSchema,
  clientPreferencesSchema,
  salonPageAppearanceSchema,
  salonLocationSchema,
  SALON_PLANS,
  SALON_STATUSES,
  type SalonPlan,
  type SalonStatus,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateSalonSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only').optional(),
  plan: z.enum(SALON_PLANS).optional(),
  status: z.enum(SALON_STATUSES).optional(),
  maxLocations: z.coerce.number().min(1).optional(),
  isMultiLocationEnabled: z.boolean().optional(),
  ownerEmail: z.string().email().optional().nullable(),
  ownerClerkUserId: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  // Feature toggles
  onlineBookingEnabled: z.boolean().optional(),
  smsRemindersEnabled: z.boolean().optional(),
  rewardsEnabled: z.boolean().optional(),
  profilePageEnabled: z.boolean().optional(),
});

// =============================================================================
// GET /api/super-admin/organizations/[id] - Get salon detail
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id } = await params;

    // Get salon
    const [salon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Get technician count (active only)
    const [techCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.salonId, id),
          eq(technicianSchema.isActive, true)
        )
      );

    // Get unique client count (from clientPreferences which tracks registered clients)
    const [clientCount] = await db
      .select({ count: sql<number>`count(distinct ${clientPreferencesSchema.normalizedClientPhone})` })
      .from(clientPreferencesSchema)
      .where(eq(clientPreferencesSchema.salonId, id));

    // Get appointments last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [apptLast30d] = await db
      .select({ count: sql<number>`count(*)` })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, id),
          gte(appointmentSchema.createdAt, thirtyDaysAgo)
        )
      );

    return Response.json({
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        plan: (salon.plan || 'single_salon') as SalonPlan,
        status: (salon.status || 'active') as SalonStatus,
        maxLocations: salon.maxLocations ?? 1,
        isMultiLocationEnabled: salon.isMultiLocationEnabled ?? false,
        // Feature toggles
        onlineBookingEnabled: salon.onlineBookingEnabled ?? true,
        smsRemindersEnabled: salon.smsRemindersEnabled ?? true,
        rewardsEnabled: salon.rewardsEnabled ?? true,
        profilePageEnabled: salon.profilePageEnabled ?? true,
        // Owner & metadata
        ownerEmail: salon.ownerEmail,
        ownerClerkUserId: salon.ownerClerkUserId,
        internalNotes: salon.internalNotes,
        deletedAt: salon.deletedAt?.toISOString() ?? null,
        createdAt: salon.createdAt.toISOString(),
        updatedAt: salon.updatedAt.toISOString(),
      },
      metrics: {
        locationsCount: 1, // For now, assume 1 location per salon
        techsCount: Number(techCount?.count ?? 0),
        clientsCount: Number(clientCount?.count ?? 0),
        appointmentsLast30d: Number(apptLast30d?.count ?? 0),
      },
    });
  } catch (error) {
    console.error('Error fetching salon:', error);
    return Response.json(
      { error: 'Failed to fetch salon' },
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/super-admin/organizations/[id] - Update salon
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id } = await params;
    const body = await request.json();

    const validated = updateSalonSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

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

    const updates = validated.data;

    // If slug is being changed, check for duplicates
    if (updates.slug && updates.slug !== existing.slug) {
      const [duplicateSlug] = await db
        .select()
        .from(salonSchema)
        .where(eq(salonSchema.slug, updates.slug))
        .limit(1);

      if (duplicateSlug) {
        return Response.json(
          { error: 'A salon with this slug already exists' },
          { status: 409 },
        );
      }
    }

    // Determine the effective plan after update (use update value if provided, else existing)
    const effectivePlan = updates.plan ?? existing.plan ?? 'single_salon';

    // Business logic: single_salon and free plans must have maxLocations=1
    if (effectivePlan === 'single_salon' || effectivePlan === 'free') {
      updates.maxLocations = 1;
      updates.isMultiLocationEnabled = false;
    }

    // Business logic: multi_salon plan requires maxLocations >= 2
    if (effectivePlan === 'multi_salon' && (updates.maxLocations ?? existing.maxLocations ?? 1) < 2) {
      updates.maxLocations = 2;
    }

    // Update salon
    const [updated] = await db
      .update(salonSchema)
      .set(updates)
      .where(eq(salonSchema.id, id))
      .returning();

    // Log the update
    await logAuditAction(id, 'updated', {
      details: `Updated fields: ${Object.keys(updates).join(', ')}`,
    });

    return Response.json({
      salon: {
        id: updated!.id,
        name: updated!.name,
        slug: updated!.slug,
        plan: (updated!.plan || 'single_salon') as SalonPlan,
        status: (updated!.status || 'active') as SalonStatus,
        maxLocations: updated!.maxLocations ?? 1,
        isMultiLocationEnabled: updated!.isMultiLocationEnabled ?? false,
        // Feature toggles
        onlineBookingEnabled: updated!.onlineBookingEnabled ?? true,
        smsRemindersEnabled: updated!.smsRemindersEnabled ?? true,
        rewardsEnabled: updated!.rewardsEnabled ?? true,
        profilePageEnabled: updated!.profilePageEnabled ?? true,
        // Owner & metadata
        ownerEmail: updated!.ownerEmail,
        ownerClerkUserId: updated!.ownerClerkUserId,
        internalNotes: updated!.internalNotes,
        deletedAt: updated!.deletedAt?.toISOString() ?? null,
        createdAt: updated!.createdAt.toISOString(),
        updatedAt: updated!.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating salon:', error);
    return Response.json(
      { error: 'Failed to update salon' },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/super-admin/organizations/[id] - Delete salon (soft or hard)
// =============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const hardDelete = searchParams.get('hard') === 'true';

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

    const adminInfo = await getSuperAdminInfo();

    if (hardDelete) {
      // HARD DELETE: Permanently remove all data
      // Order matters due to foreign key constraints
      
      // 1. Delete appointment-related data
      const appointments = await db
        .select({ id: appointmentSchema.id })
        .from(appointmentSchema)
        .where(eq(appointmentSchema.salonId, id));
      
      const appointmentIds = appointments.map(a => a.id);
      
      if (appointmentIds.length > 0) {
        // Delete appointment services
        for (const apptId of appointmentIds) {
          await db
            .delete(appointmentServicesSchema)
            .where(eq(appointmentServicesSchema.appointmentId, apptId));
        }
        
        // Delete appointment photos
        await db
          .delete(appointmentPhotoSchema)
          .where(eq(appointmentPhotoSchema.salonId, id));
        
        // Delete appointments
        await db
          .delete(appointmentSchema)
          .where(eq(appointmentSchema.salonId, id));
      }
      
      // 2. Delete rewards
      await db
        .delete(rewardSchema)
        .where(eq(rewardSchema.salonId, id));
      
      // 3. Delete referrals
      await db
        .delete(referralSchema)
        .where(eq(referralSchema.salonId, id));
      
      // 4. Delete client preferences
      await db
        .delete(clientPreferencesSchema)
        .where(eq(clientPreferencesSchema.salonId, id));
      
      // 5. Delete technician-related data
      const technicians = await db
        .select({ id: technicianSchema.id })
        .from(technicianSchema)
        .where(eq(technicianSchema.salonId, id));
      
      const technicianIds = technicians.map(t => t.id);
      
      if (technicianIds.length > 0) {
        for (const techId of technicianIds) {
          await db
            .delete(technicianServicesSchema)
            .where(eq(technicianServicesSchema.technicianId, techId));
          
          await db
            .delete(technicianTimeOffSchema)
            .where(eq(technicianTimeOffSchema.technicianId, techId));
          
          await db
            .delete(technicianBlockedSlotSchema)
            .where(eq(technicianBlockedSlotSchema.technicianId, techId));
        }
        
        // Delete technicians
        await db
          .delete(technicianSchema)
          .where(eq(technicianSchema.salonId, id));
      }
      
      // 6. Delete services
      await db
        .delete(serviceSchema)
        .where(eq(serviceSchema.salonId, id));
      
      // 7. Delete locations
      await db
        .delete(salonLocationSchema)
        .where(eq(salonLocationSchema.salonId, id));
      
      // 8. Delete page appearances
      await db
        .delete(salonPageAppearanceSchema)
        .where(eq(salonPageAppearanceSchema.salonId, id));
      
      // 9. Finally delete the salon (audit logs will cascade)
      await db
        .delete(salonSchema)
        .where(eq(salonSchema.id, id));
      
      return Response.json({
        success: true,
        message: 'Salon permanently deleted',
        deletedId: id,
      });
    } else {
      // SOFT DELETE: Mark as deleted but keep data
      const [updated] = await db
        .update(salonSchema)
        .set({
          deletedAt: new Date(),
          deletedBy: adminInfo?.userId || 'unknown',
          status: 'cancelled',
        })
        .where(eq(salonSchema.id, id))
        .returning();
      
      // Log the action
      await logAuditAction(id, 'deleted', {
        details: 'Soft deleted (data preserved)',
      });
      
      return Response.json({
        success: true,
        message: 'Salon soft deleted',
        salon: {
          id: updated!.id,
          name: updated!.name,
          deletedAt: updated!.deletedAt?.toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('Error deleting salon:', error);
    return Response.json(
      { error: 'Failed to delete salon' },
      { status: 500 },
    );
  }
}
