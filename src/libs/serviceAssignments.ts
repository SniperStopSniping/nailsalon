import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { serviceSchema, technicianSchema, technicianServicesSchema } from '@/models/Schema';

type AssignmentDatabase = Pick<typeof db, 'insert' | 'select'>;

export type EnsureServiceAssignmentsResult = {
  assignedTechnicianIds: string[];
  assignmentRequired: boolean;
};

export class InvalidTechnicianAssignmentError extends Error {
  constructor() {
    super('INVALID_TECHNICIAN_ASSIGNMENT');
    this.name = 'InvalidTechnicianAssignmentError';
  }
}

/**
 * Keeps service creation and technician assignment on one shared code path.
 *
 * Default = every ACTIVE technician (AG-w2-services-01). The previous rule
 * only auto-assigned a single-technician salon, so a multi-technician salon
 * that created a service through a form with no technician picker got zero
 * `technician_services` rows and a service that read "Active" in the owner UI
 * while being invisible on the public booking page forever. Assigning
 * everyone matches what an owner means by "I now offer this"; narrowing it is
 * an explicit, reversible action in Team -> technician -> Services.
 *
 * An explicit `technicianIds` list still wins, and is still validated against
 * the salon's active technicians.
 */
export async function ensureServiceAssignments(
  database: AssignmentDatabase,
  args: {
    salonId: string;
    serviceId: string;
    technicianIds?: string[];
  },
): Promise<EnsureServiceAssignmentsResult> {
  const [service] = await database
    .select({ id: serviceSchema.id })
    .from(serviceSchema)
    .where(and(eq(serviceSchema.id, args.serviceId), eq(serviceSchema.salonId, args.salonId)))
    .limit(1);

  if (!service) {
    throw new InvalidTechnicianAssignmentError();
  }

  const activeTechnicians = await database
    .select({ id: technicianSchema.id })
    .from(technicianSchema)
    .where(and(eq(technicianSchema.salonId, args.salonId), eq(technicianSchema.isActive, true)));

  const activeTechnicianIds = new Set(activeTechnicians.map(technician => technician.id));
  const explicitTechnicianIds = Array.from(new Set(args.technicianIds ?? []));

  if (explicitTechnicianIds.some(technicianId => !activeTechnicianIds.has(technicianId))) {
    throw new InvalidTechnicianAssignmentError();
  }

  const assignedTechnicianIds = explicitTechnicianIds.length > 0
    ? explicitTechnicianIds
    : activeTechnicians.map(technician => technician.id);

  if (assignedTechnicianIds.length > 0) {
    await database
      .insert(technicianServicesSchema)
      .values(assignedTechnicianIds.map((technicianId, priority) => ({
        technicianId,
        serviceId: args.serviceId,
        enabled: true,
        priority,
      })))
      .onConflictDoUpdate({
        target: [technicianServicesSchema.technicianId, technicianServicesSchema.serviceId],
        set: { enabled: true },
      });
  }

  return {
    assignedTechnicianIds,
    // True only when the salon HAS active technicians and none of them ended
    // up offering the service — i.e. the owner must go and pick someone. With
    // the everyone-by-default rule above that can no longer happen through
    // creation; it stays in the contract for callers that pass an explicit
    // (possibly empty) list.
    assignmentRequired:
      activeTechnicians.length > 0 && assignedTechnicianIds.length === 0,
  };
}

export async function getPublicBookableServiceIds(salonId: string): Promise<Set<string> | null> {
  const activeTechnicians = await db
    .select({ id: technicianSchema.id })
    .from(technicianSchema)
    .where(and(eq(technicianSchema.salonId, salonId), eq(technicianSchema.isActive, true)));

  if (activeTechnicians.length === 0) {
    return new Set();
  }

  const assignments = await db
    .select({
      serviceId: technicianServicesSchema.serviceId,
      enabled: technicianServicesSchema.enabled,
    })
    .from(technicianServicesSchema)
    .innerJoin(serviceSchema, eq(serviceSchema.id, technicianServicesSchema.serviceId))
    .where(and(
      inArray(technicianServicesSchema.technicianId, activeTechnicians.map(technician => technician.id)),
      eq(serviceSchema.salonId, salonId),
    ));

  // A salon with no technician-service rows is still on the legacy unrestricted
  // model. Returning null preserves that behavior while structured salons hide
  // accidentally unassigned services.
  if (assignments.length === 0) {
    return null;
  }

  return new Set(
    assignments
      .filter(assignment => assignment.enabled)
      .map(assignment => assignment.serviceId),
  );
}
