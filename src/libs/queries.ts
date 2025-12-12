import 'server-only';

import { eq, and, inArray, gte, lt, gt, ne, desc, asc, or, ilike, sql } from 'drizzle-orm';

import {
  appointmentSchema,
  clientSchema,
  salonSchema,
  salonClientSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
  type Appointment,
  type CancelReason,
  type Client,
  type Salon,
  type SalonClient,
  type Service,
  type Technician,
} from '@/models/Schema';

import { db } from './DB';

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
    tech => tech.enabledServiceIds.includes(serviceId)
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
      clientAppointments.map(a => a.technicianId).filter(Boolean) as string[]
    );
    
    // Filter: if tech doesn't accept new clients, only include if client is returning
    eligibleTechnicians = eligibleTechnicians.filter(tech => {
      if (tech.acceptingNewClients) return true;
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
    normalizedPhone,                    // "4165551234"
    `+1${normalizedPhone}`,             // "+14165551234"
    `1${normalizedPhone}`,              // "14165551234"
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
): Promise<Appointment | null> {
  const results = await db
    .select()
    .from(appointmentSchema)
    .where(eq(appointmentSchema.id, appointmentId))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Update an appointment's status and optionally cancel reason
 * @param appointmentId - The appointment's unique ID
 * @param status - The new status
 * @param cancelReason - Optional cancel reason (only for cancelled appointments)
 * @returns The updated appointment or null if not found
 */
export async function updateAppointmentStatus(
  appointmentId: string,
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
    .where(eq(appointmentSchema.id, appointmentId))
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
  const now = new Date();

  // Normalize phone to handle different formats
  // Include 10-digit version (strip leading 1 if 11 digits) to match stored format
  const normalizedPhone = clientPhone.replace(/\D/g, '');
  const tenDigitPhone = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
    ? normalizedPhone.slice(1)
    : normalizedPhone;
  const phoneVariants = [
    clientPhone,
    normalizedPhone,
    tenDigitPhone,
    `+1${tenDigitPhone}`,
    `+${normalizedPhone}`,
  ];

  return db
    .select()
    .from(appointmentSchema)
    .where(
      and(
        inArray(appointmentSchema.clientPhone, phoneVariants),
        eq(appointmentSchema.salonId, salonId),
        inArray(appointmentSchema.status, ['pending', 'confirmed']),
        gte(appointmentSchema.startTime, now),
      ),
    );
}

// =============================================================================
// SALON CLIENT QUERIES - Salon-scoped client profiles
// =============================================================================

/**
 * Normalize phone number to 10 digits
 * Strips country code and non-digit characters
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If 11 digits starting with 1, strip the leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Upsert a salon client - create if doesn't exist, update if exists
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
      // Update existing record linked to this global client
      const [updated] = await db
        .update(salonClientSchema)
        .set({
          ...(fullName && { fullName }),
          ...(email && { email }),
          // Update phone if it changed (e.g., user updated their number)
          phone: normalizedPhone,
          updatedAt: new Date(),
        })
        .where(eq(salonClientSchema.id, existingByClientId[0]!.id))
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
      // Link existing phone-based record to global client
      const [updated] = await db
        .update(salonClientSchema)
        .set({
          clientId: globalClientId,
          ...(fullName && { fullName }),
          ...(email && { email }),
          updatedAt: new Date(),
        })
        .where(eq(salonClientSchema.id, existingByPhone[0]!.id))
        .returning();
      return updated!;
    }

    // Create new record with global client link
    const [newClient] = await db
      .insert(salonClientSchema)
      .values({
        id: salonClientId,
        salonId,
        phone: normalizedPhone,
        fullName,
        email,
        clientId: globalClientId,
      })
      .returning();
    return newClient!;
  }

  // No globalClientId - use phone-based conflict resolution
  const [salonClient] = await db
    .insert(salonClientSchema)
    .values({
      id: salonClientId,
      salonId,
      phone: normalizedPhone,
      fullName,
      email,
      clientId: null,
    })
    .onConflictDoUpdate({
      target: [salonClientSchema.salonId, salonClientSchema.phone],
      set: {
        ...(fullName && { fullName }),
        ...(email && { email }),
        updatedAt: new Date(),
      },
    })
    .returning();

  return salonClient!;
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
  const conditions = [eq(salonClientSchema.salonId, salonId)];

  // Add search filter
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(salonClientSchema.fullName, searchPattern),
        ilike(salonClientSchema.phone, searchPattern),
        ilike(salonClientSchema.email, searchPattern),
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
    .map((c) => c.preferredTechnicianId)
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

    techMap = new Map(technicians.map((t) => [t.id, t]));
  }

  // Combine clients with technician info
  const clientsWithTech: SalonClientWithTech[] = clients.map((client) => ({
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
  updates: Partial<Pick<SalonClient, 'fullName' | 'email' | 'preferredTechnicianId' | 'notes'>>,
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
  const normalizedPhone = normalizePhone(phone);

  // Get the salon client (scoped to this salon)
  const salonClient = await getSalonClientByPhone(salonId, normalizedPhone);
  if (!salonClient) {
    // No salon client record exists - nothing to update
    // This can happen if booking was created before the salon_client feature
    return;
  }

  // Build comprehensive phone variants for matching appointments
  // Appointments may store phone in various formats
  const phoneVariants = [
    normalizedPhone,                    // "4165551234"
    `+1${normalizedPhone}`,             // "+14165551234"
    `1${normalizedPhone}`,              // "14165551234"
    phone,                               // original format passed in
    phone.replace(/\D/g, ''),           // digits only from original
  ];
  // Deduplicate
  const uniquePhoneVariants = [...new Set(phoneVariants)];

  // Calculate stats from appointments - SCOPED TO THIS SALON ONLY
  // Using FILTER clause for conditional aggregation (Postgres 9.4+)
  const stats = await db
    .select({
      totalVisits: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'completed')::int`,
      totalSpent: sql<number>`COALESCE(sum(${appointmentSchema.totalPrice}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
      noShowCount: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'no_show')::int`,
      lastVisitAt: sql<Date | null>`max(${appointmentSchema.startTime}) FILTER (WHERE ${appointmentSchema.status} = 'completed')`,
    })
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.salonId, salonId),
        inArray(appointmentSchema.clientPhone, uniquePhoneVariants),
      ),
    );

  const clientStats = stats[0];
  
  // Calculate loyalty points: 1 point per $1 spent (totalSpent is in cents)
  // Example: $125.00 spent = 12500 cents = 125 points
  const loyaltyPoints = Math.floor((clientStats?.totalSpent ?? 0) / 100);
  
  // Update the salon client with computed stats
  // Double-check salonId in WHERE clause for multi-tenant safety
  await db
    .update(salonClientSchema)
    .set({
      totalVisits: clientStats?.totalVisits ?? 0,
      totalSpent: clientStats?.totalSpent ?? 0,
      noShowCount: clientStats?.noShowCount ?? 0,
      lastVisitAt: clientStats?.lastVisitAt ?? null,
      loyaltyPoints,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(salonClientSchema.id, salonClient.id),
        eq(salonClientSchema.salonId, salonId),
      ),
    );
}

