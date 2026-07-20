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
 * A single-technician salon is safe to auto-assign. Multi-technician salons
 * must explicitly provide the technicians who offer the service.
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
    : activeTechnicians.length === 1
      ? [activeTechnicians[0]!.id]
      : [];

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
    assignmentRequired: activeTechnicians.length > 1 && assignedTechnicianIds.length === 0,
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
