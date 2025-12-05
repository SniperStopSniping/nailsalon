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

    // Professional
    specialties: jsonb('specialties').$type<string[]>(),
    rating: numeric('rating', { precision: 2, scale: 1 }),
    reviewCount: integer('review_count').default(0),

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

// =============================================================================
// CONST EXPORTS
// =============================================================================

export const SERVICE_CATEGORIES = ['hands', 'feet', 'combo'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CANCEL_REASONS = [
  'rescheduled',
  'client_request',
  'no_show',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
