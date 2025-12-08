import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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

    // Metadata
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex('salon_slug_idx').on(table.slug),
    customDomainIdx: uniqueIndex('salon_custom_domain_idx').on(table.customDomain),
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
  (table) => ({
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
  (table) => ({
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
  (table) => ({
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

    // Client (phone-based identification)
    clientPhone: text('client_phone').notNull(),
    clientName: text('client_name'),

    // Timing
    startTime: timestamp('start_time', { mode: 'date' }).notNull(),
    endTime: timestamp('end_time', { mode: 'date' }).notNull(),

    // Status
    status: text('status').notNull().default('confirmed'),
    // 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
    cancelReason: text('cancel_reason'),
    // 'rescheduled' | 'client_request' | 'no_show' | null

    // Totals (computed from linked services at booking time)
    totalPrice: integer('total_price').notNull(), // Sum of all service prices
    totalDurationMinutes: integer('total_duration_minutes').notNull(), // Sum of durations

    // Additional
    notes: text('notes'),

    // Lifecycle timestamps (for staff workflow)
    startedAt: timestamp('started_at', { mode: 'date' }), // When tech starts the appointment
    completedAt: timestamp('completed_at', { mode: 'date' }), // When appointment is finished

    // Payment
    paymentStatus: text('payment_status').default('pending'), // 'pending' | 'paid'

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    salonIdx: index('appointment_salon_idx').on(table.salonId),
    clientIdx: index('appointment_client_idx').on(table.clientPhone),
    dateIdx: index('appointment_date_idx').on(table.salonId, table.startTime),
    statusIdx: index('appointment_status_idx').on(table.salonId, table.status),
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
  (table) => ({
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
  (table) => ({
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
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    phoneIdx: uniqueIndex('client_phone_idx').on(table.phone),
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
  (table) => ({
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
  (table) => ({
    salonIdx: index('reward_salon_idx').on(table.salonId),
    clientIdx: index('reward_client_idx').on(table.clientPhone),
    referralIdx: index('reward_referral_idx').on(table.referralId),
    statusIdx: index('reward_status_idx').on(table.clientPhone, table.status),
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
    clientId: text('client_id').references(() => clientSchema.id),

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
    beveragePreference: jsonb('beverage_preference').$type<string[]>(),

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
  (table) => ({
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
  (table) => ({
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
  (table) => ({
    technicianIdx: index('blocked_slot_technician_idx').on(table.technicianId),
    salonIdx: index('blocked_slot_salon_idx').on(table.salonId),
    dayIdx: index('blocked_slot_day_idx').on(table.technicianId, table.dayOfWeek),
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
  (table) => ({
    uniqueSalonPage: uniqueIndex('salon_page_appearance_unique').on(table.salonId, table.pageName),
    salonIdx: index('salon_page_appearance_salon_idx').on(table.salonId),
  }),
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Client = typeof clientSchema.$inferSelect;
export type NewClient = typeof clientSchema.$inferInsert;

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

export type ClientPreferences = typeof clientPreferencesSchema.$inferSelect;
export type NewClientPreferences = typeof clientPreferencesSchema.$inferInsert;

export type TechnicianTimeOff = typeof technicianTimeOffSchema.$inferSelect;
export type NewTechnicianTimeOff = typeof technicianTimeOffSchema.$inferInsert;

export type TechnicianBlockedSlot = typeof technicianBlockedSlotSchema.$inferSelect;
export type NewTechnicianBlockedSlot = typeof technicianBlockedSlotSchema.$inferInsert;

export type SalonPageAppearance = typeof salonPageAppearanceSchema.$inferSelect;
export type NewSalonPageAppearance = typeof salonPageAppearanceSchema.$inferInsert;

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
