import { z } from 'zod';

/**
 * Luster L1 — the typed contract for `catalog_rule` rows.
 *
 * This module is the ONE place that answers "is this a well-formed catalog
 * rule?". It is PURE: no `@/libs/DB`, no `server-only`, no I/O — the same
 * reasons `depositPolicy.ts` is pure apply here, and a later owner editor will
 * need to validate a draft rule before it ever reaches a request handler.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It does not EXECUTE rules. There is no resolver, no expression evaluation,
 * no price or duration arithmetic, and no projection of a rule to a public
 * client anywhere in this PR. A `catalog_rule` row is inert storage of a
 * bounded vocabulary; deciding what a stored row DOES is a later PR's work.
 * Keeping the vocabulary and its shapes pinned here first is what stops that
 * later PR from having to invent semantics under deadline.
 *
 * WHERE ENFORCEMENT LIVES
 *
 * Migration 0073 enforces, in the database, everything structural: the rule
 * vocabulary, exactly-one-subject, the per-type object shape, `params` being a
 * JSON object, and tenant ownership of every reference. Those cannot be
 * bypassed by any caller, present or future.
 *
 * This module enforces what the database deliberately does not: the per-type
 * SHAPE of `params`. Expressing those shapes as CHECK constraints would mean
 * reaching into JSON with expressions whose behaviour is not guaranteed to be
 * identical between PostgreSQL and the PGlite build the suite replays against,
 * and a constraint that holds on only one engine is worse than an explicit
 * application-level one — it reads as a guarantee it cannot keep. That
 * boundary is stated here rather than implied, so no future reader mistakes
 * `params` validation for a database guarantee.
 */

// =============================================================================
// VOCABULARY
// =============================================================================

/**
 * The complete L1 rule vocabulary, in the same order as the
 * `catalog_rule_type_check` CHECK in migration 0073. The two must stay in
 * lockstep: `catalogRuleContract.test.ts` reads the migration and fails if
 * they drift, so adding a seventh type here without a migration cannot pass.
 *
 * There is deliberately no price-adjustment type, no duration-adjustment type,
 * no boolean-expression type, and no user-authored code. Add-ons already carry
 * their own price and duration; a rule decides whether an add-on is offered,
 * required, forbidden or capped — never what it costs or how long it takes.
 */
export const CATALOG_RULE_TYPES = [
  'include',
  'exclude',
  'requires',
  'mutually_exclusive',
  'max_quantity',
  'requires_capability',
] as const;

export type CatalogRuleType = typeof CATALOG_RULE_TYPES[number];

export const catalogRuleTypeSchema = z.enum(CATALOG_RULE_TYPES);

/** The one rule type whose object is a capability rather than an add-on. */
export const CAPABILITY_RULE_TYPE = 'requires_capability' as const satisfies CatalogRuleType;

/**
 * Absurdity ceiling for `max_quantity`. A cap this high is already far past
 * anything a nail appointment can mean; the ceiling exists so a typo cannot
 * store a quantity that later arithmetic has to defend itself against.
 */
export const MAX_QUANTITY_CEILING = 99;

// =============================================================================
// PARAMS
// =============================================================================

/**
 * Bounded, client-safe reasons a rule fired. Codes — never owner free text.
 *
 * Owner-authored prose belongs in `catalog_rule.note`, which is owner-facing
 * and never projected. A code can be localized by the client and cannot leak
 * a salon's internal wording, a technician's name, or anything else the owner
 * did not intend a stranger to read.
 */
export const CATALOG_RULE_REASON_CODES = [
  'included_with_selection',
  'required_for_selection',
  'unavailable_with_selection',
  'quantity_limited',
  'capability_required',
] as const;

export type CatalogRuleReasonCode = typeof CATALOG_RULE_REASON_CODES[number];

/**
 * Whether a rule's effect is announced to the client or applied quietly.
 * `surface` is the honest default: a client who has an add-on added or removed
 * on their behalf should be able to see that it happened.
 */
export const CATALOG_RULE_PRESENTATIONS = ['surface', 'silent'] as const;

export type CatalogRulePresentation = typeof CATALOG_RULE_PRESENTATIONS[number];

/** Fields every rule type may carry. */
const sharedParamsShape = {
  reasonCode: z.enum(CATALOG_RULE_REASON_CODES).optional(),
  presentation: z.enum(CATALOG_RULE_PRESENTATIONS).optional(),
} as const;

/**
 * `.strict()` throughout: an unknown key is a rejection, not something quietly
 * carried along. `params` is owner-influenced JSON, and the one thing a typed
 * contract over untrusted JSON must never do is pass through what it does not
 * understand.
 */
const includeParamsSchema = z.object({
  ...sharedParamsShape,
  /**
   * When true, the object add-on is added to the selection automatically
   * rather than merely offered. Nothing performs that addition in this PR.
   */
  autoAdd: z.boolean().optional(),
}).strict();

const maxQuantityParamsSchema = z.object({
  ...sharedParamsShape,
  /** Required for this type — the cap is the entire content of the rule. */
  maxQuantity: z.number().int().min(1).max(MAX_QUANTITY_CEILING),
}).strict();

const plainParamsSchema = z.object({ ...sharedParamsShape }).strict();

const PARAMS_SCHEMA_BY_TYPE = {
  include: includeParamsSchema,
  exclude: plainParamsSchema,
  requires: plainParamsSchema,
  mutually_exclusive: plainParamsSchema,
  max_quantity: maxQuantityParamsSchema,
  requires_capability: plainParamsSchema,
} as const satisfies Record<CatalogRuleType, z.ZodTypeAny>;

export type CatalogRuleParams<T extends CatalogRuleType = CatalogRuleType>
  = z.infer<typeof PARAMS_SCHEMA_BY_TYPE[T]>;

/**
 * Validates `params` for one rule type. Call this on every write, and again on
 * read before the value is used: a row can predate a narrowing of this
 * contract, and re-validating is how such a row surfaces as an explicit
 * failure instead of quietly reaching arithmetic that assumed it was fine.
 */
export function parseCatalogRuleParams<T extends CatalogRuleType>(
  ruleType: T,
  params: unknown,
): CatalogRuleParams<T> {
  return PARAMS_SCHEMA_BY_TYPE[ruleType].parse(params ?? {}) as CatalogRuleParams<T>;
}

/** Non-throwing form, for validating owner drafts without exception flow. */
export function safeParseCatalogRuleParams<T extends CatalogRuleType>(
  ruleType: T,
  params: unknown,
): z.SafeParseReturnType<unknown, CatalogRuleParams<T>> {
  return PARAMS_SCHEMA_BY_TYPE[ruleType].safeParse(params ?? {}) as
    z.SafeParseReturnType<unknown, CatalogRuleParams<T>>;
}

// =============================================================================
// WHOLE-ROW SHAPE
// =============================================================================

/**
 * The write-side shape of a `catalog_rule` row, mirroring migration 0073's
 * structural CHECKs so a malformed draft fails in the application with a
 * readable message instead of as a bare constraint violation.
 *
 * This MIRRORS the database; it does not replace it. Every invariant below is
 * also enforced by 0073, which is what makes it true of rows this code never
 * touched. Tenant ownership is deliberately NOT re-implemented here — it is
 * carried by the composite foreign keys and is not knowable from a single row
 * in isolation.
 */
export const catalogRuleWriteSchema = z.object({
  /** NULL scopes the rule salon-wide; a value narrows it to one service. */
  serviceId: z.string().min(1).nullable().default(null),

  ruleType: catalogRuleTypeSchema,

  subjectServiceId: z.string().min(1).nullable().default(null),
  subjectAddOnId: z.string().min(1).nullable().default(null),

  objectAddOnId: z.string().min(1).nullable().default(null),
  capabilityId: z.string().min(1).nullable().default(null),

  params: z.unknown().optional(),

  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  note: z.string().nullable().default(null),
})
  // Exactly one subject — the same XOR the database enforces.
  .refine(
    row => (row.subjectServiceId === null) !== (row.subjectAddOnId === null),
    {
      message: 'A catalog rule needs exactly one subject: subjectServiceId or subjectAddOnId.',
      path: ['subjectServiceId'],
    },
  )
  // The object side is fully determined by the rule type.
  .refine(
    row => (row.ruleType === CAPABILITY_RULE_TYPE
      ? row.capabilityId !== null && row.objectAddOnId === null
      : row.capabilityId === null && row.objectAddOnId !== null),
    {
      message:
        'requires_capability names a capabilityId and no objectAddOnId; every other rule type names an objectAddOnId and no capabilityId.',
      path: ['ruleType'],
    },
  )
  // An add-on cannot require, exclude or conflict with itself.
  .refine(
    row => row.subjectAddOnId === null
      || row.objectAddOnId === null
      || row.subjectAddOnId !== row.objectAddOnId,
    {
      message: 'A catalog rule cannot point an add-on at itself.',
      path: ['objectAddOnId'],
    },
  )
  // Params are checked against the shape their own rule type declares.
  .superRefine((row, ctx) => {
    const result = safeParseCatalogRuleParams(row.ruleType, row.params);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ['params', ...issue.path] });
      }
    }
  });

export type CatalogRuleWriteInput = z.input<typeof catalogRuleWriteSchema>;
export type CatalogRuleWrite = z.output<typeof catalogRuleWriteSchema>;

// =============================================================================
// ADD-ON GROUP SELECTION BOUNDS
// =============================================================================

/**
 * The selection bound stored on `add_on_group`, mirroring 0073's CHECKs.
 *
 * `maxSelections: null` means unlimited; `1` is what a later PR renders as a
 * single-select group. Nothing here counts a client's actual selection — this
 * validates the BOUND, not a choice made against it.
 */
export const addOnGroupBoundsSchema = z.object({
  minSelections: z.number().int().min(0).default(0),
  maxSelections: z.number().int().min(1).nullable().default(null),
}).refine(
  bounds => bounds.maxSelections === null || bounds.maxSelections >= bounds.minSelections,
  {
    message: 'maxSelections must be at least minSelections, or null for unlimited.',
    path: ['maxSelections'],
  },
);

export type AddOnGroupBounds = z.output<typeof addOnGroupBoundsSchema>;

/** True when a group means "pick exactly one" — the radio presentation. */
export function isSingleSelectGroup(bounds: AddOnGroupBounds): boolean {
  return bounds.maxSelections === 1;
}
