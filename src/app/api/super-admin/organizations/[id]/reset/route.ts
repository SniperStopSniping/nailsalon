import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import type { PurgeGroup, PurgeTx } from '@/libs/salonPurge';
import { purgeSalonGroups, SalonPurgeBlockedError } from '@/libs/salonPurge';
import { getSuperAdminInfo, logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { salonSchema } from '@/models/Schema';

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

    // Reset all or specific categories.
    // Note 'clients' maps to preferences only — the modal offers "Client
    // Preferences", and a reset must never destroy client records (loyalty
    // points, lifetime spend). Only a full salon purge removes those.
    const resetAppointments = all || appointments;
    const resetClients = all || clients;
    const resetStaff = all || staff;
    const resetRewards = all || rewards;

    const groups: PurgeGroup[] = [
      ...(resetAppointments ? (['appointments'] as const) : []),
      ...(resetClients ? (['clients'] as const) : []),
      ...(resetStaff ? (['staff'] as const) : []),
      ...(resetRewards ? (['rewards'] as const) : []),
    ];

    if (groups.length === 0) {
      return Response.json(
        { error: 'Select at least one category to reset' },
        { status: 400 },
      );
    }

    // One transaction: a partial reset is what destroyed 104 appointments'
    // service line items before this route delegated to the shared purge plan.
    const result = await db.transaction(async tx =>
      purgeSalonGroups(tx as unknown as PurgeTx, id, groups));

    const resetted = Object.entries(result.counts).map(([table, n]) => `${table} (${n})`);
    const adminInfo = await getSuperAdminInfo();

    // Per-salon trail for the salon's own activity log. Best-effort: the reset
    // is already committed, so a failed audit insert must not turn a successful
    // reset into a 500 the operator would read as "nothing happened".
    try {
      await logAuditAction(id, 'data_reset', {
        details: `Reset: ${resetted.join(', ') || 'nothing to remove'}`,
        newValue: { appointments: resetAppointments, clients: resetClients, staff: resetStaff, rewards: resetRewards },
      });
    } catch (auditError) {
      console.error('[reset] Failed to write salon audit entry:', auditError);
    }

    // ...plus a platform-level record that survives a later salon deletion.
    await logAuditEvent({
      salonId: null,
      actorType: 'super_admin',
      actorId: adminInfo?.userId ?? null,
      action: 'salon_data_reset',
      entityType: 'salon',
      entityId: id,
      metadata: { name: existing.name, slug: existing.slug, groups, rowsDeleted: result.totalRows, tables: result.counts },
    });

    return Response.json({
      success: true,
      message: 'Data reset successfully',
      resetted,
      rowsDeleted: result.totalRows,
      tables: result.counts,
    });
  } catch (error) {
    if (error instanceof SalonPurgeBlockedError) {
      return Response.json(
        { error: error.message, blockers: error.blockers },
        { status: 409 },
      );
    }

    const pgError = error as { code?: string; constraint?: string; table?: string; detail?: string };
    if (pgError?.code === '23503') {
      return Response.json(
        {
          error: 'Cannot reset salon data: related records still reference it',
          constraint: pgError.constraint,
          table: pgError.table,
          detail: pgError.detail,
        },
        { status: 409 },
      );
    }

    console.error('Error resetting salon data:', error);
    return Response.json(
      {
        error: 'Failed to reset salon data',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
