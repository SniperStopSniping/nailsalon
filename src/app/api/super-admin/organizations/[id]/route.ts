import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { areSuperAdminTestToolsEnabled } from '@/libs/authConfig.server';
import { db } from '@/libs/DB';
import {
  BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION,
  buildBookingExperienceEntitlementInspection,
  getBookingExperienceOverrideAuditId,
  getBookingExperienceOverrideState,
  parseBookingExperienceOverrideProvenance,
} from '@/libs/featureEntitlements';
import { getEntitledModules } from '@/libs/featureGating';
import { getSalonIntegrationHealth } from '@/libs/integrationHealth';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import type { PurgeTx } from '@/libs/salonPurge';
import { purgeSalonData, SalonPurgeBlockedError } from '@/libs/salonPurge';
import { getSuperAdminInfo, logAuditAction, requireSuperAdmin } from '@/libs/superAdmin';
import { isValidSalonSlug } from '@/libs/tenantSlug';
import {
  adminInviteSchema,
  adminSalonMembershipSchema,
  adminUserSchema,
  appointmentSchema,
  clientPreferencesSchema,
  SALON_PLANS,
  SALON_STATUSES,
  salonAuditLogSchema,
  salonLocationSchema,
  type SalonPlan,
  salonSchema,
  type SalonStatus,
  technicianSchema,
} from '@/models/Schema';
import type {
  BookingExperienceEntitlementInspection,
  SalonFeatures,
  SalonSettings,
} from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

// Valid booking steps
const BOOKING_STEPS = ['service', 'tech', 'time', 'confirm'] as const;

const salonFeaturesSchema = z.custom<SalonFeatures>(
  value => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Features must be an object',
);

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
  // Booking flow customization
  bookingFlowCustomizationEnabled: z.boolean().optional(),
  bookingFlow: z.array(z.enum(BOOKING_STEPS)).optional().nullable(),
  features: salonFeaturesSchema.optional(),
  // Super-admin feature switches are authoritative. When this marker is set,
  // the owner-facing module state is synchronized in the same database write.
  syncFeatureModules: z.boolean().optional(),
});

// Permanent deletion must be confirmed server-side. The modal's typed-slug
// check is client state and therefore not a control.
const hardDeleteConfirmationSchema = z.object({
  confirmSlug: z.string().min(1),
});

async function buildBookingExperienceInspection(
  salon: Pick<typeof salonSchema.$inferSelect, 'id' | 'plan' | 'features'>,
): Promise<BookingExperienceEntitlementInspection> {
  const features = salon.features ?? null;
  const auditId = getBookingExperienceOverrideAuditId(features);
  const overrideState = getBookingExperienceOverrideState(features);
  let provenance = null;

  if (auditId) {
    const [audit] = await db
      .select({
        id: salonAuditLogSchema.id,
        salonId: salonAuditLogSchema.salonId,
        action: salonAuditLogSchema.action,
        performedBy: salonAuditLogSchema.performedBy,
        performedByEmail: salonAuditLogSchema.performedByEmail,
        metadata: salonAuditLogSchema.metadata,
        createdAt: salonAuditLogSchema.createdAt,
      })
      .from(salonAuditLogSchema)
      .where(and(
        eq(salonAuditLogSchema.id, auditId),
        eq(salonAuditLogSchema.salonId, salon.id),
        eq(
          salonAuditLogSchema.action,
          BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION,
        ),
      ))
      .limit(1);

    provenance = parseBookingExperienceOverrideProvenance(audit, {
      salonId: salon.id,
      auditId,
      overrideState,
    });
  }

  return buildBookingExperienceEntitlementInspection({
    storedPlan: salon.plan,
    features,
  }, provenance);
}

/**
 * This route writes the WHOLE `features` object verbatim from the request body,
 * in the same statement as a whole-`settings` write, so a stale super-admin save
 * can both de-entitle a live salon and re-entitle one after a deliberate kill.
 *
 * The mechanism does NOT reject a stale value: it DISCARDS the requested value
 * and RESTORES the live one, evaluated from the current database row at UPDATE
 * time. A key in the protected set is therefore IMMUTABLE THROUGH THIS ROUTE IN
 * BOTH DIRECTIONS — which is exactly why each protected key must have a
 * dedicated, audited writer of its own.
 *
 * Protected: `booking.customization` (+ its audit pointer),
 * `money.deposits`, and the LEGACY top-level `deposits` boolean. Both deposit
 * keys are needed because `resolveEntitlement` honours the legacy flat key as
 * its second branch, so protecting only the grouped one would leave a
 * de-entitlement path open.
 */
function protectFeatureOverrides(
  requestedFeatures: SalonFeatures,
) {
  const requestedJson = JSON.stringify(requestedFeatures);
  const currentFeatures = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.features}) = 'object'
        THEN ${salonSchema.features}
      ELSE '{}'::jsonb
    END
  `;
  const requestedBooking = sql`
    (
      CASE
        WHEN jsonb_typeof(${requestedJson}::jsonb -> 'booking') = 'object'
          THEN ${requestedJson}::jsonb -> 'booking'
        ELSE '{}'::jsonb
      END
      - 'customization'
      - 'customizationOverrideAuditId'
    )
  `;
  const currentBooking = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.features} -> 'booking') = 'object'
        THEN ${salonSchema.features} -> 'booking'
      ELSE '{}'::jsonb
    END
  `;
  const withCustomization = sql`
    CASE
      WHEN ${currentBooking} ? 'customization'
        THEN jsonb_set(
          ${requestedBooking},
          '{customization}',
          ${currentBooking} -> 'customization',
          true
        )
      ELSE ${requestedBooking}
    END
  `;
  const withAuditPointer = sql`
    CASE
      WHEN ${currentBooking} ? 'customizationOverrideAuditId'
        THEN jsonb_set(
          ${withCustomization},
          '{customizationOverrideAuditId}',
          ${currentBooking} -> 'customizationOverrideAuditId',
          true
        )
      ELSE ${withCustomization}
    END
  `;

  const requestedMoney = sql`
    (
      CASE
        WHEN jsonb_typeof(${requestedJson}::jsonb -> 'money') = 'object'
          THEN ${requestedJson}::jsonb -> 'money'
        ELSE '{}'::jsonb
      END
      - 'deposits'
    )
  `;
  const currentMoney = sql`
    CASE
      WHEN jsonb_typeof(${currentFeatures} -> 'money') = 'object'
        THEN ${currentFeatures} -> 'money'
      ELSE '{}'::jsonb
    END
  `;
  const withDeposits = sql`
    CASE
      WHEN ${currentMoney} ? 'deposits'
        THEN jsonb_set(
          ${requestedMoney},
          '{deposits}',
          ${currentMoney} -> 'deposits',
          true
        )
      ELSE ${requestedMoney}
    END
  `;

  const withBooking = sql`
    jsonb_set(
      ${requestedJson}::jsonb,
      '{booking}',
      ${withAuditPointer},
      true
    )
  `;
  const withMoney = sql`
    jsonb_set(
      ${withBooking},
      '{money}',
      ${withDeposits},
      true
    )
  `;

  // The legacy flat key, stripped from the request and restored iff the live row
  // carries it.
  const withoutLegacyDeposits = sql`(${withMoney} - 'deposits')`;

  return sql`
    CASE
      WHEN ${currentFeatures} ? 'deposits'
        THEN jsonb_set(
          ${withoutLegacyDeposits},
          '{deposits}',
          ${currentFeatures} -> 'deposits',
          true
        )
      ELSE ${withoutLegacyDeposits}
    END
  `;
}

// =============================================================================
// GET /api/super-admin/organizations/[id] - Get salon detail
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

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
          eq(technicianSchema.isActive, true),
        ),
      );

    const [locationCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(salonLocationSchema)
      .where(and(
        eq(salonLocationSchema.salonId, id),
        eq(salonLocationSchema.isActive, true),
      ));

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
          gte(appointmentSchema.createdAt, thirtyDaysAgo),
        ),
      );

    // Get owner info from admin_salon_membership
    const [ownerInfo] = await db
      .select({
        adminId: adminSalonMembershipSchema.adminId,
        phoneE164: adminUserSchema.phoneE164,
        name: adminUserSchema.name,
      })
      .from(adminSalonMembershipSchema)
      .innerJoin(adminUserSchema, eq(adminSalonMembershipSchema.adminId, adminUserSchema.id))
      .where(
        and(
          eq(adminSalonMembershipSchema.salonId, id),
          eq(adminSalonMembershipSchema.role, 'owner'),
        ),
      )
      .limit(1);

    // Get pending owner invite
    const now = new Date();
    const [pendingOwnerInvite] = await db
      .select({
        phoneE164: adminInviteSchema.phoneE164,
        expiresAt: adminInviteSchema.expiresAt,
        createdAt: adminInviteSchema.createdAt,
      })
      .from(adminInviteSchema)
      .where(
        and(
          eq(adminInviteSchema.salonId, id),
          eq(adminInviteSchema.role, 'ADMIN'),
          eq(adminInviteSchema.membershipRole, 'owner'),
          isNull(adminInviteSchema.usedAt),
        ),
      )
      .orderBy(desc(adminInviteSchema.createdAt))
      .limit(1);

    // Get all admins for this salon
    const admins = await db
      .select({
        adminId: adminSalonMembershipSchema.adminId,
        role: adminSalonMembershipSchema.role,
        phoneE164: adminUserSchema.phoneE164,
        name: adminUserSchema.name,
        email: adminUserSchema.email,
      })
      .from(adminSalonMembershipSchema)
      .innerJoin(adminUserSchema, eq(adminSalonMembershipSchema.adminId, adminUserSchema.id))
      .where(eq(adminSalonMembershipSchema.salonId, id));

    const integrationHealth = await getSalonIntegrationHealth(id);
    const publicUrl = buildSalonTenantPublicUrl('/', salon);
    const bookingUrl = buildSalonTenantPublicUrl('/book', salon);
    const findBookingUrl = buildSalonTenantPublicUrl('/find-booking', salon);
    const bookingExperienceEntitlement
      = await buildBookingExperienceInspection(salon);

    return Response.json({
      testToolsEnabled: areSuperAdminTestToolsEnabled(),
      canonicalUrls: { publicUrl, bookingUrl, findBookingUrl },
      integrationHealth,
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        customDomain: salon.customDomain,
        plan: (salon.plan || 'single_salon') as SalonPlan,
        status: (salon.status || 'active') as SalonStatus,
        maxLocations: salon.maxLocations ?? 1,
        isMultiLocationEnabled: salon.isMultiLocationEnabled ?? false,
        features: salon.features ?? null,
        bookingExperienceEntitlement,
        // Feature toggles
        onlineBookingEnabled: salon.onlineBookingEnabled ?? true,
        smsRemindersEnabled: salon.smsRemindersEnabled ?? true,
        rewardsEnabled: salon.rewardsEnabled ?? true,
        profilePageEnabled: salon.profilePageEnabled ?? true,
        // Booking flow customization
        bookingFlowCustomizationEnabled: salon.bookingFlowCustomizationEnabled ?? false,
        bookingFlow: salon.bookingFlow ?? null,
        // Owner & metadata (legacy)
        ownerEmail: salon.ownerEmail,
        ownerClerkUserId: salon.ownerClerkUserId,
        internalNotes: salon.internalNotes,
        deletedAt: salon.deletedAt?.toISOString() ?? null,
        createdAt: salon.createdAt.toISOString(),
        updatedAt: salon.updatedAt.toISOString(),
      },
      // New owner info from admin system
      owner: ownerInfo
        ? {
            adminId: ownerInfo.adminId,
            phoneE164: ownerInfo.phoneE164,
            name: ownerInfo.name,
          }
        : null,
      pendingOwnerInvite: pendingOwnerInvite
        ? {
            phoneE164: pendingOwnerInvite.phoneE164,
            expiresAt: pendingOwnerInvite.expiresAt.toISOString(),
            isExpired: pendingOwnerInvite.expiresAt < now,
          }
        : null,
      admins: admins.map(a => ({
        adminId: a.adminId,
        role: a.role,
        phoneE164: a.phoneE164,
        name: a.name,
        email: a.email,
      })),
      metrics: {
        locationsCount: Number(locationCount?.count ?? 0),
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
  if (guard) {
    return guard;
  }

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

    const { syncFeatureModules, ...validatedUpdates } = validated.data;
    const requestedFeatures = validatedUpdates.features;
    const updates: Partial<typeof salonSchema.$inferInsert> = { ...validatedUpdates };

    if (syncFeatureModules && requestedFeatures) {
      const existingSettings = (existing.settings as SalonSettings | null) ?? {};
      updates.settings = {
        ...existingSettings,
        modules: {
          ...(existingSettings.modules ?? {}),
          ...getEntitledModules(requestedFeatures),
        },
      };
    }

    if (requestedFeatures) {
      // Booking Experience overrides and the deposits entitlement are mutated
      // only by dedicated, reasoned, audited endpoints. Evaluate these protected
      // values from the current database row at UPDATE time so a stale
      // full-feature save cannot create, change, or remove any of them.
      updates.features = protectFeatureOverrides(
        requestedFeatures,
      ) as unknown as SalonFeatures;
    }

    // If slug is being changed, check for duplicates
    if (updates.slug && updates.slug !== existing.slug) {
      if (existing.slugLockedAt) {
        return Response.json({ error: 'Published Luster salon links cannot be changed' }, { status: 409 });
      }
      if (!isValidSalonSlug(updates.slug)) {
        return Response.json({ error: 'This slug is invalid or reserved by Luster' }, { status: 400 });
      }
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

    const bookingExperienceEntitlement
      = await buildBookingExperienceInspection(updated!);

    return Response.json({
      salon: {
        id: updated!.id,
        name: updated!.name,
        slug: updated!.slug,
        customDomain: updated!.customDomain,
        plan: (updated!.plan || 'single_salon') as SalonPlan,
        status: (updated!.status || 'active') as SalonStatus,
        maxLocations: updated!.maxLocations ?? 1,
        isMultiLocationEnabled: updated!.isMultiLocationEnabled ?? false,
        features: updated!.features ?? null,
        bookingExperienceEntitlement,
        // Feature toggles
        onlineBookingEnabled: updated!.onlineBookingEnabled ?? true,
        smsRemindersEnabled: updated!.smsRemindersEnabled ?? true,
        rewardsEnabled: updated!.rewardsEnabled ?? true,
        profilePageEnabled: updated!.profilePageEnabled ?? true,
        // Booking flow customization
        bookingFlowCustomizationEnabled: updated!.bookingFlowCustomizationEnabled ?? false,
        bookingFlow: updated!.bookingFlow ?? null,
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
  if (guard) {
    return guard;
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const hardDelete = searchParams.get('hard') === 'true';

  try {
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
      // The typed-slug gate lives in the modal, which is client state and
      // therefore not a control. Re-verify it server-side so a stray request
      // cannot destroy a tenant.
      const body = await request.json().catch(() => null);
      const confirmation = hardDeleteConfirmationSchema.safeParse(body);

      if (!confirmation.success) {
        return Response.json(
          { error: 'Permanent deletion requires a confirmSlug matching the salon slug' },
          { status: 400 },
        );
      }

      if (confirmation.data.confirmSlug !== existing.slug) {
        return Response.json(
          { error: 'Confirmation text does not match this salon\'s slug' },
          { status: 400 },
        );
      }

      // Permanent deletion is only reachable from the archived state, so an
      // active salon with live bookings can never be destroyed in one request.
      if (!existing.deletedAt) {
        return Response.json(
          { error: 'Soft delete the salon first, then permanently delete it' },
          { status: 409 },
        );
      }

      // One transaction: a failure rolls the whole purge back rather than
      // leaving the tenant half-destroyed.
      const purge = await db.transaction(async tx => purgeSalonData(tx as unknown as PurgeTx, id));

      // Written after the commit, with salonId null, so the record of the
      // deletion survives the salon it describes.
      await logAuditEvent({
        salonId: null,
        actorType: 'super_admin',
        actorId: adminInfo?.userId ?? null,
        action: 'salon_hard_deleted',
        entityType: 'salon',
        entityId: id,
        metadata: {
          name: existing.name,
          slug: existing.slug,
          rowsDeleted: purge.totalRows,
          tables: purge.counts,
        },
      });

      return Response.json({
        success: true,
        message: 'Salon permanently deleted',
        deletedId: id,
        rowsDeleted: purge.totalRows,
        tables: purge.counts,
      });
    }

    if (existing.deletedAt) {
      // Re-running a soft delete would overwrite the original deletedAt and
      // deletedBy, erasing who actually deleted it and when.
      return Response.json(
        { error: 'Salon is already deleted' },
        { status: 409 },
      );
    }

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
  } catch (error) {
    if (error instanceof SalonPurgeBlockedError) {
      return Response.json(
        { error: error.message, blockers: error.blockers },
        { status: 409 },
      );
    }

    // Surface the constraint that blocked the delete. Super admins are the only
    // callers here, and a bare "Failed to delete salon" leaves them with no way
    // to diagnose which table is holding a reference.
    const pgError = error as { code?: string; constraint?: string; table?: string; detail?: string };
    if (pgError?.code === '23503') {
      return Response.json(
        {
          error: 'Cannot delete salon: related records still reference it',
          constraint: pgError.constraint,
          table: pgError.table,
          detail: pgError.detail,
        },
        { status: 409 },
      );
    }

    console.error('Error deleting salon:', error);
    return Response.json(
      {
        error: hardDelete ? 'Failed to delete salon' : 'Failed to soft delete salon',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
