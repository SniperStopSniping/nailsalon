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
  bookingExperienceUpdateSchema,
  resolveBookingExperience,
} from '@/libs/bookingExperience';
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
  mergeSalonEmailNotificationSettings,
  resolveSalonEmailNotificationSettings,
  resolveSalonNotificationRecipient,
  salonEmailNotificationSettingsUpdateSchema,
} from '@/libs/salonNotificationEmailSettings';
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
  salonEmailNotifications: salonEmailNotificationSettingsUpdateSchema.optional(),
  merchandising: merchandisingSettingsUpdateSchema.optional(),
  payments: salonPaymentsSettingsSchema.optional(),
  smartFit: smartFitSettingsUpdateSchema.optional(),
  bookingExperience: bookingExperienceUpdateSchema.optional(),
});

// Fields that are forbidden for admins to update (403 if present)
const FORBIDDEN_FIELDS = [
  'billingMode',
  'welcomeBonusPointsOverride',
  'profileCompletionPointsOverride',
  'referralRefereePointsOverride',
  'referralReferrerPointsOverride',
];

/**
 * Salon-facing appointment email settings plus the recipient they resolve to,
 * so the settings UI can show the effective fallback and warn when nothing
 * valid is configured.
 */
function buildSalonEmailNotificationResponse(salon: {
  settings: SalonSettings | null | undefined;
  ownerEmail: string | null;
  email: string | null;
}) {
  const salonEmailNotifications = resolveSalonEmailNotificationSettings(
    salon.settings ?? null,
  );
  const recipient = resolveSalonNotificationRecipient({
    recipientEmail: salonEmailNotifications.recipientEmail,
    ownerEmail: salon.ownerEmail,
    salonEmail: salon.email,
  });

  return {
    salonEmailNotifications,
    salonNotificationRecipient: recipient.email
      ? { email: recipient.email, source: recipient.source }
      : null,
    salonNotificationRecipientMissing: recipient.email === null,
  };
}

function buildBookingExperienceAuditMetadata(
  bookingExperience: ReturnType<typeof resolveBookingExperience>,
) {
  return {
    primaryColor: bookingExperience.primaryColor,
    bookingMessagePresent: bookingExperience.bookingMessage !== null,
    bookingMessageLength: bookingExperience.bookingMessage
      ? Array.from(bookingExperience.bookingMessage).length
      : 0,
    policyEnabled: bookingExperience.policy.enabled,
    policyTitlePresent: bookingExperience.policy.title !== null,
    policyTextLength: bookingExperience.policy.text
      ? Array.from(bookingExperience.policy.text).length
      : 0,
    appointmentOnly: bookingExperience.appointmentOnly,
    socialLinksConfigured: {
      instagram: bookingExperience.socialLinks.instagram !== null,
      facebook: bookingExperience.socialLinks.facebook !== null,
      tiktok: bookingExperience.socialLinks.tiktok !== null,
    },
    confirmationMessagePresent:
      bookingExperience.confirmationMessage !== null,
    confirmationMessageLength: bookingExperience.confirmationMessage
      ? Array.from(bookingExperience.confirmationMessage).length
      : 0,
  };
}

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
      bookingExperience: resolveBookingExperience(
        (salon.settings as SalonSettings | null | undefined) ?? null,
      ),
      bookingNotifications,
      ...buildSalonEmailNotificationResponse({
        settings: (salon.settings as SalonSettings | null | undefined) ?? null,
        ownerEmail: salon.ownerEmail,
        email: salon.email,
      }),
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
    const currentBookingExperience = resolveBookingExperience(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const currentBookingNotifications = resolveBookingNotificationSettingsFromSettings(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const currentSalonEmailNotifications = resolveSalonEmailNotificationSettings(
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

    if (updates.bookingExperience) {
      before.bookingExperience = buildBookingExperienceAuditMetadata(
        currentBookingExperience,
      );
      after.bookingExperience = buildBookingExperienceAuditMetadata(
        updates.bookingExperience,
      );
      ensureNextSettings().bookingExperience = updates.bookingExperience;
      touchedSettingsKeys.push('bookingExperience');
    }

    // Both notification blocks live under `settings.notifications`, so they are
    // written together — assigning either one alone would drop the other.
    if (updates.bookingNotifications || updates.salonEmailNotifications) {
      const nextNotifications = {
        ...(currentSettings.notifications ?? {}),
      } as NonNullable<SalonSettings['notifications']>;

      if (updates.bookingNotifications) {
        const mergedBookingNotifications = mergeBookingNotificationSettings(
          currentBookingNotifications,
          updates.bookingNotifications,
        );
        before.bookingNotifications = currentBookingNotifications;
        after.bookingNotifications = mergedBookingNotifications;
        nextNotifications.newBooking = mergedBookingNotifications.newBooking;
        nextNotifications.appointmentCancelled
          = mergedBookingNotifications.appointmentCancelled;
      }

      if (updates.salonEmailNotifications) {
        const mergedSalonEmailNotifications = mergeSalonEmailNotificationSettings(
          currentSalonEmailNotifications,
          updates.salonEmailNotifications,
        );
        before.salonEmailNotifications = currentSalonEmailNotifications;
        after.salonEmailNotifications = mergedSalonEmailNotifications;
        nextNotifications.salonEmail = mergedSalonEmailNotifications;
      }

      ensureNextSettings().notifications = nextNotifications;
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

    if (touchedSettingsKeys.length > 0) {
      // The helper above initializes this before recording a touched key.
      // `currentSettings` is a defensive fallback for TypeScript's conservative
      // control-flow analysis across the helper closure.
      const settingsToPersist = nextSettings ?? currentSettings;

      // Every touched top-level key is applied to the current database value.
      // This avoids a stale read-modify-write replacing unrelated settings
      // when two settings cards are saved concurrently. Legacy non-object
      // JSONB values cannot accept a jsonb_set path, so only preserve objects.
      let settingsExpression = sql`
        CASE
          WHEN jsonb_typeof(${salonSchema.settings}) = 'object'
            THEN ${salonSchema.settings}
          ELSE '{}'::jsonb
        END
      `;

      if (touchedSettingsKeys.includes('booking')) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{booking}', ${JSON.stringify(settingsToPersist.booking)}::jsonb)`;
      }
      if (touchedSettingsKeys.includes('bookingExperience')) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience}', ${JSON.stringify(settingsToPersist.bookingExperience)}::jsonb)`;
      }
      if (touchedSettingsKeys.includes('notifications')) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{notifications}', ${JSON.stringify(settingsToPersist.notifications)}::jsonb)`;
      }
      if (touchedSettingsKeys.includes('payments')) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{payments}', ${JSON.stringify(settingsToPersist.payments)}::jsonb)`;
      }
      if (touchedSettingsKeys.includes('smartFit')) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{smartFit}', ${JSON.stringify(settingsToPersist.smartFit)}::jsonb)`;
      }
      if (touchedSettingsKeys.includes('merchandising')) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{merchandising}', ${JSON.stringify(settingsToPersist.merchandising)}::jsonb)`;
      }

      dbUpdates.settings = settingsExpression;
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
        bookingExperience: currentBookingExperience,
        bookingNotifications: currentBookingNotifications,
        ...buildSalonEmailNotificationResponse({
          settings: currentSettings,
          ownerEmail: salon.ownerEmail,
          email: salon.email,
        }),
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
      bookingExperience: resolveBookingExperience(
        (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
      ),
      bookingNotifications,
      ...buildSalonEmailNotificationResponse({
        settings: (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
        ownerEmail: updatedSalon.ownerEmail,
        email: updatedSalon.email,
      }),
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
