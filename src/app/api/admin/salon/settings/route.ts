/**
 * Admin Salon Settings API
 *
 * GET /api/admin/salon/settings?salonSlug=xxx
 * PATCH /api/admin/salon/settings?salonSlug=xxx
 *
 * Allows salon admins to:
 * - GET: View settings including effective points (read-only for points/billing)
 * - PATCH: Update reviewsEnabled, rewardsEnabled, and typed booking configuration
 *
 * Any attempt to update billingMode or *PointsOverride returns 403 Forbidden.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdmin } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { bookingConfigSchema, getBookingConfigForSalon, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  bookingNotificationSettingsUpdateSchema,
  mergeBookingNotificationSettings,
  resolveBookingNotificationCapabilities,
  resolveBookingNotificationSettingsFromSettings,
} from '@/libs/bookingNotificationSettings';
import { db } from '@/libs/DB';
import { getDefaultLoyaltyPoints, resolveSalonLoyaltyPoints } from '@/libs/loyalty';
import { getSalonBySlug } from '@/libs/queries';
import {
  merchandisingSettingsSchema,
  merchandisingSettingsUpdateSchema,
  resolveMerchandisingSettings,
} from '@/libs/salonMerchandisingSettings';
import {
  mergeSmartFitSettings,
  readStoredSmartFitSettings,
  smartFitSettingsUpdateSchema,
} from '@/libs/smartFitConfig';
import {
  mergePaymentsSettings,
  readStoredPaymentsSettings,
  salonPaymentsSettingsSchema,
} from '@/libs/taxConfig';
import { salonSchema, serviceSchema, technicianSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

// Admin can ONLY update these fields
const adminUpdateSchema = z.object({
  reviewsEnabled: z.boolean().optional(),
  rewardsEnabled: z.boolean().optional(),
  bookingConfig: bookingConfigSchema.partial().optional(),
  bookingNotifications: bookingNotificationSettingsUpdateSchema.optional(),
  merchandising: merchandisingSettingsUpdateSchema.optional(),
  payments: salonPaymentsSettingsSchema.optional(),
  smartFit: smartFitSettingsUpdateSchema.optional(),
});

// Fields that are forbidden for admins to update (403 if present)
const FORBIDDEN_FIELDS = [
  'billingMode',
  'welcomeBonusPointsOverride',
  'profileCompletionPointsOverride',
  'referralRefereePointsOverride',
  'referralReferrerPointsOverride',
];

// =============================================================================
// GET /api/admin/salon/settings - Get salon settings
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        { error: 'salonSlug query parameter is required' },
        { status: 400 },
      );
    }

    // 1. Fetch salon by slug
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 2. Check admin authorization
    const guard = await requireAdmin(salon.id);
    if (!guard.ok) {
      return guard.response;
    }

    // 3. Resolve effective points
    const effectivePoints = resolveSalonLoyaltyPoints(salon);
    const defaults = getDefaultLoyaltyPoints();
    const bookingConfig = await getBookingConfigForSalon(salon.id);
    const bookingNotifications = resolveBookingNotificationSettingsFromSettings(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const notificationCapabilities = resolveBookingNotificationCapabilities({
      features: salon.features,
      settings: (salon.settings as SalonSettings | null | undefined) ?? null,
      ownerPhone: salon.ownerPhone,
      ownerEmail: salon.ownerEmail,
    });

    // 4. Return settings
    return Response.json({
      reviewsEnabled: salon.reviewsEnabled ?? true,
      rewardsEnabled: salon.rewardsEnabled ?? true,
      bookingConfig,
      bookingNotifications,
      merchandising: resolveMerchandisingSettings(
        (salon.settings as SalonSettings | null | undefined) ?? null,
      ),
      payments: readStoredPaymentsSettings(
        (salon.settings as SalonSettings | null | undefined) ?? null,
      ),
      smartFit: readStoredSmartFitSettings(
        (salon.settings as SalonSettings | null | undefined) ?? null,
      ),
      ownerPhonePresent: notificationCapabilities.ownerPhonePresent,
      ownerEmailPresent: notificationCapabilities.ownerEmailPresent,
      smsChannelAvailable: notificationCapabilities.smsChannelAvailable,
      emailChannelAvailable: notificationCapabilities.emailChannelAvailable,
      effectivePoints,
      defaults,
      billingMode: salon.billingMode ?? 'NONE',
      subscriptionStatus: salon.billingMode === 'STRIPE' ? salon.stripeSubscriptionStatus : null,
      // Indicate what the admin can/cannot edit
      canEditPoints: false,
      canEditBillingMode: false,
    });
  } catch (error) {
    console.error('Error fetching salon settings:', error);
    return Response.json(
      { error: 'Failed to fetch salon settings' },
      { status: 500 },
    );
  }
}

// =============================================================================
// PATCH /api/admin/salon/settings - Update salon settings (limited)
// =============================================================================

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    if (!salonSlug) {
      return Response.json(
        { error: 'salonSlug query parameter is required' },
        { status: 400 },
      );
    }

    // 1. Fetch salon by slug
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 2. Check admin authorization
    const guard = await requireAdmin(salon.id);
    if (!guard.ok) {
      return guard.response;
    }

    // 3. Parse request body
    const body = await request.json();

    // 4. Check for forbidden fields - return 403 if any are present
    for (const field of FORBIDDEN_FIELDS) {
      if (field in body) {
        return Response.json(
          {
            error: 'Forbidden',
            message: `You do not have permission to modify ${field}. Contact a super admin.`,
          },
          { status: 403 },
        );
      }
    }

    // 5. Validate allowed fields
    const validated = adminUpdateSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        { error: 'Invalid request data', details: validated.error.flatten() },
        { status: 400 },
      );
    }

    const updates = validated.data;
    if (salon.freeSoloEnabled && (updates.reviewsEnabled !== undefined || updates.rewardsEnabled !== undefined)) {
      return Response.json(
        {
          error: 'FEATURE_PROFILE_LOCKED',
          message: 'Reviews and rewards are not available in the free solo profile.',
        },
        { status: 403 },
      );
    }
    const currentSettings = ((salon.settings as SalonSettings | null | undefined) ?? {}) as SalonSettings;
    const currentBookingConfig = resolveBookingConfigFromSettings((salon.settings as SalonSettings | null | undefined) ?? null);
    const currentBookingNotifications = resolveBookingNotificationSettingsFromSettings(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const currentMerchandising = resolveMerchandisingSettings(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );

    // 6. Build before/after diff for audit log (only changed fields)
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const dbUpdates: Record<string, unknown> = {};
    let nextSettings: SalonSettings | null = null;
    const touchedSettingsKeys: string[] = [];

    const ensureNextSettings = (): SalonSettings => {
      if (nextSettings) {
        return nextSettings;
      }

      nextSettings = { ...currentSettings };
      return nextSettings;
    };

    if (updates.reviewsEnabled !== undefined && updates.reviewsEnabled !== salon.reviewsEnabled) {
      before.reviewsEnabled = salon.reviewsEnabled;
      after.reviewsEnabled = updates.reviewsEnabled;
      dbUpdates.reviewsEnabled = updates.reviewsEnabled;
    }

    if (updates.rewardsEnabled !== undefined && updates.rewardsEnabled !== salon.rewardsEnabled) {
      before.rewardsEnabled = salon.rewardsEnabled;
      after.rewardsEnabled = updates.rewardsEnabled;
      dbUpdates.rewardsEnabled = updates.rewardsEnabled;
    }

    if (updates.bookingConfig) {
      const mergedBookingConfig = bookingConfigSchema.parse({
        ...currentBookingConfig,
        ...updates.bookingConfig,
      });

      before.bookingConfig = currentBookingConfig;
      after.bookingConfig = mergedBookingConfig;
      ensureNextSettings().booking = mergedBookingConfig;
      touchedSettingsKeys.push('booking');
    }

    if (updates.bookingNotifications) {
      const mergedBookingNotifications = mergeBookingNotificationSettings(
        currentBookingNotifications,
        updates.bookingNotifications,
      );

      before.bookingNotifications = currentBookingNotifications;
      after.bookingNotifications = mergedBookingNotifications;
      ensureNextSettings().notifications = mergedBookingNotifications;
      touchedSettingsKeys.push('notifications');
    }

    const currentPayments = readStoredPaymentsSettings(currentSettings);
    let mergedPayments: ReturnType<typeof mergePaymentsSettings> | null = null;
    if (updates.payments) {
      mergedPayments = mergePaymentsSettings(currentPayments, updates.payments);

      before.payments = currentPayments;
      after.payments = mergedPayments;
      ensureNextSettings().payments = mergedPayments;
      touchedSettingsKeys.push('payments');
    }

    const currentSmartFit = readStoredSmartFitSettings(currentSettings);
    let mergedSmartFit: ReturnType<typeof mergeSmartFitSettings> | null = null;
    if (updates.smartFit) {
      try {
        mergedSmartFit = mergeSmartFitSettings(currentSmartFit, updates.smartFit);
      } catch (mergeError) {
        if (mergeError instanceof z.ZodError) {
          return Response.json(
            { error: 'Invalid request data', details: mergeError.flatten() },
            { status: 400 },
          );
        }
        throw mergeError;
      }

      // Ids supplied in THIS update must belong to this salon (ownership only,
      // not isActive — a stale-but-owned archived id must never brick a save).
      // Stored ids from earlier saves are not re-validated here.
      const requestedServiceIds = [...new Set(updates.smartFit.eligibleServiceIds ?? [])];
      if (requestedServiceIds.length > 0) {
        const ownedServices = await db
          .select({ id: serviceSchema.id })
          .from(serviceSchema)
          .where(and(
            eq(serviceSchema.salonId, salon.id),
            inArray(serviceSchema.id, requestedServiceIds),
          ));
        const ownedServiceIds = new Set(ownedServices.map(service => service.id));
        const invalidServiceIds = requestedServiceIds.filter(id => !ownedServiceIds.has(id));
        if (invalidServiceIds.length > 0) {
          return Response.json(
            {
              error: 'INVALID_SERVICE',
              message: 'One or more eligible services do not belong to this salon.',
              details: { serviceIds: invalidServiceIds },
            },
            { status: 400 },
          );
        }
      }

      const requestedTechnicianIds = [...new Set(updates.smartFit.eligibleTechnicianIds ?? [])];
      if (requestedTechnicianIds.length > 0) {
        const ownedTechnicians = await db
          .select({ id: technicianSchema.id })
          .from(technicianSchema)
          .where(and(
            eq(technicianSchema.salonId, salon.id),
            inArray(technicianSchema.id, requestedTechnicianIds),
          ));
        const ownedTechnicianIds = new Set(ownedTechnicians.map(technician => technician.id));
        const invalidTechnicianIds = requestedTechnicianIds.filter(id => !ownedTechnicianIds.has(id));
        if (invalidTechnicianIds.length > 0) {
          return Response.json(
            {
              error: 'INVALID_TECHNICIAN',
              message: 'One or more eligible technicians do not belong to this salon.',
              details: { technicianIds: invalidTechnicianIds },
            },
            { status: 400 },
          );
        }
      }

      before.smartFit = currentSmartFit;
      after.smartFit = mergedSmartFit;
      ensureNextSettings().smartFit = mergedSmartFit;
      touchedSettingsKeys.push('smartFit');
    }

    let mergedMerchandising: ReturnType<typeof merchandisingSettingsSchema.parse> | null = null;
    if (updates.merchandising) {
      mergedMerchandising = merchandisingSettingsSchema.parse({
        ...currentMerchandising,
        ...updates.merchandising,
      });

      before.merchandising = currentMerchandising;
      after.merchandising = mergedMerchandising;
      ensureNextSettings().merchandising = mergedMerchandising;
      touchedSettingsKeys.push('merchandising');
    }

    if (nextSettings) {
      // Single-key updates (merchandising promo dismissals, the Payments &
      // taxes card) write just their key via jsonb_set so a concurrent
      // booking/notification save is never clobbered by this read-modify-write.
      if (
        mergedMerchandising
        && touchedSettingsKeys.length === 1
        && touchedSettingsKeys[0] === 'merchandising'
      ) {
        dbUpdates.settings = sql`jsonb_set(coalesce(${salonSchema.settings}, '{}'::jsonb), '{merchandising}', ${JSON.stringify(mergedMerchandising)}::jsonb)`;
      } else if (
        mergedPayments
        && touchedSettingsKeys.length === 1
        && touchedSettingsKeys[0] === 'payments'
      ) {
        dbUpdates.settings = sql`jsonb_set(coalesce(${salonSchema.settings}, '{}'::jsonb), '{payments}', ${JSON.stringify(mergedPayments)}::jsonb)`;
      } else if (
        mergedSmartFit
        && touchedSettingsKeys.length === 1
        && touchedSettingsKeys[0] === 'smartFit'
      ) {
        dbUpdates.settings = sql`jsonb_set(coalesce(${salonSchema.settings}, '{}'::jsonb), '{smartFit}', ${JSON.stringify(mergedSmartFit)}::jsonb)`;
      } else {
        dbUpdates.settings = nextSettings;
      }
    }

    // 7. If no changes, return current state
    if (Object.keys(dbUpdates).length === 0) {
      const effectivePoints = resolveSalonLoyaltyPoints(salon);
      const defaults = getDefaultLoyaltyPoints();
      const notificationCapabilities = resolveBookingNotificationCapabilities({
        features: salon.features,
        settings: currentSettings,
        ownerPhone: salon.ownerPhone,
        ownerEmail: salon.ownerEmail,
      });

      return Response.json({
        reviewsEnabled: salon.reviewsEnabled ?? true,
        rewardsEnabled: salon.rewardsEnabled ?? true,
        bookingConfig: currentBookingConfig,
        bookingNotifications: currentBookingNotifications,
        merchandising: currentMerchandising,
        payments: currentPayments,
        smartFit: currentSmartFit,
        ownerPhonePresent: notificationCapabilities.ownerPhonePresent,
        ownerEmailPresent: notificationCapabilities.ownerEmailPresent,
        smsChannelAvailable: notificationCapabilities.smsChannelAvailable,
        emailChannelAvailable: notificationCapabilities.emailChannelAvailable,
        effectivePoints,
        defaults,
        billingMode: salon.billingMode ?? 'NONE',
        subscriptionStatus: salon.billingMode === 'STRIPE' ? salon.stripeSubscriptionStatus : null,
        canEditPoints: false,
        canEditBillingMode: false,
      });
    }

    // 8. Update salon
    const [updatedSalon] = await db
      .update(salonSchema)
      .set(dbUpdates)
      .where(eq(salonSchema.id, salon.id))
      .returning();

    // If update returns no row, the salon was deleted between validation and update
    if (!updatedSalon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // 9. Write audit log
    void logAuditEvent({
      salonId: salon.id,
      actorType: 'admin',
      actorId: guard.admin.id,
      action: 'settings_updated',
      entityType: 'salon',
      entityId: salon.id,
      metadata: { before, after },
    });

    // 10. Return updated settings
    const effectivePoints = resolveSalonLoyaltyPoints(updatedSalon);
    const defaults = getDefaultLoyaltyPoints();
    const bookingConfig = await getBookingConfigForSalon(updatedSalon.id);
    const bookingNotifications = resolveBookingNotificationSettingsFromSettings(
      (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
    );
    const notificationCapabilities = resolveBookingNotificationCapabilities({
      features: updatedSalon.features,
      settings: (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
      ownerPhone: updatedSalon.ownerPhone,
      ownerEmail: updatedSalon.ownerEmail,
    });

    return Response.json({
      reviewsEnabled: updatedSalon.reviewsEnabled ?? true,
      rewardsEnabled: updatedSalon.rewardsEnabled ?? true,
      bookingConfig,
      bookingNotifications,
      merchandising: resolveMerchandisingSettings(
        (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
      ),
      payments: readStoredPaymentsSettings(
        (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
      ),
      // Read back through the shared parser so success reflects what was persisted.
      smartFit: readStoredSmartFitSettings(
        (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
      ),
      ownerPhonePresent: notificationCapabilities.ownerPhonePresent,
      ownerEmailPresent: notificationCapabilities.ownerEmailPresent,
      smsChannelAvailable: notificationCapabilities.smsChannelAvailable,
      emailChannelAvailable: notificationCapabilities.emailChannelAvailable,
      effectivePoints,
      defaults,
      billingMode: updatedSalon.billingMode ?? 'NONE',
      subscriptionStatus: updatedSalon.billingMode === 'STRIPE' ? updatedSalon.stripeSubscriptionStatus : null,
      canEditPoints: false,
      canEditBillingMode: false,
    });
  } catch (error) {
    console.error('Error updating salon settings:', error);
    return Response.json(
      { error: 'Failed to update salon settings' },
      { status: 500 },
    );
  }
}
