import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { isSuperAdmin } from '@/libs/super-admin';
import {
  appointmentSchema,
  clientPreferencesSchema,
  ORG_PLANS,
  ORG_STATUSES,
  type OrgPlan,
  type OrgStatus,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateSalonSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  ownerClerkUserId: z.string().nullable().optional(),
  plan: z.enum(ORG_PLANS).optional(),
  status: z.enum(ORG_STATUSES).optional(),
  maxLocations: z.number().min(1).optional(),
  maxTechnicians: z.number().min(1).optional(),
  isMultiLocationEnabled: z.boolean().optional(),
  internalNotes: z.string().nullable().optional(),
});

// =============================================================================
// HELPER: Verify Super Admin
// =============================================================================

async function verifySuperAdmin(): Promise<{ authorized: false; response: Response } | { authorized: true; userEmail: string }> {
  const { userId } = await auth();

  if (!userId) {
    return {
      authorized: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const userEmail = user.emailAddresses[0]?.emailAddress ?? '';

  if (!isSuperAdmin(userEmail)) {
    return {
      authorized: false,
      response: Response.json({ error: 'Forbidden - Super Admin access required' }, { status: 403 }),
    };
  }

  return { authorized: true, userEmail };
}

// =============================================================================
// GET /api/super-admin/organizations/[id] - Get salon details
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const authResult = await verifySuperAdmin();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const { id } = await params;

    // Get the salon
    const salons = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    const salon = salons[0];
    if (!salon) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Get technician count
    const techCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(technicianSchema)
      .where(and(
        eq(technicianSchema.salonId, id),
        eq(technicianSchema.isActive, true),
      ));
    const techniciansCount = Number(techCountResult[0]?.count ?? 0);

    // Get unique client count
    const clientCountResult = await db
      .select({ count: sql<number>`count(distinct ${clientPreferencesSchema.normalizedClientPhone})` })
      .from(clientPreferencesSchema)
      .where(eq(clientPreferencesSchema.salonId, id));
    const clientsCount = Number(clientCountResult[0]?.count ?? 0);

    // Get appointments last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const apptCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, id),
        gte(appointmentSchema.createdAt, thirtyDaysAgo),
      ));
    const appointmentsLast30Days = Number(apptCountResult[0]?.count ?? 0);

    // Get owner info from Clerk
    let owner: { id: string; email: string; name: string | null } | null = null;
    if (salon.ownerClerkUserId) {
      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(salon.ownerClerkUserId);
        owner = {
          id: user.id,
          email: user.emailAddresses[0]?.emailAddress ?? '',
          name: user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
        };
      } catch {
        // User might not exist
      }
    }

    return Response.json({
      data: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        plan: salon.plan as OrgPlan,
        status: salon.status as OrgStatus,
        maxLocations: salon.maxLocations ?? 1,
        maxTechnicians: salon.maxTechnicians ?? 10,
        isMultiLocationEnabled: salon.isMultiLocationEnabled ?? false,
        internalNotes: salon.internalNotes,
        createdAt: salon.createdAt.toISOString(),
        owner,
        locations: [
          // For now, single location per salon
          { id: salon.id, name: salon.name },
        ],
        techniciansCount,
        clientsCount,
        appointmentsLast30Days,
      },
    });
  } catch (error) {
    console.error('Error getting organization:', error);
    return Response.json(
      { error: 'Failed to get organization' },
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
  try {
    const authResult = await verifySuperAdmin();
    if (!authResult.authorized) {
      return authResult.response;
    }

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
    const existing = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (existing.length === 0) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    const updates = validated.data;

    // If changing slug, check it's not taken
    if (updates.slug && updates.slug !== existing[0]!.slug) {
      const slugExists = await db
        .select()
        .from(salonSchema)
        .where(eq(salonSchema.slug, updates.slug))
        .limit(1);

      if (slugExists.length > 0) {
        return Response.json(
          { error: 'A salon with this slug already exists' },
          { status: 409 },
        );
      }
    }

    // If changing owner, verify they exist
    if (updates.ownerClerkUserId !== undefined && updates.ownerClerkUserId !== null) {
      try {
        const clerk = await clerkClient();
        await clerk.users.getUser(updates.ownerClerkUserId);
      } catch {
        return Response.json(
          { error: 'Owner user not found' },
          { status: 404 },
        );
      }
    }

    // Apply plan logic: if upgrading to multi_salon, ensure maxLocations >= 2
    if (updates.plan === 'multi_salon' || updates.plan === 'enterprise') {
      const currentMaxLocations = updates.maxLocations ?? existing[0]!.maxLocations ?? 1;
      if (currentMaxLocations < 2) {
        updates.maxLocations = 2;
      }
    }

    // If downgrading to single_salon, ensure maxLocations is at least 1
    if (updates.plan === 'single_salon' || updates.plan === 'free') {
      updates.maxLocations = 1;
      updates.isMultiLocationEnabled = false;
    }

    // Update the salon
    const [updated] = await db
      .update(salonSchema)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(salonSchema.id, id))
      .returning();

    // Get owner info for response
    let owner: { id: string; email: string; name: string | null } | null = null;
    if (updated!.ownerClerkUserId) {
      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(updated!.ownerClerkUserId);
        owner = {
          id: user.id,
          email: user.emailAddresses[0]?.emailAddress ?? '',
          name: user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
        };
      } catch {
        // User might not exist
      }
    }

    // Get counts for response
    const techCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(technicianSchema)
      .where(and(
        eq(technicianSchema.salonId, id),
        eq(technicianSchema.isActive, true),
      ));
    const techniciansCount = Number(techCountResult[0]?.count ?? 0);

    const clientCountResult = await db
      .select({ count: sql<number>`count(distinct ${clientPreferencesSchema.normalizedClientPhone})` })
      .from(clientPreferencesSchema)
      .where(eq(clientPreferencesSchema.salonId, id));
    const clientsCount = Number(clientCountResult[0]?.count ?? 0);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const apptCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, id),
        gte(appointmentSchema.createdAt, thirtyDaysAgo),
      ));
    const appointmentsLast30Days = Number(apptCountResult[0]?.count ?? 0);

    return Response.json({
      data: {
        id: updated!.id,
        name: updated!.name,
        slug: updated!.slug,
        plan: updated!.plan as OrgPlan,
        status: updated!.status as OrgStatus,
        maxLocations: updated!.maxLocations ?? 1,
        maxTechnicians: updated!.maxTechnicians ?? 10,
        isMultiLocationEnabled: updated!.isMultiLocationEnabled ?? false,
        internalNotes: updated!.internalNotes,
        createdAt: updated!.createdAt.toISOString(),
        owner,
        locations: [{ id: updated!.id, name: updated!.name }],
        techniciansCount,
        clientsCount,
        appointmentsLast30Days,
      },
    });
  } catch (error) {
    console.error('Error updating organization:', error);
    return Response.json(
      { error: 'Failed to update organization' },
      { status: 500 },
    );
  }
}
