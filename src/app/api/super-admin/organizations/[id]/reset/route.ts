import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import {
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  clientPreferencesSchema,
  referralSchema,
  rewardSchema,
  salonSchema,
  technicianBlockedSlotSchema,
  technicianSchema,
  technicianServicesSchema,
  technicianTimeOffSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const resetDataSchema = z.object({
  appointments: z.boolean().optional(),
  clients: z.boolean().optional(), // Client preferences
  staff: z.boolean().optional(), // Technicians and availability
  rewards: z.boolean().optional(), // Rewards and referrals
  all: z.boolean().optional(),
});

// =============================================================================
// POST /api/super-admin/organizations/[id]/reset - Reset salon data
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

    const validated = resetDataSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { appointments, clients, staff, rewards, all } = validated.data;

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

    const resetted: string[] = [];

    // Reset all or specific categories
    const resetAppointments = all || appointments;
    const resetClients = all || clients;
    const resetStaff = all || staff;
    const resetRewards = all || rewards;

    // 1. Reset appointments
    if (resetAppointments) {
      // Get all appointment IDs first
      const appointmentRecords = await db
        .select({ id: appointmentSchema.id })
        .from(appointmentSchema)
        .where(eq(appointmentSchema.salonId, id));

      const appointmentIds = appointmentRecords.map(a => a.id);

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

      resetted.push(`appointments (${appointmentIds.length})`);
    }

    // 2. Reset client preferences
    if (resetClients) {
      const result = await db
        .delete(clientPreferencesSchema)
        .where(eq(clientPreferencesSchema.salonId, id))
        .returning();

      resetted.push(`client preferences (${result.length})`);
    }

    // 3. Reset staff (technicians and their availability)
    if (resetStaff) {
      // Get all technician IDs first
      const technicianRecords = await db
        .select({ id: technicianSchema.id })
        .from(technicianSchema)
        .where(eq(technicianSchema.salonId, id));

      const technicianIds = technicianRecords.map(t => t.id);

      if (technicianIds.length > 0) {
        // Delete technician services
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

      resetted.push(`staff (${technicianIds.length})`);
    }

    // 4. Reset rewards and referrals
    if (resetRewards) {
      const rewardsResult = await db
        .delete(rewardSchema)
        .where(eq(rewardSchema.salonId, id))
        .returning();

      const referralsResult = await db
        .delete(referralSchema)
        .where(eq(referralSchema.salonId, id))
        .returning();

      resetted.push(`rewards (${rewardsResult.length}), referrals (${referralsResult.length})`);
    }

    // Log the action
    await logAuditAction(id, 'data_reset', {
      details: `Reset: ${resetted.join(', ')}`,
      newValue: { appointments: resetAppointments, clients: resetClients, staff: resetStaff, rewards: resetRewards },
    });

    return Response.json({
      success: true,
      message: 'Data reset successfully',
      resetted,
    });
  } catch (error) {
    console.error('Error resetting salon data:', error);
    return Response.json(
      { error: 'Failed to reset salon data' },
      { status: 500 },
    );
  }
}
