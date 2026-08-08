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
  bookingExperienceAppearanceUpdateSchema,
  bookingPolicyUpdateSchema,
  resolveBookingExperience,
  type ResolvedBookingExperience,
} from '@/libs/bookingExperience';
import {
  bookingNotificationSettingsUpdateSchema,
  mergeBookingNotificationSettings,
  resolveBookingNotificationCapabilities,
  resolveBookingNotificationSettingsFromSettings,
} from '@/libs/bookingNotificationSettings';
import { db } from '@/libs/DB';
import { resolveBookingExperienceEntitlement } from '@/libs/featureEntitlements';
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
  bookingExperienceAppearance:
    bookingExperienceAppearanceUpdateSchema.optional(),
  bookingPolicy: bookingPolicyUpdateSchema.optional(),
}).strict();

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

function buildBookingExperienceAppearanceAuditMetadata(
  bookingExperience: ReturnType<typeof resolveBookingExperience>,
) {
  return {
    primaryColor: bookingExperience.primaryColor,
    bookingMessagePresent: bookingExperience.bookingMessage !== null,
    bookingMessageLength: bookingExperience.bookingMessage
      ? Array.from(bookingExperience.bookingMessage).length
      : 0,
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

function buildBookingPolicyAuditMetadata(
  bookingExperience: ResolvedBookingExperience,
) {
  const quickFactMetadata = (
    quickFact: ResolvedBookingExperience['quickFacts']['appointmentOnly'],
  ) => ({
    enabled: quickFact.enabled,
    labelPresent: quickFact.label !== null,
    labelLength: quickFact.label
      ? Array.from(quickFact.label).length
      : 0,
  });

  return {
    enabled: bookingExperience.policy.enabled,
    titlePresent: bookingExperience.policy.title !== null,
    titleLength: bookingExperience.policy.title
      ? Array.from(bookingExperience.policy.title).length
      : 0,
    textLength: bookingExperience.policy.text
      ? Array.from(bookingExperience.policy.text).length
      : 0,
    acknowledgment: {
      required: bookingExperience.policy.acknowledgment.required,
      textConfigured:
        bookingExperience.policy.acknowledgment.text !== null,
      textLength: bookingExperience.policy.acknowledgment.text
        ? Array.from(bookingExperience.policy.acknowledgment.text).length
        : 0,
      versionAvailable: bookingExperience.policy.version !== null,
    },
    placements: {
      servicePage: bookingExperience.policy.showOnServicePage,
      beforeConfirmation: bookingExperience.policy.showBeforeConfirmation,
      afterConfirmation: bookingExperience.policy.showAfterConfirmation,
      confirmationEmail: bookingExperience.policy.showInConfirmationEmail,
    },
    quickFacts: {
      appointmentOnly: quickFactMetadata(
        bookingExperience.quickFacts.appointmentOnly,
      ),
      depositNotice: quickFactMetadata(
        bookingExperience.quickFacts.depositNotice,
      ),
      cancellationNotice: quickFactMetadata(
        bookingExperience.quickFacts.cancellationNotice,
      ),
    },
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
    const bookingExperienceEntitlement
      = resolveBookingExperienceEntitlement({
        storedPlan: salon.plan,
        features: salon.features,
      });

    // 4. Return settings
    return Response.json({
      reviewsEnabled: salon.reviewsEnabled ?? true,
      rewardsEnabled: salon.rewardsEnabled ?? true,
      bookingConfig,
      bookingExperience: resolveBookingExperience(
        (salon.settings as SalonSettings | null | undefined) ?? null,
        { includeAcknowledgmentConfiguration: true },
      ),
      bookingExperienceEntitlement,
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'Invalid request data' },
        { status: 400 },
      );
    }

    if (
      typeof body === 'object'
      && body !== null
      && !Array.isArray(body)
      && 'bookingExperience' in body
    ) {
      return Response.json(
        {
          error: 'BOOKING_EXPERIENCE_REFRESH_REQUIRED',
          message:
            'Booking Experience settings changed. Refresh Settings and try again.',
        },
        { status: 409 },
      );
    }

    // 4. Check for forbidden fields - return 403 if any are present
    for (const field of FORBIDDEN_FIELDS) {
      if (
        typeof body === 'object'
        && body !== null
        && !Array.isArray(body)
        && field in body
      ) {
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
    const bookingExperienceEntitlement
      = resolveBookingExperienceEntitlement({
        storedPlan: salon.plan,
        features: salon.features,
      });
    if (
      (
        updates.bookingExperienceAppearance !== undefined
        || updates.bookingPolicy !== undefined
      )
      && !bookingExperienceEntitlement.entitled
    ) {
      return Response.json(
        {
          error: {
            code: 'UPGRADE_REQUIRED',
            message: 'Booking Experience Customization requires an eligible plan.',
          },
        },
        { status: 403 },
      );
    }

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
      { includeAcknowledgmentConfiguration: true },
    );
    const acknowledgmentWasExplicitlyProvided
      = updates.bookingPolicy?.policy.acknowledgment !== undefined;
    let effectiveBookingPolicyUpdate = updates.bookingPolicy;
    if (updates.bookingPolicy) {
      // Older open editor tabs do not submit acknowledgment. Merge the
      // server-resolved value before validating so they cannot accidentally
      // disable an already-required policy. Parsing again also applies the
      // required => enabled + pre-confirm invariants to persisted values.
      const mergedBookingPolicy = bookingPolicyUpdateSchema.safeParse({
        ...updates.bookingPolicy,
        policy: {
          ...updates.bookingPolicy.policy,
          acknowledgment:
            updates.bookingPolicy.policy.acknowledgment
            ?? currentBookingExperience.policy.acknowledgment,
        },
      });

      if (!mergedBookingPolicy.success) {
        return Response.json(
          {
            error: 'Invalid request data',
            details: mergedBookingPolicy.error.flatten(),
          },
          { status: 400 },
        );
      }

      effectiveBookingPolicyUpdate = mergedBookingPolicy.data;
    }
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

    if (updates.bookingExperienceAppearance) {
      const nextBookingExperience = {
        ...currentBookingExperience,
        ...updates.bookingExperienceAppearance,
        socialLinks: {
          ...updates.bookingExperienceAppearance.socialLinks,
        },
      };

      before.bookingExperienceAppearance
        = buildBookingExperienceAppearanceAuditMetadata(
          currentBookingExperience,
        );
      after.bookingExperienceAppearance
        = buildBookingExperienceAppearanceAuditMetadata(
          nextBookingExperience,
        );
      touchedSettingsKeys.push('bookingExperienceAppearance');
    }

    if (effectiveBookingPolicyUpdate) {
      const nextBookingExperience = resolveBookingExperience(
        {
          bookingExperience: {
            ...currentBookingExperience,
            policy: {
              ...effectiveBookingPolicyUpdate.policy,
            },
            quickFacts: {
              appointmentOnly: {
                ...effectiveBookingPolicyUpdate.quickFacts.appointmentOnly,
              },
              depositNotice: {
                ...effectiveBookingPolicyUpdate.quickFacts.depositNotice,
              },
              cancellationNotice: {
                ...effectiveBookingPolicyUpdate.quickFacts.cancellationNotice,
              },
            },
          },
        },
        { includeAcknowledgmentConfiguration: true },
      );

      if (
        effectiveBookingPolicyUpdate.policy.acknowledgment?.required === true
        && nextBookingExperience.policy.version === null
      ) {
        return Response.json(
          {
            error: 'BOOKING_POLICY_VERSION_UNAVAILABLE',
            message:
              'The booking policy version could not be generated. Try again.',
          },
          { status: 409 },
        );
      }

      before.bookingPolicy = buildBookingPolicyAuditMetadata(
        currentBookingExperience,
      );
      after.bookingPolicy = buildBookingPolicyAuditMetadata(
        nextBookingExperience,
      );
      touchedSettingsKeys.push('bookingPolicy');
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

    const requestedMerchandisingKeys = updates.merchandising
      ? Object.keys(updates.merchandising) as Array<keyof typeof currentMerchandising>
      : [];
    if (updates.merchandising && requestedMerchandisingKeys.length > 0) {
      const mergedMerchandising = merchandisingSettingsSchema.parse({
        ...currentMerchandising,
        ...updates.merchandising,
      });

      // Audit only fields owned by this request. Recording the entire
      // request-start snapshot would misattribute a concurrently saved sibling
      // preference that the targeted SQL below intentionally preserves.
      before.merchandising = Object.fromEntries(
        requestedMerchandisingKeys.map(key => [key, currentMerchandising[key]]),
      );
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
      if (
        touchedSettingsKeys.includes('bookingExperienceAppearance')
        || touchedSettingsKeys.includes('bookingPolicy')
      ) {
        // Ensure a usable nested object without replacing an existing one.
        // Subsequent writes target only their owned subpaths, so a concurrent
        // appearance save and policy save cannot overwrite one another.
        settingsExpression = sql`
          jsonb_set(
            ${settingsExpression},
            '{bookingExperience}',
            CASE
              WHEN jsonb_typeof(${settingsExpression}->'bookingExperience') = 'object'
                THEN ${settingsExpression}->'bookingExperience'
              ELSE '{}'::jsonb
            END
          )
        `;
      }
      if (
        touchedSettingsKeys.includes('bookingExperienceAppearance')
        && updates.bookingExperienceAppearance
      ) {
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,primaryColor}', ${JSON.stringify(updates.bookingExperienceAppearance.primaryColor)}::jsonb)`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,bookingMessage}', ${JSON.stringify(updates.bookingExperienceAppearance.bookingMessage)}::jsonb)`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,socialLinks}', ${JSON.stringify(updates.bookingExperienceAppearance.socialLinks)}::jsonb)`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,confirmationMessage}', ${JSON.stringify(updates.bookingExperienceAppearance.confirmationMessage)}::jsonb)`;
      }
      if (
        touchedSettingsKeys.includes('bookingPolicy')
        && effectiveBookingPolicyUpdate
      ) {
        // Preserve acknowledgment atomically for older open browser tabs,
        // which submit only the original policy fields. Each owned base field
        // is updated against the current database value; acknowledgment
        // changes only when the client explicitly supplies that subobject.
        settingsExpression = sql`
          jsonb_set(
            ${settingsExpression},
            '{bookingExperience,policy}',
            CASE
              WHEN jsonb_typeof(${settingsExpression}#>'{bookingExperience,policy}') = 'object'
                THEN ${settingsExpression}#>'{bookingExperience,policy}'
              ELSE '{}'::jsonb
            END
          )
        `;
        const enabledValue = acknowledgmentWasExplicitlyProvided
          ? sql`${JSON.stringify(effectiveBookingPolicyUpdate.policy.enabled)}::jsonb`
          : sql`
              CASE
                WHEN ${settingsExpression}#>'{bookingExperience,policy,acknowledgment,required}' = 'true'::jsonb
                  THEN 'true'::jsonb
                ELSE ${JSON.stringify(effectiveBookingPolicyUpdate.policy.enabled)}::jsonb
              END
            `;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,enabled}', ${enabledValue})`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,title}', ${JSON.stringify(effectiveBookingPolicyUpdate.policy.title)}::jsonb)`;
        const policyTextValue = (
          !acknowledgmentWasExplicitlyProvided
          && effectiveBookingPolicyUpdate.policy.text === null
        )
          ? sql`
              CASE
                WHEN ${settingsExpression}#>'{bookingExperience,policy,acknowledgment,required}' = 'true'::jsonb
                  THEN COALESCE(
                    ${settingsExpression}#>'{bookingExperience,policy,text}',
                    'null'::jsonb
                  )
                ELSE 'null'::jsonb
              END
            `
          : sql`${JSON.stringify(effectiveBookingPolicyUpdate.policy.text)}::jsonb`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,text}', ${policyTextValue})`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,showOnServicePage}', ${JSON.stringify(effectiveBookingPolicyUpdate.policy.showOnServicePage)}::jsonb)`;
        const showBeforeConfirmationValue = acknowledgmentWasExplicitlyProvided
          ? sql`${JSON.stringify(effectiveBookingPolicyUpdate.policy.showBeforeConfirmation)}::jsonb`
          : sql`
              CASE
                WHEN ${settingsExpression}#>'{bookingExperience,policy,acknowledgment,required}' = 'true'::jsonb
                  THEN 'true'::jsonb
                ELSE ${JSON.stringify(effectiveBookingPolicyUpdate.policy.showBeforeConfirmation)}::jsonb
              END
            `;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,showBeforeConfirmation}', ${showBeforeConfirmationValue})`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,showAfterConfirmation}', ${JSON.stringify(effectiveBookingPolicyUpdate.policy.showAfterConfirmation)}::jsonb)`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,showInConfirmationEmail}', ${JSON.stringify(effectiveBookingPolicyUpdate.policy.showInConfirmationEmail)}::jsonb)`;
        if (acknowledgmentWasExplicitlyProvided) {
          settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,policy,acknowledgment}', ${JSON.stringify(effectiveBookingPolicyUpdate.policy.acknowledgment)}::jsonb)`;
        }
        // A version is trusted output only. Remove any legacy/hostile stored
        // value instead of carrying it into the canonical policy JSON.
        settingsExpression = sql`(${settingsExpression} #- '{bookingExperience,policy,version}')`;
        settingsExpression = sql`jsonb_set(${settingsExpression}, '{bookingExperience,quickFacts}', ${JSON.stringify(effectiveBookingPolicyUpdate.quickFacts)}::jsonb)`;
        // The explicit replacement is part of this same atomic UPDATE. A
        // failed validation/write therefore leaves the legacy boolean intact.
        settingsExpression = sql`(${settingsExpression} #- '{bookingExperience,appointmentOnly}')`;
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
      if (
        touchedSettingsKeys.includes('merchandising')
        && updates.merchandising
      ) {
        // Merchandising controls live in several independent admin surfaces.
        // Normalize the live database value, then update only the keys this
        // request owns so a concurrent sibling preference is never replaced
        // by the request-start snapshot used for validation and audit data.
        settingsExpression = sql`
          jsonb_set(
            ${settingsExpression},
            '{merchandising}',
            CASE
              WHEN jsonb_typeof(${settingsExpression}->'merchandising') = 'object'
                THEN ${settingsExpression}->'merchandising'
              ELSE '{}'::jsonb
            END
          )
        `;

        if (updates.merchandising.featureLusterManicure !== undefined) {
          settingsExpression = sql`jsonb_set(${settingsExpression}, '{merchandising,featureLusterManicure}', ${JSON.stringify(updates.merchandising.featureLusterManicure)}::jsonb)`;
        }
        if (updates.merchandising.showServiceImages !== undefined) {
          settingsExpression = sql`jsonb_set(${settingsExpression}, '{merchandising,showServiceImages}', ${JSON.stringify(updates.merchandising.showServiceImages)}::jsonb)`;
        }
        if (updates.merchandising.lusterPromoDismissed !== undefined) {
          settingsExpression = sql`jsonb_set(${settingsExpression}, '{merchandising,lusterPromoDismissed}', ${JSON.stringify(updates.merchandising.lusterPromoDismissed)}::jsonb)`;
        }
        if (updates.merchandising.serviceLibraryIntroDismissed !== undefined) {
          settingsExpression = sql`jsonb_set(${settingsExpression}, '{merchandising,serviceLibraryIntroDismissed}', ${JSON.stringify(updates.merchandising.serviceLibraryIntroDismissed)}::jsonb)`;
        }
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
        bookingExperienceEntitlement,
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

    if (requestedMerchandisingKeys.length > 0) {
      const authoritativeMerchandising = resolveMerchandisingSettings(
        (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
      );
      after.merchandising = Object.fromEntries(
        requestedMerchandisingKeys.map(key => [key, authoritativeMerchandising[key]]),
      );
    }

    if (updates.bookingPolicy) {
      after.bookingPolicy = buildBookingPolicyAuditMetadata(
        resolveBookingExperience(
          (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
          { includeAcknowledgmentConfiguration: true },
        ),
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
    const updatedBookingExperienceEntitlement
      = resolveBookingExperienceEntitlement({
        storedPlan: updatedSalon.plan,
        features: updatedSalon.features,
      });

    return Response.json({
      reviewsEnabled: updatedSalon.reviewsEnabled ?? true,
      rewardsEnabled: updatedSalon.rewardsEnabled ?? true,
      bookingConfig,
      bookingExperience: resolveBookingExperience(
        (updatedSalon.settings as SalonSettings | null | undefined) ?? null,
        { includeAcknowledgmentConfiguration: true },
      ),
      bookingExperienceEntitlement: updatedBookingExperienceEntitlement,
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
