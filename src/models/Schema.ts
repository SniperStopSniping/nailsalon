import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
    isMultiLocationEnabled: boolean('is_multi_location_enabled').default(false),

    // Status (Super Admin controlled)
    status: text('status').default('active'),

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
      .references(() => salonSchema.id),

    // Service Details
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(), // in cents
    durationMinutes: integer('duration_minutes').notNull(),

    // Categorization
    category: text('category').notNull(), // 'hands' | 'feet' | 'combo'

    // Display
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').default(0),

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
    categoryIdx: index('service_category_idx').on(table.salonId, table.category),
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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),

    // Technician (services are linked via junction table)
    technicianId: text('technician_id').references(() => technicianSchema.id),

    // Location (multi-location support)
    // Note: FK reference added at DB level, not ORM level due to schema order
    locationId: text('location_id'),

    // Client (phone-based identification)
    clientPhone: text('client_phone').notNull(),
    clientName: text('client_name'),

    // Stable client identity (Phase 1: nullable for migration, Phase 1.5: NOT NULL after backfill)
    // onDelete: 'restrict' - can't delete salonClient with appointments (use soft-delete if needed)
    salonClientId: text('salon_client_id').references(() => salonClientSchema.id, { onDelete: 'restrict' }),

    // Timing
    startTime: timestamp('start_time', { mode: 'date' }).notNull(),
    endTime: timestamp('end_time', { mode: 'date' }).notNull(),

    // Status
    status: text('status').notNull().default('confirmed'),
    // 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
    cancelReason: text('cancel_reason'),
    // 'rescheduled' | 'client_request' | 'no_show' | null

    // Canvas Flow OS state (parallel to legacy status)
    canvasState: canvasStateEnum('canvas_state').default('waiting'),
    canvasStateUpdatedAt: timestamp('canvas_state_updated_at', { mode: 'date', withTimezone: true }),

    // Soft delete
    deletedAt: timestamp('deleted_at', { mode: 'date', withTimezone: true }),

    // Totals (computed from linked services at booking time)
    totalPrice: integer('total_price').notNull(), // Sum of all service prices
    totalDurationMinutes: integer('total_duration_minutes').notNull(), // Sum of durations

    // Additional
    notes: text('notes'),

    // Lifecycle timestamps (for staff workflow)
    startedAt: timestamp('started_at', { mode: 'date' }), // When tech starts the appointment
    completedAt: timestamp('completed_at', { mode: 'date' }), // When appointment is finished

    // Appointment locking (Step 16A - prevents edits once service starts)
    lockedAt: timestamp('locked_at', { mode: 'date' }), // Set when canvas_state -> 'working'
    lockedBy: text('locked_by'), // technician ID who locked it

    // Arrival tracking (Step 16A - grace window handling)
    arrivedAt: timestamp('arrived_at', { mode: 'date' }),
    wasLate: boolean('was_late').default(false),

    // Staff private notes (Step 16A - only visible to assigned tech)
    techNotes: text('tech_notes'),

    // Payment
    paymentStatus: text('payment_status').default('pending'), // 'pending' | 'paid'

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
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
    deletedAtIdx: index('appointment_deleted_at_idx').on(table.deletedAt),
    // Fraud detection: basic composite for salonClientId lookups
    salonClientIdx: index('appointment_salon_client_idx').on(table.salonId, table.salonClientId),
    // NOTE: For fraud queries, use PARTIAL INDEX via raw SQL migration (most efficient):
    // CREATE INDEX appt_fraud_lookup_idx
    // ON appointment (salon_id, salon_client_id, completed_at)
    // WHERE status = 'completed' AND payment_status = 'paid';
    // (Drizzle doesn't support partial indexes - add via migration only)
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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),

    // Link to global client (for auth/identity)
    clientId: text('client_id').references(() => clientSchema.id),

    // Identity (can override global client data per salon)
    phone: text('phone').notNull(), // normalized 10-digit
    fullName: text('full_name'),
    email: text('email'),

    // Preferences
    preferredTechnicianId: text('preferred_technician_id').references(
      () => technicianSchema.id,
    ),
    notes: text('notes'), // internal staff notes

    // Computed stats (updated after each booking)
    lastVisitAt: timestamp('last_visit_at', { mode: 'date' }),
    totalVisits: integer('total_visits').default(0),
    totalSpent: integer('total_spent').default(0), // in cents
    noShowCount: integer('no_show_count').default(0),
    loyaltyPoints: integer('loyalty_points').default(0),

    // Welcome bonus tracking (Step 21A - one-time 25,000 points)
    welcomeBonusGrantedAt: timestamp('welcome_bonus_granted_at', { mode: 'date' }),

    // Late cancellation tracking (Step 16A - client accountability)
    lateCancelCount: integer('late_cancel_count').default(0),
    lastLateCancelAt: timestamp('last_late_cancel_at', { mode: 'date' }),

    // Admin-only client flags (Step 16A - problem client management)
    adminFlags: jsonb('admin_flags').$type<{
      isProblemClient?: boolean;
      flagReason?: string;
      flaggedAt?: string;
      flaggedBy?: string;
    }>(),
    isBlocked: boolean('is_blocked').default(false),
    blockedReason: text('blocked_reason'),

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
    // Search indexes
    salonIdx: index('salon_client_salon_idx').on(table.salonId),
    phoneIdx: index('salon_client_phone_idx').on(table.phone),
    emailIdx: index('salon_client_email_idx').on(table.salonId, table.email),
    lastVisitIdx: index('salon_client_last_visit_idx').on(
      table.salonId,
      table.lastVisitAt,
    ),
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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),

    // Who owns this reward
    clientPhone: text('client_phone').notNull(),
    clientName: text('client_name'),

    // Link to referral that created this reward
    referralId: text('referral_id').references(() => referralSchema.id),

    // Type: 'referral_referee' (friend who was referred)
    //       'referral_referrer' (person who sent referral)
    type: text('type').notNull(),

    // Points value (2500 points = 1 free manicure)
    points: integer('points').notNull().default(0),

    // Eligible service - for now just "Gel Manicure"
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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),

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
      .references(() => salonSchema.id),
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
      .references(() => salonSchema.id),

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
// AdminInvite - Invites for admin access (invite-only system)
// -----------------------------------------------------------------------------
export const adminInviteSchema = pgTable(
  'admin_invite',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(), // "+14374289008"
    salonId: text('salon_id').references(() => salonSchema.id), // null for super admin
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

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Client = typeof clientSchema.$inferSelect;
export type NewClient = typeof clientSchema.$inferInsert;

export type SalonClient = typeof salonClientSchema.$inferSelect;
export type NewSalonClient = typeof salonClientSchema.$inferInsert;

export type Salon = typeof salonSchema.$inferSelect;
export type NewSalon = typeof salonSchema.$inferInsert;

export type Service = typeof serviceSchema.$inferSelect;
export type NewService = typeof serviceSchema.$inferInsert;

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

export type AppointmentService = typeof appointmentServicesSchema.$inferSelect;
export type NewAppointmentService = typeof appointmentServicesSchema.$inferInsert;

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

export type AdminInvite = typeof adminInviteSchema.$inferSelect;
export type NewAdminInvite = typeof adminInviteSchema.$inferInsert;

export type AdminSalonMembership = typeof adminSalonMembershipSchema.$inferSelect;
export type NewAdminSalonMembership = typeof adminSalonMembershipSchema.$inferInsert;

// =============================================================================
// CONST EXPORTS
// =============================================================================

export const SERVICE_CATEGORIES = ['hands', 'feet', 'combo'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PAYMENT_STATUSES = ['pending', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PHOTO_TYPES = ['before', 'after'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const CANCEL_REASONS = [
  'rescheduled',
  'client_request',
  'no_show',
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
      .references(() => salonSchema.id),
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
      .references(() => salonSchema.id),

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
    salonId: text('salon_id').references(() => salonSchema.id),

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
  // Super-admin actions (merge from existing)
  'updated',
  'owner_changed',
  // Settings updates
  'settings_updated',
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
  'HIGH_APPOINTMENT_FREQUENCY',  // 3+ in 7 days OR 5+ in 14 days
  'HIGH_REWARD_VELOCITY',        // Points >= 5000 in 7 days
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
    id: text('id').primaryKey(),  // Generated via crypto.randomUUID()
    salonId: text('salon_id').notNull().references(() => salonSchema.id),
    // Both NOT NULL - fraud without client or appointment is useless
    // ON DELETE RESTRICT - never cascade-delete fraud history
    salonClientId: text('salon_client_id').notNull().references(() => salonClientSchema.id, { onDelete: 'restrict' }),
    appointmentId: text('appointment_id').notNull().references(() => appointmentSchema.id, { onDelete: 'restrict' }),

    type: fraudSignalTypeEnum('type').notNull(),
    severity: fraudSignalSeverityEnum('severity').notNull().default('MEDIUM'),
    reason: text('reason').notNull(),  // Human-readable, deterministic format

    metadata: jsonb('metadata').$type<{
      appointmentsInPeriod?: number;
      pointsInPeriod?: number;
      periodDays?: number;
      threshold?: number;
      clientPhone?: string;  // For reference only
    }>().notNull().default(sql`'{}'::jsonb`),

    // Resolution tracking (full timestamp precision - NO mode: 'date')
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),  // adminUserId from session
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
