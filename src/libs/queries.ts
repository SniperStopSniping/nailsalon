import 'server-only';

import { eq, and, inArray } from 'drizzle-orm';

import {
  salonSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
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

