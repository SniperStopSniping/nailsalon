import 'server-only';

import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import {
  type AddOn,
  addOnSchema,
  type Appointment,
  appointmentSchema,
  appointmentServicesSchema,
  type CancelReason,
  type Client,
  clientSchema,
  type Salon,
  salonAuditLogSchema,
  type SalonClient,
  salonClientContactAliasSchema,
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
import { db } from './DB';
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
): Promise<TechnicianWithServices[]> {
  // Get all technicians for the salon
  const technicians = await db
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
  const serviceAssociations = await db
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
 * @param salonId - The salon that owns the appointment
 * @param status - The new status
 * @param cancelReason - Optional cancel reason (only for cancelled appointments)
 * @returns The updated appointment or null if not found
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

type SalonClientIdentityDb = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  execute: typeof db.execute;
};

export type ResolvedSalonClientIdentity = {
  client: SalonClient;
  clientIds: string[];
  normalizedPhones: string[];
  phoneVariants: string[];
  resolvedFromClientId: string | null;
};

function buildClientPhoneVariants(phones: string[]): string[] {
  const variants = new Set<string>();
  for (const rawPhone of phones) {
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      continue;
    }
    variants.add(normalized);
    variants.add(`1${normalized}`);
    variants.add(`+1${normalized}`);
    variants.add(rawPhone);
    variants.add(rawPhone.replace(/\D/g, ''));
  }
  return [...variants];
}

async function lockSalonClientIdentity(
  handle: SalonClientIdentityDb,
  salonId: string,
): Promise<void> {
  // Lifecycle mutations take FOR UPDATE on the salon row. KEY SHARE keeps
  // ordinary bookings concurrent with each other while making client creation
  // wait for an in-flight edit/merge (and vice versa).
  await handle.execute(sql`
    select ${salonSchema.id}
    from ${salonSchema}
    where ${salonSchema.id} = ${salonId}
    for key share
  `);
}

async function resolveMergedPrimaryWithHandle(
  handle: SalonClientIdentityDb,
  salonId: string,
  seed: SalonClient,
): Promise<{
  client: SalonClient;
  resolvedFromClientId: string | null;
} | null> {
  let client = seed;
  const visited = new Set<string>();
  while (client.mergedIntoClientId) {
    if (visited.has(client.id) || visited.size >= 16) {
      return null;
    }
    visited.add(client.id);
    const [target] = await handle
      .select()
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salonId),
        eq(salonClientSchema.id, client.mergedIntoClientId),
      ))
      .limit(1);
    if (!target) {
      return null;
    }
    client = target;
  }
  return {
    client,
    resolvedFromClientId: client.id === seed.id ? null : seed.id,
  };
}

async function resolveSalonClientIdentityByPhoneWithHandle(
  handle: SalonClientIdentityDb,
  salonId: string,
  phone: string,
): Promise<ResolvedSalonClientIdentity | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    return null;
  }

  // Aliases are authoritative after an edit/merge. Looking here first also
  // repairs reads if an older buggy booking created a second current row for a
  // historical number.
  const [aliasMatch] = await handle
    .select({ client: salonClientSchema })
    .from(salonClientContactAliasSchema)
    .innerJoin(
      salonClientSchema,
      and(
        eq(
          salonClientSchema.id,
          salonClientContactAliasSchema.salonClientId,
        ),
        eq(
          salonClientSchema.salonId,
          salonClientContactAliasSchema.salonId,
        ),
      ),
    )
    .where(and(
      eq(salonClientContactAliasSchema.salonId, salonId),
      eq(salonClientContactAliasSchema.kind, 'phone'),
      eq(salonClientContactAliasSchema.normalizedValue, normalizedPhone),
    ))
    .limit(1);

  let seed = aliasMatch?.client ?? null;
  if (!seed) {
    const [current] = await handle
      .select()
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salonId),
        eq(salonClientSchema.phone, normalizedPhone),
        isNull(salonClientSchema.mergedIntoClientId),
      ))
      .limit(1);
    seed = current ?? null;
  }
  if (!seed) {
    const [mergedSource] = await handle
      .select()
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salonId),
        eq(salonClientSchema.phone, normalizedPhone),
        isNotNull(salonClientSchema.mergedIntoClientId),
      ))
      .limit(1);
    seed = mergedSource ?? null;
  }
  if (!seed) {
    return null;
  }

  const resolved = await resolveMergedPrimaryWithHandle(
    handle,
    salonId,
    seed,
  );
  if (!resolved) {
    return null;
  }

  const clientIds = new Set<string>([resolved.client.id]);
  const normalizedPhones = new Set<string>([
    normalizePhone(resolved.client.phone),
    normalizedPhone,
  ]);
  let frontier = [resolved.client.id];
  for (let depth = 0; depth < 16 && frontier.length > 0; depth += 1) {
    const mergedSources = await handle
      .select({
        id: salonClientSchema.id,
        phone: salonClientSchema.phone,
      })
      .from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, salonId),
        inArray(salonClientSchema.mergedIntoClientId, frontier),
      ));
    frontier = [];
    for (const source of mergedSources) {
      if (clientIds.has(source.id)) {
        continue;
      }
      clientIds.add(source.id);
      normalizedPhones.add(normalizePhone(source.phone));
      frontier.push(source.id);
    }
  }

  const aliasRows = await handle
    .select({
      normalizedValue: salonClientContactAliasSchema.normalizedValue,
    })
    .from(salonClientContactAliasSchema)
    .where(and(
      eq(salonClientContactAliasSchema.salonId, salonId),
      eq(salonClientContactAliasSchema.kind, 'phone'),
      inArray(salonClientContactAliasSchema.salonClientId, [...clientIds]),
    ));
  for (const alias of aliasRows) {
    normalizedPhones.add(normalizePhone(alias.normalizedValue));
  }

  const phones = [...normalizedPhones].filter(Boolean).sort();
  return {
    client: resolved.client,
    clientIds: [
      resolved.client.id,
      ...[...clientIds]
        .filter(clientId => clientId !== resolved.client.id)
        .sort(),
    ],
    normalizedPhones: phones,
    phoneVariants: buildClientPhoneVariants(phones),
    resolvedFromClientId: resolved.resolvedFromClientId,
  };
}

/**
 * Resolve a current or historical phone to the unmerged salon-scoped primary.
 * This never changes the global client/session identity linked to either row.
 */
export async function resolveSalonClientIdentityByPhone(
  salonId: string,
  phone: string,
): Promise<ResolvedSalonClientIdentity | null> {
  return resolveSalonClientIdentityByPhoneWithHandle(
    db as SalonClientIdentityDb,
    salonId,
    phone,
  );
}

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

  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as SalonClientIdentityDb;
    await lockSalonClientIdentity(tx, salonId);

    const existingIdentity
      = await resolveSalonClientIdentityByPhoneWithHandle(
        tx,
        salonId,
        normalizedPhone,
      );
    if (existingIdentity) {
      const isCurrentPrimaryPhone
        = normalizePhone(existingIdentity.client.phone) === normalizedPhone;
      if (!trimmedName || !isCurrentPrimaryPhone) {
        // A historical phone can associate a booking with the stable primary,
        // but must not rewrite that profile's current identity fields.
        return existingIdentity.client;
      }
      const [updated] = await tx
        .update(salonClientSchema)
        .set({ fullName: trimmedName, updatedAt: new Date() })
        .where(and(
          eq(salonClientSchema.salonId, salonId),
          eq(salonClientSchema.id, existingIdentity.client.id),
          isNull(salonClientSchema.mergedIntoClientId),
        ))
        .returning();
      return updated ?? existingIdentity.client;
    }

    // INSERT ... ON CONFLICT DO UPDATE RETURNING remains the atomic fallback
    // for simultaneous first bookings on the same brand-new phone.
    const [client] = await tx
      .insert(salonClientSchema)
      .values({
        id: `sc_${crypto.randomUUID()}`,
        salonId,
        phone: normalizedPhone,
        fullName: trimmedName,
      })
      .onConflictDoUpdate({
        target: [salonClientSchema.salonId, salonClientSchema.phone],
        targetWhere: isNull(salonClientSchema.mergedIntoClientId),
        set: trimmedName
          ? { fullName: trimmedName, updatedAt: new Date() }
          : { updatedAt: new Date() },
      })
      .returning();

    return client ?? null;
  });
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

  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as SalonClientIdentityDb;
    await lockSalonClientIdentity(tx, salonId);

    if (globalClientId) {
      const [existingByClientId] = await tx
        .select()
        .from(salonClientSchema)
        .where(and(
          eq(salonClientSchema.salonId, salonId),
          eq(salonClientSchema.clientId, globalClientId),
        ))
        .limit(1);

      if (existingByClientId) {
        const resolved = await resolveMergedPrimaryWithHandle(
          tx,
          salonId,
          existingByClientId,
        );
        if (!resolved) {
          throw new Error('Invalid salon client merge history');
        }
        if (normalizePhone(resolved.client.phone) !== normalizedPhone) {
          // The external identity remains attached to the preserved source.
          // Return the operational primary without silently transferring the
          // identity or replacing the owner's selected contact fields.
          return resolved.client;
        }
        const [updated] = await tx
          .update(salonClientSchema)
          .set({
            ...(fullName && { fullName }),
            ...(email && { email }),
            phone: normalizedPhone,
            updatedAt: new Date(),
          })
          .where(and(
            eq(salonClientSchema.id, resolved.client.id),
            eq(salonClientSchema.salonId, salonId),
            isNull(salonClientSchema.mergedIntoClientId),
          ))
          .returning();
        return updated ?? resolved.client;
      }
    }

    const existingIdentity
      = await resolveSalonClientIdentityByPhoneWithHandle(
        tx,
        salonId,
        normalizedPhone,
      );
    if (existingIdentity) {
      const isCurrentPrimaryPhone
        = normalizePhone(existingIdentity.client.phone) === normalizedPhone;
      if (!isCurrentPrimaryPhone) {
        // Historical aliases are association hints, not permission to link a
        // global login or change owner-selected profile fields.
        return existingIdentity.client;
      }
      const mayLinkGlobalIdentity
        = Boolean(globalClientId) && existingIdentity.client.clientId === null;
      const [updated] = await tx
        .update(salonClientSchema)
        .set({
          ...(mayLinkGlobalIdentity && { clientId: globalClientId }),
          ...(fullName && { fullName }),
          ...(email && { email }),
          updatedAt: new Date(),
        })
        .where(and(
          eq(salonClientSchema.id, existingIdentity.client.id),
          eq(salonClientSchema.salonId, salonId),
          isNull(salonClientSchema.mergedIntoClientId),
        ))
        .returning();
      return updated ?? existingIdentity.client;
    }

    const [created] = await tx
      .insert(salonClientSchema)
      .values({
        id: salonClientId,
        salonId,
        phone: normalizedPhone,
        fullName,
        email,
        clientId: globalClientId ?? null,
        loyaltyPoints: 0,
      })
      .returning();
    if (!created) {
      throw new Error('Failed to create salon client');
    }
    return created;
  });
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
  const identity = await resolveSalonClientIdentityByPhone(salonId, phone);
  return identity?.client ?? null;
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
  const [client] = await db
    .select()
    .from(salonClientSchema)
    .where(
      and(
        eq(salonClientSchema.id, salonClientId),
        eq(salonClientSchema.salonId, salonId),
      ),
    )
    .limit(1);

  if (!client) {
    return null;
  }
  const resolved = await resolveMergedPrimaryWithHandle(
    db as SalonClientIdentityDb,
    salonId,
    client,
  );
  return resolved?.client ?? null;
}

/**
 * List options for salon clients
 */
export type ListSalonClientsOptions = {
  search?: string;
  sortBy?: 'recent' | 'visits' | 'spent' | 'name';
  sortOrder?: 'asc' | 'desc';
  scope?: 'active' | 'archived';
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
    scope = 'active',
    page = 1,
    limit = 50,
  } = options;

  // Build where conditions
  const conditions = [
    eq(salonClientSchema.salonId, salonId),
    isNull(salonClientSchema.mergedIntoClientId),
    scope === 'archived'
      ? isNotNull(salonClientSchema.archivedAt)
      : isNull(salonClientSchema.archivedAt),
  ];

  // Add search filter
  if (search) {
    const trimmedSearch = search.trim();
    const searchPattern = `%${trimmedSearch}%`;
    const normalizedPhoneSearch = normalizePhone(trimmedSearch);
    const aliasPredicates = [
      and(
        eq(salonClientContactAliasSchema.kind, 'email'),
        ilike(
          salonClientContactAliasSchema.normalizedValue,
          searchPattern.toLowerCase(),
        ),
      )!,
    ];
    if (normalizedPhoneSearch) {
      aliasPredicates.push(
        and(
          eq(salonClientContactAliasSchema.kind, 'phone'),
          ilike(
            salonClientContactAliasSchema.normalizedValue,
            `%${normalizedPhoneSearch}%`,
          ),
        )!,
      );
    }
    conditions.push(
      or(
        ilike(salonClientSchema.fullName, searchPattern),
        ilike(salonClientSchema.phone, searchPattern),
        normalizedPhoneSearch
          ? ilike(
            salonClientSchema.phone,
            `%${normalizedPhoneSearch}%`,
          )
          : undefined,
        ilike(salonClientSchema.email, searchPattern),
        sql`exists (
          select 1
          from ${salonClientContactAliasSchema}
          where ${salonClientContactAliasSchema.salonId} = ${salonId}
            and ${salonClientContactAliasSchema.salonClientId}
              = ${salonClientSchema.id}
            and ${or(...aliasPredicates)}
        )`,
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
 * Update salon client stats based on their appointment history
 * Call this after appointment completion, cancellation, or no-show
 *
 * This function is IDEMPOTENT - it recalculates all stats from scratch
 * based on the current appointment data, so calling it multiple times
 * is safe and will always produce correct results.
 *
 * Stats are SALON-SCOPED - only appointments from this salon are counted.
 *
 * Loyalty points rule: 1 point per $1 spent (100 cents = 1 point)
 *
 * @param salonId - The salon's unique ID
 * @param phone - The client's phone number (any format)
 */
export async function updateSalonClientStats(
  salonId: string,
  phone: string,
): Promise<void> {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as SalonClientIdentityDb;
    await lockSalonClientIdentity(tx, salonId);
    const identity = await resolveSalonClientIdentityByPhoneWithHandle(
      tx,
      salonId,
      phone,
    );
    if (!identity) {
      return;
    }

    // Stable IDs are authoritative. Phone aliases are used only for legacy
    // appointment rows that predate salon_client_id.
    const [clientStats] = await tx
      .select({
        totalVisits: sql<number>`count(*) FILTER (
          WHERE ${appointmentSchema.status} = 'completed'
            AND ${appointmentSchema.deletedAt} IS NULL
        )::int`,
        // Client spending = final charged price (net of tax; booked total for
        // legacy rows), counted only once the appointment is fully paid.
        totalSpent: sql<number>`COALESCE(sum(
          COALESCE(
            ${appointmentSchema.finalPriceCents},
            ${appointmentSchema.totalPrice}
          )
        ) FILTER (
          WHERE ${appointmentSchema.status} = 'completed'
            AND ${appointmentSchema.paymentStatus} = 'paid'
            AND ${appointmentSchema.deletedAt} IS NULL
        ), 0)::int`,
        noShowCount: sql<number>`count(*) FILTER (
          WHERE ${appointmentSchema.status} = 'no_show'
            AND ${appointmentSchema.deletedAt} IS NULL
        )::int`,
        lastVisitAt: sql<Date | null>`max(${appointmentSchema.startTime}) FILTER (
          WHERE ${appointmentSchema.status} = 'completed'
            AND ${appointmentSchema.deletedAt} IS NULL
        )`,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, salonId),
        or(
          inArray(appointmentSchema.salonClientId, identity.clientIds),
          and(
            isNull(appointmentSchema.salonClientId),
            inArray(
              appointmentSchema.clientPhone,
              identity.phoneVariants,
            ),
          ),
        ),
      ));

    const totalVisits = Number(clientStats?.totalVisits ?? 0);
    const totalSpent = Number(clientStats?.totalSpent ?? 0);
    const noShowCount = Number(clientStats?.noShowCount ?? 0);
    const loyaltyPoints = reconcileLoyaltyPointsBalance({
      currentBalance: identity.client.loyaltyPoints,
      previousCompletedSpendCents: identity.client.totalSpent,
      nextCompletedSpendCents: totalSpent,
    });
    const rawLastVisitAt = clientStats?.lastVisitAt ?? null;
    const lastVisitAt = rawLastVisitAt ? new Date(rawLastVisitAt) : null;
    const nextRebookDueAt = lastVisitAt && identity.client.rebookIntervalDays
      ? new Date(
        lastVisitAt.getTime()
        + identity.client.rebookIntervalDays * 86_400_000,
      )
      : null;

    await tx
      .update(salonClientSchema)
      .set({
        totalVisits,
        totalSpent,
        noShowCount,
        lastVisitAt,
        nextRebookDueAt,
        loyaltyPoints,
        updatedAt: new Date(),
      })
      .where(and(
        eq(salonClientSchema.id, identity.client.id),
        eq(salonClientSchema.salonId, salonId),
        isNull(salonClientSchema.mergedIntoClientId),
      ));
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
