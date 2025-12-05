import 'server-only';

import { eq, and, inArray, gte, lt, gt, ne } from 'drizzle-orm';

import {
  appointmentSchema,
  clientSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
  type Appointment,
  type CancelReason,
  type Client,
  type Salon,
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

  // Build a map of technician ID to service IDs
  const techServiceMap = new Map<string, string[]>();
  for (const assoc of serviceAssociations) {
    const existing = techServiceMap.get(assoc.technicianId) ?? [];
    existing.push(assoc.serviceId);
    techServiceMap.set(assoc.technicianId, existing);
  }

  // Combine technicians with their service IDs
  return technicians.map(tech => ({
    ...tech,
    serviceIds: techServiceMap.get(tech.id) ?? [],
  }));
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
        firstName: firstName ?? clientSchema.firstName,
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

