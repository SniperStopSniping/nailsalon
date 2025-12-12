import { eq, ilike, or, sql, and, gte, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/superAdmin';
import {
  salonSchema,
  technicianSchema,
  appointmentSchema,
  clientPreferencesSchema,
  adminSalonMembershipSchema,
  adminUserSchema,
  adminInviteSchema,
  SALON_PLANS,
  SALON_STATUSES,
  type SalonPlan,
  type SalonStatus,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const listQuerySchema = z.object({
  q: z.string().optional(),
  plan: z.enum(SALON_PLANS).optional(),
  status: z.enum(SALON_STATUSES).optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(100).optional().default(20),
});

const createSalonSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  ownerEmail: z.string().email().optional().nullable(),
  plan: z.enum(SALON_PLANS).optional().default('single_salon'),
  maxLocations: z.coerce.number().min(1).optional().default(1),
  isMultiLocationEnabled: z.boolean().optional().default(false),
});

// =============================================================================
// GET /api/super-admin/organizations - List all salons
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validated = listQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid query parameters', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { q, plan, status, page, pageSize } = validated.data;

    // Build conditions
    const conditions = [];

    if (q && q.trim()) {
      conditions.push(
        or(
          ilike(salonSchema.name, `%${q}%`),
          ilike(salonSchema.slug, `%${q}%`),
          ilike(salonSchema.ownerEmail, `%${q}%`),
        ),
      );
    }

    if (plan) {
      conditions.push(eq(salonSchema.plan, plan));
    }

    if (status) {
      conditions.push(eq(salonSchema.status, status));
    }

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(salonSchema)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const total = Number(countResult[0]?.count ?? 0);

    // Get salons with pagination
    const offset = (page - 1) * pageSize;
    const salons = await db
      .select()
      .from(salonSchema)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(salonSchema.createdAt)
      .limit(pageSize)
      .offset(offset);

    // Get counts for each salon
    const salonIds = salons.map((s) => s.id);

    // Get technician counts (active only, filtered by salonIds)
    const techCounts = salonIds.length > 0
      ? await db
          .select({
            salonId: technicianSchema.salonId,
            count: sql<number>`count(*)`,
          })
          .from(technicianSchema)
          .where(
            and(
              sql`${technicianSchema.salonId} IN ${salonIds}`,
              eq(technicianSchema.isActive, true),
            ),
          )
          .groupBy(technicianSchema.salonId)
      : [];

    // Get unique client counts per salon (from clientPreferences which tracks registered clients)
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

    // Get appointments last 30 days (filtered by salonIds)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const apptCounts = salonIds.length > 0
      ? await db
          .select({
            salonId: appointmentSchema.salonId,
            count: sql<number>`count(*)`,
          })
          .from(appointmentSchema)
          .where(
            and(
              sql`${appointmentSchema.salonId} IN ${salonIds}`,
              gte(appointmentSchema.createdAt, thirtyDaysAgo),
            ),
          )
          .groupBy(appointmentSchema.salonId)
      : [];

    // Build lookup maps
    const techCountMap = new Map(techCounts.map((t) => [t.salonId, Number(t.count)]));
    const clientCountMap = new Map(clientCounts.map((c) => [c.salonId, Number(c.count)]));
    const apptCountMap = new Map(apptCounts.map((a) => [a.salonId, Number(a.count)]));

    // Get owner info for each salon (from admin_salon_membership where role='owner')
    const ownerInfos = salonIds.length > 0
      ? await db
          .select({
            salonId: adminSalonMembershipSchema.salonId,
            adminId: adminSalonMembershipSchema.adminId,
            phoneE164: adminUserSchema.phoneE164,
            name: adminUserSchema.name,
          })
          .from(adminSalonMembershipSchema)
          .innerJoin(adminUserSchema, eq(adminSalonMembershipSchema.adminId, adminUserSchema.id))
          .where(
            and(
              sql`${adminSalonMembershipSchema.salonId} IN ${salonIds}`,
              eq(adminSalonMembershipSchema.role, 'owner'),
            ),
          )
      : [];
    const ownerMap = new Map(ownerInfos.map((o) => [o.salonId, o]));

    // Get latest invite status for each salon (for ADMIN role invites)
    const now = new Date();
    const latestInvites = salonIds.length > 0
      ? await db
          .select({
            salonId: adminInviteSchema.salonId,
            phoneE164: adminInviteSchema.phoneE164,
            expiresAt: adminInviteSchema.expiresAt,
            usedAt: adminInviteSchema.usedAt,
            membershipRole: adminInviteSchema.membershipRole,
            createdAt: adminInviteSchema.createdAt,
          })
          .from(adminInviteSchema)
          .where(
            and(
              sql`${adminInviteSchema.salonId} IN ${salonIds}`,
              eq(adminInviteSchema.role, 'ADMIN'),
            ),
          )
          .orderBy(desc(adminInviteSchema.createdAt))
      : [];
    
    // Group invites by salon and get the latest owner invite status
    const inviteMap = new Map<string, { status: 'pending' | 'expired' | 'used'; phone: string }>();
    for (const invite of latestInvites) {
      if (!invite.salonId) continue;
      // Only track owner invites for status
      if (invite.membershipRole !== 'owner') continue;
      if (inviteMap.has(invite.salonId)) continue; // Already have latest
      
      let status: 'pending' | 'expired' | 'used';
      if (invite.usedAt) {
        status = 'used';
      } else if (invite.expiresAt < now) {
        status = 'expired';
      } else {
        status = 'pending';
      }
      inviteMap.set(invite.salonId, { status, phone: invite.phoneE164 });
    }

    // Format response
    const items = salons.map((salon) => {
      const owner = ownerMap.get(salon.id);
      const invite = inviteMap.get(salon.id);
      
      // Determine owner invite status
      let ownerInviteStatus: 'none' | 'pending' | 'expired' | 'used' = 'none';
      if (owner) {
        ownerInviteStatus = 'used'; // Owner exists, invite was claimed
      } else if (invite) {
        ownerInviteStatus = invite.status;
      }

      return {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        ownerEmail: salon.ownerEmail, // Legacy fallback
        ownerPhoneE164: owner?.phoneE164 ?? null,
        ownerAdminId: owner?.adminId ?? null,
        ownerName: owner?.name ?? null,
        ownerInviteStatus,
        pendingOwnerPhone: invite?.status === 'pending' ? invite.phone : null,
        plan: (salon.plan || 'single_salon') as SalonPlan,
        maxLocations: salon.maxLocations ?? 1,
        isMultiLocationEnabled: salon.isMultiLocationEnabled ?? false,
        status: (salon.status || 'active') as SalonStatus,
        createdAt: salon.createdAt.toISOString(),
        locationsCount: 1, // For now, assume 1 location per salon
        techsCount: techCountMap.get(salon.id) ?? 0,
        clientsCount: clientCountMap.get(salon.id) ?? 0,
        appointmentsLast30d: apptCountMap.get(salon.id) ?? 0,
      };
    });

    return Response.json({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('Error listing salons:', error);
    return Response.json(
      { error: 'Failed to list salons' },
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/super-admin/organizations - Create a new salon
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const body = await request.json();
    const validated = createSalonSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const { name, slug, ownerEmail, plan, maxLocations, isMultiLocationEnabled } = validated.data;

    // Check for duplicate slug
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

    // Create salon
    const salonId = `salon_${nanoid()}`;
    const [newSalon] = await db
      .insert(salonSchema)
      .values({
        id: salonId,
        name,
        slug,
        ownerEmail: ownerEmail ?? null,
        plan,
        maxLocations,
        isMultiLocationEnabled,
        status: 'active',
        isActive: true,
      })
      .returning();

    return Response.json({
      salon: {
        id: newSalon!.id,
        name: newSalon!.name,
        slug: newSalon!.slug,
        ownerEmail: newSalon!.ownerEmail,
        plan: newSalon!.plan as SalonPlan,
        maxLocations: newSalon!.maxLocations ?? 1,
        isMultiLocationEnabled: newSalon!.isMultiLocationEnabled ?? false,
        status: newSalon!.status as SalonStatus,
        createdAt: newSalon!.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error creating salon:', error);
    return Response.json(
      { error: 'Failed to create salon' },
      { status: 500 },
    );
  }
}
