import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
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

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(ORG_STATUSES).optional(),
  plan: z.enum(ORG_PLANS).optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

const createSalonSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  ownerClerkUserId: z.string().optional(),
  plan: z.enum(ORG_PLANS).optional().default('single_salon'),
  maxLocations: z.number().min(1).optional().default(1),
  maxTechnicians: z.number().min(1).optional().default(10),
  isMultiLocationEnabled: z.boolean().optional().default(false),
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

  // Get user email from Clerk
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
// GET /api/super-admin/organizations - List all salons
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const authResult = await verifySuperAdmin();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validated = listQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid query parameters', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { search, status, plan, page, limit } = validated.data;

    // Build conditions
    const conditions = [];

    if (status) {
      conditions.push(eq(salonSchema.status, status));
    }

    if (plan) {
      conditions.push(eq(salonSchema.plan, plan));
    }

    if (search) {
      conditions.push(
        or(
          ilike(salonSchema.name, `%${search}%`),
          ilike(salonSchema.slug, `%${search}%`),
          ilike(salonSchema.email, `%${search}%`),
        ),
      );
    }

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(salonSchema)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const totalCount = Number(countResult[0]?.count ?? 0);

    // Get salons with pagination
    const offset = (page - 1) * limit;
    const salons = await db
      .select()
      .from(salonSchema)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(salonSchema.createdAt))
      .limit(limit)
      .offset(offset);

    // Get counts for each salon
    const salonIds = salons.map(s => s.id);

    // Get technician counts
    const techCounts = salonIds.length > 0
      ? await db
        .select({
          salonId: technicianSchema.salonId,
          count: sql<number>`count(*)`,
        })
        .from(technicianSchema)
        .where(and(
          sql`${technicianSchema.salonId} IN ${salonIds}`,
          eq(technicianSchema.isActive, true),
        ))
        .groupBy(technicianSchema.salonId)
      : [];

    // Get unique client counts (from clientPreferences which tracks clients per salon)
    const clientCounts = salonIds.length > 0
      ? await db
        .select({
          salonId: clientPreferencesSchema.salonId,
          count: sql<number>`count(distinct ${clientPreferencesSchema.normalizedClientPhone})`,
        })
        .from(clientPreferencesSchema)
        .where(sql`${clientPreferencesSchema.salonId} IN ${salonIds}`)
        .groupBy(clientPreferencesSchema.salonId)
      : [];

    // Get appointments last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const apptCounts = salonIds.length > 0
      ? await db
        .select({
          salonId: appointmentSchema.salonId,
          count: sql<number>`count(*)`,
        })
        .from(appointmentSchema)
        .where(and(
          sql`${appointmentSchema.salonId} IN ${salonIds}`,
          gte(appointmentSchema.createdAt, thirtyDaysAgo),
        ))
        .groupBy(appointmentSchema.salonId)
      : [];

    // Build count maps
    const techCountMap = new Map(techCounts.map(t => [t.salonId, Number(t.count)]));
    const clientCountMap = new Map(clientCounts.map(c => [c.salonId, Number(c.count)]));
    const apptCountMap = new Map(apptCounts.map(a => [a.salonId, Number(a.count)]));

    // Get owner emails from Clerk
    const ownerIds = [...new Set(salons.map(s => s.ownerClerkUserId).filter(Boolean))] as string[];
    const ownerEmailMap = new Map<string, string>();

    if (ownerIds.length > 0) {
      const clerk = await clerkClient();
      for (const ownerId of ownerIds) {
        try {
          const user = await clerk.users.getUser(ownerId);
          const email = user.emailAddresses[0]?.emailAddress;
          if (email) {
            ownerEmailMap.set(ownerId, email);
          }
        } catch {
          // User might not exist anymore
        }
      }
    }

    // Format response
    const data = salons.map(salon => ({
      id: salon.id,
      name: salon.name,
      slug: salon.slug,
      plan: salon.plan as OrgPlan,
      status: salon.status as OrgStatus,
      maxLocations: salon.maxLocations ?? 1,
      maxTechnicians: salon.maxTechnicians ?? 10,
      isMultiLocationEnabled: salon.isMultiLocationEnabled ?? false,
      createdAt: salon.createdAt.toISOString(),
      ownerEmail: salon.ownerClerkUserId ? ownerEmailMap.get(salon.ownerClerkUserId) ?? null : null,
      ownerClerkUserId: salon.ownerClerkUserId,
      locationsCount: 1, // For now, single location per salon until multi-location is implemented
      techniciansCount: techCountMap.get(salon.id) ?? 0,
      clientsCount: clientCountMap.get(salon.id) ?? 0,
      appointmentsLast30Days: apptCountMap.get(salon.id) ?? 0,
    }));

    return Response.json({
      data,
      page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
    });
  } catch (error) {
    console.error('Error listing organizations:', error);
    return Response.json(
      { error: 'Failed to list organizations' },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/super-admin/organizations - Create a new salon
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const authResult = await verifySuperAdmin();
    if (!authResult.authorized) {
      return authResult.response;
    }

    const body = await request.json();
    const validated = createSalonSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { name, slug, ownerClerkUserId, plan, maxLocations, maxTechnicians, isMultiLocationEnabled } = validated.data;

    // Check if slug already exists
    const existingSlug = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.slug, slug))
      .limit(1);

    if (existingSlug.length > 0) {
      return Response.json(
        { error: 'A salon with this slug already exists' },
        { status: 409 },
      );
    }

    // Verify owner exists if provided
    let ownerEmail: string | null = null;
    if (ownerClerkUserId) {
      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(ownerClerkUserId);
        ownerEmail = user.emailAddresses[0]?.emailAddress ?? null;
      } catch {
        return Response.json(
          { error: 'Owner user not found' },
          { status: 404 },
        );
      }
    }

    // Create the salon
    const salonId = `salon_${nanoid()}`;
    const [newSalon] = await db
      .insert(salonSchema)
      .values({
        id: salonId,
        name,
        slug,
        ownerClerkUserId: ownerClerkUserId ?? null,
        plan,
        maxLocations,
        maxTechnicians,
        isMultiLocationEnabled,
        status: 'active',
        isActive: true,
      })
      .returning();

    return Response.json({
      data: {
        id: newSalon!.id,
        name: newSalon!.name,
        slug: newSalon!.slug,
        plan: newSalon!.plan as OrgPlan,
        status: newSalon!.status as OrgStatus,
        maxLocations: newSalon!.maxLocations ?? 1,
        maxTechnicians: newSalon!.maxTechnicians ?? 10,
        isMultiLocationEnabled: newSalon!.isMultiLocationEnabled ?? false,
        createdAt: newSalon!.createdAt.toISOString(),
        ownerEmail,
        ownerClerkUserId: newSalon!.ownerClerkUserId,
        locationsCount: 1,
        techniciansCount: 0,
        clientsCount: 0,
        appointmentsLast30Days: 0,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating organization:', error);
    return Response.json(
      { error: 'Failed to create organization' },
      { status: 500 },
    );
  }
}
