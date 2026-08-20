import 'server-only';

import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// VALUE imports from the catalog module set — this file is an authorized
// edge in `architecturalInvariants.test.ts` (invariant 5) for BOTH
// `catalogRuleContract.ts` and `catalogRuleGraph.ts`.
//
// This module maps OWNER INTENT onto the six landed rule types; it never
// accepts a raw `ruleType`, `params`, or `priority` from a caller — the
// intent schema below simply has no field shaped like any of those, so
// there is nothing for a caller to send that would reach the database
// un-mapped. `catalogRuleWriteSchema` is the single source of truth for
// whether the MAPPED result is well-formed; this file does not
// re-implement any of its checks.
import type { CatalogRuleType } from '@/libs/catalogRuleContract';
import { catalogRuleWriteSchema } from '@/libs/catalogRuleContract';
import type { CatalogAutoAddEdge, CatalogAutoAddNode } from '@/libs/catalogRuleGraph';
import { detectAutoAddCycle } from '@/libs/catalogRuleGraph';
import { db } from '@/libs/DB';
import { OwnerCatalogConfigError } from '@/libs/ownerCatalogErrors.server';
import type { CatalogRule } from '@/models/Schema';
import {
  addOnSchema,
  capabilitySchema,
  catalogRuleSchema,
  serviceSchema,
} from '@/models/Schema';

// =============================================================================
// OWNER INTENT VOCABULARY
// =============================================================================

/**
 * The owner-facing names for the six landed rule types
 * (`CATALOG_RULE_TYPES`, `catalogRuleContract.ts`). One intent per type,
 * named for what an owner is actually trying to DO rather than the
 * database's internal vocabulary — the mapping to `ruleType` below is the
 * only place the two vocabularies meet.
 */
export const OWNER_RULE_INTENTS = [
  'bundle_add_on',
  'exclude_add_on',
  'require_add_on',
  'prevent_combination',
  'limit_add_on_quantity',
  'require_capability',
] as const;
export type OwnerRuleIntent = typeof OWNER_RULE_INTENTS[number];

const INTENT_TO_RULE_TYPE: Record<OwnerRuleIntent, CatalogRuleType> = {
  bundle_add_on: 'include',
  exclude_add_on: 'exclude',
  require_add_on: 'requires',
  prevent_combination: 'mutually_exclusive',
  limit_add_on_quantity: 'max_quantity',
  require_capability: 'requires_capability',
};

const subjectSchema = z.object({
  subjectKind: z.enum(['service', 'addOn']),
  subjectId: z.string().min(1, 'A subject is required'),
});

const sharedIntentFields = {
  salonSlug: z.string().min(1, 'Salon slug is required'),
  /** Mirrors `catalog_rule.service_id`: omitted/null = salon-wide scope. */
  scopeServiceId: z.string().min(1).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  presentation: z.enum(['surface', 'silent']).optional(),
  reasonCode: z.enum([
    'included_with_selection',
    'required_for_selection',
    'unavailable_with_selection',
    'quantity_limited',
    'capability_required',
  ]).optional(),
};

const ownerRuleIntentSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('bundle_add_on'), ...sharedIntentFields, ...subjectSchema.shape, addOnId: z.string().min(1, 'addOnId is required'), autoAdd: z.boolean().optional().default(false) }),
  z.object({ intent: z.literal('exclude_add_on'), ...sharedIntentFields, ...subjectSchema.shape, addOnId: z.string().min(1, 'addOnId is required') }),
  z.object({ intent: z.literal('require_add_on'), ...sharedIntentFields, ...subjectSchema.shape, addOnId: z.string().min(1, 'addOnId is required') }),
  z.object({ intent: z.literal('prevent_combination'), ...sharedIntentFields, ...subjectSchema.shape, addOnId: z.string().min(1, 'addOnId is required') }),
  z.object({ intent: z.literal('limit_add_on_quantity'), ...sharedIntentFields, ...subjectSchema.shape, addOnId: z.string().min(1, 'addOnId is required'), maxQuantity: z.number().int().min(1).max(99) }),
  z.object({ intent: z.literal('require_capability'), ...sharedIntentFields, ...subjectSchema.shape, capabilityId: z.string().min(1, 'capabilityId is required') }),
]);

export type OwnerRuleIntentInput = z.infer<typeof ownerRuleIntentSchema>;

export type ParsedOwnerRuleWrite = {
  salonSlug: string;
  ruleWrite: z.output<typeof catalogRuleWriteSchema>;
};

/**
 * Validates the raw request body as an owner intent, then maps it onto the
 * exact shape `catalogRuleWriteSchema` expects and validates THAT — the
 * database-mirroring checks (XOR subject, object shape, no self-pairing,
 * per-type params) run here, once, for every intent.
 */
export function parseOwnerRuleWrite(raw: unknown): ParsedOwnerRuleWrite {
  const intentParsed = ownerRuleIntentSchema.safeParse(raw);
  if (!intentParsed.success) {
    throw new OwnerCatalogConfigError({
      code: 'VALIDATION_ERROR',
      message: intentParsed.error.issues[0]?.message ?? 'Invalid rule details.',
      anchor: { kind: 'rule', ruleId: null },
      status: 400,
    });
  }

  const intent = intentParsed.data;
  const ruleType = INTENT_TO_RULE_TYPE[intent.intent];

  const candidate: z.input<typeof catalogRuleWriteSchema> = {
    serviceId: intent.scopeServiceId ?? null,
    ruleType,
    subjectServiceId: intent.subjectKind === 'service' ? intent.subjectId : null,
    subjectAddOnId: intent.subjectKind === 'addOn' ? intent.subjectId : null,
    objectAddOnId: intent.intent === 'require_capability' ? null : intent.addOnId,
    capabilityId: intent.intent === 'require_capability' ? intent.capabilityId : null,
    params: {
      ...(intent.reasonCode ? { reasonCode: intent.reasonCode } : {}),
      ...(intent.presentation ? { presentation: intent.presentation } : {}),
      ...(intent.intent === 'bundle_add_on' ? { autoAdd: intent.autoAdd } : {}),
      ...(intent.intent === 'limit_add_on_quantity' ? { maxQuantity: intent.maxQuantity } : {}),
    },
    // Never accepted from the client — every owner-authored rule starts at
    // the same priority; ties break on `id` (the frozen `(priority, id)`
    // evaluation order — see `catalogRuleContract.ts`/ADR 0001).
    priority: 0,
    isActive: intent.isActive,
    note: intent.note ?? null,
  };

  const ruleParsed = catalogRuleWriteSchema.safeParse(candidate);
  if (!ruleParsed.success) {
    throw new OwnerCatalogConfigError({
      code: 'VALIDATION_ERROR',
      message: ruleParsed.error.issues[0]?.message ?? 'Invalid rule details.',
      anchor: { kind: 'rule', ruleId: null },
      status: 400,
    });
  }

  return { salonSlug: intent.salonSlug, ruleWrite: ruleParsed.data };
}

// =============================================================================
// REFERENCE VALIDATION — reject unknown/cross-tenant/inactive targets
// =============================================================================

async function assertActiveServiceInSalon(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  serviceId: string,
): Promise<void> {
  const [row] = await tx.select({ id: serviceSchema.id }).from(serviceSchema)
    .where(and(eq(serviceSchema.id, serviceId), eq(serviceSchema.salonId, salonId), eq(serviceSchema.isActive, true)));
  if (!row) {
    throw new OwnerCatalogConfigError({
      code: 'INVALID_RULE_REFERENCE',
      message: 'The selected service does not belong to this salon, or is not active.',
      anchor: { kind: 'service', serviceId },
      status: 400,
    });
  }
}

async function assertActiveAddOnInSalon(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  addOnId: string,
): Promise<void> {
  const [row] = await tx.select({ id: addOnSchema.id }).from(addOnSchema)
    .where(and(eq(addOnSchema.id, addOnId), eq(addOnSchema.salonId, salonId), eq(addOnSchema.isActive, true)));
  if (!row) {
    throw new OwnerCatalogConfigError({
      code: 'INVALID_RULE_REFERENCE',
      message: 'The selected add-on does not belong to this salon, or is not active.',
      anchor: { kind: 'addOn', addOnId },
      status: 400,
    });
  }
}

async function assertActiveCapabilityInSalon(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  capabilityId: string,
): Promise<void> {
  const [row] = await tx.select({ id: capabilitySchema.id }).from(capabilitySchema)
    .where(and(eq(capabilitySchema.id, capabilityId), eq(capabilitySchema.salonId, salonId), eq(capabilitySchema.isActive, true)));
  if (!row) {
    throw new OwnerCatalogConfigError({
      code: 'INVALID_RULE_REFERENCE',
      message: 'The selected capability does not belong to this salon, or is not active.',
      anchor: { kind: 'capability', capabilityId },
      status: 400,
    });
  }
}

async function assertRuleReferences(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  ruleWrite: z.output<typeof catalogRuleWriteSchema>,
): Promise<void> {
  if (ruleWrite.serviceId) {
    await assertActiveServiceInSalon(tx, salonId, ruleWrite.serviceId);
  }
  if (ruleWrite.subjectServiceId) {
    await assertActiveServiceInSalon(tx, salonId, ruleWrite.subjectServiceId);
  }
  if (ruleWrite.subjectAddOnId) {
    await assertActiveAddOnInSalon(tx, salonId, ruleWrite.subjectAddOnId);
  }
  if (ruleWrite.objectAddOnId) {
    await assertActiveAddOnInSalon(tx, salonId, ruleWrite.objectAddOnId);
  }
  if (ruleWrite.capabilityId) {
    await assertActiveCapabilityInSalon(tx, salonId, ruleWrite.capabilityId);
  }
}

// =============================================================================
// AUTO-ADD GRAPH VALIDATION — cycle detection
// =============================================================================

/**
 * Loads every OTHER active `include`-with-`autoAdd` rule for the salon
 * (excluding `excludeRuleId`, so an UPDATE re-validates against its own
 * post-write state rather than double-counting itself), adds the candidate
 * edge, and rejects if the resulting graph is cyclic. Mirrors the edge
 * derivation `catalogResolverCore.ts`'s own (private) `buildAutoAddEdges`
 * uses — `subjectKind`/`subjectId` from `subjectServiceId ?? subjectAddOnId`
 * — without importing that internal helper, since this is a WRITE-time
 * check over raw rows, not a read-time resolution.
 */
async function assertNoAutoAddCycle(
  tx: Pick<typeof db, 'select'>,
  salonId: string,
  candidate: { ruleType: string; subjectServiceId: string | null; subjectAddOnId: string | null; objectAddOnId: string | null; params?: unknown; isActive: boolean },
  excludeRuleId?: string,
): Promise<void> {
  const candidateParams = (candidate.params ?? {}) as Record<string, unknown>;
  const candidateAutoAdd = candidate.ruleType === 'include' && candidate.isActive && candidateParams.autoAdd === true;
  if (!candidateAutoAdd || !candidate.objectAddOnId) {
    return;
  }

  const existing = await tx
    .select()
    .from(catalogRuleSchema)
    .where(and(
      eq(catalogRuleSchema.salonId, salonId),
      eq(catalogRuleSchema.ruleType, 'include'),
      eq(catalogRuleSchema.isActive, true),
      excludeRuleId ? ne(catalogRuleSchema.id, excludeRuleId) : undefined,
    ));

  const edges: CatalogAutoAddEdge[] = [];
  for (const rule of existing) {
    if ((rule.params as Record<string, unknown>)?.autoAdd !== true || !rule.objectAddOnId) {
      continue;
    }
    const node: CatalogAutoAddNode = rule.subjectServiceId
      ? { kind: 'service', id: rule.subjectServiceId }
      : { kind: 'addOn', id: rule.subjectAddOnId! };
    edges.push({ from: node, toAddOnId: rule.objectAddOnId });
  }

  const candidateNode: CatalogAutoAddNode = candidate.subjectServiceId
    ? { kind: 'service', id: candidate.subjectServiceId }
    : { kind: 'addOn', id: candidate.subjectAddOnId! };
  edges.push({ from: candidateNode, toAddOnId: candidate.objectAddOnId });

  const cycle = detectAutoAddCycle(edges);
  if (cycle) {
    throw new OwnerCatalogConfigError({
      code: 'CYCLIC_AUTO_ADD',
      message: 'This bundling rule would create a loop where add-ons keep auto-adding each other. Break the cycle by removing autoAdd from one of the rules involved.',
      anchor: { kind: 'addOn', addOnId: candidate.objectAddOnId },
      status: 409,
    });
  }
}

// =============================================================================
// CRUD
// =============================================================================

export async function listCatalogRules(salonId: string): Promise<CatalogRule[]> {
  return db
    .select()
    .from(catalogRuleSchema)
    .where(eq(catalogRuleSchema.salonId, salonId))
    .orderBy(catalogRuleSchema.priority, catalogRuleSchema.id);
}

export async function createCatalogRule(
  salonId: string,
  ruleWrite: z.output<typeof catalogRuleWriteSchema>,
): Promise<CatalogRule> {
  return db.transaction(async (tx) => {
    await assertRuleReferences(tx, salonId, ruleWrite);
    await assertNoAutoAddCycle(tx, salonId, ruleWrite);

    const [created] = await tx
      .insert(catalogRuleSchema)
      .values({
        id: `rule_${nanoid()}`,
        salonId,
        serviceId: ruleWrite.serviceId,
        ruleType: ruleWrite.ruleType,
        subjectServiceId: ruleWrite.subjectServiceId,
        subjectAddOnId: ruleWrite.subjectAddOnId,
        objectAddOnId: ruleWrite.objectAddOnId,
        capabilityId: ruleWrite.capabilityId,
        params: (ruleWrite.params ?? {}) as Record<string, unknown>,
        priority: ruleWrite.priority,
        isActive: ruleWrite.isActive,
        note: ruleWrite.note,
      })
      .returning();

    if (!created) {
      throw new OwnerCatalogConfigError({
        code: 'CREATE_FAILED',
        message: 'The rule could not be created. Try again.',
        anchor: { kind: 'rule', ruleId: null },
        status: 500,
      });
    }

    return created;
  });
}

export async function updateCatalogRule(
  salonId: string,
  ruleId: string,
  ruleWrite: z.output<typeof catalogRuleWriteSchema>,
): Promise<CatalogRule> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: catalogRuleSchema.id }).from(catalogRuleSchema)
      .where(and(eq(catalogRuleSchema.id, ruleId), eq(catalogRuleSchema.salonId, salonId)));
    if (!existing) {
      throw new OwnerCatalogConfigError({
        code: 'RULE_NOT_FOUND',
        message: 'Rule not found.',
        anchor: { kind: 'rule', ruleId },
        status: 404,
      });
    }

    await assertRuleReferences(tx, salonId, ruleWrite);
    await assertNoAutoAddCycle(tx, salonId, ruleWrite, ruleId);

    const [updated] = await tx
      .update(catalogRuleSchema)
      .set({
        serviceId: ruleWrite.serviceId,
        ruleType: ruleWrite.ruleType,
        subjectServiceId: ruleWrite.subjectServiceId,
        subjectAddOnId: ruleWrite.subjectAddOnId,
        objectAddOnId: ruleWrite.objectAddOnId,
        capabilityId: ruleWrite.capabilityId,
        params: (ruleWrite.params ?? {}) as Record<string, unknown>,
        priority: ruleWrite.priority,
        isActive: ruleWrite.isActive,
        note: ruleWrite.note,
        updatedAt: new Date(),
      })
      .where(and(eq(catalogRuleSchema.id, ruleId), eq(catalogRuleSchema.salonId, salonId)))
      .returning();

    if (!updated) {
      throw new OwnerCatalogConfigError({
        code: 'RULE_NOT_FOUND',
        message: 'Rule not found.',
        anchor: { kind: 'rule', ruleId },
        status: 404,
      });
    }

    return updated;
  });
}

export async function deleteCatalogRule(salonId: string, ruleId: string): Promise<void> {
  // Removing a rule can never introduce a cycle — only adding/enabling an
  // autoAdd edge can — so no graph re-validation is needed on delete.
  const deleted = await db
    .delete(catalogRuleSchema)
    .where(and(eq(catalogRuleSchema.id, ruleId), eq(catalogRuleSchema.salonId, salonId)))
    .returning();

  if (deleted.length === 0) {
    throw new OwnerCatalogConfigError({
      code: 'RULE_NOT_FOUND',
      message: 'Rule not found.',
      anchor: { kind: 'rule', ruleId },
      status: 404,
    });
  }
}
