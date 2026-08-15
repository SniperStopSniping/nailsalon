import 'server-only';

import { and, asc, desc, eq, exists, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { listPayments } from '@/libs/appointmentCheckoutServer';
import { resolveAppointmentDepositFinancials } from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import {
  CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH,
  getSalonClientHistoricalPhoneHintsWithHandle,
  getSalonClientLineageIdsWithHandle,
  getSalonClientPhoneAliasesWithHandle,
  resolveOperationalSalonClientByPhoneWithHandle,
} from '@/libs/clientLifecycleStabilization';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import {
  type AddOn,
  addOnSchema,
  type Appointment,
  appointmentAuditLogSchema,
  appointmentDepositSchema,
  appointmentSchema,
  appointmentServicesSchema,
  type CancelReason,
  type Client,
  clientSchema,
  type Salon,
  salonAuditLogSchema,
  type SalonClient,
  salonClientSchema,
  type SalonLocation,
  salonLocationSchema,
  salonSchema,
  type Service,
  serviceAddOnSchema,
  serviceSchema,
  type Technician,
  technicianSchema,
  technicianServicesSchema,
} from '@/models/Schema';
import { LOYALTY_POINTS } from '@/utils/AppConfig';

import { getActiveAppointmentsForContact } from './activeAppointments';
import { type DatabaseSessionHandle, db } from './DB';
import { reconcileLoyaltyPointsBalance } from './loyaltyBalance';
import { normalizePhone } from './phone';
import { resolveWeeklySchedule } from './weeklySchedule';

// Re-export for backwards compatibility
export const WELCOME_BONUS_POINTS = LOYALTY_POINTS.WELCOME_BONUS;

// =============================================================================
// SALON QUERIES
// =============================================================================

/**
 * Get a salon by its URL slug
 * @param slug - The salon's URL-friendly slug (e.g., "nail-salon-no5")
 * @returns The salon or null if not found
 */
export async function getSalonBySlug(slug: string): Promise<Salon | null> {
  const results = await db
    .select()
    .from(salonSchema)
    .where(and(eq(salonSchema.slug, slug), eq(salonSchema.isActive, true)))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Resolve a salon from a slug that was replaced by an audited super-admin
 * rename. The audit row retains the stable salon id, so this also works across
 * multiple consecutive renames without maintaining redirect records.
 */
export async function getSalonByFormerSlug(slug: string): Promise<Salon | null> {
  const results = await db
    .select({ salon: salonSchema })
    .from(salonAuditLogSchema)
    .innerJoin(salonSchema, eq(salonAuditLogSchema.salonId, salonSchema.id))
    .where(and(
      eq(salonAuditLogSchema.action, 'updated'),
      eq(salonSchema.isActive, true),
      sql`${salonAuditLogSchema.metadata}->>'field' = 'slug'`,
      sql`${salonAuditLogSchema.metadata}->>'previousValue' = ${slug}`,
    ))
    .orderBy(desc(salonAuditLogSchema.createdAt))
    .limit(1);

  return results[0]?.salon ?? null;
}

/**
 * Get a salon by its ID
 * @param id - The salon's unique ID
 * @returns The salon or null if not found
 */
export async function getSalonById(id: string): Promise<Salon | null> {
  const results = await db
    .select()
    .from(salonSchema)
    .where(and(eq(salonSchema.id, id), eq(salonSchema.isActive, true)))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get a salon by slug AND owner user ID (for admin auth verification)
 * Ensures the requesting user actually owns the salon they're trying to access.
 * @param slug - The salon's URL-friendly slug
 * @param ownerUserId - The Clerk user ID of the salon owner
 * @returns The salon or null if not found or not owned by user
 */
export async function getSalonBySlugAndOwnerUserId(
  slug: string,
  ownerUserId: string,
): Promise<Salon | null> {
  const results = await db
    .select()
    .from(salonSchema)
    .where(
      and(
        eq(salonSchema.slug, slug),
        eq(salonSchema.ownerClerkUserId, ownerUserId),
        eq(salonSchema.isActive, true),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

// =============================================================================
// SERVICE QUERIES - Always scoped to salonId
// =============================================================================

/**
 * Get all active services for a salon
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns Array of services sorted by sortOrder
 */
export async function getServicesBySalonId(salonId: string): Promise<Service[]> {
  return db
    .select()
    .from(serviceSchema)
    .where(and(eq(serviceSchema.salonId, salonId), eq(serviceSchema.isActive, true)))
    .orderBy(serviceSchema.sortOrder);
}

/**
 * Admin-only variant that includes deactivated services, so owners can see
 * and reactivate them. Customer-facing surfaces must keep using the active
 * filter above.
 */
export async function getServicesBySalonIdIncludingInactive(salonId: string): Promise<Service[]> {
  return db
    .select()
    .from(serviceSchema)
    .where(eq(serviceSchema.salonId, salonId))
    .orderBy(serviceSchema.sortOrder);
}

/**
 * Get multiple services by their IDs, scoped to a salon
 * @param serviceIds - Array of service IDs to fetch
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns Array of services that belong to the specified salon
 */
export async function getServicesByIds(
  serviceIds: string[],
  salonId: string,
): Promise<Service[]> {
  if (serviceIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(serviceSchema)
    .where(
      and(
        inArray(serviceSchema.id, serviceIds),
        eq(serviceSchema.salonId, salonId),
        eq(serviceSchema.isActive, true),
      ),
    );
}

/**
 * Get a single service by ID, scoped to a salon
 * @param serviceId - The service's unique ID
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns The service or null if not found/not belonging to salon
 */
export async function getServiceById(
  serviceId: string,
  salonId: string,
): Promise<Service | null> {
  const results = await db
    .select()
    .from(serviceSchema)
    .where(
      and(
        eq(serviceSchema.id, serviceId),
        eq(serviceSchema.salonId, salonId),
        eq(serviceSchema.isActive, true),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

export async function getAllServicesBySalonId(salonId: string): Promise<Service[]> {
  return db
    .select()
    .from(serviceSchema)
    .where(eq(serviceSchema.salonId, salonId))
    .orderBy(serviceSchema.sortOrder, serviceSchema.createdAt);
}

export async function getActiveAddOnsBySalonId(salonId: string): Promise<AddOn[]> {
  return db
    .select()
    .from(addOnSchema)
    .where(and(eq(addOnSchema.salonId, salonId), eq(addOnSchema.isActive, true)))
    .orderBy(addOnSchema.displayOrder, addOnSchema.createdAt);
}

export async function getAllAddOnsBySalonId(salonId: string): Promise<AddOn[]> {
  return db
    .select()
    .from(addOnSchema)
    .where(eq(addOnSchema.salonId, salonId))
    .orderBy(addOnSchema.displayOrder, addOnSchema.createdAt);
}

export async function getServiceAddOnRulesBySalonId(salonId: string) {
  return db
    .select()
    .from(serviceAddOnSchema)
    .where(eq(serviceAddOnSchema.salonId, salonId))
    .orderBy(serviceAddOnSchema.displayOrder, serviceAddOnSchema.createdAt);
}

// =============================================================================
// TECHNICIAN QUERIES - Always scoped to salonId
// =============================================================================

/**
 * Technician with their associated services
 */
export type TechnicianWithServices = Technician & {
  serviceIds: string[];
  enabledServiceIds: string[];
};

/**
 * Get all active technicians for a salon with their service associations
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns Array of technicians with their associated service IDs
 */
export async function getTechniciansBySalonId(
  salonId: string,
  database: { select: typeof db.select } = db,
): Promise<TechnicianWithServices[]> {
  // Get all technicians for the salon
  const technicians = await database
    .select()
    .from(technicianSchema)
    .where(
      and(eq(technicianSchema.salonId, salonId), eq(technicianSchema.isActive, true)),
    );

  if (technicians.length === 0) {
    return [];
  }

  // Get all service associations for these technicians
  const technicianIds = technicians.map(t => t.id);
  const serviceAssociations = await database
    .select()
    .from(technicianServicesSchema)
    .where(inArray(technicianServicesSchema.technicianId, technicianIds));

  // Build a map of technician ID to service IDs (all assigned + only enabled)
  const techServiceMap = new Map<string, string[]>();
  const techEnabledServiceMap = new Map<string, string[]>();
  for (const assoc of serviceAssociations) {
    const existing = techServiceMap.get(assoc.technicianId) ?? [];
    existing.push(assoc.serviceId);
    techServiceMap.set(assoc.technicianId, existing);

    // Only add to enabled map if enabled is true
    if (assoc.enabled) {
      const enabledExisting = techEnabledServiceMap.get(assoc.technicianId) ?? [];
      enabledExisting.push(assoc.serviceId);
      techEnabledServiceMap.set(assoc.technicianId, enabledExisting);
    }
  }

  // Combine technicians with their service IDs
  return technicians.map(tech => ({
    ...tech,
    weeklySchedule: resolveWeeklySchedule(tech),
    serviceIds: techServiceMap.get(tech.id) ?? [],
    enabledServiceIds: techEnabledServiceMap.get(tech.id) ?? [],
  }));
}

/**
 * Get technicians who can perform a specific service
 * @param salonId - The salon's unique ID
 * @param serviceId - The service ID to filter by
 * @param clientPhone - Optional client phone to check returning client status
 * @returns Array of technicians who can perform the service
 */
export async function getTechniciansForService(
  salonId: string,
  serviceId: string,
  clientPhone?: string,
): Promise<TechnicianWithServices[]> {
  // Get all active technicians
  const allTechnicians = await getTechniciansBySalonId(salonId);

  // Filter to those who have this service enabled
  let eligibleTechnicians = allTechnicians.filter(
    tech => tech.enabledServiceIds.includes(serviceId),
  );

  // If client phone provided, filter by acceptingNewClients
  if (clientPhone) {
    // Check which technicians have seen this client before
    const clientAppointments = await db
      .select({ technicianId: appointmentSchema.technicianId })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salonId),
          eq(appointmentSchema.clientPhone, clientPhone),
          eq(appointmentSchema.status, 'completed'),
        ),
      );

    const returningTechIds = new Set(
      clientAppointments.map(a => a.technicianId).filter(Boolean) as string[],
    );

    // Filter: if tech doesn't accept new clients, only include if client is returning
    eligibleTechnicians = eligibleTechnicians.filter((tech) => {
      if (tech.acceptingNewClients) {
        return true;
      }
      return returningTechIds.has(tech.id);
    });
  } else {
    // No client phone - only show techs accepting new clients
    eligibleTechnicians = eligibleTechnicians.filter(tech => tech.acceptingNewClients);
  }

  return eligibleTechnicians;
}

/**
 * Get a technician by their Clerk user ID
 * Used to link logged-in users to their technician profile
 * @param userId - The Clerk user ID
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns The technician or null if not found
 */
export async function getTechnicianByUserId(
  userId: string,
  salonId: string,
): Promise<Technician | null> {
  const results = await db
    .select()
    .from(technicianSchema)
    .where(
      and(
        eq(technicianSchema.userId, userId),
        eq(technicianSchema.salonId, salonId),
        eq(technicianSchema.isActive, true),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get a technician by their phone number
 * Used for phone-based staff login
 * @param phone - The technician's phone number (will be normalized)
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns The technician or null if not found
 */
export async function getTechnicianByPhone(
  phone: string,
  salonId: string,
): Promise<Technician | null> {
  // Normalize phone to 10 digits
  const normalizedPhone = normalizePhone(phone);

  // Build phone variants to handle different stored formats
  const phoneVariants = [
    normalizedPhone, // "4165551234"
    `+1${normalizedPhone}`, // "+14165551234"
    `1${normalizedPhone}`, // "14165551234"
  ];

  const results = await db
    .select()
    .from(technicianSchema)
    .where(
      and(
        inArray(technicianSchema.phone, phoneVariants),
        eq(technicianSchema.salonId, salonId),
        eq(technicianSchema.isActive, true),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get a single technician by ID, scoped to a salon
 * @param technicianId - The technician's unique ID
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @returns The technician with service IDs or null if not found/not belonging to salon
 */
export async function getTechnicianById(
  technicianId: string,
  salonId: string,
): Promise<TechnicianWithServices | null> {
  const results = await db
    .select()
    .from(technicianSchema)
    .where(
      and(
        eq(technicianSchema.id, technicianId),
        eq(technicianSchema.salonId, salonId),
        eq(technicianSchema.isActive, true),
      ),
    )
    .limit(1);

  const technician = results[0];
  if (!technician) {
    return null;
  }

  // Get service associations
  const serviceAssociations = await db
    .select()
    .from(technicianServicesSchema)
    .where(eq(technicianServicesSchema.technicianId, technicianId));

  return {
    ...technician,
    weeklySchedule: resolveWeeklySchedule(technician),
    serviceIds: serviceAssociations.map(a => a.serviceId),
    enabledServiceIds: serviceAssociations.filter(a => a.enabled).map(a => a.serviceId),
  };
}

// =============================================================================
// CLIENT QUERIES
// =============================================================================

/**
 * Get a client by their phone number
 * @param phone - The client's phone number (E.164 format, e.g., "+15551234567")
 * @returns The client or null if not found
 */
export async function getClientByPhone(phone: string): Promise<Client | null> {
  // Normalize phone number to digits only for comparison
  // Include 10-digit version (strip leading 1 if 11 digits) to match stored format
  const normalizedPhone = phone.replace(/\D/g, '');
  const tenDigitPhone = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
    ? normalizedPhone.slice(1)
    : normalizedPhone;
  const phoneVariants = [
    phone,
    normalizedPhone,
    tenDigitPhone,
    `+1${tenDigitPhone}`,
    `+${normalizedPhone}`,
  ];

  const results = await db
    .select()
    .from(clientSchema)
    .where(inArray(clientSchema.phone, phoneVariants))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Upsert a client - create if doesn't exist, update if exists
 * @param phone - The client's phone number
 * @param firstName - The client's first name (optional for update)
 * @returns The upserted client
 */
export async function upsertClient(
  phone: string,
  firstName?: string,
): Promise<Client> {
  const clientId = `client_${crypto.randomUUID()}`;

  const [client] = await db
    .insert(clientSchema)
    .values({
      id: clientId,
      phone,
      firstName,
    })
    .onConflictDoUpdate({
      target: clientSchema.phone,
      set: {
        ...(firstName && { firstName }),
        updatedAt: new Date(),
      },
    })
    .returning();

  return client!;
}

// =============================================================================
// APPOINTMENT QUERIES
// =============================================================================

/**
 * Get an appointment by its ID
 * @param appointmentId - The appointment's unique ID
 * @returns The appointment or null if not found
 */
export async function getAppointmentById(
  appointmentId: string,
  salonId?: string,
): Promise<Appointment | null> {
  const results = await db
    .select()
    .from(appointmentSchema)
    .where(
      salonId
        ? and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, salonId),
        )
        : eq(appointmentSchema.id, appointmentId),
    )
    .limit(1);

  return results[0] ?? null;
}

export async function getAppointmentServiceNames(appointmentId: string): Promise<string[]> {
  const rows = await db
    .select({ name: serviceSchema.name })
    .from(appointmentServicesSchema)
    .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
    .where(eq(appointmentServicesSchema.appointmentId, appointmentId));

  return rows.map(row => row.name);
}

/**
 * Update an appointment's status and optionally cancel reason
 * @param appointmentId - The appointment's unique ID
 * @param salonId - The salon's unique ID (required for multi-tenant scoping)
 * @param status - The new status
 * @param cancelReason - Optional cancel reason (only for cancelled appointments)
 * @returns The updated appointment, or null when no row matched — which now
 *   also covers a deposit hold, because this function refuses to move one.
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  salonId: string,
  status: Appointment['status'],
  cancelReason?: CancelReason,
): Promise<Appointment | null> {
  const [updated] = await db
    .update(appointmentSchema)
    .set({
      status,
      cancelReason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, salonId),
        // D5 FENCE. This function takes no transaction, no lock and no expected
        // current status, so it is a blind writer: whatever it is handed wins.
        // A deposit hold is the one row where that is a money bug — flipping
        // 'awaiting_payment' to 'confirmed' here would confirm a booking whose
        // deposit was never paid, outside the single-writer boundary of
        // `src/libs/deposits/**` (invariant I1).
        //
        // D4 already fences the route that calls this. This is the
        // FUNCTION-level belt: a future caller inherits the guard without
        // having to know the rule. Zero rows updated ⇒ `null` ⇒ the caller's
        // existing not-found/conflict branch.
        ne(appointmentSchema.status, 'awaiting_payment'),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Check for overlapping appointments for a technician
 * @param technicianId - The technician's ID
 * @param salonId - The salon's ID
 * @param startTime - Start time of the new appointment
 * @param endTime - End time of the new appointment
 * @param excludeAppointmentId - Optional appointment ID to exclude (for rescheduling)
 * @returns True if there's an overlap, false otherwise
 */
export async function checkTechnicianOverlap(
  technicianId: string,
  salonId: string,
  startTime: Date,
  endTime: Date,
  excludeAppointmentId?: string,
): Promise<boolean> {
  const conditions = [
    eq(appointmentSchema.technicianId, technicianId),
    eq(appointmentSchema.salonId, salonId),
    inArray(appointmentSchema.status, ['pending', 'confirmed']),
    // Overlap: new start < existing end AND new end > existing start
    lt(appointmentSchema.startTime, endTime),
    gt(appointmentSchema.endTime, startTime),
  ];

  // Exclude the current appointment if rescheduling
  if (excludeAppointmentId) {
    conditions.push(ne(appointmentSchema.id, excludeAppointmentId));
  }

  const overlapping = await db
    .select()
    .from(appointmentSchema)
    .where(and(...conditions))
    .limit(1);

  return overlapping.length > 0;
}

/**
 * Get active upcoming appointments for a client at a salon
 * @param clientPhone - The client's phone number
 * @param salonId - The salon's ID
 * @returns Array of active appointments
 */
export async function getActiveAppointmentsForClient(
  clientPhone: string,
  salonId: string,
): Promise<Appointment[]> {
  return getActiveAppointmentsForContact({
    salonId,
    phone: clientPhone,
    horizon: 'booking-gate',
  });
}

// =============================================================================
// SALON CLIENT QUERIES - Salon-scoped client profiles
// =============================================================================

/**
 * @deprecated Import from '@/libs/phone' instead to avoid DB module deps.
 * This re-export exists only for backwards compatibility with existing code.
 * TODO: Remove in next major version after migrating all imports.
 */
export { normalizePhone } from './phone';

/**
 * Get or create a salon client by phone (concurrency-safe).
 * Used by booking flow to ensure salonClientId is always set.
 *
 * CALLERS: Pass RAW phone. This function normalizes internally.
 *
 * Returns null if phone is invalid (caller should return 400).
 * Uses INSERT ... ON CONFLICT to handle concurrent requests atomically.
 * Only updates fullName if provided and non-empty (don't overwrite good names).
 *
 * @param salonId - Salon ID
 * @param phone - Raw phone number (will be normalized)
 * @param name - Optional client name
 * @returns SalonClient or null if phone is invalid
 */
export async function getOrCreateSalonClient(
  salonId: string,
  phone: string,
  name?: string,
): Promise<SalonClient | null> {
  // Normalize phone HERE - single point of normalization
  const normalizedPhone = normalizePhone(phone);

  // FAIL FAST: invalid phone must not create DB records
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    return null; // Caller checks and returns 400 INVALID_PHONE
  }

  // Only update name if provided and non-empty (don't overwrite good names)
  const trimmedName = name?.trim() || undefined;

  // INSERT ... ON CONFLICT DO UPDATE RETURNING ensures atomicity
  // Two concurrent requests for same phone will not create duplicate rows
  // Note: Drizzle requires at least one field in `set`, so we always update `updatedAt`
  const [client] = await db
    .insert(salonClientSchema)
    .values({
      id: `sc_${crypto.randomUUID()}`,
      salonId,
      phone: normalizedPhone,
      fullName: trimmedName,
    })
    .onConflictDoUpdate({
      target: [salonClientSchema.salonId, salonClientSchema.phone],
      set: trimmedName
        ? { fullName: trimmedName, updatedAt: new Date() }
        : { updatedAt: new Date() }, // Always set updatedAt to satisfy Drizzle's requirement
    })
    .returning();

  return client ?? null;
}

/**
 * Upsert a salon-scoped client profile
 * Called automatically when a client books or logs in
 *
 * Conflict resolution strategy:
 * - If globalClientId is provided: use (salonId, clientId) as conflict target
 *   This links the salon profile to the authenticated global client
 * - Otherwise: use (salonId, phone) as conflict target
 *   This handles guest bookings or phone-only identification
 *
 * @param salonId - The salon's unique ID
 * @param phone - The client's phone number (will be normalized to 10 digits)
 * @param fullName - Optional name
 * @param email - Optional email
 * @param globalClientId - Optional link to global client table
 * @returns The upserted salon client
 */
export async function upsertSalonClient(
  salonId: string,
  phone: string,
  fullName?: string,
  email?: string,
  globalClientId?: string,
  _welcomeBonusPoints: number = WELCOME_BONUS_POINTS,
): Promise<SalonClient> {
  const normalizedPhone = normalizePhone(phone);
  const salonClientId = `sc_${crypto.randomUUID()}`;

  // If we have a globalClientId, prefer matching by (salonId, clientId)
  // This ensures authenticated users get their profile linked correctly
  if (globalClientId) {
    // First, check if a salon client already exists for this global client
    const existingByClientId = await db
      .select()
      .from(salonClientSchema)
      .where(
        and(
          eq(salonClientSchema.salonId, salonId),
          eq(salonClientSchema.clientId, globalClientId),
        ),
      )
      .limit(1);

    if (existingByClientId.length > 0) {
      const existing = existingByClientId[0]!;
      const [updated] = await db
        .update(salonClientSchema)
        .set({
          ...(fullName && { fullName }),
          ...(email && { email }),
          phone: normalizedPhone,
          updatedAt: new Date(),
        })
        .where(eq(salonClientSchema.id, existing.id))
        .returning();

      return updated!;
    }

    // Check if there's an existing record by phone that we should link
    const existingByPhone = await db
      .select()
      .from(salonClientSchema)
      .where(
        and(
          eq(salonClientSchema.salonId, salonId),
          eq(salonClientSchema.phone, normalizedPhone),
        ),
      )
      .limit(1);

    if (existingByPhone.length > 0) {
      const existing = existingByPhone[0]!;
      // Link existing phone-based record to global client
      const [updated] = await db
        .update(salonClientSchema)
        .set({
          clientId: globalClientId,
          ...(fullName && { fullName }),
          ...(email && { email }),
          updatedAt: new Date(),
        })
        .where(eq(salonClientSchema.id, existing.id))
        .returning();

      return updated!;
    }

    // Create new record with global client link.
    return await createSalonClient(
      salonClientId,
      salonId,
      normalizedPhone,
      fullName,
      email,
      globalClientId,
    );
  }

  // No globalClientId - use phone-based conflict resolution
  // First check if the record exists (to determine if this is a new client)
  const [existingClient] = await db
    .select({ id: salonClientSchema.id })
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.salonId, salonId),
        eq(salonClientSchema.phone, normalizedPhone),
      ),
    )
    .limit(1);

  if (existingClient) {
    // Existing client - update in place.
    const [updated] = await db
      .update(salonClientSchema)
      .set({
        ...(fullName && { fullName }),
        ...(email && { email }),
        updatedAt: new Date(),
      })
      .where(eq(salonClientSchema.id, existingClient.id))
      .returning();

    return updated!;
  }

  // New client - create without any automatic welcome points.
  return await createSalonClient(
    salonClientId,
    salonId,
    normalizedPhone,
    fullName,
    email,
    null,
  );
}

/**
 * Create a new salon client profile with zero starting points.
 */
async function createSalonClient(
  salonClientId: string,
  salonId: string,
  phone: string,
  fullName?: string,
  email?: string,
  globalClientId?: string | null,
): Promise<SalonClient> {
  const [newClient] = await db
    .insert(salonClientSchema)
    .values({
      id: salonClientId,
      salonId,
      phone,
      fullName,
      email,
      clientId: globalClientId ?? null,
      loyaltyPoints: 0,
    })
    .returning();

  if (!newClient) {
    throw new Error('Failed to create salon client');
  }

  return newClient;
}

/**
 * Get a salon client by phone number
 * @param salonId - The salon's unique ID
 * @param phone - The client's phone number
 * @returns The salon client or null if not found
 */
export async function getSalonClientByPhone(
  salonId: string,
  phone: string,
): Promise<SalonClient | null> {
  const normalizedPhone = normalizePhone(phone);

  const results = await db
    .select()
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.salonId, salonId),
        eq(salonClientSchema.phone, normalizedPhone),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get a salon client by ID
 * @param salonId - The salon's unique ID (for multi-tenant safety)
 * @param salonClientId - The salon client's unique ID
 * @returns The salon client or null if not found
 */
export async function getSalonClientById(
  salonId: string,
  salonClientId: string,
): Promise<SalonClient | null> {
  const results = await db
    .select()
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.id, salonClientId),
        eq(salonClientSchema.salonId, salonId),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

/**
 * List options for salon clients
 */
export type ListSalonClientsOptions = {
  search?: string;
  sortBy?: 'recent' | 'visits' | 'spent' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
};

/**
 * Salon client with preferred technician info
 */
export type SalonClientWithTech = SalonClient & {
  preferredTechnician?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
};

/**
 * Get all salon clients for a salon with optional search and sorting
 * @param salonId - The salon's unique ID
 * @param options - Search, sort, and pagination options
 * @returns Array of salon clients with total count
 */
export async function getSalonClients(
  salonId: string,
  options: ListSalonClientsOptions = {},
): Promise<{ clients: SalonClientWithTech[]; total: number }> {
  const {
    search,
    sortBy = 'recent',
    sortOrder = 'desc',
    page = 1,
    limit = 50,
  } = options;

  // Build where conditions
  const conditions = [
    eq(salonClientSchema.salonId, salonId),
    isNull(salonClientSchema.archivedAt),
    isNull(salonClientSchema.mergedIntoClientId),
  ];

  // Add search filter
  if (search) {
    const searchPattern = `%${search}%`;
    const normalizedPhoneSearch = /^[+\d().\-\s]+$/.test(search)
      ? normalizePhone(search)
      : '';
    const phoneSearchPattern = `%${normalizedPhoneSearch}%`;
    const lineageContactMatch = sql<boolean>`
      exists (
        with recursive directory_lineage(id, path, depth) as (
          select
            ${salonClientSchema.id},
            array[${salonClientSchema.id}]::text[],
            0

          union all

          select
            source.id,
            directory_lineage.path || source.id,
            directory_lineage.depth + 1
          from directory_lineage
          inner join salon_client as source
            on source.salon_id = ${salonId}
           and source.merged_into_client_id = directory_lineage.id
           and source.archived_at is not null
          where directory_lineage.depth < ${CLIENT_LIFECYCLE_MAX_CHAIN_DEPTH - 1}
            and not source.id = any(directory_lineage.path)
        )
        select 1
        from directory_lineage
        inner join salon_client as lineage_client
          on lineage_client.salon_id = ${salonId}
         and lineage_client.id = directory_lineage.id
        where (
          ${normalizedPhoneSearch !== ''
            ? sql`lineage_client.phone ilike ${phoneSearchPattern}`
            : sql`false`}
        )
           or lineage_client.email ilike ${searchPattern}
           or exists (
             select 1
             from salon_client_contact_alias as contact_alias
             where contact_alias.salon_id = ${salonId}
               and contact_alias.salon_client_id = directory_lineage.id
               and (
                 (
                   contact_alias.kind = 'phone'
                   and ${normalizedPhoneSearch !== ''
                      ? sql`contact_alias.normalized_value ilike ${phoneSearchPattern}`
                      : sql`false`}
                 )
                 or (
                   contact_alias.kind = 'email'
                   and contact_alias.normalized_value ilike ${searchPattern}
                 )
               )
           )
      )
    `;
    conditions.push(
      or(
        ilike(salonClientSchema.fullName, searchPattern),
        lineageContactMatch,
      ) ?? sql`1=0`,
    );
  }

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(salonClientSchema)
    .where(and(...conditions));
  const total = countResult[0]?.count ?? 0;

  // Build order by
  let orderBy;
  const orderDir = sortOrder === 'asc' ? asc : desc;
  switch (sortBy) {
    case 'visits':
      orderBy = orderDir(salonClientSchema.totalVisits);
      break;
    case 'spent':
      orderBy = orderDir(salonClientSchema.totalSpent);
      break;
    case 'name':
      orderBy = orderDir(salonClientSchema.fullName);
      break;
    case 'recent':
    default:
      orderBy = desc(salonClientSchema.lastVisitAt);
      break;
  }

  // Get paginated results
  const offset = (page - 1) * limit;
  const clients = await db
    .select()
    .from(salonClientSchema)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  // Fetch preferred technicians for clients that have one
  const techIds = clients
    .map(c => c.preferredTechnicianId)
    .filter((id): id is string => id !== null);

  let techMap = new Map<string, { id: string; name: string; avatarUrl: string | null }>();
  if (techIds.length > 0) {
    const technicians = await db
      .select({
        id: technicianSchema.id,
        name: technicianSchema.name,
        avatarUrl: technicianSchema.avatarUrl,
      })
      .from(technicianSchema)
      .where(inArray(technicianSchema.id, techIds));

    techMap = new Map(technicians.map(t => [t.id, t]));
  }

  // Combine clients with technician info
  const clientsWithTech: SalonClientWithTech[] = clients.map(client => ({
    ...client,
    preferredTechnician: client.preferredTechnicianId
      ? techMap.get(client.preferredTechnicianId) ?? null
      : null,
  }));

  return { clients: clientsWithTech, total };
}

/**
 * Update a salon client's profile
 * @param salonId - The salon's unique ID (for multi-tenant safety)
 * @param salonClientId - The salon client's unique ID
 * @param updates - Fields to update
 * @returns The updated salon client or null if not found
 */
export async function updateSalonClient(
  salonId: string,
  salonClientId: string,
  updates: Partial<Pick<SalonClient, 'fullName' | 'email' | 'preferredTechnicianId' | 'notes' | 'sensitivities' | 'nailPreferences' | 'tags' | 'rebookIntervalDays' | 'nextRebookDueAt' | 'lastContactAt'>>,
): Promise<SalonClient | null> {
  const [updated] = await db
    .update(salonClientSchema)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(salonClientSchema.id, salonClientId),
        eq(salonClientSchema.salonId, salonId),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Return whether any completed+paid appointment in this stable client scope
 * currently derives a positive credit from canonical deposit evidence.
 * D6.1 uses this durable read to keep reward/points attribution deferred even
 * when a later unrelated action refreshes client stats or fraud signals.
 */
export async function hasCanonicalAppliedDepositCreditForClient(input: {
  salonId: string;
  salonClientIds: readonly string[];
  clientPhoneVariants?: readonly string[];
  database?: Pick<DatabaseSessionHandle, 'select'>;
}): Promise<boolean> {
  const database = input.database ?? db;
  const contactScope = input.clientPhoneVariants?.length
    ? or(
      inArray(appointmentSchema.salonClientId, [...input.salonClientIds]),
      and(
        isNull(appointmentSchema.salonClientId),
        inArray(appointmentSchema.clientPhone, [...input.clientPhoneVariants]),
      ),
    )
    : inArray(appointmentSchema.salonClientId, [...input.salonClientIds]);
  const depositHistoryAppointments = await database
    .select({
      id: appointmentSchema.id,
      amountPaidCents: appointmentSchema.amountPaidCents,
      invoiceCurrency: appointmentSchema.invoiceCurrency,
      finalPriceCents: appointmentSchema.finalPriceCents,
      taxAmountCents: appointmentSchema.taxAmountCents,
      tipCents: appointmentSchema.tipCents,
      status: appointmentSchema.status,
      paymentStatus: appointmentSchema.paymentStatus,
    })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.salonId, input.salonId),
      contactScope,
      exists(
        database
          .select({ id: appointmentDepositSchema.id })
          .from(appointmentDepositSchema)
          .where(and(
            eq(appointmentDepositSchema.salonId, appointmentSchema.salonId),
            eq(appointmentDepositSchema.appointmentId, appointmentSchema.id),
            isNotNull(appointmentDepositSchema.stripePaymentIntentId),
          )),
      ),
    ));
  if (depositHistoryAppointments.length === 0) {
    return false;
  }

  // Completion and later-payment writers persist the applied credit in the
  // immutable appointment audit row.  This is the durable D6.1/D6.2 boundary:
  // a refund, reopen, or later status transition must not erase the fact that
  // reward attribution was deliberately deferred when the invoice settled.
  const [deferredAudit] = await database
    .select({ id: appointmentAuditLogSchema.id })
    .from(appointmentAuditLogSchema)
    .where(and(
      eq(appointmentAuditLogSchema.salonId, input.salonId),
      inArray(
        appointmentAuditLogSchema.appointmentId,
        depositHistoryAppointments.map(appointment => appointment.id),
      ),
      sql`jsonb_typeof(${appointmentAuditLogSchema.newValue}->'depositCreditAppliedCents') = 'number'`,
      sql`(${appointmentAuditLogSchema.newValue}->>'depositCreditAppliedCents')::numeric > 0`,
    ))
    .limit(1);
  if (deferredAudit) {
    return true;
  }

  const depositApplications = await Promise.all(
    depositHistoryAppointments.map(async (appointment) => {
      // Non-completed rows participate only in the immutable-audit lookup
      // above. This catches a reopened/cancelled formerly completed invoice
      // without freezing rewards merely because an upcoming booking collected
      // its deposit.
      if (appointment.status !== 'completed') {
        return { attributionDeferred: false };
      }
      const [deposits, paymentRows] = await Promise.all([
        loadAppointmentDepositCreditRows({
          salonId: input.salonId,
          appointmentId: appointment.id,
          database,
        }),
        listPayments(database, appointment.id),
      ]);
      const paymentLedger = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: appointment.amountPaidCents,
        paymentRows,
        expectedSalonId: input.salonId,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      // A fully refunded deposit followed by a separately proven full tender
      // retains the pre-D6 reward behavior.  Legacy paid inference, a tenant
      // mismatch, or any unresolved ledger cannot prove that distinction and
      // therefore keeps attribution deferred for D6.2.
      if (!paymentLedger.ok || paymentLedger.state === 'legacy_paid') {
        return { attributionDeferred: true };
      }
      const application = resolveAppointmentDepositFinancials({
        deposits,
        invoiceCurrency: appointment.invoiceCurrency,
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      return {
        attributionDeferred: !application.depositResolution.ok
          || !application.financials.ok
          || application.financials.depositCreditAppliedCents > 0
          || application.financials.excessDepositCents > 0
          || application.financials.tenderExcessCents > 0
          || !application.financials.financiallySettled,
      };
    }),
  );
  return depositApplications.some(application => application.attributionDeferred);
}

/**
 * Resolve a caller's stable client id through its complete same-salon lineage
 * and legacy phone aliases before applying the durable D6.1 reward boundary.
 */
export async function hasCanonicalAppliedDepositCreditForClientLineage(input: {
  salonId: string;
  salonClientId: string;
}): Promise<boolean> {
  const history = await getSalonClientHistoricalPhoneHintsWithHandle(db, {
    salonId: input.salonId,
    clientId: input.salonClientId,
    allowArchived: true,
  });
  const lineageIds = await getSalonClientLineageIdsWithHandle(db, {
    salonId: input.salonId,
    terminalClientId: history.terminal.id,
  });
  const phoneVariants = [...new Set(history.phones.flatMap(phone => [
    phone,
    `1${phone}`,
    `+1${phone}`,
    `+${phone}`,
  ]))];
  return hasCanonicalAppliedDepositCreditForClient({
    salonId: input.salonId,
    salonClientIds: lineageIds,
    clientPhoneVariants: phoneVariants,
  });
}

/**
 * Update salon client stats based on their appointment history
 * Call this after appointment completion, cancellation, or no-show
 *
 * This function is IDEMPOTENT - it recalculates all stats from scratch
 * based on the current appointment data, so calling it multiple times
 * is safe and will always produce correct results.
 *
 * Stats are SALON-SCOPED - only appointments from this salon are counted.
 *
 * Single-profile loyalty uses the existing configured spend reconciliation.
 * Merged-lineage loyalty remains unchanged pending ledger-backed reconciliation.
 *
 * @param salonId - The salon's unique ID
 * @param phone - The client's phone number (any format)
 */
export async function updateSalonClientStats(
  salonId: string,
  phone: string,
): Promise<void> {
  await db.transaction(async (database) => {
    const terminal = await resolveOperationalSalonClientByPhoneWithHandle(database, {
      salonId,
      phone,
    });
    if (!terminal) {
      // No salon client record exists - nothing to update. This can happen if
      // booking was created before the salon_client feature.
      return;
    }

    // Serialize the whole aggregate -> overwrite cycle on the stable terminal
    // profile. Without this early lock, an older refund refresh could read an
    // earlier appointment state, pause, and overwrite a newer payment/void
    // refresh after it committed.
    const [lockedTerminal] = await database
      .select({ id: salonClientSchema.id })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.id, terminal.id),
        eq(salonClientSchema.salonId, salonId),
      ))
      .for('update')
      .limit(1);
    if (!lockedTerminal) {
      return;
    }

    const lineageIds = await getSalonClientLineageIdsWithHandle(database, {
      salonId,
      terminalClientId: terminal.id,
    });
    const lineageClients = await database
      .select({
        id: salonClientSchema.id,
        phone: salonClientSchema.phone,
        loyaltyPoints: salonClientSchema.loyaltyPoints,
        totalSpent: salonClientSchema.totalSpent,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
      })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salonId),
        inArray(salonClientSchema.id, lineageIds),
      ));
    const terminalClient = lineageClients.find(client => client.id === terminal.id);
    if (!terminalClient) {
      return;
    }

    const aliasPhones = await getSalonClientPhoneAliasesWithHandle(database, {
      salonId,
      clientIds: lineageIds,
    });
    const ownedPhoneSnapshots = [
      ...lineageClients.map(client => client.phone),
      ...aliasPhones,
      phone,
    ];
    const normalizedPhones = [...new Set(
      ownedPhoneSnapshots
        .map(normalizePhone)
        .filter(value => value.length === 10),
    )];
    const phoneVariants = [...new Set([
      ...ownedPhoneSnapshots,
      ...ownedPhoneSnapshots.map(value => value.replace(/\D/g, '')),
      ...normalizedPhones.flatMap(value => [
        value,
        `1${value}`,
        `+1${value}`,
      ]),
    ].filter(Boolean))];

    // D6.1 may make a completed invoice financially paid because canonical
    // deposit credit was applied. Reward attribution/release belongs to D6.2,
    // so freeze loyalty mutation while such an appointment exists. A fully
    // refunded/forfeited deposit followed by full tender remains legacy-eligible.
    const loyaltyAttributionDeferred = await hasCanonicalAppliedDepositCreditForClient({
      salonId,
      salonClientIds: lineageIds,
      clientPhoneVariants: phoneVariants,
      database,
    });

    // Calculate stats from appointments - SCOPED TO THIS SALON ONLY
    // Using FILTER clause for conditional aggregation (Postgres 9.4+)
    const stats = await database
      .select({
        totalVisits: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'completed')::int`,
        // Client spending = final charged price (net of tax; booked total for
        // legacy rows), counted only once the appointment is fully PAID — an
        // unpaid/partial/comp completion is a visit but not spend, and loyalty
        // points derive from this figure. Tax is excluded by construction
        // (finalPriceCents never includes it).
        totalSpent: sql<number>`COALESCE(sum(COALESCE(${appointmentSchema.finalPriceCents}, ${appointmentSchema.totalPrice})) FILTER (WHERE ${appointmentSchema.status} = 'completed' AND ${appointmentSchema.paymentStatus} = 'paid'), 0)::int`,
        noShowCount: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'no_show')::int`,
        lastVisitAt: sql<Date | null>`max(${appointmentSchema.startTime}) FILTER (WHERE ${appointmentSchema.status} = 'completed')`,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salonId),
          or(
            inArray(appointmentSchema.salonClientId, lineageIds),
            and(
              isNull(appointmentSchema.salonClientId),
              inArray(appointmentSchema.clientPhone, phoneVariants),
            ),
          ),
        ),
      );

    const clientStats = stats[0];

    // Calculate loyalty points using centralized formula (totalSpent is in cents)
    // PER_DOLLAR_SPENT=20 means 20 points per $1, so $75.00 = 7500 cents = 1500 points
    const totalSpentCents = clientStats?.totalSpent ?? 0;
    // A merged lineage can contain independent loyalty histories that cannot be
    // reconstructed from cached spend. Keep every balance unchanged until the
    // ledger-backed PR 0B design exists; ordinary single-profile reconciliation
    // retains the established behavior.
    const reconciledLoyaltyPoints = lineageIds.length === 1 && !loyaltyAttributionDeferred
      ? reconcileLoyaltyPointsBalance({
        currentBalance: terminalClient.loyaltyPoints,
        previousCompletedSpendCents: terminalClient.totalSpent,
        nextCompletedSpendCents: totalSpentCents,
      })
      : null;
    // Raw-SQL aggregates return strings on some drivers (PGlite) and Dates on
    // others (pg) — normalize before doing Date math or writing back.
    const rawLastVisitAt = clientStats?.lastVisitAt ?? null;
    const lastVisitAt = rawLastVisitAt ? new Date(rawLastVisitAt) : null;
    const nextRebookDueAt = lastVisitAt && terminalClient.rebookIntervalDays
      ? new Date(lastVisitAt.getTime() + terminalClient.rebookIntervalDays * 86_400_000)
      : null;

    // Update the salon client with computed stats
    // Double-check salonId in WHERE clause for multi-tenant safety
    await database
      .update(salonClientSchema)
      .set({
        totalVisits: clientStats?.totalVisits ?? 0,
        totalSpent: clientStats?.totalSpent ?? 0,
        noShowCount: clientStats?.noShowCount ?? 0,
        lastVisitAt,
        nextRebookDueAt,
        ...(reconciledLoyaltyPoints === null
          ? {}
          : { loyaltyPoints: reconciledLoyaltyPoints }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(salonClientSchema.id, terminal.id),
          eq(salonClientSchema.salonId, salonId),
        ),
      );
  });
}

// =============================================================================
// LOCATION QUERIES
// =============================================================================

/**
 * Get a location by ID (scoped to salon for security)
 * @param locationId - The location's unique ID
 * @param salonId - The salon's ID (for multi-tenant security)
 * @returns The location or null if not found
 */
export async function getLocationById(
  locationId: string,
  salonId: string,
): Promise<SalonLocation | null> {
  const results = await db
    .select()
    .from(salonLocationSchema)
    .where(
      and(
        eq(salonLocationSchema.id, locationId),
        eq(salonLocationSchema.salonId, salonId),
        eq(salonLocationSchema.isActive, true),
      ),
    )
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get all active locations for a salon
 * @param salonId - The salon's ID
 * @returns Array of active locations (ordered: primary first, then by name)
 */
export async function getActiveLocationsBySalonId(
  salonId: string,
): Promise<SalonLocation[]> {
  const results = await db
    .select()
    .from(salonLocationSchema)
    .where(
      and(
        eq(salonLocationSchema.salonId, salonId),
        eq(salonLocationSchema.isActive, true),
      ),
    )
    .orderBy(salonLocationSchema.isPrimary, salonLocationSchema.name);

  return results;
}

/**
 * Get the primary (default) location for a salon
 * Falls back to first active location if no primary is set
 * @param salonId - The salon's ID
 * @returns The primary location or null if none exists
 */
export async function getPrimaryLocation(
  salonId: string,
): Promise<SalonLocation | null> {
  // First try to get the primary location
  const primary = await db
    .select()
    .from(salonLocationSchema)
    .where(
      and(
        eq(salonLocationSchema.salonId, salonId),
        eq(salonLocationSchema.isPrimary, true),
        eq(salonLocationSchema.isActive, true),
      ),
    )
    .limit(1);

  if (primary[0]) {
    return primary[0];
  }

  // Fallback to first active location
  const fallback = await db
    .select()
    .from(salonLocationSchema)
    .where(
      and(
        eq(salonLocationSchema.salonId, salonId),
        eq(salonLocationSchema.isActive, true),
      ),
    )
    .limit(1);

  return fallback[0] ?? null;
}
