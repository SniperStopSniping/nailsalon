import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// This file defines the structure of your database tables using the Drizzle ORM.

// To modify the database schema:
// 1. Update this file with your desired changes.
// 2. Generate a new migration by running: `npm run db:generate`

// The generated migration file will reflect your schema changes.
// The migration is automatically applied during the next database interaction,
// so there's no need to run it manually or restart the Next.js server.

// Need a database for production? Check out https://www.prisma.io/?via=saasboilerplatesrc
// Tested and compatible with Next.js Boilerplate

// =============================================================================
// ENUMS (Canvas Flow OS + Policies)
// =============================================================================

export const canvasStateEnum = pgEnum('canvas_state', [
  'waiting',
  'working',
  'wrap_up',
  'complete',
  'cancelled',
  'no_show',
]);

export const photoRequirementModeEnum = pgEnum('photo_requirement_mode', [
  'off',
  'optional',
  'required',
]);

export const autopostStatusEnum = pgEnum('autopost_status', [
  'queued',
  'processing',
  'posted',
  'failed',
]);

export const serviceCategoryEnum = pgEnum('service_category', [
  'manicure',
  'builder_gel',
  'extensions',
  'pedicure',
  // Legacy categories retained for backward compatibility with existing salons.
  'hands',
  'feet',
  'combo',
]);

export const bookingCategoryEnum = pgEnum('booking_category', [
  'manicure',
  'pedicure',
  'combo',
]);

export const addOnCategoryEnum = pgEnum('add_on_category', [
  'nail_art',
  'repair',
  'removal',
  'pedicure_addon',
]);

export const addOnPricingTypeEnum = pgEnum('add_on_pricing_type', [
  'fixed',
  'per_unit',
]);

export const serviceAddOnSelectionModeEnum = pgEnum('service_add_on_selection_mode', [
  'optional',
  'required',
  'conditional',
]);

export const organizationSchema = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionPriceId: text('stripe_subscription_price_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodEnd: bigint(
      'stripe_subscription_current_period_end',
      { mode: 'number' },
    ),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      stripeCustomerIdIdx: uniqueIndex('stripe_customer_id_idx').on(
        table.stripeCustomerId,
      ),
    };
  },
);

export const todoSchema = pgTable('todo', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// =============================================================================
// NAIL SALON DOMAIN SCHEMAS
// =============================================================================

// -----------------------------------------------------------------------------
// Salon (Tenant) - Core multi-tenant entity
// -----------------------------------------------------------------------------
export const salonSchema = pgTable(
  'salon',
  {
    id: text('id').primaryKey(),

    // Identity
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    customDomain: text('custom_domain'),

    // Branding
    themeKey: text('theme_key').default('nail-salon-no5'),
    logoUrl: text('logo_url'),
    coverImageUrl: text('cover_image_url'),

    // Contact
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    zipCode: text('zip_code'),

    // Social Links (JSON)
    socialLinks: jsonb('social_links').$type<{
      instagram?: string;
      facebook?: string;
      tiktok?: string;
    }>(),

    // Business Hours (JSON)
    businessHours: jsonb('business_hours').$type<{
      monday: { open: string; close: string } | null;
      tuesday: { open: string; close: string } | null;
      wednesday: { open: string; close: string } | null;
      thursday: { open: string; close: string } | null;
      friday: { open: string; close: string } | null;
      saturday: { open: string; close: string } | null;
      sunday: { open: string; close: string } | null;
    }>(),

    // Policies (JSON)
    policies: jsonb('policies').$type<{
      cancellationHours: number;
      noShowFee: number;
      depositRequired: boolean;
      depositAmount: number;
    }>(),

    // Stripe Integration
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripePriceId: text('stripe_price_id'),
    stripeCurrentPeriodEnd: bigint('stripe_current_period_end', { mode: 'number' }),
    stripeCustomerEmail: text('stripe_customer_email'),

    // Billing Mode: 'NONE' = cash/manual, 'STRIPE' = Stripe subscription
    billingMode: text('billing_mode').default('NONE'),

    // Plan & Billing (Super Admin controlled)
    plan: text('plan').default('single_salon'),
    maxLocations: integer('max_locations').default(1),
    // Per-salon Portfolio photo limit override. NULL means "use the plan
    // default" — the same shape as `maxLocations` above, which is read as
    // `salon.maxLocations ?? planLimit`. See `@/libs/portfolioLimits`.
    maxPortfolioPhotos: integer('max_portfolio_photos'),
    isMultiLocationEnabled: boolean('is_multi_location_enabled').default(false),

    // Status (Super Admin controlled)
    status: text('status').default('active'),

    // Luster Free Booking publication lifecycle. Existing salons remain published;
    // invite-created salons explicitly start in draft until setup is complete.
    publicationStatus: text('publication_status').default('published').notNull(),
    publishedAt: timestamp('published_at', { mode: 'date' }),
    slugLockedAt: timestamp('slug_locked_at', { mode: 'date' }),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { mode: 'date' }),
    freeSoloEnabled: boolean('free_solo_enabled').default(false).notNull(),
    invitationSource: text('invitation_source'),

    // Feature toggles (Super Admin controlled)
    onlineBookingEnabled: boolean('online_booking_enabled').default(true),
    smsRemindersEnabled: boolean('sms_reminders_enabled').default(true),
    rewardsEnabled: boolean('rewards_enabled').default(true),
    profilePageEnabled: boolean('profile_page_enabled').default(true),
    reviewsEnabled: boolean('reviews_enabled').default(true),

    // Per-salon loyalty points overrides (Super Admin only, null = use default)
    welcomeBonusPointsOverride: integer('welcome_bonus_points_override'),
    profileCompletionPointsOverride: integer('profile_completion_points_override'),
    referralRefereePointsOverride: integer('referral_referee_points_override'),
    referralReferrerPointsOverride: integer('referral_referrer_points_override'),

    // Booking flow customization (Super Admin controlled)
    bookingFlowCustomizationEnabled: boolean('booking_flow_customization_enabled').default(false),
    bookingFlow: jsonb('booking_flow').$type<string[] | null>().default(null),

    // Owner tracking (nullable for existing rows)
    ownerEmail: text('owner_email'),
    ownerName: text('owner_name'),
    ownerPhone: text('owner_phone'),
    ownerClerkUserId: text('owner_clerk_user_id'),

    // Internal (super admin only, nullable)
    internalNotes: text('internal_notes'),

    // Operational settings (Step 16A)
    graceWindowMinutes: integer('grace_window_minutes').default(10), // Late arrival grace period

    // Admin settings + visibility policy (Step 16)
    settings: jsonb('settings').$type<import('@/types/salonPolicy').SalonSettings>(),
    visibility: jsonb('visibility').$type<import('@/types/salonPolicy').SalonVisibilityPolicy>(),

    // Feature entitlements (Step 16.1 - Super Admin controlled)
    // Note: This supplements the existing boolean columns for future extensibility
    features: jsonb('features').$type<import('@/types/salonPolicy').SalonFeatures>(),

    // Soft delete (super admin)
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
    deletedBy: text('deleted_by'),

    // Metadata
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    slugIdx: uniqueIndex('salon_slug_idx').on(table.slug),
    customDomainIdx: uniqueIndex('salon_custom_domain_idx').on(table.customDomain),
    deletedAtIdx: index('salon_deleted_at_idx').on(table.deletedAt),
  }),
);

// -----------------------------------------------------------------------------
// Service - Services offered by a salon (scoped to tenant)
// -----------------------------------------------------------------------------
export const serviceSchema = pgTable(
  'service',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Service Details
    name: text('name').notNull(),
    description: text('description'),
    descriptionItems: jsonb('description_items').$type<string[] | null>().default(null),
    slug: text('slug'),
    price: integer('price').notNull(), // in cents
    priceDisplayText: text('price_display_text'),
    durationMinutes: integer('duration_minutes').notNull(),
    preparationBufferMinutes: integer('preparation_buffer_minutes').default(0).notNull(),
    cleanupBufferMinutes: integer('cleanup_buffer_minutes').default(0).notNull(),
    isIntroPrice: boolean('is_intro_price').default(false),
    introPriceLabel: text('intro_price_label'),
    introPriceExpiresAt: timestamp('intro_price_expires_at', { mode: 'date' }),
    bookingQuestions: jsonb('booking_questions').$type<unknown[] | null>().default(null),

    // Categorization
    category: serviceCategoryEnum('category').notNull(),
    // Client-facing booking page grouping, independent of the admin category.
    bookingCategory: bookingCategoryEnum('booking_category').default('manicure').notNull(),
    // Stable key linking this service to a catalog template (e.g. 'luster_manicure').
    // Unique per salon via the partial index below.
    templateKey: text('template_key'),

    // Display
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').default(0),
    // Manual featured position on the booking page; null = not manually featured.
    featuredOrder: integer('featured_order'),

    // Status
    isActive: boolean('is_active').default(true),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('service_salon_idx').on(table.salonId),
    salonSlugIdx: uniqueIndex('service_salon_slug_idx').on(table.salonId, table.slug),
    categoryIdx: index('service_category_idx').on(table.salonId, table.category),
    activeCategoryIdx: index('service_active_category_idx').on(table.salonId, table.isActive, table.category),
    // Partial unique index (WHERE template_key IS NOT NULL) is created in
    // migrations/0056_booking_category_luster_featuring.sql as
    // service_salon_template_key_idx — one template-derived service per salon.
  }),
);

// -----------------------------------------------------------------------------
// AddOn - Optional extras attached to a base service
// -----------------------------------------------------------------------------
export const addOnSchema = pgTable(
  'add_on',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    category: addOnCategoryEnum('category').notNull(),
    // Stable key linking this add-on to a catalog template; unique per salon
    // via the partial index in migrations/0057_add_on_template_key.sql.
    templateKey: text('template_key'),
    descriptionItems: jsonb('description_items').$type<string[] | null>().default(null),
    priceCents: integer('price_cents').notNull(),
    priceDisplayText: text('price_display_text'),
    durationMinutes: integer('duration_minutes').notNull(),
    pricingType: addOnPricingTypeEnum('pricing_type').notNull().default('fixed'),
    unitLabel: text('unit_label'),
    maxQuantity: integer('max_quantity'),
    isActive: boolean('is_active').default(true),
    displayOrder: integer('display_order').default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('add_on_salon_idx').on(table.salonId),
    salonSlugIdx: uniqueIndex('add_on_salon_slug_idx').on(table.salonId, table.slug),
    activeCategoryIdx: index('add_on_active_category_idx').on(table.salonId, table.isActive, table.category),
  }),
);

// -----------------------------------------------------------------------------
// Technician - Nail technicians/artists who perform services
// -----------------------------------------------------------------------------
export const technicianSchema = pgTable(
  'technician',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Profile
    name: text('name').notNull(),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),

    // Contact
    email: text('email'),
    phone: text('phone'),

    // Role & Compensation
    // commissionRate stored as decimal: 0.4 = 40%
    role: text('role').default('tech'),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).default('0'),
    payType: text('pay_type').default('commission'),
    hourlyRate: numeric('hourly_rate', { precision: 8, scale: 2 }),
    salaryAmount: numeric('salary_amount', { precision: 10, scale: 2 }),

    // Real-time Status
    currentStatus: text('current_status').default('available'),

    // Professional
    specialties: jsonb('specialties').$type<string[]>(),
    rating: numeric('rating', { precision: 2, scale: 1 }),
    reviewCount: integer('review_count').default(0),

    // Skills
    languages: jsonb('languages').$type<string[]>(),
    skillLevel: text('skill_level').default('standard'),

    // Availability - Per-day schedule with start/end times
    // null for a day means day off
    weeklySchedule: jsonb('weekly_schedule').$type<{
      sunday?: { start: string; end: string } | null;
      monday?: { start: string; end: string } | null;
      tuesday?: { start: string; end: string } | null;
      wednesday?: { start: string; end: string } | null;
      thursday?: { start: string; end: string } | null;
      friday?: { start: string; end: string } | null;
      saturday?: { start: string; end: string } | null;
    }>(),

    // Legacy fields (kept for backward compatibility)
    workDays: jsonb('work_days').$type<number[]>(), // [1, 2, 3, 4, 5] = Mon-Fri
    startTime: text('start_time'), // "09:00"
    endTime: text('end_time'), // "18:00"

    // Admin
    notes: text('notes'),
    displayOrder: integer('display_order').default(0),

    // Future Auth Link (nullable, no FK constraint yet)
    userId: text('user_id'),

    // Employment Lifecycle
    hiredAt: timestamp('hired_at', { mode: 'date' }).defaultNow(),
    terminatedAt: timestamp('terminated_at', { mode: 'date' }),
    returnDate: timestamp('return_date', { mode: 'date' }),
    onboardingStatus: text('onboarding_status').default('pending'),

    // Booking Settings
    acceptingNewClients: boolean('accepting_new_clients').default(true),

    // Multi-location Hook
    primaryLocationId: text('primary_location_id'),

    // Status
    isActive: boolean('is_active').default(true),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('technician_salon_idx').on(table.salonId),
  }),
);

// -----------------------------------------------------------------------------
// TechnicianServices - Many-to-many: Technician <-> Services
// -----------------------------------------------------------------------------
export const technicianServicesSchema = pgTable(
  'technician_services',
  {
    technicianId: text('technician_id')
      .notNull()
      .references(() => technicianSchema.id),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceSchema.id),
    // Custom ordering for this tech's services
    priority: integer('priority').default(0),
    // Toggle service without removing the relationship
    enabled: boolean('enabled').default(true),
  },
  table => ({
    pk: primaryKey({ columns: [table.technicianId, table.serviceId] }),
  }),
);

// -----------------------------------------------------------------------------
// Appointment - Booked appointments linking clients and technicians
// -----------------------------------------------------------------------------
export const appointmentSchema = pgTable(
  'appointment',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Technician (services are linked via junction table)
    technicianId: text('technician_id').references(() => technicianSchema.id),

    // Location (multi-location support)
    // Note: FK reference added at DB level, not ORM level due to schema order
    locationId: text('location_id'),

    // Client (phone-based identification)
    clientPhone: text('client_phone').notNull(),
    clientName: text('client_name'),
    clientEmail: text('client_email'),

    // Stable client identity (Phase 1: nullable for migration, Phase 1.5: NOT NULL after backfill)
    // onDelete: 'restrict' - can't delete salonClient with appointments (use soft-delete if needed)
    // eslint-disable-next-line ts/no-use-before-define -- Drizzle ORM intentional forward reference via callback
    salonClientId: text('salon_client_id').references(() => salonClientSchema.id, { onDelete: 'restrict' }),

    // Timing
    startTime: timestamp('start_time', { mode: 'date', withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { mode: 'date', withTimezone: true }).notNull(),

    // Status — see APPOINTMENT_STATUSES for the authoritative list.
    status: text('status').notNull().default('confirmed'),
    // 'pending' | 'confirmed' | 'in_progress' | 'awaiting_payment'
    //   | 'cancelled' | 'completed' | 'no_show'
    cancelReason: text('cancel_reason'),
    // 'rescheduled' | 'client_request' | 'no_show' | 'deposit_not_paid' | null

    // Canvas Flow OS state (parallel to legacy status)
    canvasState: canvasStateEnum('canvas_state').default('waiting'),
    canvasStateUpdatedAt: timestamp('canvas_state_updated_at', { mode: 'date', withTimezone: true }),

    // Deposit hold deadline (migration 0066). Set ONLY on 'awaiting_payment'
    // rows: the appointment row IS the hold, and this is when it lapses. The
    // reaper keys on it; the Stripe Checkout Session expires at the same
    // instant. NULL on every other status.
    depositHoldExpiresAt: timestamp('deposit_hold_expires_at', { mode: 'date', withTimezone: true }),

    // Soft delete
    deletedAt: timestamp('deleted_at', { mode: 'date', withTimezone: true }),

    // Totals (computed from linked services at booking time)
    totalPrice: integer('total_price').notNull(), // Final amount after any applied discount
    totalDurationMinutes: integer('total_duration_minutes').notNull(), // Visible customer-facing duration only
    basePriceCents: integer('base_price_cents'),
    addOnsPriceCents: integer('add_ons_price_cents').default(0),
    baseDurationMinutes: integer('base_duration_minutes'),
    addOnsDurationMinutes: integer('add_ons_duration_minutes').default(0),
    bufferMinutes: integer('buffer_minutes').default(0),
    blockedDurationMinutes: integer('blocked_duration_minutes'),
    subtotalBeforeDiscountCents: integer('subtotal_before_discount_cents'),
    discountAmountCents: integer('discount_amount_cents').default(0),
    discountType: text('discount_type'),
    discountLabel: text('discount_label'),
    discountPercent: integer('discount_percent'),
    discountAppliedAt: timestamp('discount_applied_at', { mode: 'date', withTimezone: true }),

    // Additional
    notes: text('notes'),

    // Client reminder tracking (idempotent cron delivery)
    dayBeforeReminderSentAt: timestamp('day_before_reminder_sent_at', { mode: 'date', withTimezone: true }),
    dayBeforeReminderChannel: text('day_before_reminder_channel'),
    sameDayReminderSentAt: timestamp('same_day_reminder_sent_at', { mode: 'date', withTimezone: true }),
    sameDayReminderChannel: text('same_day_reminder_channel'),

    // Lifecycle timestamps (for staff workflow)
    startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }), // When tech starts the appointment
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }), // When appointment is finished

    // Appointment locking (Step 16A - prevents edits once service starts)
    lockedAt: timestamp('locked_at', { mode: 'date', withTimezone: true }), // Set when canvas_state -> 'working'
    lockedBy: text('locked_by'), // technician ID who locked it

    // Arrival tracking (Step 16A - grace window handling)
    arrivedAt: timestamp('arrived_at', { mode: 'date', withTimezone: true }),
    wasLate: boolean('was_late').default(false),

    // Staff private notes (Step 16A - only visible to assigned tech)
    techNotes: text('tech_notes'),

    // External calendar sync
    googleCalendarEventId: text('google_calendar_event_id'),
    googleCalendarSyncStatus: text('google_calendar_sync_status').default('not_synced'),
    googleCalendarSyncedAt: timestamp('google_calendar_synced_at', { mode: 'date', withTimezone: true }),
    googleCalendarSyncError: text('google_calendar_sync_error'),

    // Payment
    paymentStatus: text('payment_status').default('pending'), // 'pending' | 'paid'
    // Frozen ISO identity for D6.1 invoice/deposit comparisons. Migration 0068
    // safely backfills CAD when a tenant-bound CAD deposit proves that identity;
    // other historical NULLs must never use mutable current salon settings.
    invoiceCurrency: text('invoice_currency'),

    // Booking-time disclosure estimate. Additive and nullable: existing rows
    // stay explicitly historical rather than receiving guessed tax facts.
    bookingTaxSnapshot: jsonb('booking_tax_snapshot')
      .$type<import('@/libs/taxConfig').BookingTaxSnapshot>(),

    // Latest estimate created by an in-place reschedule or price mutation.
    // bookingTaxSnapshot is the immutable original disclosure; consumers use
    // this nullable successor only while no final actual invoice exists.
    rescheduleTaxSnapshot: jsonb('reschedule_tax_snapshot')
      .$type<import('@/libs/taxConfig').BookingTaxSnapshot>(),

    // Completion record (filled by the tech's Complete Appointment form)
    // Nullable until the appointment is completed; source of truth for revenue/tips.
    // finalPriceCents is ALWAYS net-of-tax, post-discount service revenue —
    // reporting reads COALESCE(final_price_cents, total_price) as tax-free revenue.
    finalPriceCents: integer('final_price_cents'), // Actual amount charged (defaults to booked total)
    tipCents: integer('tip_cents').notNull().default(0),
    paymentMethod: text('payment_method'), // PaymentMethod ('cash' | 'debit' | ... | 'other')

    // Checkout record (0058). All nullable: NULL = not recorded (historic rows
    // are never recalculated). totalDue = finalPriceCents + taxAmountCents + tipCents.
    actualStartAt: timestamp('actual_start_at', { mode: 'date', withTimezone: true }),
    actualEndAt: timestamp('actual_end_at', { mode: 'date', withTimezone: true }),
    finalSubtotalCents: integer('final_subtotal_cents'), // final items sum (as displayed), pre-discount
    finalDiscountCents: integer('final_discount_cents'), // checkout-time discount on displayed prices
    finalDiscountReason: text('final_discount_reason'),
    amountPaidCents: integer('amount_paid_cents'), // SUM of non-voided appointment_payment rows

    // Tax snapshot at completion — frozen forever; changing salon tax settings
    // must never recalculate completed appointments.
    taxEnabledSnapshot: boolean('tax_enabled_snapshot'),
    taxNameSnapshot: text('tax_name_snapshot'),
    taxRateBps: integer('tax_rate_bps'), // basis points (13% = 1300)
    taxInclusive: boolean('tax_inclusive'), // true = prices include tax; false = tax added at checkout
    taxAmountCents: integer('tax_amount_cents'),
    taxableSubtotalCents: integer('taxable_subtotal_cents'),
    taxExempt: boolean('tax_exempt'),
    taxExemptReason: text('tax_exempt_reason'),
    // Authoritative D6.1 invoice-issue snapshot. The older scalar columns above
    // remain mapped for compatibility; this JSON preserves configuration
    // identity and actual-vs-estimate classification as one typed value.
    finalTaxSnapshot: jsonb('final_tax_snapshot')
      .$type<import('@/libs/taxConfig').FinalTaxSnapshot>(),

    // Post-appointment review follow-up (what the tech chose to send)
    reviewFollowupAction: text('review_followup_action'), // 'satisfaction_question' | 'google_review_link' | 'skipped' | 'already_reviewed'
    reviewFollowupSentAt: timestamp('review_followup_sent_at', { mode: 'date', withTimezone: true }),
    reviewFollowupSentBy: text('review_followup_sent_by').references(() => technicianSchema.id),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('appointment_salon_idx').on(table.salonId),
    clientIdx: index('appointment_client_idx').on(table.clientPhone),
    dateIdx: index('appointment_date_idx').on(table.salonId, table.startTime),
    statusIdx: index('appointment_status_idx').on(table.salonId, table.status),
    techStartTimeIdx: index('appointment_tech_start_time_idx').on(table.technicianId, table.startTime),
    salonTechStartTimeIdx: index('appointment_salon_tech_start_time_idx').on(table.salonId, table.technicianId, table.startTime),
    deletedAtIdx: index('appointment_deleted_at_idx').on(table.deletedAt),
    invoiceCurrencyValid: check(
      'appointment_invoice_currency_valid',
      sql`${table.invoiceCurrency} is null or ${table.invoiceCurrency} in ('CAD', 'USD')`,
    ),
    // Fraud detection: basic composite for salonClientId lookups
    salonClientIdx: index('appointment_salon_client_idx').on(table.salonId, table.salonClientId),
    // Supports tenant-safe child references that bind an appointment to its
    // owning salon rather than trusting appointment_id by itself.
    salonIdIdIdx: uniqueIndex('appointment_salon_id_id_idx').on(
      table.salonId,
      table.id,
    ),
    // NOTE: For fraud queries, use PARTIAL INDEX via raw SQL migration (most efficient):
    // CREATE INDEX appt_fraud_lookup_idx
    // ON appointment (salon_id, salon_client_id, completed_at)
    // WHERE status = 'completed' AND payment_status = 'paid';
    // (Drizzle doesn't support partial indexes - add via migration only)
  }),
);

// -----------------------------------------------------------------------------
// AppointmentBookingPolicyAcknowledgment - Append-only evidence of the exact
// customer-visible booking policy accepted for one public booking attempt.
// Public rescheduling is reserved by the source constraint but is not written
// by the new-booking acknowledgment release.
// -----------------------------------------------------------------------------
export const appointmentBookingPolicyAcknowledgmentSchema = pgTable(
  'appointment_booking_policy_acknowledgment',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull(),
    appointmentId: text('appointment_id').notNull(),
    policyVersion: text('policy_version').notNull(),
    policyTitleSnapshot: text('policy_title_snapshot').notNull(),
    policyTextSnapshot: text('policy_text_snapshot').notNull(),
    acknowledgmentTextSnapshot: text('acknowledgment_text_snapshot').notNull(),
    source: text('source')
      .$type<'public_booking' | 'public_reschedule'>()
      .notNull(),
    scheduledStartAtSnapshot: timestamp('scheduled_start_at_snapshot', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    scheduledEndAtSnapshot: timestamp('scheduled_end_at_snapshot', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    attemptId: uuid('attempt_id').notNull(),
    requestHash: text('request_hash').notNull(),
    appointmentUpdatedAtSnapshot: timestamp(
      'appointment_updated_at_snapshot',
      { mode: 'date', withTimezone: true },
    ).notNull(),
    // Reserved for the atomic-move release. Initial public bookings persist
    // NULL because no reservation revision exists yet.
    reservationRevisionSnapshot: integer('reservation_revision_snapshot'),
    acknowledgedAt: timestamp('acknowledged_at', {
      mode: 'date',
      withTimezone: true,
    }).defaultNow().notNull(),
  },
  table => ({
    sourceValid: check(
      'appointment_booking_policy_ack_source_valid',
      sql`${table.source} IN ('public_booking', 'public_reschedule')`,
    ),
    versionValid: check(
      'appointment_booking_policy_ack_version_valid',
      sql`${table.policyVersion} ~ '^policy-v1:[0-9a-f]{64}$'`,
    ),
    titleValid: check(
      'appointment_booking_policy_ack_title_valid',
      sql`char_length(${table.policyTitleSnapshot}) BETWEEN 1 AND 60
        AND char_length(btrim(${table.policyTitleSnapshot})) > 0`,
    ),
    policyTextValid: check(
      'appointment_booking_policy_ack_policy_text_valid',
      sql`char_length(${table.policyTextSnapshot}) BETWEEN 1 AND 1500
        AND char_length(btrim(${table.policyTextSnapshot})) > 0`,
    ),
    acknowledgmentTextValid: check(
      'appointment_booking_policy_ack_text_valid',
      sql`char_length(${table.acknowledgmentTextSnapshot}) BETWEEN 1 AND 220
        AND char_length(btrim(${table.acknowledgmentTextSnapshot})) > 0`,
    ),
    requestHashValid: check(
      'appointment_booking_policy_ack_request_hash_valid',
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    scheduleValid: check(
      'appointment_booking_policy_ack_schedule_valid',
      sql`${table.scheduledEndAtSnapshot} > ${table.scheduledStartAtSnapshot}`,
    ),
    reservationRevisionValid: check(
      'appointment_booking_policy_ack_revision_valid',
      sql`${table.reservationRevisionSnapshot} IS NULL OR ${table.reservationRevisionSnapshot} >= 0`,
    ),
    salonFk: foreignKey({
      columns: [table.salonId],
      foreignColumns: [salonSchema.id],
      name: 'appointment_booking_policy_ack_salon_fk',
    }).onDelete('cascade'),
    appointmentTenantFk: foreignKey({
      columns: [table.salonId, table.appointmentId],
      foreignColumns: [appointmentSchema.salonId, appointmentSchema.id],
      name: 'appointment_booking_policy_ack_appointment_fk',
    }).onDelete('cascade'),
    attemptUnique: uniqueIndex(
      'booking_policy_ack_attempt_unique',
    ).on(
      table.salonId,
      table.source,
      table.attemptId,
    ),
    appointmentScheduleIdx: index(
      'appointment_booking_policy_ack_history_idx',
    ).on(
      table.salonId,
      table.appointmentId,
      table.source,
      table.scheduledStartAtSnapshot,
      table.scheduledEndAtSnapshot,
      table.acknowledgedAt,
    ),
  }),
);

// -----------------------------------------------------------------------------
// AppointmentServices - Junction table for multi-service bookings
// -----------------------------------------------------------------------------
export const appointmentServicesSchema = pgTable(
  'appointment_services',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceSchema.id),

    // Price snapshot at booking time (in case service price changes later)
    priceAtBooking: integer('price_at_booking').notNull(),

    // Duration snapshot (in case service duration changes later)
    durationAtBooking: integer('duration_at_booking').notNull(),

    // Historical snapshot fields - render appointments from these, not live services.
    nameSnapshot: text('name_snapshot'),
    categorySnapshot: text('category_snapshot'),
    priceCentsSnapshot: integer('price_cents_snapshot'),
    durationMinutesSnapshot: integer('duration_minutes_snapshot'),
    priceDisplayTextSnapshot: text('price_display_text_snapshot'),
    resolvedIntroPriceLabelSnapshot: text('resolved_intro_price_label_snapshot'),
  },
  table => ({
    appointmentIdx: index('appt_services_appointment_idx').on(table.appointmentId),
    serviceIdx: index('appt_services_service_idx').on(table.serviceId),
    // Prevent duplicate service in same appointment
    uniqueApptService: uniqueIndex('unique_appt_service').on(
      table.appointmentId,
      table.serviceId,
    ),
  }),
);

// -----------------------------------------------------------------------------
// ServiceAddOn - Allowed add-ons for a service
// -----------------------------------------------------------------------------
export const serviceAddOnSchema = pgTable(
  'service_add_on',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => serviceSchema.id, { onDelete: 'cascade' }),
    addOnId: text('add_on_id')
      .notNull()
      .references(() => addOnSchema.id, { onDelete: 'cascade' }),
    selectionMode: serviceAddOnSelectionModeEnum('selection_mode').notNull().default('optional'),
    conditions: jsonb('conditions').$type<Record<string, unknown> | null>().default(null),
    defaultQuantity: integer('default_quantity'),
    maxQuantityOverride: integer('max_quantity_override'),
    displayOrder: integer('display_order').default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('service_add_on_salon_idx').on(table.salonId),
    serviceIdx: index('service_add_on_service_idx').on(table.serviceId),
    uniqueMappingIdx: uniqueIndex('service_add_on_unique_idx').on(table.serviceId, table.addOnId),
  }),
);

// -----------------------------------------------------------------------------
// AppointmentAddOn - Snapshots optional extras selected at booking time
// -----------------------------------------------------------------------------
export const appointmentAddOnSchema = pgTable(
  'appointment_add_on',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    addOnId: text('add_on_id').references(() => addOnSchema.id),
    quantitySnapshot: integer('quantity_snapshot').notNull().default(1),
    nameSnapshot: text('name_snapshot').notNull(),
    categorySnapshot: text('category_snapshot').notNull(),
    pricingTypeSnapshot: text('pricing_type_snapshot').notNull(),
    unitPriceCentsSnapshot: integer('unit_price_cents_snapshot').notNull(),
    durationMinutesSnapshot: integer('duration_minutes_snapshot').notNull(),
    lineTotalCentsSnapshot: integer('line_total_cents_snapshot').notNull(),
    lineDurationMinutesSnapshot: integer('line_duration_minutes_snapshot').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    appointmentIdx: index('appointment_add_on_appointment_idx').on(table.appointmentId),
    addOnIdx: index('appointment_add_on_add_on_idx').on(table.addOnId),
  }),
);

// -----------------------------------------------------------------------------
// AppointmentFinalItem - What was actually performed, captured at checkout.
// The booked snapshot (appointment_services / appointment_add_on) is IMMUTABLE;
// final items are a separate record so the original booking is never lost.
// Display rule: finalItems.length ? finalItems : bookedItems.
// -----------------------------------------------------------------------------
export const appointmentFinalItemSchema = pgTable(
  'appointment_final_item',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'service' | 'addon' | 'custom'
    catalogServiceId: text('catalog_service_id').references(() => serviceSchema.id),
    catalogAddOnId: text('catalog_add_on_id').references(() => addOnSchema.id),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
    durationMinutes: integer('duration_minutes'),
    taxable: boolean('taxable').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    appointmentIdx: index('appt_final_item_appointment_idx').on(table.appointmentId),
  }),
);

// -----------------------------------------------------------------------------
// AppointmentPayment - One row per recorded payment. Multiple payments per
// appointment are supported (partial payments); corrections are voids, never
// deletes. appointment.amount_paid_cents is recomputed from non-voided rows.
// -----------------------------------------------------------------------------
export const appointmentPaymentSchema = pgTable(
  'appointment_payment',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(), // > 0 (CHECK in migration)
    method: text('method'), // PaymentMethod
    reference: text('reference'), // e.g. e-Transfer confirmation number
    note: text('note'),
    // Client/request-supplied durable retry identity. Historical rows are NULL;
    // the partial unique index applies only when a caller supplies a key.
    idempotencyKey: text('idempotency_key'),
    recordedByType: text('recorded_by_type').notNull(), // 'admin' | 'staff' | 'system'
    recordedById: text('recorded_by_id'),
    recordedByName: text('recorded_by_name'),
    recordedAt: timestamp('recorded_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    voidedAt: timestamp('voided_at', { mode: 'date', withTimezone: true }),
    voidedBy: text('voided_by'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    appointmentTenantFk: foreignKey({
      name: 'appointment_payment_appointment_tenant_fk',
      columns: [table.salonId, table.appointmentId],
      foreignColumns: [appointmentSchema.salonId, appointmentSchema.id],
    }).onDelete('cascade'),
    appointmentIdx: index('appt_payment_appointment_idx').on(table.appointmentId),
    salonRecordedIdx: index('appt_payment_salon_recorded_idx').on(table.salonId, table.recordedAt),
    tenantIdempotencyUniq: uniqueIndex('appointment_payment_tenant_idempotency_uniq')
      .on(table.salonId, table.appointmentId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  }),
);

// -----------------------------------------------------------------------------
// AppointmentPaymentLink - Opaque token for the public payment-instruction
// page (QR). Token stored sha256-hashed; page shows salon-side data only.
// Revoked when the appointment is fully paid or reopened.
// -----------------------------------------------------------------------------
export const appointmentPaymentLinkSchema = pgTable(
  'appointment_payment_link',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    tokenIdx: uniqueIndex('appointment_payment_link_token_idx').on(table.tokenHash),
    appointmentIdx: index('appointment_payment_link_appointment_idx').on(table.salonId, table.appointmentId),
  }),
);

// -----------------------------------------------------------------------------
// AppointmentPhoto - Photos uploaded by technicians for completed appointments
// -----------------------------------------------------------------------------
export const appointmentPhotoSchema = pgTable(
  'appointment_photo',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Use normalized 10-digit phone (matches phone-handling.mdc rule)
    normalizedClientPhone: text('normalized_client_phone').notNull(),

    // Photo type: before/after the service
    photoType: text('photo_type').notNull().default('after'), // 'before' | 'after'

    // Cloud storage (Cloudinary)
    cloudinaryPublicId: text('cloudinary_public_id').notNull(),
    imageUrl: text('image_url').notNull(),
    thumbnailUrl: text('thumbnail_url'),

    // Optional metadata
    caption: text('caption'), // e.g. "BIAB + chrome, almond"
    isPublic: boolean('is_public').default(false), // for salon marketing gallery later

    // Who uploaded
    uploadedByTechId: text('uploaded_by_tech_id').references(
      () => technicianSchema.id,
    ),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    appointmentIdx: index('photo_appointment_idx').on(table.appointmentId),
    clientIdx: index('photo_client_phone_idx').on(table.normalizedClientPhone),
    salonIdx: index('photo_salon_idx').on(table.salonId),
    typeIdx: index('photo_type_idx').on(table.appointmentId, table.photoType),
  }),
);

// -----------------------------------------------------------------------------
// Client - Customer profiles keyed by phone number
// -----------------------------------------------------------------------------
export const clientSchema = pgTable(
  'client',
  {
    id: text('id').primaryKey(),
    phone: text('phone').notNull().unique(),
    firstName: text('first_name'),
    email: text('email'),
    profileCompletionRewardGranted: boolean('profile_completion_reward_granted').default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    phoneIdx: uniqueIndex('client_phone_idx').on(table.phone),
  }),
);

// -----------------------------------------------------------------------------
// SalonClient - Salon-scoped client profiles (multi-tenant)
// Links a global client to a specific salon with salon-specific data
// -----------------------------------------------------------------------------
export const salonClientSchema = pgTable(
  'salon_client',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Link to global client (for auth/identity)
    clientId: text('client_id').references(() => clientSchema.id),

    // Identity (can override global client data per salon)
    phone: text('phone').notNull(), // normalized 10-digit
    fullName: text('full_name'),
    email: text('email'),
    birthday: date('birthday'),

    // Preferences
    preferredTechnicianId: text('preferred_technician_id').references(
      () => technicianSchema.id,
    ),
    notes: text('notes'), // internal staff notes
    sensitivities: text('sensitivities'),
    nailPreferences: jsonb('nail_preferences').$type<{
      shape?: string;
      length?: string;
      favoriteColors?: string;
      productsUsed?: string;
    }>().default({}),
    tags: jsonb('tags').$type<string[]>().default([]),
    rebookIntervalDays: integer('rebook_interval_days'),
    nextRebookDueAt: timestamp('next_rebook_due_at', { mode: 'date', withTimezone: true }),
    lastContactAt: timestamp('last_contact_at', { mode: 'date', withTimezone: true }),

    // Computed stats (updated after each booking)
    lastVisitAt: timestamp('last_visit_at', { mode: 'date', withTimezone: true }),
    totalVisits: integer('total_visits').default(0),
    totalSpent: integer('total_spent').default(0), // in cents
    noShowCount: integer('no_show_count').default(0),
    loyaltyPoints: integer('loyalty_points').default(0),

    // Welcome bonus tracking (Step 21A - one-time 25,000 points)
    welcomeBonusGrantedAt: timestamp('welcome_bonus_granted_at', { mode: 'date' }),

    // Google review tracking (client-level source of truth).
    // Once true, the post-appointment review prompt is suppressed for this client.
    hasGoogleReview: boolean('has_google_review').notNull().default(false),
    googleReviewMarkedAt: timestamp('google_review_marked_at', { mode: 'date' }),
    googleReviewMarkedBy: text('google_review_marked_by'), // technician id who marked it

    // Late cancellation tracking (Step 16A - client accountability)
    lateCancelCount: integer('late_cancel_count').default(0),
    lastLateCancelAt: timestamp('last_late_cancel_at', { mode: 'date', withTimezone: true }),

    // Admin-only client flags (Step 16A - problem client management)
    adminFlags: jsonb('admin_flags').$type<{
      isProblemClient?: boolean;
      flagReason?: string;
      flaggedAt?: string;
      flaggedBy?: string;
    }>(),
    isBlocked: boolean('is_blocked').default(false),
    blockedReason: text('blocked_reason'),

    archivedAt: timestamp('archived_at', { mode: 'date', withTimezone: true }),
    archivedBy: text('archived_by'),
    mergedIntoClientId: text('merged_into_client_id'),
    mergedAt: timestamp('merged_at', { mode: 'date', withTimezone: true }),
    mergedBy: text('merged_by'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    // Unique constraint: one profile per client per salon
    uniqueSalonClient: uniqueIndex('salon_client_salon_client_idx').on(
      table.salonId,
      table.clientId,
    ),
    // Unique constraint: one profile per phone per salon
    uniqueSalonPhone: uniqueIndex('salon_client_salon_phone_idx').on(
      table.salonId,
      table.phone,
    ),
    sameSalonMergeTarget: foreignKey({
      columns: [table.salonId, table.mergedIntoClientId],
      foreignColumns: [table.salonId, table.id],
      name: 'salon_client_merged_into_client_id_fkey',
    }).onDelete('restrict'),
    salonIdIdIdx: uniqueIndex('salon_client_salon_id_id_idx').on(
      table.salonId,
      table.id,
    ),
    // Search indexes
    salonIdx: index('salon_client_salon_idx').on(table.salonId),
    phoneIdx: index('salon_client_phone_idx').on(table.phone),
    emailIdx: index('salon_client_email_idx').on(table.salonId, table.email),
    lastVisitIdx: index('salon_client_last_visit_idx').on(
      table.salonId,
      table.lastVisitAt,
    ),
    lifecycleIdx: index('salon_client_lifecycle_idx').on(
      table.salonId,
      table.archivedAt,
      table.mergedIntoClientId,
    ),
    mergedIntoIdx: index('salon_client_merged_into_idx').on(
      table.salonId,
      table.mergedIntoClientId,
    ),
  }),
);

export const salonClientContactAliasSchema = pgTable(
  'salon_client_contact_alias',
  {
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    salonClientId: text('salon_client_id')
      .notNull()
      .references(() => salonClientSchema.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'phone' | 'email'>().notNull(),
    normalizedValue: text('normalized_value').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    kindValid: check(
      'salon_client_contact_alias_kind_valid',
      sql`${table.kind} IN ('phone', 'email')`,
    ),
    valueNonempty: check(
      'salon_client_contact_alias_value_nonempty',
      sql`length(${table.normalizedValue}) > 0`,
    ),
    uniqueSalonContact: uniqueIndex('salon_client_contact_alias_unique').on(
      table.salonId,
      table.kind,
      table.normalizedValue,
    ),
    clientIdx: index('salon_client_contact_alias_client_idx').on(
      table.salonId,
      table.salonClientId,
    ),
  }),
);

export const salonClientNoteSchema = pgTable(
  'salon_client_note',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    salonClientId: text('salon_client_id')
      .notNull()
      .references(() => salonClientSchema.id, { onDelete: 'cascade' }),
    sourceClientId: text('source_client_id'),
    body: text('body').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    bodyNonempty: check(
      'salon_client_note_body_nonempty',
      sql`length(btrim(${table.body})) > 0`,
    ),
    clientCreatedIdx: index('salon_client_note_client_created_idx').on(
      table.salonId,
      table.salonClientId,
      table.createdAt,
    ),
    sourceIdx: index('salon_client_note_source_idx').on(
      table.salonId,
      table.sourceClientId,
    ),
  }),
);

export const appSchemaCapabilitySchema = pgTable(
  'app_schema_capability',
  {
    capability: text('capability').primaryKey(),
    version: integer('version').notNull(),
    state: text('state').$type<'ready'>().notNull(),
    mergeWritesEnabled: boolean('merge_writes_enabled').notNull().default(false),
    installedAt: timestamp('installed_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    stateValid: check(
      'app_schema_capability_state_valid',
      sql`${table.state} = 'ready'`,
    ),
    versionPositive: check(
      'app_schema_capability_version_positive',
      sql`${table.version} > 0`,
    ),
    mergeWritesDisabled: check(
      'app_schema_capability_merge_writes_disabled',
      sql`${table.mergeWritesEnabled} = false`,
    ),
  }),
);

// -----------------------------------------------------------------------------
// Retention assistant settings - one durable configuration row per salon
// -----------------------------------------------------------------------------
export const salonRetentionSettingsSchema = pgTable(
  'salon_retention_settings',
  {
    salonId: text('salon_id')
      .primaryKey()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    defaultRebookDays: integer('default_rebook_days').notNull().default(21),
    reminderLeadHours: integer('reminder_lead_hours').notNull().default(24),
    googleReviewUrl: text('google_review_url'),
    parkingInstructions: text('parking_instructions'),
    sixWeekPromotion: jsonb('six_week_promotion')
      .$type<import('@/types/retention').RetentionPromotionSettings>()
      .notNull()
      .default({
        enabled: false,
        name: 'We miss you',
        discountType: 'percent',
        value: 0,
        eligibleServiceIds: [],
        expiryDays: 14,
        code: null,
        messageTemplate: 'Hi {firstName}, we miss you at {salonName}! Enjoy {offer} when you book by {expiry}: {bookingLink}',
        singleUse: true,
      }),
    eightWeekPromotion: jsonb('eight_week_promotion')
      .$type<import('@/types/retention').RetentionPromotionSettings>()
      .notNull()
      .default({
        enabled: false,
        name: 'Come back soon',
        discountType: 'percent',
        value: 0,
        eligibleServiceIds: [],
        expiryDays: 14,
        code: null,
        messageTemplate: 'Hi {firstName}, we would love to see you again at {salonName}. Enjoy {offer} when you book by {expiry}: {bookingLink}',
        singleUse: true,
      }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

// -----------------------------------------------------------------------------
// Client communication - honest, salon-scoped outreach history and queue state
// -----------------------------------------------------------------------------
export const clientCommunicationSchema = pgTable(
  'client_communication',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    salonClientId: text('salon_client_id')
      .notNull()
      .references(() => salonClientSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id').references(() => appointmentSchema.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('prepared'),
    dueAt: timestamp('due_at', { mode: 'date', withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { mode: 'date', withTimezone: true }),
    messageSnapshot: text('message_snapshot'),
    destinationSnapshot: text('destination_snapshot'),
    metadata: jsonb('metadata').$type<import('@/types/retention').ClientCommunicationMetadata>().default({}),
    preparedAt: timestamp('prepared_at', { mode: 'date', withTimezone: true }),
    markedSentAt: timestamp('marked_sent_at', { mode: 'date', withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { mode: 'date', withTimezone: true }),
    convertedAt: timestamp('converted_at', { mode: 'date', withTimezone: true }),
    actorAdminId: text('actor_admin_id'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonClientCreatedIdx: index('client_communication_salon_client_created_idx').on(
      table.salonId,
      table.salonClientId,
      table.createdAt,
    ),
    appointmentIdx: index('client_communication_appointment_idx').on(
      table.salonId,
      table.appointmentId,
    ),
    queueIdx: index('client_communication_queue_idx').on(
      table.salonId,
      table.kind,
      table.status,
      table.snoozedUntil,
    ),
    // Mirrors migrations/0055: at most one prepared/snoozed retention stage
    // per client. Declared here too so PGlite-backed tests enforce the same
    // invariant production does. (Migrations are hand-authored SQL — keep the
    // two definitions in sync.)
    activeRetentionUnique: uniqueIndex('client_communication_active_retention_unique')
      .on(table.salonId, table.salonClientId)
      .where(sql`"kind" IN ('rebook', 'promo_6w', 'promo_8w') AND "status" IN ('prepared', 'snoozed')`),
  }),
);

// -----------------------------------------------------------------------------
// Retention campaign - stores only a hash of the client-facing opaque token
// -----------------------------------------------------------------------------
export const retentionCampaignSchema = pgTable(
  'retention_campaign',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    salonClientId: text('salon_client_id')
      .notNull()
      .references(() => salonClientSchema.id, { onDelete: 'cascade' }),
    communicationId: text('communication_id').references(() => clientCommunicationSchema.id, { onDelete: 'set null' }),
    tokenHash: text('token_hash').notNull(),
    stage: text('stage').notNull(),
    promotionSnapshot: jsonb('promotion_snapshot')
      .$type<import('@/types/retention').RetentionPromotionSettings>()
      .notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    singleUse: boolean('single_use').notNull().default(true),
    redeemedAt: timestamp('redeemed_at', { mode: 'date', withTimezone: true }),
    redeemedAppointmentId: text('redeemed_appointment_id').references(() => appointmentSchema.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    tokenHashIdx: uniqueIndex('retention_campaign_token_hash_idx').on(table.tokenHash),
    salonClientIdx: index('retention_campaign_salon_client_idx').on(
      table.salonId,
      table.salonClientId,
      table.createdAt,
    ),
    redeemedAppointmentIdx: index('retention_campaign_redeemed_appointment_idx').on(table.redeemedAppointmentId),
  }),
);

export const retentionCampaignRedemptionSchema = pgTable(
  'retention_campaign_redemption',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => retentionCampaignSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    discountAmountCents: integer('discount_amount_cents').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    campaignIdx: index('retention_campaign_redemption_campaign_idx').on(table.campaignId, table.createdAt),
    appointmentIdx: uniqueIndex('retention_campaign_redemption_appointment_idx').on(table.appointmentId),
  }),
);

// -----------------------------------------------------------------------------
// Referral - Track referrals sent by clients (link-based flow)
// -----------------------------------------------------------------------------
export const referralSchema = pgTable(
  'referral',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Who sent the referral
    referrerPhone: text('referrer_phone').notNull(),
    referrerName: text('referrer_name'),

    // Who was referred (filled when they claim the referral)
    refereePhone: text('referee_phone'), // Nullable - filled on claim
    refereeName: text('referee_name'), // Filled on claim

    // Status tracking
    // 'sent' = Link generated, waiting for claim
    // 'claimed' = Friend verified, waiting for booking
    // 'booked' = Friend created booking within 14 days
    // 'reward_earned' = First booking completed, referrer credited
    // 'expired' = 14 days passed without booking
    status: text('status').notNull().default('sent'),

    // Claim tracking (14-day expiration rule)
    claimedAt: timestamp('claimed_at', { mode: 'date' }), // When friend verified
    expiresAt: timestamp('expires_at', { mode: 'date' }), // claimedAt + 14 days

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('referral_salon_idx').on(table.salonId),
    referrerIdx: index('referral_referrer_idx').on(table.salonId, table.referrerPhone),
    refereeIdx: index('referral_referee_idx').on(table.refereePhone),
  }),
);

// -----------------------------------------------------------------------------
// Reward - Track rewards earned from referrals
// -----------------------------------------------------------------------------
export const rewardSchema = pgTable(
  'reward',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Who owns this reward
    clientPhone: text('client_phone').notNull(),
    clientName: text('client_name'),

    // Link to referral that created this reward
    referralId: text('referral_id').references(() => referralSchema.id),

    // Type: 'referral_referee' (friend who was referred)
    //       'referral_referrer' (person who sent referral)
    type: text('type').notNull(),

    // Legacy points value for catalog / historical rewards.
    points: integer('points').notNull().default(0),

    // Explicit discount shape for issued rewards (referrals, review rewards).
    discountType: text('discount_type').$type<'fixed_amount' | 'percentage' | 'service'>(),
    discountAmountCents: integer('discount_amount_cents'),
    discountPercent: integer('discount_percent'),

    // Eligible service for legacy service-specific rewards.
    eligibleServiceName: text('eligible_service_name').default('Gel Manicure'),

    // Status: 'active' | 'used' | 'expired'
    status: text('status').notNull().default('active'),

    // Expiration and usage tracking
    expiresAt: timestamp('expires_at', { mode: 'date' }),
    usedAt: timestamp('used_at', { mode: 'date' }),
    usedInAppointmentId: text('used_in_appointment_id').references(() => appointmentSchema.id),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('reward_salon_idx').on(table.salonId),
    clientIdx: index('reward_client_idx').on(table.clientPhone),
    referralIdx: index('reward_referral_idx').on(table.referralId),
    statusIdx: index('reward_status_idx').on(table.clientPhone, table.status),
  }),
);

// -----------------------------------------------------------------------------
// Review - Post-appointment reviews from clients (Step 21B)
// -----------------------------------------------------------------------------
export const reviewSchema = pgTable(
  'review',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Link to appointment (one review per appointment - enforced by unique index)
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id),

    // Who wrote the review (linked to salon client for proper identity)
    salonClientId: text('salon_client_id')
      .notNull()
      .references(() => salonClientSchema.id),

    // Snapshot of client name at time of review (for display even if client changes name)
    clientNameSnapshot: text('client_name_snapshot'),

    // Optional: which technician was reviewed
    technicianId: text('technician_id').references(() => technicianSchema.id),

    // Review content
    rating: integer('rating').notNull(), // 1-5 stars
    comment: text('comment'), // Optional text feedback

    // Admin moderation
    isPublic: boolean('is_public').default(true),
    adminHidden: boolean('admin_hidden').default(false),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('review_salon_idx').on(table.salonId),
    // UNIQUE constraint: one review per appointment (prevents duplicates)
    appointmentIdx: uniqueIndex('review_appointment_idx').on(table.appointmentId),
    technicianIdx: index('review_technician_idx').on(table.technicianId),
    salonClientIdx: index('review_salon_client_idx').on(table.salonClientId),
    ratingIdx: index('review_rating_idx').on(table.salonId, table.rating),
  }),
);

// -----------------------------------------------------------------------------
// ClientPreferences - Client style preferences per salon (multi-tenant)
// -----------------------------------------------------------------------------
export const clientPreferencesSchema = pgTable(
  'client_preferences',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Client identification (normalized 10-digit phone)
    normalizedClientPhone: text('normalized_client_phone').notNull(),

    // Favorite technician (FK to technician within this salon)
    favoriteTechId: text('favorite_tech_id').references(() => technicianSchema.id),

    // Preferences stored as JSON arrays
    favoriteServices: jsonb('favorite_services').$type<string[]>(),
    nailShape: text('nail_shape'),
    nailLength: text('nail_length'),
    finishes: jsonb('finishes').$type<string[]>(),
    colorFamilies: jsonb('color_families').$type<string[]>(),
    preferredBrands: jsonb('preferred_brands').$type<string[]>(),
    sensitivities: jsonb('sensitivities').$type<string[]>(),

    // Salon experience preferences
    musicPreference: text('music_preference'),
    conversationLevel: text('conversation_level'),
    beveragePreference: jsonb('beverage_preferences').$type<string[]>(),

    // Notes
    techNotes: text('tech_notes'),
    appointmentNotes: text('appointment_notes'),

    // Timestamps
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    // Unique constraint: one preferences row per client per salon
    uniqueClientSalon: uniqueIndex('client_prefs_salon_phone_idx').on(
      table.salonId,
      table.normalizedClientPhone,
    ),
    salonIdx: index('client_prefs_salon_idx').on(table.salonId),
    clientIdx: index('client_prefs_client_idx').on(table.normalizedClientPhone),
  }),
);

// -----------------------------------------------------------------------------
// TechnicianTimeOff - Track vacation, sick days, personal time
// -----------------------------------------------------------------------------
export const technicianTimeOffSchema = pgTable(
  'technician_time_off',
  {
    id: text('id').primaryKey(),
    technicianId: text('technician_id')
      .notNull()
      .references(() => technicianSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Time off period
    startDate: timestamp('start_date', { mode: 'date' }).notNull(),
    endDate: timestamp('end_date', { mode: 'date' }).notNull(),

    // Reason for time off
    reason: text('reason'), // 'vacation' | 'sick' | 'personal' | 'training' | 'other'
    notes: text('notes'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    technicianIdx: index('time_off_technician_idx').on(table.technicianId),
    salonIdx: index('time_off_salon_idx').on(table.salonId),
    dateRangeIdx: index('time_off_date_range_idx').on(table.technicianId, table.startDate, table.endDate),
  }),
);

// -----------------------------------------------------------------------------
// TechnicianBlockedSlot - Block specific time slots (lunch, breaks, cleaning)
// -----------------------------------------------------------------------------
export const technicianBlockedSlotSchema = pgTable(
  'technician_blocked_slot',
  {
    id: text('id').primaryKey(),
    technicianId: text('technician_id')
      .notNull()
      .references(() => technicianSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // For recurring blocks (e.g., daily lunch break)
    dayOfWeek: integer('day_of_week'), // 0=Sunday, 6=Saturday (null if one-time)
    startTime: text('start_time').notNull(), // "12:00"
    endTime: text('end_time').notNull(), // "13:00"

    // For one-time blocks (specific date)
    specificDate: timestamp('specific_date', { mode: 'date' }), // null if recurring

    // Description
    label: text('label'), // "Lunch", "Cleaning", "Personal"
    isRecurring: boolean('is_recurring').default(true),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    technicianIdx: index('blocked_slot_technician_idx').on(table.technicianId),
    salonIdx: index('blocked_slot_salon_idx').on(table.salonId),
    dayIdx: index('blocked_slot_day_idx').on(table.technicianId, table.dayOfWeek),
  }),
);

// -----------------------------------------------------------------------------
// TechnicianScheduleOverride - Per-date availability overrides
// Overrides weekly schedule for specific dates (off days or custom hours)
// -----------------------------------------------------------------------------
export const technicianScheduleOverrideSchema = pgTable(
  'technician_schedule_override',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    technicianId: text('technician_id')
      .notNull()
      .references(() => technicianSchema.id, { onDelete: 'cascade' }),

    // Single date for this override
    date: text('date').notNull(), // YYYY-MM-DD format

    // Type: 'off' = day off, 'hours' = custom working hours
    type: text('type').notNull(), // 'off' | 'hours'

    // Custom hours (required when type='hours')
    startTime: text('start_time'), // "HH:mm" format
    endTime: text('end_time'), // "HH:mm" format

    // Optional note
    note: text('note'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    // One override per technician per day
    uniqueTechDate: uniqueIndex('schedule_override_tech_date_idx').on(table.technicianId, table.date),
    salonIdx: index('schedule_override_salon_idx').on(table.salonId),
    dateIdx: index('schedule_override_date_idx').on(table.technicianId, table.date),
  }),
);

// -----------------------------------------------------------------------------
// SalonPageAppearance - Per-page theme settings (custom vs themed)
// -----------------------------------------------------------------------------
export const salonPageAppearanceSchema = pgTable(
  'salon_page_appearance',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Page identifier: 'rewards' | 'profile' | 'gallery' | 'book-service' | etc.
    pageName: text('page_name').notNull(),

    // Mode: 'custom' = use existing styles (no theme), 'theme' = use themeKey
    mode: text('mode').notNull().default('custom'),

    // Theme key when mode = 'theme': 'espresso' | 'lavender' | etc.
    themeKey: text('theme_key'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    uniqueSalonPage: uniqueIndex('salon_page_appearance_unique').on(table.salonId, table.pageName),
    salonIdx: index('salon_page_appearance_salon_idx').on(table.salonId),
  }),
);

// -----------------------------------------------------------------------------
// SalonAuditLog - Track super admin actions on salons
// -----------------------------------------------------------------------------
export const salonAuditLogSchema = pgTable(
  'salon_audit_log',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Action performed
    action: text('action').notNull(), // 'created' | 'updated' | 'deleted' | 'restored' | 'owner_changed' | 'plan_changed' | 'status_changed' | 'data_reset'

    // Who performed the action
    performedBy: text('performed_by').notNull(), // Clerk user ID
    performedByEmail: text('performed_by_email'),

    // Additional metadata (JSON)
    metadata: jsonb('metadata').$type<{
      previousValue?: unknown;
      newValue?: unknown;
      field?: string;
      details?: string;
    }>(),

    // Timestamp
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    salonIdx: index('audit_log_salon_idx').on(table.salonId),
    actionIdx: index('audit_log_action_idx').on(table.action),
    createdIdx: index('audit_log_created_idx').on(table.createdAt),
  }),
);

// -----------------------------------------------------------------------------
// SalonLocation - Multi-location support for salons
// -----------------------------------------------------------------------------
export const salonLocationSchema = pgTable(
  'salon_location',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Location details
    name: text('name').notNull(),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    zipCode: text('zip_code'),
    phone: text('phone'),
    email: text('email'),

    // Operating hours (same format as salon)
    businessHours: jsonb('business_hours').$type<{
      monday: { open: string; close: string } | null;
      tuesday: { open: string; close: string } | null;
      wednesday: { open: string; close: string } | null;
      thursday: { open: string; close: string } | null;
      friday: { open: string; close: string } | null;
      saturday: { open: string; close: string } | null;
      sunday: { open: string; close: string } | null;
    }>(),

    // Status
    isPrimary: boolean('is_primary').default(false),
    isActive: boolean('is_active').default(true),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('location_salon_idx').on(table.salonId),
    primaryIdx: index('location_primary_idx').on(table.salonId, table.isPrimary),
  }),
);

// =============================================================================
// ADMIN AUTH SCHEMAS
// =============================================================================

// -----------------------------------------------------------------------------
// AdminUser - Admin/Super Admin identity (phone-based)
// -----------------------------------------------------------------------------
export const adminUserSchema = pgTable(
  'admin_user',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull().unique(), // "+14374289008"
    clerkUserId: text('clerk_user_id'),
    name: text('name'),
    email: text('email'),
    emailVerifiedAt: timestamp('email_verified_at', { mode: 'date' }),
    isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    phoneIdx: uniqueIndex('admin_user_phone_idx').on(table.phoneE164),
    emailIdx: uniqueIndex('admin_user_email_idx').on(table.email),
    normalizedEmailIdx: uniqueIndex('admin_user_normalized_email_idx')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    clerkUserIdx: uniqueIndex('admin_user_clerk_user_idx').on(table.clerkUserId),
  }),
);

// -----------------------------------------------------------------------------
// AdminSession - Server-side sessions for admin auth
// -----------------------------------------------------------------------------
export const adminSessionSchema = pgTable(
  'admin_session',
  {
    id: text('id').primaryKey(), // UUID, stored in cookie
    adminId: text('admin_id')
      .notNull()
      .references(() => adminUserSchema.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(), // 1 year from creation
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }), // Optional: for cleanup
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    adminIdx: index('admin_session_admin_idx').on(table.adminId),
    expiresIdx: index('admin_session_expires_idx').on(table.expiresAt),
  }),
);

// -----------------------------------------------------------------------------
// ClientSession - Server-side sessions for customer auth
// -----------------------------------------------------------------------------
export const clientSessionSchema = pgTable(
  'client_session',
  {
    id: text('id').primaryKey(), // UUID, stored in cookie
    clientPhone: text('client_phone').notNull(), // E.164 phone used for auth
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    phoneIdx: index('client_session_phone_idx').on(table.clientPhone),
    expiresIdx: index('client_session_expires_idx').on(table.expiresAt),
  }),
);

// -----------------------------------------------------------------------------
// StaffSession - Server-side sessions for staff auth
// -----------------------------------------------------------------------------
export const staffSessionSchema = pgTable(
  'staff_session',
  {
    id: text('id').primaryKey(), // UUID, stored in cookie
    technicianId: text('technician_id')
      .notNull()
      .references(() => technicianSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    technicianIdx: index('staff_session_technician_idx').on(table.technicianId),
    salonIdx: index('staff_session_salon_idx').on(table.salonId),
    expiresIdx: index('staff_session_expires_idx').on(table.expiresAt),
  }),
);

// -----------------------------------------------------------------------------
// AdminInvite - Invites for admin access (invite-only system)
// -----------------------------------------------------------------------------
export const adminInviteSchema = pgTable(
  'admin_invite',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(), // "+14374289008"
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'cascade' }), // null for super admin
    role: text('role').notNull(), // 'ADMIN' | 'SUPER_ADMIN'
    membershipRole: text('membership_role'), // 'admin' | 'owner' - role to assign when claimed
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(), // 7 days from creation
    usedAt: timestamp('used_at', { mode: 'date' }), // null until claimed
    createdBy: text('created_by').references(() => adminUserSchema.id), // adminId who created
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    phoneIdx: index('admin_invite_phone_idx').on(table.phoneE164),
    expiresIdx: index('admin_invite_expires_idx').on(table.expiresAt),
    phoneUsedIdx: index('admin_invite_phone_used_idx').on(
      table.phoneE164,
      table.usedAt,
    ),
    // CHECK constraint added via migration SQL:
    // CHECK ((role = 'SUPER_ADMIN' AND salon_id IS NULL) OR (role = 'ADMIN' AND salon_id IS NOT NULL))
  }),
);

// -----------------------------------------------------------------------------
// AdminSalonMembership - Which admins can access which salons
// -----------------------------------------------------------------------------
export const adminSalonMembershipSchema = pgTable(
  'admin_salon_membership',
  {
    adminId: text('admin_id')
      .notNull()
      .references(() => adminUserSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    role: text('role').default('admin').notNull(), // 'admin' | 'owner'
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.adminId, table.salonId] }),
    salonIdx: index('admin_membership_salon_idx').on(table.salonId),
  }),
);

// -----------------------------------------------------------------------------
// Luster Free Booking - invite, capability, consent, and integration records
// -----------------------------------------------------------------------------
export const salonSignupInviteSchema = pgTable(
  'salon_signup_invite',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedEmail: text('invited_email').notNull(),
    intent: text('intent').$type<'create_salon' | 'claim_existing'>().default('create_salon').notNull(),
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'cascade' }),
    campaignSource: text('campaign_source'),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { mode: 'date', withTimezone: true }),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    consumedByAdminId: text('consumed_by_admin_id').references(() => adminUserSchema.id),
    resultSalonId: text('result_salon_id').references(() => salonSchema.id, { onDelete: 'set null' }),
    createdByAdminId: text('created_by_admin_id').references(() => adminUserSchema.id),
    emailDeliveryStatus: text('email_delivery_status').$type<'pending' | 'sent' | 'failed'>().default('pending').notNull(),
    emailSentAt: timestamp('email_sent_at', { mode: 'date', withTimezone: true }),
    emailDeliveryErrorCode: text('email_delivery_error_code'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    tokenIdx: uniqueIndex('salon_signup_invite_token_idx').on(table.tokenHash),
    emailIdx: index('salon_signup_invite_email_idx').on(table.invitedEmail),
    salonIdx: index('salon_signup_invite_salon_idx').on(table.salonId),
    resultSalonIdx: index('salon_signup_invite_result_salon_idx').on(table.resultSalonId),
    expiresIdx: index('salon_signup_invite_expires_idx').on(table.expiresAt),
    activeSalonIdx: uniqueIndex('salon_signup_invite_active_salon_idx')
      .on(table.salonId)
      .where(sql`${table.salonId} is not null and ${table.consumedAt} is null and ${table.revokedAt} is null`),
    activeEmailIdx: uniqueIndex('salon_signup_invite_active_email_idx')
      .on(table.invitedEmail)
      .where(sql`${table.intent} = 'create_salon' and ${table.consumedAt} is null and ${table.revokedAt} is null`),
  }),
);

export const salonGoogleCalendarConnectionSchema = pgTable(
  'salon_google_calendar_connection',
  {
    salonId: text('salon_id')
      .primaryKey()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    googleAccountId: text('google_account_id'),
    googleEmail: text('google_email'),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    encryptionKeyVersion: integer('encryption_key_version').default(1).notNull(),
    destinationCalendarId: text('destination_calendar_id').default('primary').notNull(),
    busyCalendarIds: jsonb('busy_calendar_ids').$type<string[]>().default(['primary']).notNull(),
    scopes: jsonb('scopes').$type<string[]>().default([]).notNull(),
    status: text('status').default('active').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { mode: 'date', withTimezone: true }),
    lastError: text('last_error'),
    lastCheckedAt: timestamp('last_checked_at', { mode: 'date', withTimezone: true }),
    inboundSyncEnabled: boolean('inbound_sync_enabled').default(true).notNull(),
    inboundSyncedAt: timestamp('inbound_synced_at', { mode: 'date', withTimezone: true }),
    inboundSyncError: text('inbound_sync_error'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    statusIdx: index('salon_google_calendar_status_idx').on(table.status),
  }),
);

export const googleCalendarDraftSchema = pgTable(
  'google_calendar_draft',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull().references(() => salonSchema.id, { onDelete: 'cascade' }),
    googleEventId: text('google_event_id').notNull(),
    title: text('title'),
    startTime: timestamp('start_time', { mode: 'date', withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { mode: 'date', withTimezone: true }).notNull(),
    status: text('status').$type<'needs_details' | 'dismissed' | 'converted'>().default('needs_details').notNull(),
    convertedAppointmentId: text('converted_appointment_id').references(() => appointmentSchema.id),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    salonEventIdx: uniqueIndex('google_calendar_draft_salon_event_idx').on(table.salonId, table.googleEventId),
    salonStatusTimeIdx: index('google_calendar_draft_salon_status_time_idx').on(table.salonId, table.status, table.startTime),
  }),
);

// GoogleCalendarEvent - provider-owned calendar time kept separate from CRM appointments.
export const googleCalendarEventSchema = pgTable(
  'google_calendar_event',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull().references(() => salonSchema.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id').notNull(),
    googleEventId: text('google_event_id').notNull(),
    recurringEventId: text('recurring_event_id'),
    appointmentId: text('appointment_id').references(() => appointmentSchema.id, { onDelete: 'set null' }),
    sourceAccessRole: text('source_access_role').default('reader').notNull(),
    syncMode: text('sync_mode').$type<'inbound_only' | 'bidirectional' | 'superseded'>().default('inbound_only').notNull(),
    title: text('title'),
    description: text('description'),
    location: text('location'),
    attendeeName: text('attendee_name'),
    attendeePhone: text('attendee_phone'),
    attendeeEmail: text('attendee_email'),
    startTime: timestamp('start_time', { mode: 'date', withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { mode: 'date', withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    isAllDay: boolean('is_all_day').default(false).notNull(),
    transparency: text('transparency').$type<'busy' | 'free'>().default('busy').notNull(),
    googleStatus: text('google_status').default('confirmed').notNull(),
    reviewStatus: text('review_status').$type<'needs_review' | 'reviewed' | 'appointment'>().default('needs_review').notNull(),
    googleUpdatedAt: timestamp('google_updated_at', { mode: 'date', withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { mode: 'date', withTimezone: true }),
    deletedAt: timestamp('deleted_at', { mode: 'date', withTimezone: true }),
    supersededByEventId: text('superseded_by_event_id'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    salonCalendarEventIdx: uniqueIndex('google_calendar_event_tenant_provider_idx').on(table.salonId, table.calendarId, table.googleEventId),
    salonReviewTimeIdx: index('google_calendar_event_review_time_idx').on(table.salonId, table.reviewStatus, table.startTime),
    salonTimeIdx: index('google_calendar_event_salon_time_idx').on(table.salonId, table.startTime, table.endTime),
    appointmentIdx: index('google_calendar_event_appointment_idx').on(table.appointmentId),
  }),
);

// Exact-title review memory for future suggestions. The title itself is never duplicated here.
export const googleEventReviewPatternSchema = pgTable(
  'google_event_review_pattern',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull().references(() => salonSchema.id, { onDelete: 'cascade' }),
    titleFingerprint: text('title_fingerprint').notNull(),
    lastDecision: text('last_decision').$type<'busy_time' | 'free_event' | 'appointment'>().notNull(),
    decisionCount: integer('decision_count').default(1).notNull(),
    lastDecisionAt: timestamp('last_decision_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  table => ({
    salonPatternIdx: uniqueIndex('google_event_review_pattern_tenant_title_idx').on(table.salonId, table.titleFingerprint),
  }),
);

export const salonTwilioConnectionSchema = pgTable(
  'salon_twilio_connection',
  {
    salonId: text('salon_id')
      .primaryKey()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    connectAccountSid: text('connect_account_sid').notNull(),
    messagingServiceSid: text('messaging_service_sid'),
    phoneNumber: text('phone_number'),
    status: text('status').default('pending').notNull(),
    deauthorizedAt: timestamp('deauthorized_at', { mode: 'date', withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    accountIdx: uniqueIndex('salon_twilio_account_idx').on(table.connectAccountSid),
    statusIdx: index('salon_twilio_status_idx').on(table.status),
  }),
);

export const communicationConsentSchema = pgTable(
  'communication_consent',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    channel: text('channel').notNull(),
    purpose: text('purpose').notNull(),
    status: text('status').notNull(),
    wordingVersion: text('wording_version').notNull(),
    source: text('source').notNull(),
    grantedAt: timestamp('granted_at', { mode: 'date', withTimezone: true }),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    salonRecipientIdx: index('communication_consent_salon_recipient_idx').on(
      table.salonId,
      table.recipient,
      table.channel,
      table.purpose,
    ),
  }),
);

export const appointmentAccessTokenSchema = pgTable(
  'appointment_access_token',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    tokenIdx: uniqueIndex('appointment_access_token_hash_idx').on(table.tokenHash),
    appointmentIdx: index('appointment_access_token_appointment_idx').on(table.salonId, table.appointmentId),
    expiresIdx: index('appointment_access_token_expires_idx').on(table.expiresAt),
  }),
);

export const integrationOutboxSchema = pgTable(
  'integration_outbox',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id').references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    pendingIdx: index('integration_outbox_pending_idx').on(table.provider, table.status, table.availableAt),
    salonIdx: index('integration_outbox_salon_idx').on(table.salonId),
  }),
);

export const notificationDeliverySchema = pgTable(
  'notification_delivery',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id').references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    purpose: text('purpose').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    providerMessageId: text('provider_message_id'),
    status: text('status').default('queued').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retryable: boolean('retryable'),
    // --- 0070 communications-pipeline extensions (all nullable; legacy rows untouched) ---
    intentId: text('intent_id'),
    creditReservationId: text('credit_reservation_id'),
    segmentCount: integer('segment_count'),
    encoding: text('encoding'),
    senderIdentity: text('sender_identity'),
    messagingServiceSid: text('messaging_service_sid'),
    statusRank: integer('status_rank'),
    settlementState: text('settlement_state'),
    settledAt: timestamp('settled_at', { mode: 'date', withTimezone: true }),
    providerPriceRaw: numeric('provider_price_raw'),
    providerCurrency: text('provider_currency'),
    providerSegments: integer('provider_segments'),
    fxRate: numeric('fx_rate'),
    fxRateSource: text('fx_rate_source'),
    fxConvertedAt: timestamp('fx_converted_at', { mode: 'date', withTimezone: true }),
    providerCostCadMicros: bigint('provider_cost_cad_micros', { mode: 'number' }),
    anomalyCode: text('anomaly_code'),
    reconciledAt: timestamp('reconciled_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('notification_delivery_salon_idx').on(table.salonId, table.channel, table.status),
  }),
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Client = typeof clientSchema.$inferSelect;
export type NewClient = typeof clientSchema.$inferInsert;

export type SalonClient = typeof salonClientSchema.$inferSelect;
export type NewSalonClient = typeof salonClientSchema.$inferInsert;
export type SalonClientContactAlias = typeof salonClientContactAliasSchema.$inferSelect;
export type NewSalonClientContactAlias = typeof salonClientContactAliasSchema.$inferInsert;
export type SalonClientNote = typeof salonClientNoteSchema.$inferSelect;
export type NewSalonClientNote = typeof salonClientNoteSchema.$inferInsert;

export type SalonRetentionSettings = typeof salonRetentionSettingsSchema.$inferSelect;
export type NewSalonRetentionSettings = typeof salonRetentionSettingsSchema.$inferInsert;
export type ClientCommunication = typeof clientCommunicationSchema.$inferSelect;
export type NewClientCommunication = typeof clientCommunicationSchema.$inferInsert;
export type RetentionCampaign = typeof retentionCampaignSchema.$inferSelect;
export type NewRetentionCampaign = typeof retentionCampaignSchema.$inferInsert;
export type RetentionCampaignRedemption = typeof retentionCampaignRedemptionSchema.$inferSelect;
export type NewRetentionCampaignRedemption = typeof retentionCampaignRedemptionSchema.$inferInsert;

export type Salon = typeof salonSchema.$inferSelect;
export type NewSalon = typeof salonSchema.$inferInsert;

export type Service = typeof serviceSchema.$inferSelect;
export type NewService = typeof serviceSchema.$inferInsert;

export type AddOn = typeof addOnSchema.$inferSelect;
export type NewAddOn = typeof addOnSchema.$inferInsert;

export type Technician = typeof technicianSchema.$inferSelect;
export type NewTechnician = typeof technicianSchema.$inferInsert;

// Weekly schedule type for technician availability
export type DaySchedule = { start: string; end: string } | null;
export type WeeklySchedule = {
  sunday?: DaySchedule;
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
};

export type TechnicianService = typeof technicianServicesSchema.$inferSelect;
export type NewTechnicianService = typeof technicianServicesSchema.$inferInsert;

export type Appointment = typeof appointmentSchema.$inferSelect;
export type NewAppointment = typeof appointmentSchema.$inferInsert;

export type AppointmentBookingPolicyAcknowledgment
  = typeof appointmentBookingPolicyAcknowledgmentSchema.$inferSelect;
export type NewAppointmentBookingPolicyAcknowledgment
  = typeof appointmentBookingPolicyAcknowledgmentSchema.$inferInsert;

export type AppointmentService = typeof appointmentServicesSchema.$inferSelect;
export type NewAppointmentService = typeof appointmentServicesSchema.$inferInsert;

export type ServiceAddOn = typeof serviceAddOnSchema.$inferSelect;
export type NewServiceAddOn = typeof serviceAddOnSchema.$inferInsert;

export type AppointmentAddOn = typeof appointmentAddOnSchema.$inferSelect;
export type NewAppointmentAddOn = typeof appointmentAddOnSchema.$inferInsert;

export type AppointmentFinalItem = typeof appointmentFinalItemSchema.$inferSelect;
export type NewAppointmentFinalItem = typeof appointmentFinalItemSchema.$inferInsert;

export type AppointmentPayment = typeof appointmentPaymentSchema.$inferSelect;
export type NewAppointmentPayment = typeof appointmentPaymentSchema.$inferInsert;

export type AppointmentPaymentLink = typeof appointmentPaymentLinkSchema.$inferSelect;
export type NewAppointmentPaymentLink = typeof appointmentPaymentLinkSchema.$inferInsert;

export type AppointmentPhoto = typeof appointmentPhotoSchema.$inferSelect;
export type NewAppointmentPhoto = typeof appointmentPhotoSchema.$inferInsert;

export type Referral = typeof referralSchema.$inferSelect;
export type NewReferral = typeof referralSchema.$inferInsert;

export type Reward = typeof rewardSchema.$inferSelect;
export type NewReward = typeof rewardSchema.$inferInsert;

export type Review = typeof reviewSchema.$inferSelect;
export type NewReview = typeof reviewSchema.$inferInsert;

export type ClientPreferences = typeof clientPreferencesSchema.$inferSelect;
export type NewClientPreferences = typeof clientPreferencesSchema.$inferInsert;

export type TechnicianTimeOff = typeof technicianTimeOffSchema.$inferSelect;
export type NewTechnicianTimeOff = typeof technicianTimeOffSchema.$inferInsert;

export type TechnicianBlockedSlot = typeof technicianBlockedSlotSchema.$inferSelect;
export type NewTechnicianBlockedSlot = typeof technicianBlockedSlotSchema.$inferInsert;

export type TechnicianScheduleOverride = typeof technicianScheduleOverrideSchema.$inferSelect;
export type NewTechnicianScheduleOverride = typeof technicianScheduleOverrideSchema.$inferInsert;

export type SalonPageAppearance = typeof salonPageAppearanceSchema.$inferSelect;
export type NewSalonPageAppearance = typeof salonPageAppearanceSchema.$inferInsert;

export type SalonAuditLog = typeof salonAuditLogSchema.$inferSelect;
export type NewSalonAuditLog = typeof salonAuditLogSchema.$inferInsert;

export type SalonLocation = typeof salonLocationSchema.$inferSelect;
export type NewSalonLocation = typeof salonLocationSchema.$inferInsert;

export type AdminUser = typeof adminUserSchema.$inferSelect;
export type NewAdminUser = typeof adminUserSchema.$inferInsert;

export type AdminSession = typeof adminSessionSchema.$inferSelect;
export type NewAdminSession = typeof adminSessionSchema.$inferInsert;

export type ClientSession = typeof clientSessionSchema.$inferSelect;
export type NewClientSession = typeof clientSessionSchema.$inferInsert;

export type StaffSession = typeof staffSessionSchema.$inferSelect;
export type NewStaffSession = typeof staffSessionSchema.$inferInsert;

export type AdminInvite = typeof adminInviteSchema.$inferSelect;
export type NewAdminInvite = typeof adminInviteSchema.$inferInsert;

export type AdminSalonMembership = typeof adminSalonMembershipSchema.$inferSelect;
export type NewAdminSalonMembership = typeof adminSalonMembershipSchema.$inferInsert;

export type SalonSignupInvite = typeof salonSignupInviteSchema.$inferSelect;
export type NewSalonSignupInvite = typeof salonSignupInviteSchema.$inferInsert;
export type SalonGoogleCalendarConnection = typeof salonGoogleCalendarConnectionSchema.$inferSelect;
export type SalonTwilioConnection = typeof salonTwilioConnectionSchema.$inferSelect;
export type CommunicationConsent = typeof communicationConsentSchema.$inferSelect;
export type AppointmentAccessToken = typeof appointmentAccessTokenSchema.$inferSelect;
export type IntegrationOutboxJob = typeof integrationOutboxSchema.$inferSelect;
export type NotificationDelivery = typeof notificationDeliverySchema.$inferSelect;

// =============================================================================
// CONST EXPORTS
// =============================================================================

export const SERVICE_CATEGORIES = [
  'manicure',
  'builder_gel',
  'extensions',
  'pedicure',
  'hands',
  'feet',
  'combo',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const PUBLIC_SERVICE_CATEGORIES = [
  'manicure',
  'builder_gel',
  'extensions',
  'pedicure',
  'combo',
] as const;
export type PublicServiceCategory = (typeof PUBLIC_SERVICE_CATEGORIES)[number];

export const BOOKING_CATEGORIES = [
  'manicure',
  'pedicure',
  'combo',
] as const;
export type BookingCategory = (typeof BOOKING_CATEGORIES)[number];

export const ADD_ON_CATEGORIES = [
  'nail_art',
  'repair',
  'removal',
  'pedicure_addon',
] as const;
export type AddOnCategory = (typeof ADD_ON_CATEGORIES)[number];

export const ADD_ON_PRICING_TYPES = ['fixed', 'per_unit'] as const;
export type AddOnPricingType = (typeof ADD_ON_PRICING_TYPES)[number];

export const SERVICE_ADD_ON_SELECTION_MODES = ['optional', 'required', 'conditional'] as const;
export type ServiceAddOnSelectionMode = (typeof SERVICE_ADD_ON_SELECTION_MODES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  // A deposit hold. The appointment row IS the hold: the slot is occupied but
  // the booking is not yet paid for, and it lapses at `deposit_hold_expires_at`.
  // It is NOT a member of ACTIVE_APPOINTMENT_STATUSES (which is an
  // allowed-transition-target list) — see src/libs/activeAppointments.ts.
  'awaiting_payment',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// 'pending' = unpaid, 'partially_paid' = payments recorded but balance remains,
// 'paid' = fully collected (fraud/points only ever count completed+paid rows),
// 'comp' = complimentary (admin-only; counts 0 revenue; requires no payments).
export const PAYMENT_STATUSES = ['pending', 'partially_paid', 'paid', 'comp'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'e_transfer', 'online', 'gift_card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PHOTO_TYPES = ['before', 'after'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const CANCEL_REASONS = [
  'rescheduled',
  'client_request',
  'no_show',
  // Written by the deposit-checkout compensating cancel and by the hold reaper.
  // Note the intended side effect: CANCEL_REASONS also types the PATCH body, so
  // this becomes a legal PATCH cancel reason. Harmless — the CAS lists exclude
  // holds, so the reason is cosmetic on an ordinary cancel.
  'deposit_not_paid',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const REFERRAL_STATUSES = [
  'sent',
  'claimed',
  'booked',
  'reward_earned',
  'expired',
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REWARD_TYPES = [
  'referral_referee',
  'referral_referrer',
] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export const REWARD_STATUSES = [
  'active',
  'used',
  'expired',
] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];

export const TIME_OFF_REASONS = [
  'vacation',
  'sick',
  'personal',
  'training',
  'other',
] as const;
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number];

export const BLOCKED_SLOT_LABELS = [
  'lunch',
  'break',
  'cleaning',
  'meeting',
  'personal',
  'other',
] as const;
export type BlockedSlotLabel = (typeof BLOCKED_SLOT_LABELS)[number];

export const SCHEDULE_OVERRIDE_TYPES = ['off', 'hours'] as const;
export type ScheduleOverrideType = (typeof SCHEDULE_OVERRIDE_TYPES)[number];

export const PAGE_APPEARANCE_MODES = ['custom', 'theme'] as const;
export type PageAppearanceMode = (typeof PAGE_APPEARANCE_MODES)[number];

export const THEMEABLE_PAGES = [
  'rewards',
  'profile',
  'gallery',
  'book-service',
  'book-tech',
  'book-time',
  'book-confirm',
  'preferences',
  'invite',
] as const;
export type ThemeablePage = (typeof THEMEABLE_PAGES)[number];

// Staff Management Constants
export const STAFF_ROLES = ['tech', 'junior', 'senior', 'admin', 'front_desk'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_STATUSES = ['available', 'busy', 'break', 'off'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const SKILL_LEVELS = ['junior', 'standard', 'senior', 'master'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const PAY_TYPES = ['commission', 'hourly', 'salary'] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const ONBOARDING_STATUSES = ['pending', 'active', 'offboarded'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

// Salon Plan & Status Constants (Super Admin)
export const SALON_PLANS = ['free', 'single_salon', 'multi_salon', 'enterprise'] as const;
export type SalonPlan = (typeof SALON_PLANS)[number];

export const SALON_STATUSES = ['active', 'suspended', 'trial', 'cancelled'] as const;
export type SalonStatus = (typeof SALON_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'restored',
  'owner_changed',
  'plan_changed',
  'status_changed',
  'data_reset',
  'location_added',
  'location_updated',
  'location_deleted',
  'booking_experience_entitlement_override_changed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Admin Auth Constants
export const ADMIN_INVITE_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;
export type AdminInviteRole = (typeof ADMIN_INVITE_ROLES)[number];

export const ADMIN_MEMBERSHIP_ROLES = ['admin', 'owner'] as const;
export type AdminMembershipRole = (typeof ADMIN_MEMBERSHIP_ROLES)[number];

// =============================================================================
// CANVAS FLOW OS SCHEMAS (Step 9.1)
// =============================================================================

// -----------------------------------------------------------------------------
// AppointmentArtifacts - 1:1 photo artifacts for appointments
// -----------------------------------------------------------------------------
export const appointmentArtifactsSchema = pgTable(
  'appointment_artifacts',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .unique()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),

    // Photo URLs (null by default, never empty string)
    beforePhotoUrl: text('before_photo_url'),
    afterPhotoUrl: text('after_photo_url'),

    // Upload timestamps (timezone-aware)
    beforePhotoUploadedAt: timestamp('before_photo_uploaded_at', { mode: 'date', withTimezone: true }),
    afterPhotoUploadedAt: timestamp('after_photo_uploaded_at', { mode: 'date', withTimezone: true }),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    appointmentIdx: uniqueIndex('artifacts_appointment_idx').on(table.appointmentId),
  }),
);

// -----------------------------------------------------------------------------
// SalonPolicies - One row per salon (photo + auto-post policies)
// -----------------------------------------------------------------------------
export const salonPoliciesSchema = pgTable(
  'salon_policies',
  {
    salonId: text('salon_id')
      .primaryKey()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Photo requirements
    requireBeforePhotoToStart: photoRequirementModeEnum('require_before_photo_to_start').default('off').notNull(),
    requireAfterPhotoToFinish: photoRequirementModeEnum('require_after_photo_to_finish').default('off').notNull(),
    requireAfterPhotoToPay: photoRequirementModeEnum('require_after_photo_to_pay').default('off').notNull(),

    // Auto-post settings
    autoPostEnabled: boolean('auto_post_enabled').default(false).notNull(),
    autoPostPlatforms: text('auto_post_platforms').array().default([]).notNull(),
    autoPostIncludePrice: boolean('auto_post_include_price').default(false).notNull(),
    autoPostIncludeColor: boolean('auto_post_include_color').default(false).notNull(),
    autoPostIncludeBrand: boolean('auto_post_include_brand').default(false).notNull(),
    autoPostAiCaptionEnabled: boolean('auto_post_ai_caption_enabled').default(false).notNull(),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

// -----------------------------------------------------------------------------
// SuperAdminPolicies - TRUE SINGLETON (exactly one row, id = 'singleton')
// -----------------------------------------------------------------------------
export const superAdminPoliciesSchema = pgTable(
  'super_admin_policies',
  {
    id: text('id').primaryKey().default('singleton'),

    // Photo requirements (nullable = salon decides)
    requireBeforePhotoToStart: photoRequirementModeEnum('require_before_photo_to_start'),
    requireAfterPhotoToFinish: photoRequirementModeEnum('require_after_photo_to_finish'),
    requireAfterPhotoToPay: photoRequirementModeEnum('require_after_photo_to_pay'),

    // Auto-post overrides (nullable = salon decides)
    autoPostEnabled: boolean('auto_post_enabled'),
    autoPostAiCaptionEnabled: boolean('auto_post_ai_caption_enabled'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

// -----------------------------------------------------------------------------
// AutopostQueue - Queue for auto-posting photos to social platforms
// -----------------------------------------------------------------------------
export const autopostQueueSchema = pgTable(
  'autopost_queue',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),

    // Status
    status: autopostStatusEnum('status').default('queued').notNull(),
    platform: text('platform').notNull(),

    // Payload
    payloadJson: jsonb('payload_json'),

    // Error tracking
    error: text('error'),
    retryCount: integer('retry_count').default(0).notNull(),

    // Scheduling
    scheduledFor: timestamp('scheduled_for', { mode: 'date', withTimezone: true }),
    processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    salonIdx: index('autopost_queue_salon_idx').on(table.salonId),
    appointmentIdx: index('autopost_queue_appointment_idx').on(table.appointmentId),
    statusScheduledIdx: index('autopost_queue_status_scheduled_idx').on(table.status, table.scheduledFor),
  }),
);

// =============================================================================
// CANVAS FLOW OS TYPE EXPORTS
// =============================================================================

export type AppointmentArtifacts = typeof appointmentArtifactsSchema.$inferSelect;
export type NewAppointmentArtifacts = typeof appointmentArtifactsSchema.$inferInsert;

export type SalonPolicies = typeof salonPoliciesSchema.$inferSelect;
export type NewSalonPolicies = typeof salonPoliciesSchema.$inferInsert;

export type SuperAdminPolicies = typeof superAdminPoliciesSchema.$inferSelect;
export type NewSuperAdminPolicies = typeof superAdminPoliciesSchema.$inferInsert;

export type AutopostQueue = typeof autopostQueueSchema.$inferSelect;
export type NewAutopostQueue = typeof autopostQueueSchema.$inferInsert;

// Canvas state enum values (matches Step 7 policyTypes.ts)
export const CANVAS_STATES = [
  'waiting',
  'working',
  'wrap_up',
  'complete',
  'cancelled',
  'no_show',
] as const;
export type CanvasState = (typeof CANVAS_STATES)[number];

export const PHOTO_REQUIREMENT_MODES = ['off', 'optional', 'required'] as const;
export type PhotoRequirementMode = (typeof PHOTO_REQUIREMENT_MODES)[number];

export const AUTOPOST_STATUSES = ['queued', 'processing', 'posted', 'failed'] as const;
export type AutopostStatus = (typeof AUTOPOST_STATUSES)[number];

export const AUTOPOST_PLATFORMS = ['instagram', 'facebook', 'tiktok'] as const;
export type AutopostPlatform = (typeof AUTOPOST_PLATFORMS)[number];

// =============================================================================
// STEP 16A - APPOINTMENT AUDIT LOG
// =============================================================================

export const DEPOSIT_AUDIT_ACTIONS = [
  'deposit_refund_requested',
  'deposit_refund_retried',
  'deposit_refund_updated',
  'deposit_refund_succeeded',
  'deposit_refund_failed',
  'deposit_external_refund_observed',
  'deposit_waived',
  'deposit_hold_released',
  'deposit_forfeited',
] as const;

export const APPOINTMENT_AUDIT_ACTIONS = [
  'created',
  'status_changed',
  'tech_reassigned',
  'time_changed',
  'price_adjusted',
  'locked',
  'unlocked',
  'notes_updated',
  'cancelled',
  'completed',
  'arrived',
  'admin_override',
  // Checkout phase (0058)
  'items_changed',
  'discount_applied',
  'payment_recorded',
  'payment_voided',
  'payment_status_changed',
  'tax_overridden',
  'tax_exempted',
  'times_recorded',
  'photo_uploaded',
  'photo_removed',
  'reopened',
  // Deposit refund and waiver lifecycle (D6).
  ...DEPOSIT_AUDIT_ACTIONS,
] as const;
export type AppointmentAuditAction = (typeof APPOINTMENT_AUDIT_ACTIONS)[number];

export const AUDIT_PERFORMER_ROLES = ['admin', 'staff', 'system', 'client'] as const;
export type AuditPerformerRole = (typeof AUDIT_PERFORMER_ROLES)[number];

// -----------------------------------------------------------------------------
// AppointmentAuditLog - Immutable log of all appointment changes
// -----------------------------------------------------------------------------
export const appointmentAuditLogSchema = pgTable(
  'appointment_audit_log',
  {
    id: text('id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointmentSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Action performed
    action: text('action').notNull(), // AppointmentAuditAction

    // Who performed the action
    performedBy: text('performed_by').notNull(), // clerk user ID, 'staff:{techId}', or 'system'
    performedByRole: text('performed_by_role').notNull(), // 'admin' | 'staff' | 'system' | 'client'
    performedByName: text('performed_by_name'), // Human-readable name for display

    // Change details
    previousValue: jsonb('previous_value').$type<Record<string, unknown>>(),
    newValue: jsonb('new_value').$type<Record<string, unknown>>(),
    reason: text('reason'), // Optional explanation for the change

    // Timestamp (immutable)
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    appointmentIdx: index('appt_audit_appointment_idx').on(table.appointmentId),
    salonIdx: index('appt_audit_salon_idx').on(table.salonId),
    actionIdx: index('appt_audit_action_idx').on(table.action),
    createdIdx: index('appt_audit_created_idx').on(table.createdAt),
    performerIdx: index('appt_audit_performer_idx').on(table.performedBy),
  }),
);

export type AppointmentAuditLog = typeof appointmentAuditLogSchema.$inferSelect;
export type NewAppointmentAuditLog = typeof appointmentAuditLogSchema.$inferInsert;

// =============================================================================
// STEP 17 - TIME OFF REQUESTS & NOTIFICATIONS
// =============================================================================

// -----------------------------------------------------------------------------
// TimeOffRequest - Staff submit, Admin approves/denies
// -----------------------------------------------------------------------------
export const timeOffRequestSchema = pgTable(
  'time_off_request',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    technicianId: text('technician_id')
      .notNull()
      .references(() => technicianSchema.id, { onDelete: 'cascade' }),

    // Request details
    startDate: timestamp('start_date', { mode: 'date' }).notNull(),
    endDate: timestamp('end_date', { mode: 'date' }).notNull(),
    note: text('note'),

    // Status: PENDING | APPROVED | DENIED
    status: text('status').notNull().default('PENDING'),

    // Decision tracking
    decidedByAdminId: text('decided_by_admin_id').references(() => adminUserSchema.id),
    decidedAt: timestamp('decided_at', { mode: 'date', withTimezone: true }),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    salonIdx: index('time_off_request_salon_idx').on(table.salonId),
    techIdx: index('time_off_request_tech_idx').on(table.technicianId),
    statusIdx: index('time_off_request_status_idx').on(table.salonId, table.status),
    techStatusIdx: index('time_off_request_tech_status_idx').on(table.technicianId, table.status),
  }),
);

export const TIME_OFF_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'DENIED'] as const;
export type TimeOffRequestStatus = (typeof TIME_OFF_REQUEST_STATUSES)[number];

export type TimeOffRequest = typeof timeOffRequestSchema.$inferSelect;
export type NewTimeOffRequest = typeof timeOffRequestSchema.$inferInsert;

// -----------------------------------------------------------------------------
// Notification - In-app notifications for staff
// -----------------------------------------------------------------------------
export const notificationSchema = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // Recipient targeting
    recipientRole: text('recipient_role').notNull(), // 'STAFF' | 'ADMIN'
    recipientTechnicianId: text('recipient_technician_id').references(
      () => technicianSchema.id,
      { onDelete: 'cascade' },
    ),

    // Notification content
    type: text('type').notNull(), // 'TIME_OFF_DECISION', 'OVERRIDE_DECISION', etc.
    title: text('title').notNull(),
    body: text('body').notNull(),
    metadata: jsonb('metadata').$type<{
      timeOffRequestId?: string;
      overrideId?: string;
      appointmentId?: string;
      [key: string]: unknown;
    }>(),

    // Read tracking
    readAt: timestamp('read_at', { mode: 'date', withTimezone: true }),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    salonIdx: index('notification_salon_idx').on(table.salonId),
    recipientTechIdx: index('notification_recipient_tech_idx').on(table.recipientTechnicianId),
    createdIdx: index('notification_created_idx').on(table.recipientTechnicianId, table.createdAt),
  }),
);

export const NOTIFICATION_TYPES = [
  'TIME_OFF_DECISION',
  'OVERRIDE_DECISION',
  'APPOINTMENT_REMINDER',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_RECIPIENT_ROLES = ['STAFF', 'ADMIN'] as const;
export type NotificationRecipientRole = (typeof NOTIFICATION_RECIPIENT_ROLES)[number];

export type Notification = typeof notificationSchema.$inferSelect;
export type NewNotification = typeof notificationSchema.$inferInsert;

// -----------------------------------------------------------------------------
// AuditLog - Critical action tracking for debugging and compliance (Step 21D)
// -----------------------------------------------------------------------------
export const auditLogSchema = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    // Nullable for system/auth events not tied to a salon
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'set null' }),

    // Who performed the action
    actorType: text('actor_type').notNull(), // 'admin' | 'staff' | 'client' | 'system' | 'webhook'
    actorId: text('actor_id'), // Technician ID, admin session ID, etc.
    actorPhone: text('actor_phone'), // For client actions

    // What happened
    action: text('action').notNull(), // e.g., 'billing_mode_changed', 'review_created', 'reward_granted'
    entityType: text('entity_type'), // e.g., 'salon', 'appointment', 'reward', 'review'
    entityId: text('entity_id'), // ID of the affected entity

    // Additional context (JSON)
    metadata: jsonb('metadata'), // { oldValue, newValue, reason, etc. }

    // Request info for forensics
    ip: text('ip'),
    userAgent: text('user_agent'),

    // Timestamp
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    salonIdx: index('general_audit_log_salon_idx').on(table.salonId),
    actionIdx: index('general_audit_log_action_idx').on(table.action),
    entityIdx: index('general_audit_log_entity_idx').on(table.entityType, table.entityId),
    createdAtIdx: index('general_audit_log_created_at_idx').on(table.createdAt),
  }),
);

export const AUDIT_LOG_ACTIONS = [
  // Billing
  'billing_mode_changed',
  'subscription_status_changed',
  'checkout_session_created',
  // Staff/Permissions
  'staff_role_changed',
  'staff_permission_changed',
  'staff_created',
  'staff_deactivated',
  // Rewards/Loyalty
  'reward_granted',
  'reward_used',
  'referral_claimed',
  'referral_completed',
  // Reviews
  'review_created',
  'review_hidden',
  'review_unhidden',
  // Appointments
  'appointment_completed',
  'appointment_cancelled',
  // Required-add-on enforcement rollout (observation stage, PR 1 stage b) —
  // fired when a booking selection did not include a service_add_on row
  // marked selectionMode: 'required'. Observation only: never blocks the
  // booking. See evaluateRequiredAddOnRules in src/libs/bookingQuote.ts.
  'required_add_on_rule_omitted',
  // Same rollout, enforcement stage (PR 1 stage e) — fired when the salon has
  // opted in via settings.booking.enforceRequiredAddOns and the booking was
  // actually refused. Kept distinct from required_add_on_rule_omitted so
  // "would have blocked" and "did block" never blend into one number.
  'required_add_on_booking_blocked',
  // Super-admin actions (merge from existing)
  'updated',
  'owner_changed',
  // Destructive super-admin actions. Written with salonId = null so the record
  // outlives the salon it describes (audit_log.salon_id is ON DELETE SET NULL).
  'salon_hard_deleted',
  'salon_data_reset',
  // Settings updates
  'settings_updated',
  // Luster password auth and staging toolkit
  'super_admin_password_login_succeeded',
  'super_admin_password_login_failed',
  'test_invitation_created',
  'signup_invitation_created',
  'signup_invitation_resent',
  'signup_invitation_delivery_attempted',
  'signup_invitation_failed',
  'salon_claim_invitation_created',
  'salon_claim_completed',
  'salon_claim_failed',
  'test_tool_action',
  'integration_health_checked',
  'impersonation_started',
  'impersonation_ended',
  'clerk_owner_linked',
  'clerk_owner_relinked',
  // Stripe Connect account plumbing (D2). Appended, never reordered: two later
  // PRs in this programme append to this same array.
  'stripe_connect_account_created',
  'stripe_connect_account_rebound',
  'stripe_connect_account_revoked',
  'stripe_connect_orphan_account',
  'stripe_connect_account_shape_rejected',
  // Per-salon deposits entitlement (D3). The `action` COLUMN is free text; this
  // array is the app-level union the audit helper validates against.
  'deposits_entitlement_changed',
  // Deposit money movement (D5). `logAuditEvent` types its `action` against this
  // union, so without these three entries the post-commit audit calls on the
  // confirm, refund and restore paths do not compile. Appended, never reordered.
  'deposit_payment_confirmed',
  'deposit_refunded',
  'deposit_hold_restored',
  // Deposit refund/waiver operations and sensitive payment-health reads (D6).
  ...DEPOSIT_AUDIT_ACTIONS,
  'payment_health_viewed',
  'deposit_records_viewed',
] as const;
export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];

export type AuditLog = typeof auditLogSchema.$inferSelect;
export type NewAuditLog = typeof auditLogSchema.$inferInsert;

// =============================================================================
// FRAUD SIGNAL SYSTEM (v1)
// =============================================================================

// -----------------------------------------------------------------------------
// Fraud Signal Enums - PG enums for type safety (not free text)
// -----------------------------------------------------------------------------
export const fraudSignalTypeEnum = pgEnum('fraud_signal_type', [
  'HIGH_APPOINTMENT_FREQUENCY', // 3+ in 7 days OR 5+ in 14 days
  'HIGH_REWARD_VELOCITY', // Points >= 5000 in 7 days
]);

export const fraudSignalSeverityEnum = pgEnum('fraud_signal_severity', [
  'LOW',
  'MEDIUM',
  'HIGH',
]);

// -----------------------------------------------------------------------------
// FraudSignal - Non-blocking fraud detection flags for human review
// -----------------------------------------------------------------------------
export const fraudSignalSchema = pgTable(
  'fraud_signal',
  {
    id: text('id').primaryKey(), // Generated via crypto.randomUUID()
    salonId: text('salon_id').notNull().references(() => salonSchema.id, { onDelete: 'cascade' }),
    // Both NOT NULL - fraud without client or appointment is useless
    // ON DELETE RESTRICT - never cascade-delete fraud history
    salonClientId: text('salon_client_id').notNull().references(() => salonClientSchema.id, { onDelete: 'restrict' }),
    appointmentId: text('appointment_id').notNull().references(() => appointmentSchema.id, { onDelete: 'restrict' }),

    type: fraudSignalTypeEnum('type').notNull(),
    severity: fraudSignalSeverityEnum('severity').notNull().default('MEDIUM'),
    reason: text('reason').notNull(), // Human-readable, deterministic format

    metadata: jsonb('metadata').$type<{
      appointmentsInPeriod?: number;
      pointsInPeriod?: number;
      periodDays?: number;
      threshold?: number;
      clientPhone?: string; // For reference only
    }>().notNull().default(sql`'{}'::jsonb`),

    // Resolution tracking (full timestamp precision - NO mode: 'date')
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'), // adminUserId from session
    resolutionNote: text('resolution_note'),

    // Full timestamp precision for accurate 7d/14d throttle calculations
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    salonIdx: index('fraud_signal_salon_idx').on(table.salonId),
    clientIdx: index('fraud_signal_client_idx').on(table.salonClientId),
    appointmentIdx: index('fraud_signal_appointment_idx').on(table.appointmentId),
    // UNIQUE constraint: one signal per type per appointment (regardless of resolved status)
    uniqueApptType: uniqueIndex('fraud_signal_appt_type_unique').on(table.appointmentId, table.type),
    // NOTE: Add partial index via raw SQL migration for unresolved queries:
    // CREATE INDEX fraud_signal_unresolved_idx
    // ON fraud_signal (salon_id, created_at DESC, id DESC)
    // WHERE resolved_at IS NULL;
  }),
);

// Fraud Signal Types
export const FRAUD_SIGNAL_TYPES = ['HIGH_APPOINTMENT_FREQUENCY', 'HIGH_REWARD_VELOCITY'] as const;
export type FraudSignalType = (typeof FRAUD_SIGNAL_TYPES)[number];

export const FRAUD_SIGNAL_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type FraudSignalSeverity = (typeof FRAUD_SIGNAL_SEVERITIES)[number];

export type FraudSignal = typeof fraudSignalSchema.$inferSelect;
export type NewFraudSignal = typeof fraudSignalSchema.$inferInsert;

// =============================================================================
// DEPOSITS FOUNDATION (migrations 0065, 0067 and 0068)
// =============================================================================
// These three tables are created by `migrations/0065_deposits_foundation.sql`;
// migration 0067 adds D6 refund/waiver state and 0068 adds D6.1 invoice facts.
// This mapping mirrors the landed DDL column-for-column and is proved by the
// set-equality census in
// `src/models/depositsSchema.integration.test.ts` (test 1).
//
// Write boundary as of D2:
//   salon_stripe_account  — D2 is the first and only writer.
//   stripe_webhook_event  — D2 writes the bookkeeping columns; `salonId` and the
//                           projection columns are mapped but written by nobody
//                           here (a later PR owns them).
//   appointment_deposit   — D2 writes NOTHING. It is read at exactly one
//                           runtime site: the disconnect route's
//                           DEPOSITS_IN_FLIGHT refusal.
// -----------------------------------------------------------------------------

/**
 * Persisted shape of `salon_stripe_account.requirements_due`.
 *
 * Stored in Stripe's own snake_case wire vocabulary so the whole requirements
 * object survives a transition without a remote lookup. Unresolved
 * `currently_due` fields move OUT of `currently_due` and INTO `past_due` at the
 * deadline, so storing only one array would show a restricted salon an empty
 * requirement list at exactly the moment it needs one.
 *
 * The camelCase domain projection is `StripeAccountRequirements` in
 * `src/libs/stripeConnect/readiness.ts`.
 */
export type StripeAccountRequirementsJson = {
  currently_due?: string[];
  eventually_due?: string[];
  past_due?: string[];
  pending_verification?: string[];
  /** Unix seconds, exactly as Stripe reports them. */
  current_deadline?: number | null;
  future_current_deadline?: number | null;
  disabled_reason?: string | null;
};

export type StripeConnectRevocationCause = 'revoked_local' | 'deauthorized';

/**
 * Append-only binding history. Nothing ever UPDATEs `stripe_account_id`; a
 * re-bind INSERTs a new row and the superseded row is retained with
 * `revoked_at` + `revocation_cause`. There is no DELETE path.
 */
export const salonStripeAccountSchema = pgTable(
  'salon_stripe_account',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    stripeAccountId: text('stripe_account_id').notNull(),
    livemode: boolean('livemode').notNull(),
    chargesEnabled: boolean('charges_enabled').default(false).notNull(),
    payoutsEnabled: boolean('payouts_enabled').default(false).notNull(),
    detailsSubmitted: boolean('details_submitted').default(false).notNull(),
    requirementsDue: jsonb('requirements_due')
      .$type<StripeAccountRequirementsJson>()
      .default({})
      .notNull(),
    disabledReason: text('disabled_reason'),
    connectedAt: timestamp('connected_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    revocationCause: text('revocation_cause').$type<StripeConnectRevocationCause>(),
    lastSyncedAt: timestamp('last_synced_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    // PARTIAL, not total: a retained revoked row must not permanently occupy
    // either unique slot, or a salon could never re-bind after deauthorization.
    liveSalonUniq: uniqueIndex('salon_stripe_account_live_salon_uniq')
      .on(table.salonId)
      .where(sql`${table.revokedAt} is null`),
    liveAccountUniq: uniqueIndex('salon_stripe_account_live_account_uniq')
      .on(table.stripeAccountId)
      .where(sql`${table.revokedAt} is null`),
    // Total lookup across live AND revoked rows: webhook resolution must find an
    // old salon's genuine in-flight events, not classify them as foreign.
    accountIdx: index('salon_stripe_account_account_idx').on(table.stripeAccountId),
  }),
);

/**
 * Terminal-history deposit record. **D2 writes no row here and updates none.**
 * Mapped in full so the column census proves 0065 matches, and read at exactly
 * one runtime site (the disconnect route's DEPOSITS_IN_FLIGHT count).
 */
export const appointmentDepositSchema = pgTable(
  'appointment_deposit',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull(),
    appointmentId: text('appointment_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    disclosedAmountCents: integer('disclosed_amount_cents'),
    currency: text('currency').default('cad').notNull(),
    status: text('status').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    // Set only by the verified collection transition. NULL on historical rows
    // and every deposit that has not been authoritatively confirmed collected.
    collectedAt: timestamp('collected_at', { mode: 'date', withTimezone: true }),
    stripeCheckoutUrl: text('stripe_checkout_url'),
    checkoutSuccessUrl: text('checkout_success_url'),
    checkoutCancelUrl: text('checkout_cancel_url'),
    resolutionNote: text('resolution_note'),
    stripeRefundId: text('stripe_refund_id'),
    refundedAt: timestamp('refunded_at', { mode: 'date', withTimezone: true }),
    lateCheckDoneAt: timestamp('late_check_done_at', { mode: 'date', withTimezone: true }),
    pollRetrievals: integer('poll_retrievals').default(0).notNull(),
    pollWindowRetrievals: integer('poll_window_retrievals').default(0).notNull(),
    pollWindowStartedAt: timestamp('poll_window_started_at', {
      mode: 'date',
      withTimezone: true,
    }),
    refundTerminalFailureCount: integer('refund_terminal_failure_count')
      .default(0)
      .notNull(),
    // Begins at ONE, not zero, so first-attempt idempotency keys stay stable.
    refundKeyEpoch: integer('refund_key_epoch').default(1).notNull(),
    refundStatus: text('refund_status'),
    refundStatusChangedAt: timestamp('refund_status_changed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    refundAmountCents: integer('refund_amount_cents'),
    priorRefundIds: text('prior_refund_ids').array().default([]).notNull(),
    refundReconcileAttempts: integer('refund_reconcile_attempts').default(0).notNull(),
    refundReconcileClaimedAt: timestamp('refund_reconcile_claimed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    refundRequestedAt: timestamp('refund_requested_at', {
      mode: 'date',
      withTimezone: true,
    }),
    refundRequestedBy: text('refund_requested_by'),
    refundRequestedByRole: text('refund_requested_by_role'),
    refundTrigger: text('refund_trigger')
      .$type<'owner' | 'system_late_payment' | 'external'>(),
    refundRequestedEnv: text('refund_requested_env'),
    refundLastErrorCode: text('refund_last_error_code'),
    refundFailureReason: text('refund_failure_reason'),
    externalRefundObservedCents: integer('external_refund_observed_cents'),
    refundConflictFlag: boolean('refund_conflict_flag').default(false).notNull(),
    refundRequestedImpersonated: boolean('refund_requested_impersonated')
      .default(false)
      .notNull(),
    waivedAt: timestamp('waived_at', { mode: 'date', withTimezone: true }),
    waivedBy: text('waived_by'),
    waiverReason: text('waiver_reason'),
    forfeitedAt: timestamp('forfeited_at', { mode: 'date', withTimezone: true }),
    forfeitureTaxSnapshot: jsonb('forfeiture_tax_snapshot')
      .$type<import('@/libs/taxConfig').ForfeitureTaxSnapshot>(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    appointmentFk: foreignKey({
      name: 'appointment_deposit_appointment_fk',
      columns: [table.salonId, table.appointmentId],
      foreignColumns: [appointmentSchema.salonId, appointmentSchema.id],
    }).onDelete('restrict'),
    sessionUniq: uniqueIndex('appointment_deposit_session_uniq')
      .on(table.stripeCheckoutSessionId),
    piUniq: uniqueIndex('appointment_deposit_pi_uniq').on(table.stripePaymentIntentId),
    refundUniq: uniqueIndex('appointment_deposit_refund_uniq').on(table.stripeRefundId),
    // PARTIAL: terminal rows accumulate; only one active deposit per appointment.
    oneActive: uniqueIndex('appointment_deposit_one_active')
      .on(table.appointmentId)
      .where(sql`${table.status} in ('checkout_created','paid')`),
    salonStatusIdx: index('appointment_deposit_salon_status_idx')
      .on(table.salonId, table.status),
  }),
);

/**
 * Durable webhook receipt/claim ledger, shared by the Connect route D2 builds
 * and by a later PR's money route.
 *
 * `salon_id` deliberately carries NO foreign key — an FK would make it a
 * salon-pointing FK and drag the table into the SALON_PURGE_PLAN coverage
 * guard. D2 writes it nowhere.
 */
export const stripeWebhookEventSchema = pgTable(
  'stripe_webhook_event',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    account: text('account'),
    livemode: boolean('livemode').notNull(),
    // Context only, no FK. Written by nobody in D2.
    salonId: text('salon_id'),
    status: text('status').notNull(),
    outcome: text('outcome'),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { mode: 'date', withTimezone: true }),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }),
    // Normalized projection columns. Mapped so the census passes; a later PR
    // owns every one of them. All nullable.
    sessionId: text('session_id'),
    paymentIntentId: text('payment_intent_id'),
    paymentStatus: text('payment_status'),
    amountTotal: integer('amount_total'),
    currency: text('currency'),
    metadataAppointmentId: text('metadata_appointment_id'),
    metadataSalonId: text('metadata_salon_id'),
    metadataDepositId: text('metadata_deposit_id'),
    clientReferenceId: text('client_reference_id'),
    projectionStatus: text('projection_status'),
    rawPayload: jsonb('raw_payload'),
    payloadPurgeAfter: timestamp('payload_purge_after', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    eventIdUniq: uniqueIndex('stripe_webhook_event_event_id_uniq').on(table.eventId),
    statusAvailableIdx: index('stripe_webhook_event_status_available_idx')
      .on(table.status, table.availableAt),
  }),
);

export type SalonStripeAccount = typeof salonStripeAccountSchema.$inferSelect;
export type NewSalonStripeAccount = typeof salonStripeAccountSchema.$inferInsert;
export type AppointmentDeposit = typeof appointmentDepositSchema.$inferSelect;
export type NewAppointmentDeposit = typeof appointmentDepositSchema.$inferInsert;
export type StripeWebhookEvent = typeof stripeWebhookEventSchema.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEventSchema.$inferInsert;

// =============================================================================
// GATE B / MIGRATION 0069 — BILLING & SMS-CREDIT FOUNDATION
// Governing contract: docs/luster-billing-communications-rev-2-2.md §6-§8.
// Hand-written mappings for 0069_billing_credit_foundation.sql. Everything in
// this block is DARK in Gate B: no route, webhook or cron reads these tables
// outside tests. The append-only ledger has no updatedAt on purpose.
// =============================================================================

export const BILLING_SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;
export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];

export const BILLING_CADENCES_DB = ['monthly', 'annual'] as const;
export type BillingCadenceDb = (typeof BILLING_CADENCES_DB)[number];

export const BILLING_CREDIT_WINDOW_STATUSES = [
  'pending',
  'granted',
  'skipped_unpaid',
  'skipped_missed',
  'reversed',
] as const;
export type BillingCreditWindowStatus = (typeof BILLING_CREDIT_WINDOW_STATUSES)[number];

export const BILLING_IDENTITY_LINK_TYPES = [
  'clerk_user',
  'salon',
  'stripe_customer',
  'email_hmac',
] as const;
export type BillingIdentityLinkType = (typeof BILLING_IDENTITY_LINK_TYPES)[number];

export const BILLING_PROMOTION_CLAIM_STATUSES = [
  'reserved',
  'redeemed',
  'released',
  'expired',
  'rejected',
] as const;
export type BillingPromotionClaimStatus = (typeof BILLING_PROMOTION_CLAIM_STATUSES)[number];

export const BILLING_CHECKOUT_ATTEMPT_STATUSES = [
  'creating',
  'checkout_created',
  'completed',
  'expired',
  'failed',
  'superseded',
] as const;
export type BillingCheckoutAttemptStatus = (typeof BILLING_CHECKOUT_ATTEMPT_STATUSES)[number];

export const SMS_CREDIT_ENTRY_TYPES = [
  'grant',
  'debit',
  'sms_refund',
  'purchase_reversal',
  'adjustment',
  'expiry',
] as const;
export type SmsCreditEntryType = (typeof SMS_CREDIT_ENTRY_TYPES)[number];

export const SMS_CREDIT_BUCKETS = [
  'starter',
  'monthly',
  'purchased',
  'promotional',
  'delivery_recovery',
  'administrative',
] as const;
export type SmsCreditBucket = (typeof SMS_CREDIT_BUCKETS)[number];

export const SMS_CREDIT_RESERVATION_STATUSES = ['held', 'settled', 'released', 'expired'] as const;
export type SmsCreditReservationStatus = (typeof SMS_CREDIT_RESERVATION_STATUSES)[number];

export const SMS_LOW_BALANCE_TIERS = ['20pct', '10', '0'] as const;
export type SmsLowBalanceTier = (typeof SMS_LOW_BALANCE_TIERS)[number];

export const BILLING_STRIPE_EVENT_STATUSES = [
  'processing',
  'processed',
  'failed_retryable',
  'poisoned',
  'ignored_unhandled',
  'ignored_livemode_mismatch',
  'ignored_foreign',
  'superseded_stale',
  'held_anomaly',
] as const;
export type BillingStripeEventStatus = (typeof BILLING_STRIPE_EVENT_STATUSES)[number];

export const SMS_TOPUP_PURCHASE_STATUSES = [
  'checkout_created',
  'paid',
  'fulfilled',
  'expired',
  'canceled',
  'refunded',
  'partially_reversed',
  'disputed',
] as const;
export type SmsTopupPurchaseStatus = (typeof SMS_TOPUP_PURCHASE_STATUSES)[number];

export const billingSubscriptionSchema = pgTable(
  'billing_subscription',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    stripeSubscriptionId: text('stripe_subscription_id').notNull(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    planDefinitionKey: text('plan_definition_key').notNull(),
    billingOfferKey: text('billing_offer_key').notNull(),
    pendingOfferKey: text('pending_offer_key'),
    promotionKey: text('promotion_key'),
    rateProtectedThrough: timestamp('rate_protected_through', { mode: 'date', withTimezone: true }),
    billingCadence: text('billing_cadence').$type<BillingCadenceDb>().notNull(),
    status: text('status').$type<BillingSubscriptionStatus>().notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    paidThrough: timestamp('paid_through', { mode: 'date', withTimezone: true }).notNull(),
    creditCycleAnchor: timestamp('credit_cycle_anchor', { mode: 'date', withTimezone: true }).notNull(),
    creditCycleIndex: integer('credit_cycle_index').default(0).notNull(),
    currentCreditWindowStart: timestamp('current_credit_window_start', { mode: 'date', withTimezone: true }),
    currentCreditWindowEnd: timestamp('current_credit_window_end', { mode: 'date', withTimezone: true }),
    nextCreditGrantAt: timestamp('next_credit_grant_at', { mode: 'date', withTimezone: true }),
    lastEventCreated: timestamp('last_event_created', { mode: 'date', withTimezone: true }),
    lastEventId: text('last_event_id'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    stripeSubUniq: uniqueIndex('billing_subscription_stripe_sub_uniq').on(table.stripeSubscriptionId),
    // One LIVE subscription per salon; canceled/expired history rows remain.
    liveSalonUniq: uniqueIndex('billing_subscription_live_salon_uniq')
      .on(table.salonId)
      .where(sql`${table.status} not in ('canceled', 'incomplete_expired')`),
    salonIdx: index('billing_subscription_salon_idx').on(table.salonId, table.status),
  }),
);
export type BillingSubscription = typeof billingSubscriptionSchema.$inferSelect;
export type NewBillingSubscription = typeof billingSubscriptionSchema.$inferInsert;

export const billingCreditWindowSchema = pgTable(
  'billing_credit_window',
  {
    id: text('id').primaryKey(),
    billingSubscriptionId: text('billing_subscription_id')
      .notNull()
      .references(() => billingSubscriptionSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    creditCycleIndex: integer('credit_cycle_index').notNull(),
    planDefinitionKey: text('plan_definition_key').notNull(),
    windowStart: timestamp('window_start', { mode: 'date', withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { mode: 'date', withTimezone: true }).notNull(),
    status: text('status').$type<BillingCreditWindowStatus>().notNull(),
    grantLedgerId: text('grant_ledger_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { mode: 'date', withTimezone: true }),
  },
  table => ({
    cycleUniq: uniqueIndex('billing_credit_window_cycle_uniq')
      .on(table.billingSubscriptionId, table.creditCycleIndex),
    idemUniq: uniqueIndex('billing_credit_window_idem_uniq').on(table.idempotencyKey),
    salonIdx: index('billing_credit_window_salon_idx').on(table.salonId, table.status),
  }),
);
export type BillingCreditWindow = typeof billingCreditWindowSchema.$inferSelect;
export type NewBillingCreditWindow = typeof billingCreditWindowSchema.$inferInsert;

export const billingBusinessIdentitySchema = pgTable('billing_business_identity', {
  id: text('id').primaryKey(),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
export type BillingBusinessIdentity = typeof billingBusinessIdentitySchema.$inferSelect;

export const billingBusinessIdentityLinkSchema = pgTable(
  'billing_business_identity_link',
  {
    id: text('id').primaryKey(),
    businessIdentityId: text('business_identity_id')
      .notNull()
      .references(() => billingBusinessIdentitySchema.id, { onDelete: 'cascade' }),
    linkType: text('link_type').$type<BillingIdentityLinkType>().notNull(),
    // Plain text VALUE on purpose (even for link_type='salon'): the link must
    // survive salon purge or once-per-business enforcement dies with the salon.
    linkValue: text('link_value').notNull(),
    hmacKeyVersion: integer('hmac_key_version'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    valueUniq: uniqueIndex('billing_identity_link_value_uniq').on(table.linkType, table.linkValue),
    identityIdx: index('billing_identity_link_identity_idx').on(table.businessIdentityId),
  }),
);
export type BillingBusinessIdentityLink = typeof billingBusinessIdentityLinkSchema.$inferSelect;

export const billingStarterGrantSchema = pgTable(
  'billing_starter_grant',
  {
    id: text('id').primaryKey(),
    businessIdentityId: text('business_identity_id')
      .notNull()
      .references(() => billingBusinessIdentitySchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'set null' }),
    ledgerId: text('ledger_id'),
    credits: integer('credits').notNull(),
    grantedAt: timestamp('granted_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    // THE once-per-business enforcement: ledger rows purge with their salon,
    // this evidence row does not.
    identityUniq: uniqueIndex('billing_starter_grant_identity_uniq').on(table.businessIdentityId),
    salonIdx: index('billing_starter_grant_salon_idx').on(table.salonId),
  }),
);
export type BillingStarterGrant = typeof billingStarterGrantSchema.$inferSelect;

export const billingPromotionCounterSchema = pgTable('billing_promotion_counter', {
  promotionKey: text('promotion_key').primaryKey(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

export const billingPromotionClaimSchema = pgTable(
  'billing_promotion_claim',
  {
    id: text('id').primaryKey(),
    promotionKey: text('promotion_key').notNull(),
    businessIdentityId: text('business_identity_id')
      .notNull()
      .references(() => billingBusinessIdentitySchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'set null' }),
    billingCheckoutAttemptId: text('billing_checkout_attempt_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    status: text('status').$type<BillingPromotionClaimStatus>().notNull(),
    reservedAt: timestamp('reserved_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }),
    redeemedAt: timestamp('redeemed_at', { mode: 'date', withTimezone: true }),
    releasedAt: timestamp('released_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    liveUniq: uniqueIndex('billing_promotion_claim_live_uniq')
      .on(table.promotionKey, table.businessIdentityId)
      .where(sql`${table.status} in ('reserved', 'redeemed')`),
    salonIdx: index('billing_promotion_claim_salon_idx').on(table.salonId),
    statusIdx: index('billing_promotion_claim_status_idx').on(table.promotionKey, table.status),
  }),
);
export type BillingPromotionClaim = typeof billingPromotionClaimSchema.$inferSelect;

export const billingCheckoutAttemptSchema = pgTable(
  'billing_checkout_attempt',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<'plan_subscription' | 'sms_topup'>().notNull(),
    billingOfferKey: text('billing_offer_key'),
    topupOfferKey: text('topup_offer_key'),
    promotionKey: text('promotion_key'),
    status: text('status').$type<BillingCheckoutAttemptStatus>().notNull(),
    stripeIdempotencyKey: text('stripe_idempotency_key').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    // Purpose-scoped: a pending subscription attempt must never block top-ups.
    activeSubscriptionUniq: uniqueIndex('billing_checkout_attempt_active_subscription_uniq')
      .on(table.salonId)
      .where(sql`${table.purpose} = 'plan_subscription' and ${table.status} in ('creating', 'checkout_created')`),
    idemUniq: uniqueIndex('billing_checkout_attempt_idem_uniq').on(table.stripeIdempotencyKey),
    sessionUniq: uniqueIndex('billing_checkout_attempt_session_uniq')
      .on(table.stripeCheckoutSessionId)
      .where(sql`${table.stripeCheckoutSessionId} is not null`),
    salonIdx: index('billing_checkout_attempt_salon_idx').on(table.salonId, table.status),
  }),
);
export type BillingCheckoutAttempt = typeof billingCheckoutAttemptSchema.$inferSelect;

export const smsCreditLedgerSchema = pgTable(
  'sms_credit_ledger',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    entryType: text('entry_type').$type<SmsCreditEntryType>().notNull(),
    bucket: text('bucket').$type<SmsCreditBucket>().notNull(),
    amount: integer('amount').notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }),
    consumedFromLedgerId: text('consumed_from_ledger_id'),
    reservationId: text('reservation_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason').notNull(),
    stripeRef: text('stripe_ref'),
    actor: text('actor'),
    note: text('note'),
    // Append-only: no updatedAt, and a DB trigger rejects UPDATE outright.
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    idemUniq: uniqueIndex('sms_credit_ledger_idem_uniq').on(table.idempotencyKey),
    salonCreatedIdx: index('sms_credit_ledger_salon_created_idx').on(table.salonId, table.createdAt),
    lotConsumptionIdx: index('sms_credit_ledger_lot_consumption_idx').on(table.consumedFromLedgerId),
    openLotsIdx: index('sms_credit_ledger_open_lots_idx')
      .on(table.salonId, table.expiresAt)
      .where(sql`${table.amount} > 0`),
  }),
);
export type SmsCreditLedgerEntry = typeof smsCreditLedgerSchema.$inferSelect;
export type NewSmsCreditLedgerEntry = typeof smsCreditLedgerSchema.$inferInsert;

export const smsCreditAccountSchema = pgTable('sms_credit_account', {
  salonId: text('salon_id')
    .primaryKey()
    .references(() => salonSchema.id, { onDelete: 'cascade' }),
  cachedAvailable: integer('cached_available').default(0).notNull(),
  cachedReserved: integer('cached_reserved').default(0).notNull(),
  cacheComputedAt: timestamp('cache_computed_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .notNull(),
  warningEpoch: integer('warning_epoch').default(0).notNull(),
  lastWarningTier: text('last_warning_tier').$type<SmsLowBalanceTier>(),
  lastWarningAt: timestamp('last_warning_at', { mode: 'date', withTimezone: true }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
export type SmsCreditAccount = typeof smsCreditAccountSchema.$inferSelect;

export const smsCreditReservationSchema = pgTable(
  'sms_credit_reservation',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id').references(() => notificationDeliverySchema.id, {
      onDelete: 'set null',
    }),
    dedupeKey: text('dedupe_key').notNull(),
    segments: integer('segments').notNull(),
    status: text('status').$type<SmsCreditReservationStatus>().notNull(),
    providerSid: text('provider_sid'),
    providerSegments: integer('provider_segments'),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { mode: 'date', withTimezone: true }),
    releasedAt: timestamp('released_at', { mode: 'date', withTimezone: true }),
    releaseReason: text('release_reason'),
    refundedAt: timestamp('refunded_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    activeDedupeUniq: uniqueIndex('sms_credit_reservation_active_dedupe_uniq')
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('held', 'settled')`),
    reaperIdx: index('sms_credit_reservation_reaper_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'held'`),
    salonIdx: index('sms_credit_reservation_salon_idx').on(table.salonId, table.status),
  }),
);
export type SmsCreditReservation = typeof smsCreditReservationSchema.$inferSelect;

export const smsCreditReservationLotSchema = pgTable(
  'sms_credit_reservation_lot',
  {
    reservationId: text('reservation_id')
      .notNull()
      .references(() => smsCreditReservationSchema.id, { onDelete: 'cascade' }),
    lotLedgerId: text('lot_ledger_id')
      .notNull()
      .references(() => smsCreditLedgerSchema.id, { onDelete: 'cascade' }),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    segments: integer('segments').notNull(),
    debitLedgerId: text('debit_ledger_id'),
    refundLedgerId: text('refund_ledger_id'),
    refundedAt: timestamp('refunded_at', { mode: 'date', withTimezone: true }),
    refundedSegments: integer('refunded_segments').default(0).notNull(),
  },
  table => ({
    pk: primaryKey({
      name: 'sms_credit_reservation_lot_pk',
      columns: [table.reservationId, table.lotLedgerId],
    }),
    lotIdx: index('sms_credit_reservation_lot_lot_idx').on(table.lotLedgerId),
  }),
);
export type SmsCreditReservationLot = typeof smsCreditReservationLotSchema.$inferSelect;

export const billingStripeEventSchema = pgTable(
  'billing_stripe_event',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    livemode: boolean('livemode').notNull(),
    apiCreatedAt: timestamp('api_created_at', { mode: 'date', withTimezone: true }).notNull(),
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'set null' }),
    status: text('status').$type<BillingStripeEventStatus>().notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { mode: 'date', withTimezone: true }),
    lastError: text('last_error'),
    subscriptionId: text('subscription_id'),
    invoiceId: text('invoice_id'),
    checkoutSessionId: text('checkout_session_id'),
    paymentIntentId: text('payment_intent_id'),
    priceId: text('price_id'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    payloadPurgeAfter: timestamp('payload_purge_after', { mode: 'date', withTimezone: true }),
    receivedAt: timestamp('received_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    eventIdUniq: uniqueIndex('billing_stripe_event_event_id_uniq').on(table.eventId),
    statusAvailableIdx: index('billing_stripe_event_status_available_idx').on(
      table.status,
      table.availableAt,
    ),
  }),
);
export type BillingStripeEvent = typeof billingStripeEventSchema.$inferSelect;

export const smsTopupPurchaseSchema = pgTable(
  'sms_topup_purchase',
  {
    id: text('id').primaryKey(),
    // SET NULL: paid-money evidence must survive salon purge (audit/refunds).
    salonId: text('salon_id').references(() => salonSchema.id, { onDelete: 'set null' }),
    topupOfferKey: text('topup_offer_key').notNull(),
    credits: integer('credits').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').default('cad').notNull(),
    status: text('status').$type<SmsTopupPurchaseStatus>().notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeRefundId: text('stripe_refund_id'),
    stripeDisputeId: text('stripe_dispute_id'),
    grantLedgerId: text('grant_ledger_id'),
    refundedAt: timestamp('refunded_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    sessionUniq: uniqueIndex('sms_topup_purchase_session_uniq')
      .on(table.stripeCheckoutSessionId)
      .where(sql`${table.stripeCheckoutSessionId} is not null`),
    piUniq: uniqueIndex('sms_topup_purchase_pi_uniq')
      .on(table.stripePaymentIntentId)
      .where(sql`${table.stripePaymentIntentId} is not null`),
    salonIdx: index('sms_topup_purchase_salon_idx').on(table.salonId, table.status),
  }),
);
export type SmsTopupPurchase = typeof smsTopupPurchaseSchema.$inferSelect;

// =============================================================================
// GATE B / MIGRATION 0070 — COMMUNICATIONS PIPELINE
// Hand-written mappings for 0070_communications_pipeline.sql. Everything DARK:
// the dispatcher requires CRON_SECRET and the control row ships disabled.
// notification_delivery extension columns are declared on the existing table
// mapping consumers via raw SQL where needed; the drizzle mapping additions
// live here as a parallel typed surface for new code only.
// =============================================================================

export const COMMUNICATION_INTENT_STATUSES = [
  'pending',
  'claimed',
  'sending',
  'sent',
  'send_outcome_unknown',
  'failed',
  'canceled',
  'suppressed',
  'expired',
  'blocked_no_credit',
] as const;
export type CommunicationIntentStatus = (typeof COMMUNICATION_INTENT_STATUSES)[number];

export const COMMUNICATION_EVENT_TYPES = [
  'booking_confirmation',
  'booking_request_received',
  'booking_request_approved',
  'booking_request_declined',
  'booking_request_expired',
  'appointment_rescheduled',
  'appointment_cancelled',
  'deposit_received',
  'deposit_refunded',
  'balance_reminder',
  'appointment_reminder',
  'manual_reminder',
  'owner_new_booking',
  'owner_appointment_cancelled',
  'tech_new_booking',
  'tech_appointment_cancelled',
] as const;
export type CommunicationEventType = (typeof COMMUNICATION_EVENT_TYPES)[number];

export const communicationIntentSchema = pgTable(
  'communication_intent',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id').references(() => appointmentSchema.id, {
      onDelete: 'cascade',
    }),
    channel: text('channel').$type<'sms' | 'email'>().notNull(),
    eventType: text('event_type').$type<CommunicationEventType>().notNull(),
    audience: text('audience').$type<'client' | 'owner' | 'technician'>().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    recipient: text('recipient').notNull(),
    destinationCountry: text('destination_country'),
    templateKey: text('template_key').notNull(),
    templateVersion: text('template_version').notNull(),
    variables: jsonb('variables').$type<Record<string, string>>().default({}).notNull(),
    ruleId: text('rule_id'),
    startRevision: text('start_revision'),
    schedulingRevision: text('scheduling_revision').notNull(),
    bodySnapshot: text('body_snapshot'),
    bodyFingerprint: text('body_fingerprint'),
    segmentCount: integer('segment_count'),
    encoding: text('encoding'),
    status: text('status').$type<CommunicationIntentStatus>().default('pending').notNull(),
    scheduledFor: timestamp('scheduled_for', { mode: 'date', withTimezone: true }).notNull(),
    notAfter: timestamp('not_after', { mode: 'date', withTimezone: true }).notNull(),
    availableAt: timestamp('available_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lockedBy: text('locked_by'),
    leaseExpiresAt: timestamp('lease_expires_at', { mode: 'date', withTimezone: true }),
    deliveryId: text('delivery_id').references(() => notificationDeliverySchema.id, {
      onDelete: 'set null',
    }),
    creditReservationId: text('credit_reservation_id').references(
      () => smsCreditReservationSchema.id,
      { onDelete: 'set null' },
    ),
    requiredCredits: integer('required_credits'),
    blockedReason: text('blocked_reason'),
    blockedAt: timestamp('blocked_at', { mode: 'date', withTimezone: true }),
    supersededByIntentId: text('superseded_by_intent_id'),
    resolvedAt: timestamp('resolved_at', { mode: 'date', withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    dedupeUniq: uniqueIndex('communication_intent_dedupe_uniq').on(table.dedupeKey),
    dueIdx: index('communication_intent_due_idx')
      .on(table.availableAt, table.scheduledFor)
      .where(sql`${table.status} = 'pending'`),
    leaseIdx: index('communication_intent_lease_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} in ('claimed', 'sending')`),
    salonIdx: index('communication_intent_salon_idx').on(table.salonId, table.status, table.scheduledFor),
    appointmentIdx: index('communication_intent_appointment_idx').on(
      table.salonId,
      table.appointmentId,
      table.status,
    ),
  }),
);
export type CommunicationIntent = typeof communicationIntentSchema.$inferSelect;
export type NewCommunicationIntent = typeof communicationIntentSchema.$inferInsert;

export const smsGlobalConsentEventSchema = pgTable(
  'sms_global_consent_event',
  {
    id: text('id').primaryKey(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    senderIdentity: text('sender_identity').notNull(),
    recipient: text('recipient').notNull(),
    state: text('state').$type<'suppressed' | 'restored'>().notNull(),
    keywordClassification: text('keyword_classification'),
    optOutType: text('opt_out_type'),
    source: text('source').notNull(),
    providerSid: text('provider_sid'),
    occurredAt: timestamp('occurred_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    recipientIdx: index('sms_global_consent_recipient_idx').on(
      table.senderIdentity,
      table.recipient,
      table.seq,
    ),
    providerSidUniq: uniqueIndex('sms_global_consent_provider_sid_uniq')
      .on(table.providerSid)
      .where(sql`${table.providerSid} is not null`),
  }),
);
export type SmsGlobalConsentEvent = typeof smsGlobalConsentEventSchema.$inferSelect;

export const smsInboundEventSchema = pgTable(
  'sms_inbound_event',
  {
    id: text('id').primaryKey(),
    attributedSalonId: text('attributed_salon_id').references(() => salonSchema.id, {
      onDelete: 'set null',
    }),
    senderIdentity: text('sender_identity'),
    fromRecipient: text('from_recipient').notNull(),
    toNumber: text('to_number').notNull(),
    keywordClassification: text('keyword_classification')
      .$type<'stop' | 'start' | 'help' | 'cancel' | 'other'>()
      .notNull(),
    attributionState: text('attribution_state')
      .$type<'attributed' | 'unattributed' | 'ambiguous'>()
      .notNull(),
    bodyPresent: boolean('body_present').notNull(),
    segmentCount: integer('segment_count'),
    providerPriceRaw: numeric('provider_price_raw'),
    providerCurrency: text('provider_currency'),
    providerSid: text('provider_sid').notNull(),
    receivedAt: timestamp('received_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    providerSidUniq: uniqueIndex('sms_inbound_event_provider_sid_uniq').on(table.providerSid),
    receivedIdx: index('sms_inbound_event_received_idx').on(table.receivedAt),
  }),
);
export type SmsInboundEvent = typeof smsInboundEventSchema.$inferSelect;

export const platformCommunicationControlSchema = pgTable('platform_communication_control', {
  id: text('id').primaryKey(),
  smsEnabled: boolean('sms_enabled').default(false).notNull(),
  disabledEventTypes: jsonb('disabled_event_types').$type<string[]>().default([]).notNull(),
  dispatchBatchLimit: integer('dispatch_batch_limit').default(100).notNull(),
  perSalonBatchLimit: integer('per_salon_batch_limit').default(1).notNull(),
  dailySendLimit: integer('daily_send_limit').default(5000).notNull(),
  dailyAnomalyThreshold: integer('daily_anomaly_threshold').default(250).notNull(),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
export type PlatformCommunicationControl = typeof platformCommunicationControlSchema.$inferSelect;

// notification_delivery 0070 extension columns (typed parallel surface —
// added to the existing mapping's table via raw SQL migration; new code reads
// them through this extended mapping).
export const NOTIFICATION_DELIVERY_SETTLEMENT_STATES = [
  'settling',
  'settled',
  'refunded',
  'released',
  'not_applicable',
] as const;
export type NotificationDeliverySettlementState
  = (typeof NOTIFICATION_DELIVERY_SETTLEMENT_STATES)[number];

// =============================================================================
// Luster Discover — Portfolio Foundation (Discover PR1)
// =============================================================================
//
// This is the canonical salon-owned portfolio: fresh owner-uploaded marketing
// media. It is deliberately SEPARATE from `appointment_photo`, which holds
// per-appointment client before/after records keyed to a client's phone number.
// Appointment photos are client records, not marketing assets: they are never
// migrated, promoted, or published here, and public-display consent is never
// inferred from them.
//
// Discover browsing metadata (service family + length) is NOT booking-category
// identity. `VISIBLE_BOOKING_CATEGORIES` in `@/libs/bookingCategory` remains
// the authority for the three main booking categories a booking surface may
// show; these families are a separate photo-browsing dimension whose values are
// derived from the real service catalogue (`TEMPLATE_KEY_FAMILY_PREFIXES` in
// `@/libs/serviceImage`). See `@/libs/discoverTaxonomy`.

export const discoverServiceFamilyEnum = pgEnum('discover_service_family', [
  'gel_x',
  'acrylic',
  'builder_gel',
  'hard_gel',
  'polygel',
  'dip_powder',
  'manicure',
  'pedicure',
  'unspecified',
]);

export const discoverNailLengthEnum = pgEnum('discover_nail_length', [
  'short',
  'medium',
  'long',
  'xl',
  'unspecified',
]);

/**
 * Moderation state is admin-owned and separate from owner intent.
 *
 * - `allowed`     — no moderation action.
 * - `discover_off` — removed from Discover surfaces only; the photo remains
 *                    eligible for the salon's own profile grid.
 * - `disabled`    — removed everywhere.
 */
export const portfolioModerationStateEnum = pgEnum('portfolio_moderation_state', [
  'allowed',
  'discover_off',
  'disabled',
]);
export type PortfolioModerationState
  = (typeof portfolioModerationStateEnum.enumValues)[number];

export const salonPortfolioPhotoSchema = pgTable(
  'salon_portfolio_photo',
  {
    id: text('id').primaryKey(),

    // Stable identifier used by public-facing surfaces in later Discover PRs.
    // Never reuse the internal id publicly, and never treat a public id as
    // mutation authority.
    publicId: text('public_id').notNull(),

    salonId: text('salon_id')
      .notNull()
      .references(() => salonSchema.id, { onDelete: 'cascade' }),

    // V1 businesses have a single primary location; the association is modeled
    // now so multi-location remains possible without a rewrite.
    locationId: text('location_id').references(() => salonLocationSchema.id, {
      onDelete: 'set null',
    }),

    // Optional attribution. Nulled (not cascaded) when a technician is removed,
    // matching how `appointment_photo.uploaded_by_tech_id` is purged.
    technicianId: text('technician_id').references(() => technicianSchema.id, {
      onDelete: 'set null',
    }),

    // Cloudinary object reference. Managed public ids are app-generated and
    // validated; browser-supplied values are never trusted.
    cloudinaryPublicId: text('cloudinary_public_id').notNull(),
    imageUrl: text('image_url').notNull(),
    originalWidth: integer('original_width').notNull(),
    originalHeight: integer('original_height').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),

    // Owner-managed ordering. Also decides which photos stay plan-eligible when
    // an allowance shrinks, so the owner keeps control of what survives.
    sortOrder: integer('sort_order').default(0).notNull(),

    // Owner intent. These are NEVER rewritten by a plan change.
    ownerVisible: boolean('owner_visible').default(true).notNull(),
    discoverIncluded: boolean('discover_included').default(true).notNull(),

    serviceFamily: discoverServiceFamilyEnum('service_family')
      .default('unspecified')
      .notNull(),
    nailLength: discoverNailLengthEnum('nail_length').default('unspecified').notNull(),

    // Normalized 4:5 crop rectangle plus focal point, all stored as fractions of
    // the original in [0,1]. Sufficient to derive the swipe (4:5), nearby (1:1)
    // and profile-grid variants via Cloudinary transforms without duplicating
    // physical files.
    cropX: numeric('crop_x', { precision: 6, scale: 5 }),
    cropY: numeric('crop_y', { precision: 6, scale: 5 }),
    cropWidth: numeric('crop_width', { precision: 6, scale: 5 }),
    cropHeight: numeric('crop_height', { precision: 6, scale: 5 }),
    focalX: numeric('focal_x', { precision: 6, scale: 5 }),
    focalY: numeric('focal_y', { precision: 6, scale: 5 }),

    altText: text('alt_text'),

    moderationState: portfolioModerationStateEnum('moderation_state')
      .default('allowed')
      .notNull(),

    // Durable publication-rights evidence. A UI checkbox is not sufficient: the
    // confirming actor, the moment, and the exact text version are all retained
    // so the confirmation is attributable after the fact.
    publicationRightsConfirmedAt: timestamp('publication_rights_confirmed_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    publicationRightsConfirmedBy: text('publication_rights_confirmed_by').notNull(),
    publicationRightsVersion: text('publication_rights_version').notNull(),

    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at', { mode: 'date', withTimezone: true }),
  },
  table => ({
    salonIdx: index('salon_portfolio_photo_salon_idx').on(table.salonId),
    salonOrderIdx: index('salon_portfolio_photo_salon_order_idx').on(
      table.salonId,
      table.sortOrder,
    ),
    locationIdx: index('salon_portfolio_photo_location_idx').on(table.locationId),
    technicianIdx: index('salon_portfolio_photo_technician_idx').on(table.technicianId),
    publicIdIdx: uniqueIndex('salon_portfolio_photo_public_id_idx').on(table.publicId),
    cloudinaryIdx: uniqueIndex('salon_portfolio_photo_cloudinary_idx').on(
      table.cloudinaryPublicId,
    ),
  }),
);
export type SalonPortfolioPhoto = typeof salonPortfolioPhotoSchema.$inferSelect;

/**
 * Business-level Discover participation.
 *
 * Absent row means "not enabled" — existing businesses are opted out by
 * default and no existing content is ever published without consent.
 * `adminSuspendedAt` is admin-owned and independent of the owner's toggle, so
 * suspending Discover never touches the salon's booking page or owner intent.
 */
export const salonDiscoverSettingsSchema = pgTable('salon_discover_settings', {
  salonId: text('salon_id')
    .primaryKey()
    .references(() => salonSchema.id, { onDelete: 'cascade' }),
  discoverEnabled: boolean('discover_enabled').default(false).notNull(),
  adminSuspendedAt: timestamp('admin_suspended_at', { mode: 'date', withTimezone: true }),
  adminSuspendedReason: text('admin_suspended_reason'),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
export type SalonDiscoverSettings = typeof salonDiscoverSettingsSchema.$inferSelect;
