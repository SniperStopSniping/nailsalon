import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { OwnerCatalogConfigError } from '@/libs/ownerCatalogErrors.server';
import type { Service } from '@/models/Schema';
import { serviceSchema, technicianServicesSchema } from '@/models/Schema';

/**
 * Luster L1 PR6 — service family / variant grouping (owner/admin
 * configuration surface).
 *
 * Enforces, at the APPLICATION layer, every invariant migration 0072's own
 * CHECKs establish as structurally possible but do not by themselves rule
 * out: no grandchildren (0072 only forbids self-parenting and a child
 * carrying its own `variantKind`), one axis per family (`variantKind` is a
 * single column, but nothing stops two different WRITES from disagreeing
 * about what it should be), and "a publicly bookable child needs an active
 * parent" (0072 says nothing about `isActive` at all).
 *
 * Legacy simplicity: NOTHING here ever runs for a service nobody asked to
 * make into a family. A legacy service keeps NULL in every L1 column until
 * an owner explicitly calls one of these functions for it.
 */

export type ServiceFamilyWarning = {
  code: 'category_mismatch' | 'booking_category_mismatch' | 'staff_assignment_mismatch';
  message: string;
};

export type ServiceFamilyChange = {
  field: 'parentServiceId' | 'variantLabel' | 'variantKind' | 'selectionMode';
  serviceId: string;
  from: string | null;
  to: string | null;
};

export type AttachServiceVariantInput = {
  parentServiceId: string;
  childServiceId: string;
  variantLabel: string;
  /**
   * Required only when this attach ESTABLISHES the family's axis (the
   * parent has no other children yet). Once set, every later attach to the
   * same parent must either omit it or repeat the identical value — "one
   * axis per family" is enforced here, not just documented.
   */
  variantKind?: string | null;
  /** Optional, written onto the PARENT — never the child. */
  selectionMode?: 'direct' | 'guided' | null;
};

export type DetachServiceVariantInput = {
  childServiceId: string;
};

export type ServiceFamilyOperation =
  | { kind: 'attach'; input: AttachServiceVariantInput }
  | { kind: 'detach'; input: DetachServiceVariantInput };

export type ServiceFamilyPlan = {
  changes: ServiceFamilyChange[];
  warnings: ServiceFamilyWarning[];
};

function notFound(serviceId: string): OwnerCatalogConfigError {
  return new OwnerCatalogConfigError({
    code: 'SERVICE_NOT_FOUND',
    message: 'Service not found for this salon.',
    anchor: { kind: 'service', serviceId },
    status: 404,
  });
}

/**
 * Loads and validates the ATTACH operation, throwing on any hard invariant
 * violation. Both `inspectServiceFamilyOperation` (read-only) and
 * `commitServiceFamilyOperation` (transactional write) call this exact
 * function so the two can never disagree about what is allowed.
 */
async function planAttach(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  input: AttachServiceVariantInput,
): Promise<ServiceFamilyPlan> {
  if (!input.variantLabel.trim()) {
    throw new OwnerCatalogConfigError({
      code: 'VARIANT_LABEL_REQUIRED',
      message: 'A variant needs a label that distinguishes it from its siblings (e.g. "Short", "XL").',
      anchor: { kind: 'variant', serviceId: input.childServiceId },
      status: 400,
    });
  }

  if (input.parentServiceId === input.childServiceId) {
    throw new OwnerCatalogConfigError({
      code: 'SELF_PARENT',
      message: 'A service cannot be its own parent.',
      anchor: { kind: 'relationship' },
      status: 400,
    });
  }

  const [parent, child] = await Promise.all([
    tx.select().from(serviceSchema).where(and(eq(serviceSchema.id, input.parentServiceId), eq(serviceSchema.salonId, salonId))).then(rows => rows[0] ?? null),
    tx.select().from(serviceSchema).where(and(eq(serviceSchema.id, input.childServiceId), eq(serviceSchema.salonId, salonId))).then(rows => rows[0] ?? null),
  ]);

  if (!parent) {
    throw notFound(input.parentServiceId);
  }
  if (!child) {
    throw notFound(input.childServiceId);
  }

  // No grandchildren, side 1: the target parent must not itself be a child.
  if (parent.parentServiceId) {
    throw new OwnerCatalogConfigError({
      code: 'PARENT_IS_ALREADY_A_VARIANT',
      message: 'This service is itself a variant of another service and cannot become a parent. Attach the new variant to the top-level service instead.',
      anchor: { kind: 'service', serviceId: parent.id },
      status: 400,
    });
  }

  // No grandchildren, side 2: the incoming child must not already be a
  // parent of anything — attaching it would push its own children down to
  // a third level.
  const childsOwnChildren = await tx
    .select({ id: serviceSchema.id })
    .from(serviceSchema)
    .where(and(eq(serviceSchema.salonId, salonId), eq(serviceSchema.parentServiceId, child.id)));
  if (childsOwnChildren.length > 0) {
    throw new OwnerCatalogConfigError({
      code: 'GRANDCHILD_NOT_ALLOWED',
      message: 'This service already has its own variants and cannot become a variant of another service. Detach its variants first.',
      anchor: { kind: 'service', serviceId: child.id },
      status: 400,
    });
  }

  const siblings = await tx
    .select()
    .from(serviceSchema)
    .where(and(eq(serviceSchema.salonId, salonId), eq(serviceSchema.parentServiceId, parent.id)));
  const establishingFamily = siblings.length === 0 && !parent.variantKind;

  // One axis per family: the parent's `variantKind` is the family's single
  // source of truth. A first attach may set it; every later attach must
  // agree with what is already stored, never silently override it.
  let effectiveVariantKind = parent.variantKind ?? null;
  if (establishingFamily) {
    if (!input.variantKind || !input.variantKind.trim()) {
      throw new OwnerCatalogConfigError({
        code: 'VARIANT_KIND_REQUIRED',
        message: 'The first variant in a family must say what axis the family varies along (e.g. "length", "shape").',
        anchor: { kind: 'family', serviceId: parent.id },
        status: 400,
      });
    }
    effectiveVariantKind = input.variantKind.trim();
  } else if (input.variantKind && input.variantKind.trim() && input.variantKind.trim() !== parent.variantKind) {
    throw new OwnerCatalogConfigError({
      code: 'VARIANT_KIND_MISMATCH',
      message: `This family already varies by "${parent.variantKind}". A family can only vary along one axis — remove variantKind or use the existing value.`,
      anchor: { kind: 'family', serviceId: parent.id },
      status: 409,
    });
  }

  // A publicly bookable child needs an active, publicly bookable parent —
  // otherwise the family would advertise an option nobody can actually
  // reach from the parent's own listing.
  if (child.isActive && !parent.isActive) {
    throw new OwnerCatalogConfigError({
      code: 'PARENT_MUST_BE_ACTIVE',
      message: 'The parent service must be active while it has an active (publicly bookable) variant. Activate the parent first, or deactivate this variant.',
      anchor: { kind: 'service', serviceId: parent.id },
      status: 409,
    });
  }

  const changes: ServiceFamilyChange[] = [
    { field: 'parentServiceId', serviceId: child.id, from: child.parentServiceId, to: parent.id },
    { field: 'variantLabel', serviceId: child.id, from: child.variantLabel, to: input.variantLabel.trim() },
  ];
  if (effectiveVariantKind !== parent.variantKind) {
    changes.push({ field: 'variantKind', serviceId: parent.id, from: parent.variantKind, to: effectiveVariantKind });
  }
  if (input.selectionMode && input.selectionMode !== parent.selectionMode) {
    changes.push({ field: 'selectionMode', serviceId: parent.id, from: parent.selectionMode, to: input.selectionMode });
  }

  const warnings: ServiceFamilyWarning[] = [];
  if (parent.category !== child.category) {
    warnings.push({
      code: 'category_mismatch',
      message: `The parent's category ("${parent.category}") differs from this variant's ("${child.category}"). Consider aligning them so admin filtering stays consistent.`,
    });
  }
  if (parent.bookingCategory !== child.bookingCategory) {
    warnings.push({
      code: 'booking_category_mismatch',
      message: `The parent's booking category ("${parent.bookingCategory}") differs from this variant's ("${child.bookingCategory}"). Clients may see it grouped differently once variants are surfaced.`,
    });
  }

  const [parentAssignments, childAssignments] = await Promise.all([
    tx.select({ technicianId: technicianServicesSchema.technicianId }).from(technicianServicesSchema).where(and(eq(technicianServicesSchema.serviceId, parent.id), eq(technicianServicesSchema.enabled, true))),
    tx.select({ technicianId: technicianServicesSchema.technicianId }).from(technicianServicesSchema).where(and(eq(technicianServicesSchema.serviceId, child.id), eq(technicianServicesSchema.enabled, true))),
  ]);
  const parentTechIds = new Set(parentAssignments.map(row => row.technicianId));
  const childTechIds = new Set(childAssignments.map(row => row.technicianId));
  const staffDiffers = parentTechIds.size !== childTechIds.size
    || [...parentTechIds].some(id => !childTechIds.has(id));
  if (staffDiffers) {
    warnings.push({
      code: 'staff_assignment_mismatch',
      message: 'This variant is assigned to a different set of technicians than the parent service. Double-check staff assignments once variants are bookable.',
    });
  }

  return { changes, warnings };
}

async function planDetach(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  input: DetachServiceVariantInput,
): Promise<ServiceFamilyPlan> {
  const [child] = await tx
    .select()
    .from(serviceSchema)
    .where(and(eq(serviceSchema.id, input.childServiceId), eq(serviceSchema.salonId, salonId)));

  if (!child) {
    throw notFound(input.childServiceId);
  }
  if (!child.parentServiceId) {
    throw new OwnerCatalogConfigError({
      code: 'NOT_A_VARIANT',
      message: 'This service is not currently a variant of another service.',
      anchor: { kind: 'service', serviceId: child.id },
      status: 400,
    });
  }

  return {
    changes: [
      { field: 'parentServiceId', serviceId: child.id, from: child.parentServiceId, to: null },
      { field: 'variantLabel', serviceId: child.id, from: child.variantLabel, to: null },
    ],
    warnings: [],
  };
}

export async function planServiceFamilyOperation(
  salonId: string,
  operation: ServiceFamilyOperation,
): Promise<ServiceFamilyPlan> {
  return operation.kind === 'attach'
    ? planAttach(db, salonId, operation.input)
    : planDetach(db, salonId, operation.input);
}

export type ServiceFamilyCommitResult = {
  plan: ServiceFamilyPlan;
  parent: Service | null;
  child: Service;
};

/**
 * Re-plans and writes inside the SAME transaction, so a concurrent change
 * between inspect and commit can never leave a half-applied family — the
 * plan re-validates against the exact rows the write is about to touch.
 */
export async function commitServiceFamilyOperation(
  salonId: string,
  operation: ServiceFamilyOperation,
): Promise<ServiceFamilyCommitResult> {
  return db.transaction(async (tx) => {
    const plan = operation.kind === 'attach'
      ? await planAttach(tx, salonId, operation.input)
      : await planDetach(tx, salonId, operation.input);

    // Every field this plan can ever touch lives on `service`, so applying
    // it is uniform regardless of operation kind — the plan already fully
    // describes the write; nothing here re-derives WHAT changes, only
    // performs them. Changes are grouped by service and applied as ONE
    // UPDATE per row: `service_variant_child_requires_label_check` is
    // evaluated after every individual statement (not deferred), so writing
    // `parentServiceId` and `variantLabel` on the same child as TWO separate
    // statements would fail the CHECK on the first one, transiently.
    const changesByService = new Map<string, ServiceFamilyChange[]>();
    for (const change of plan.changes) {
      const existing = changesByService.get(change.serviceId);
      if (existing) {
        existing.push(change);
      } else {
        changesByService.set(change.serviceId, [change]);
      }
    }
    for (const [serviceId, changes] of changesByService) {
      const patch: Partial<Record<ServiceFamilyChange['field'], string | null>> = {};
      for (const change of changes) {
        patch[change.field] = change.to;
      }
      await tx
        .update(serviceSchema)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(serviceSchema.id, serviceId), eq(serviceSchema.salonId, salonId)));
    }

    const [child] = await tx
      .select()
      .from(serviceSchema)
      .where(and(eq(serviceSchema.id, operation.input.childServiceId), eq(serviceSchema.salonId, salonId)));
    if (!child) {
      throw notFound(operation.input.childServiceId);
    }

    let parent: Service | null = null;
    if (operation.kind === 'attach') {
      const [row] = await tx
        .select()
        .from(serviceSchema)
        .where(and(eq(serviceSchema.id, operation.input.parentServiceId), eq(serviceSchema.salonId, salonId)));
      parent = row ?? null;
    }

    return { plan, parent, child };
  });
}

// =============================================================================
// REQUEST PARSING — shared by the commit and inspect routes so the two can
// never accept a different request shape from one another.
// =============================================================================

const requestSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  operation: z.enum(['attach', 'detach']),
  parentServiceId: z.string().min(1).optional(),
  childServiceId: z.string().min(1, 'childServiceId is required'),
  variantLabel: z.string().optional(),
  variantKind: z.string().nullable().optional(),
  selectionMode: z.enum(['direct', 'guided']).nullable().optional(),
});

export type ParsedServiceFamilyRequest = {
  salonSlug: string;
  operation: ServiceFamilyOperation;
};

/**
 * Validates the raw request body and narrows it to a `ServiceFamilyOperation`
 * — `attach` requires `parentServiceId`/`variantLabel`; `detach` needs only
 * `childServiceId`. Throws `OwnerCatalogConfigError` (never a bare zod error)
 * so both routes translate failures identically.
 */
export function parseServiceFamilyRequest(raw: unknown): ParsedServiceFamilyRequest {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OwnerCatalogConfigError({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? 'Invalid service family request.',
      anchor: { kind: 'relationship' },
      status: 400,
    });
  }

  const { salonSlug, operation, ...rest } = parsed.data;

  if (operation === 'attach') {
    if (!rest.parentServiceId) {
      throw new OwnerCatalogConfigError({
        code: 'VALIDATION_ERROR',
        message: 'parentServiceId is required to attach a variant.',
        anchor: { kind: 'relationship' },
        status: 400,
      });
    }
    if (!rest.variantLabel || !rest.variantLabel.trim()) {
      throw new OwnerCatalogConfigError({
        code: 'VARIANT_LABEL_REQUIRED',
        message: 'A variant needs a label that distinguishes it from its siblings (e.g. "Short", "XL").',
        anchor: { kind: 'variant', serviceId: rest.childServiceId },
        status: 400,
      });
    }
    return {
      salonSlug,
      operation: {
        kind: 'attach',
        input: {
          parentServiceId: rest.parentServiceId,
          childServiceId: rest.childServiceId,
          variantLabel: rest.variantLabel,
          variantKind: rest.variantKind ?? null,
          selectionMode: rest.selectionMode ?? null,
        },
      },
    };
  }

  return {
    salonSlug,
    operation: { kind: 'detach', input: { childServiceId: rest.childServiceId } },
  };
}
