import { eq, sql, gte } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/superAdmin';
import {
  salonSchema,
  technicianSchema,
  appointmentSchema,
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
  slug: z.string().min(1).optional(),
  plan: z.enum(SALON_PLANS).optional(),
  status: z.enum(SALON_STATUSES).optional(),
  maxLocations: z.coerce.number().min(1).optional(),
  isMultiLocationEnabled: z.boolean().optional(),
  ownerEmail: z.string().email().optional().nullable(),
  ownerClerkUserId: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
});

// =============================================================================
// GET /api/super-admin/organizations/[id] - Get salon detail
// =============================================================================

export async function GET(
  request: Request,
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

    // Get technician count
    const [techCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(technicianSchema)
      .where(eq(technicianSchema.salonId, id));

    // Get unique client count
    const [clientCount] = await db
      .select({ count: sql<number>`count(distinct ${appointmentSchema.clientPhone})` })
      .from(appointmentSchema)
      .where(eq(appointmentSchema.salonId, id));

    // Get appointments last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [apptCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(appointmentSchema)
      .where(eq(appointmentSchema.salonId, id));

    const [apptLast30d] = await db
      .select({ count: sql<number>`count(*)` })
      .from(appointmentSchema)
      .where(eq(appointmentSchema.salonId, id))
      .where(gte(appointmentSchema.createdAt, thirtyDaysAgo));

    return Response.json({
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        plan: (salon.plan || 'single_salon') as SalonPlan,
        status: (salon.status || 'active') as SalonStatus,
        maxLocations: salon.maxLocations ?? 1,
        isMultiLocationEnabled: salon.isMultiLocationEnabled ?? false,
        ownerEmail: salon.ownerEmail,
        ownerClerkUserId: salon.ownerClerkUserId,
        internalNotes: salon.internalNotes,
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

    // Business logic: if plan changes to multi_salon, ensure maxLocations >= 2
    if (updates.plan === 'multi_salon' && (updates.maxLocations ?? existing.maxLocations ?? 1) < 2) {
      updates.maxLocations = 2;
    }

    // Business logic: if plan changes to single_salon, ensure maxLocations is 1
    if (updates.plan === 'single_salon') {
      updates.maxLocations = 1;
      updates.isMultiLocationEnabled = false;
    }

    // Update salon
    const [updated] = await db
      .update(salonSchema)
      .set(updates)
      .where(eq(salonSchema.id, id))
      .returning();

    return Response.json({
      salon: {
        id: updated!.id,
        name: updated!.name,
        slug: updated!.slug,
        plan: (updated!.plan || 'single_salon') as SalonPlan,
        status: (updated!.status || 'active') as SalonStatus,
        maxLocations: updated!.maxLocations ?? 1,
        isMultiLocationEnabled: updated!.isMultiLocationEnabled ?? false,
        ownerEmail: updated!.ownerEmail,
        ownerClerkUserId: updated!.ownerClerkUserId,
        internalNotes: updated!.internalNotes,
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
