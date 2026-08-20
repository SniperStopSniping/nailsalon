import 'server-only';

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { OwnerCatalogConfigError } from '@/libs/ownerCatalogErrors.server';
import type { Capability, TechnicianCapability } from '@/models/Schema';
import {
  capabilitySchema,
  catalogRuleSchema,
  technicianCapabilitySchema,
  technicianSchema,
} from '@/models/Schema';

/**
 * Luster L1 PR6 — capability + technician-assignment CRUD (owner/admin
 * configuration surface).
 *
 * `capability` and `technician_capability` are the FIRST writers either
 * table has had (migration 0073 created both empty and dark). Every
 * assignment validates BOTH sides belong to the calling salon before it is
 * ever attempted, even though the composite foreign keys
 * (`technician_capability_technician_salon_fk` /
 * `_capability_salon_fk`) would reject a cross-tenant pairing regardless —
 * checking first turns a raw constraint violation into an owner-readable
 * error.
 */

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform(value => (typeof value === 'string' ? (value.trim() || null) : null));

export const capabilityWriteSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z.string().trim().min(1, 'Capability name is required').max(120, 'Capability name is too long'),
  description: optionalText,
  isActive: z.boolean().optional().default(true),
});

function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'capability';
  return `${base}-${nanoid(6).toLowerCase()}`;
}

export async function createCapability(
  salonId: string,
  input: { name: string; description: string | null; isActive: boolean },
): Promise<Capability> {
  const id = `cap_${nanoid()}`;
  const [created] = await db
    .insert(capabilitySchema)
    .values({
      id,
      salonId,
      slug: slugFromName(input.name),
      name: input.name,
      description: input.description,
      isActive: input.isActive,
    })
    .returning();

  if (!created) {
    throw new OwnerCatalogConfigError({
      code: 'CREATE_FAILED',
      message: 'The capability could not be created. Try again.',
      anchor: { kind: 'relationship' },
      status: 500,
    });
  }

  return created;
}

export async function updateCapability(
  salonId: string,
  capabilityId: string,
  input: { name: string; description: string | null; isActive: boolean },
): Promise<Capability> {
  const [updated] = await db
    .update(capabilitySchema)
    .set({
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(capabilitySchema.id, capabilityId), eq(capabilitySchema.salonId, salonId)))
    .returning();

  if (!updated) {
    throw new OwnerCatalogConfigError({
      code: 'CAPABILITY_NOT_FOUND',
      message: 'Capability not found.',
      anchor: { kind: 'capability', capabilityId },
      status: 404,
    });
  }

  return updated;
}

/**
 * Blocked while any technician still holds this capability, or any
 * `catalog_rule` still requires it — both composite foreign keys are
 * `ON DELETE NO ACTION`, so this mirrors what the database would refuse
 * anyway, but with an owner-readable reason instead of a raw constraint
 * error.
 */
export async function deleteCapability(salonId: string, capabilityId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [assignments, rules] = await Promise.all([
      tx.select({ id: technicianCapabilitySchema.id }).from(technicianCapabilitySchema)
        .where(and(eq(technicianCapabilitySchema.salonId, salonId), eq(technicianCapabilitySchema.capabilityId, capabilityId))),
      tx.select({ id: catalogRuleSchema.id }).from(catalogRuleSchema)
        .where(and(eq(catalogRuleSchema.salonId, salonId), eq(catalogRuleSchema.capabilityId, capabilityId))),
    ]);

    if (assignments.length > 0) {
      throw new OwnerCatalogConfigError({
        code: 'CAPABILITY_HAS_ASSIGNMENTS',
        message: `This capability is still assigned to ${assignments.length} technician${assignments.length === 1 ? '' : 's'}. Unassign it first.`,
        anchor: { kind: 'capability', capabilityId },
        status: 409,
      });
    }
    if (rules.length > 0) {
      throw new OwnerCatalogConfigError({
        code: 'CAPABILITY_IN_USE_BY_RULE',
        message: `This capability is still required by ${rules.length} rule${rules.length === 1 ? '' : 's'}. Remove or edit those rules first.`,
        anchor: { kind: 'capability', capabilityId },
        status: 409,
      });
    }

    const deleted = await tx
      .delete(capabilitySchema)
      .where(and(eq(capabilitySchema.id, capabilityId), eq(capabilitySchema.salonId, salonId)))
      .returning();

    if (deleted.length === 0) {
      throw new OwnerCatalogConfigError({
        code: 'CAPABILITY_NOT_FOUND',
        message: 'Capability not found.',
        anchor: { kind: 'capability', capabilityId },
        status: 404,
      });
    }
  });
}

// =============================================================================
// TECHNICIAN ASSIGNMENT
// =============================================================================

export const technicianCapabilityWriteSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  technicianId: z.string().min(1, 'technicianId is required'),
  capabilityId: z.string().min(1, 'capabilityId is required'),
});

/**
 * Assigns a capability to a technician, validating BOTH belong to the
 * salon and that the pair is not already assigned (a friendly
 * `ALREADY_ASSIGNED` instead of the unique index's raw constraint error).
 */
export async function assignTechnicianCapability(
  salonId: string,
  input: { technicianId: string; capabilityId: string },
): Promise<TechnicianCapability> {
  return db.transaction(async (tx) => {
    const [technician] = await tx
      .select({ id: technicianSchema.id })
      .from(technicianSchema)
      .where(and(eq(technicianSchema.id, input.technicianId), eq(technicianSchema.salonId, salonId)));
    if (!technician) {
      throw new OwnerCatalogConfigError({
        code: 'TECHNICIAN_NOT_FOUND',
        message: 'Technician not found for this salon.',
        anchor: { kind: 'technician', technicianId: input.technicianId },
        status: 400,
      });
    }

    const [capability] = await tx
      .select({ id: capabilitySchema.id })
      .from(capabilitySchema)
      .where(and(eq(capabilitySchema.id, input.capabilityId), eq(capabilitySchema.salonId, salonId)));
    if (!capability) {
      throw new OwnerCatalogConfigError({
        code: 'CAPABILITY_NOT_FOUND',
        message: 'Capability not found for this salon.',
        anchor: { kind: 'capability', capabilityId: input.capabilityId },
        status: 400,
      });
    }

    const [existing] = await tx
      .select({ id: technicianCapabilitySchema.id })
      .from(technicianCapabilitySchema)
      .where(and(
        eq(technicianCapabilitySchema.technicianId, input.technicianId),
        eq(technicianCapabilitySchema.capabilityId, input.capabilityId),
      ));
    if (existing) {
      throw new OwnerCatalogConfigError({
        code: 'ALREADY_ASSIGNED',
        message: 'This technician already has this capability.',
        anchor: { kind: 'technician', technicianId: input.technicianId },
        status: 409,
      });
    }

    const [created] = await tx
      .insert(technicianCapabilitySchema)
      .values({
        id: `tc_${nanoid()}`,
        salonId,
        technicianId: input.technicianId,
        capabilityId: input.capabilityId,
      })
      .returning();

    if (!created) {
      throw new OwnerCatalogConfigError({
        code: 'CREATE_FAILED',
        message: 'The assignment could not be created. Try again.',
        anchor: { kind: 'relationship' },
        status: 500,
      });
    }

    return created;
  });
}

export async function unassignTechnicianCapability(salonId: string, assignmentId: string): Promise<void> {
  const deleted = await db
    .delete(technicianCapabilitySchema)
    .where(and(eq(technicianCapabilitySchema.id, assignmentId), eq(technicianCapabilitySchema.salonId, salonId)))
    .returning();

  if (deleted.length === 0) {
    throw new OwnerCatalogConfigError({
      code: 'ASSIGNMENT_NOT_FOUND',
      message: 'Assignment not found.',
      anchor: { kind: 'relationship' },
      status: 404,
    });
  }
}
