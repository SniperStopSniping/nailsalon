import type {
  CatalogRulePresentation,
  CatalogRuleReasonCode,
} from '@/libs/catalogRuleContract';
import { CATALOG_RULE_REASON_CODES } from '@/libs/catalogRuleContract';
import type { EffectiveConfirmationMode } from '@/libs/confirmationMode';
import type {
  AddOnCategory,
  AddOnPricingType,
  ServiceAddOnSelectionMode,
  ServiceCategory,
} from '@/models/Schema';

/**
 * Luster L1 PR3 — the shared vocabulary for the catalog resolver.
 *
 * This module is PURE and BROWSER-COMPATIBLE: no `@/libs/DB`, no
 * `server-only`, no I/O, no `node:crypto`. It defines TYPES and small
 * deterministic constants only — every function here is a pure computation
 * over its arguments. Nothing in this file is wired into a booking path,
 * an owner surface, or a feature gate; see `catalogResolverCore.ts` for the
 * engine that actually consumes these types.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It is not a resolver. It does not read `catalog_rule` rows, does not know
 * about a database, and does not decide what a client sees. It is the
 * shared alphabet `catalogResolverCore.ts`, `catalogRuleGraph.ts` and
 * `confirmationMode.ts` all speak, so those three never have to invent
 * competing shapes for the same idea.
 *
 * BINDING SEMANTICS (Owner ruling — do not reinterpret here either)
 *
 *   - `include` = BUNDLING. Selecting the subject may bring the object
 *     add-on into the resolved selection, including auto-add when
 *     `params.autoAdd` is true.
 *   - `requires` = VALIDATION. The relationship must be satisfied.
 *     `requires` does NOT auto-add anything.
 *   - `presentation` is exactly `surface | silent` — see
 *     `catalogRuleContract.ts`. There is no `hide`/`disable` presentation
 *     value and no second interpretation of `include`.
 *
 * CAPABILITY PRIVACY
 *
 * `CatalogRuleCoreInput` below deliberately has no `capabilityId` field. A
 * `requires_capability` row is represented by the boolean
 * `hasCapabilityRequirement`, never by the capability's actual id. That is
 * enforced by this type's shape, not merely by convention: nothing in
 * `catalogResolverCore.ts` can leak a capability id it was never given. The
 * server wrapper that reads `catalog_rule` and performs that
 * `capabilityId -> boolean` narrowing is later, out-of-scope work.
 * `requires_capability` also never produces a `PublicCatalogRuleProjection`
 * — see that type's doc comment.
 *
 * FINGERPRINTING LIVES ELSEWHERE
 *
 * `CatalogRevision.canonical` is produced here (via `catalogResolverCore.ts`
 * calling `catalogFingerprint.ts`'s `stableStringify`), but hashing it into
 * `CatalogRevision.fingerprint` is a SHA-256 operation that must run
 * asynchronously (`crypto.subtle.digest` in a browser) — see
 * `catalogFingerprint.ts` (Web Crypto, browser-safe) and
 * `catalogFingerprint.server.ts` (Node `crypto`, server-only).
 */

// =============================================================================
// PUBLIC RULE PROJECTION EFFECTS
// =============================================================================

/**
 * The bounded vocabulary a projected rule effect may take. This is NOT the
 * same set as `CATALOG_RULE_TYPES` (six rule types project onto — at most —
 * these five effects; see `catalogResolverCore.ts` for the mapping and for
 * which rule-type configurations are unproducible).
 *
 * `hide` is currently UNPRODUCED by any of the six rule types — `exclude`
 * projects `disable` (the object add-on stays visible, with a reason, per
 * migration 0073's own wording: it becomes "unavailable", not vanished; a
 * hidden element would also have nowhere to carry the no-silent-material-
 * change explanation). `hide` stays in this union for a future rule type
 * that genuinely needs to remove an option from view rather than disable it.
 */
export const CATALOG_PROJECTION_EFFECTS = [
  'hide',
  'disable',
  'require',
  'auto_add',
  'limit_quantity',
] as const;

export type CatalogProjectionEffect = typeof CATALOG_PROJECTION_EFFECTS[number];

/**
 * What selection triggers a projected rule. Public-safe: an id and a kind,
 * nothing else. Never the internal `catalog_rule.id`.
 */
export type CatalogRuleTrigger = {
  subjectKind: 'service' | 'addOn';
  subjectId: string;
};

/**
 * Bounded public copy for each reason code, keyed by the SAME enum
 * `catalogRuleContract.ts` already defines. This is the only place static
 * client-facing prose for a reason code lives — a client renders the code,
 * or this text, never owner-authored `catalog_rule.note`.
 */
export const CATALOG_RULE_REASON_TEXT: Record<CatalogRuleReasonCode, string> = {
  included_with_selection: 'Included automatically with your selection.',
  required_for_selection: 'Required for this selection.',
  unavailable_with_selection: 'Not available with your current selection.',
  quantity_limited: 'Quantity limited for this selection.',
  capability_required: 'Requires a technician with a specific skill.',
};

/**
 * A rule's own `params.reasonCode` is optional (see `catalogRuleContract.ts`
 * `sharedParamsShape`). When a row omits it, the projection still needs a
 * STABLE, TYPED reason code — never free text and never a hash. This map is
 * that deterministic fallback, keyed by the projected effect.
 *
 * `requires_capability` never reaches this map: it produces no public
 * projection at all (see `catalogResolverCore.ts`'s `deriveProjectionEffect`)
 * — its `capability_required` reason code is applied directly by
 * `resolveCatalogSelection`, driven entirely by the server wrapper's
 * eligibility answer, never by a projected rule.
 */
export const DEFAULT_REASON_CODE_BY_EFFECT: Record<CatalogProjectionEffect, CatalogRuleReasonCode> = {
  hide: 'unavailable_with_selection',
  disable: 'unavailable_with_selection',
  require: 'required_for_selection',
  auto_add: 'included_with_selection',
  limit_quantity: 'quantity_limited',
};

/** Defensive: keeps the two maps above from silently drifting apart. */
export function isCatalogRuleReasonCode(value: unknown): value is CatalogRuleReasonCode {
  return typeof value === 'string' && (CATALOG_RULE_REASON_CODES as readonly string[]).includes(value);
}

/**
 * The public projection of one `catalog_rule` row: an opaque, deterministic
 * key, the effect it produces, what triggers it, and bounded reason
 * metadata. Deliberately excludes: the internal rule id, `priority`,
 * `note`, raw `params`, and any capability id.
 *
 * `requires_capability` NEVER produces one of these — see
 * `deriveProjectionEffect` in `catalogResolverCore.ts`. Capability handling
 * is entirely the server wrapper's job: it alone knows the technician
 * capability graph, and returns only a bounded, already-decided eligibility
 * outcome to `resolveCatalogSelection`. A public projection with no
 * `targetAddOnId` would otherwise advertise "a hidden gate exists here" —
 * exactly the kind of structural leak this DTO exists to prevent.
 */
export type PublicCatalogRuleProjection = {
  /** Opaque and deterministic — derived from the rule's public-safe shape, never the internal row id. */
  projectionKey: string;
  effect: CatalogProjectionEffect;
  trigger: CatalogRuleTrigger;
  /** Mirrors `catalog_rule.service_id`: null means salon-wide scope. */
  serviceScopeId: string | null;
  /** Present for every effect this DTO can carry — `disable`, `hide` (currently unproduced), `auto_add`, `limit_quantity`, and `require` (from a `requires` row; `requires_capability` never reaches this type at all). */
  targetAddOnId?: string;
  /** Present only for `limit_quantity`. */
  maxQuantity?: number;
  reasonCode: CatalogRuleReasonCode;
  reasonText: string;
  presentation: CatalogRulePresentation;
};

// =============================================================================
// FLAT PUBLIC CATALOG DTO
// =============================================================================

/**
 * A legacy ungrouped service is representable AS ITSELF — `kind: 'legacy'`
 * — never wrapped in a synthetic "family" object. `parent` and `child` are
 * likewise flat entries in the same `services` array, linked by
 * `parentServiceId`. There is no nested family tree anywhere in this DTO.
 */
export type PublicCatalogServiceKind = 'legacy' | 'parent' | 'child';

/**
 * The spread of price/duration a service family can cost, derived from the
 * parent's own price/duration plus every child's — the parent is
 * independently bookable, so its own figures are part of the range, not
 * excluded from it. Only ever present on a `kind: 'parent'` entry.
 */
export type PublicCatalogRangeSummary = {
  minPriceCents: number;
  maxPriceCents: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
};

export type PublicCatalogService = {
  id: string;
  kind: PublicCatalogServiceKind;
  name: string;
  slug: string | null;
  category: ServiceCategory;
  descriptionItems: string[] | null;
  priceCents: number;
  priceDisplayText: string | null;
  durationMinutes: number;
  isIntroPrice: boolean;
  introPriceLabel: string | null;
  introPriceExpiresAt: Date | null;
  /** Null for `legacy` and `parent`; the parent's id for `child`. */
  parentServiceId: string | null;
  /** Null unless `kind: 'child'`. */
  variantLabel: string | null;
  /** Null unless `kind: 'parent'`. */
  variantKind: string | null;
  selectionMode: 'direct' | 'guided' | null;
  /** Resolved by `confirmationMode.ts` — always one of the three values, never null. */
  effectiveConfirmationMode: EffectiveConfirmationMode;
  /**
   * The SAME resolved value as `effectiveConfirmationMode`, but ONLY when it
   * came from a real stored value — this service's own `confirmationMode`,
   * or (for a `child`) its parent's — never the `DEFAULT_EFFECTIVE_
   * CONFIRMATION_MODE` fallback a legacy NULL row resolves to. `null` means
   * "this is the default, not an owner decision".
   *
   * Exists so `catalogResolutionFingerprint` (`catalogResolverCore.ts`) can
   * tell a genuinely-legacy service (NULL everywhere in its family) apart
   * from one an owner explicitly set to `'instant'` — `effectiveConfirmationMode`
   * alone cannot, since both resolve to the identical `'instant'` value.
   * Two materially different configurations must never collide in that
   * fingerprint.
   */
  explicitConfirmationMode: EffectiveConfirmationMode | null;
  /** Only ever non-null on a `kind: 'parent'` entry with at least one child. */
  rangeSummary: PublicCatalogRangeSummary | null;
};

export type PublicCatalogAddOnGroup = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  minSelections: number;
  maxSelections: number | null;
  isSingleSelect: boolean;
  sortOrder: number;
};

export type PublicCatalogAddOn = {
  id: string;
  name: string;
  slug: string;
  category: AddOnCategory;
  descriptionItems: string[] | null;
  priceCents: number;
  priceDisplayText: string | null;
  durationMinutes: number;
  pricingType: AddOnPricingType;
  unitLabel: string | null;
  /**
   * The add-on's OWN ceiling before any per-service override or catalog
   * rule — `1` for a non-`per_unit` add-on, or `addOn.maxQuantity ?? 10` for
   * `per_unit` (mirroring `bookingQuote.ts`'s own inherited default; see
   * `baseMaxQuantity` in `catalogResolverCore.ts`). A
   * `PublicServiceAddOnBinding.effectiveMaxQuantity` is ALWAYS authoritative
   * when a binding exists between this add-on and the service in question;
   * this field is the correct fallback only when one does not — e.g. an
   * add-on auto-added by an `include` rule with no matching
   * `service_add_on` row for that service.
   */
  baseMaxQuantity: number;
  /** Null when the add-on is ungrouped — a perfectly valid, legacy-compatible state. */
  groupId: string | null;
};

/**
 * A public-safe service -> add-on binding. `effectiveMaxQuantity` is the
 * ALREADY-RESOLVED ceiling (base semantics -> `maxQuantityOverride` -> an
 * applicable tightening `max_quantity` rule); the browser must never
 * reproduce that precedence chain itself. Always a concrete number — every
 * add-on has SOME ceiling (an unset `per_unit` ceiling inherits the same `10`
 * `bookingQuote.ts` falls back to; a non-`per_unit` add-on's ceiling is
 * always exactly `1`) — see `baseMaxQuantity` in `catalogResolverCore.ts`.
 */
export type PublicServiceAddOnBinding = {
  serviceId: string;
  addOnId: string;
  /** Deterministic — see the tiebreak note in `catalogResolverCore.ts`; never a bare positional index. */
  displayOrder: number;
  selectionMode: ServiceAddOnSelectionMode;
  defaultQuantity: number | null;
  effectiveMaxQuantity: number;
};

/**
 * Content-derived identity for a resolved catalog, used to gate a
 * concurrency/conflict decision at submission time (has the catalog changed
 * since a client loaded it?). `canonical` is produced SYNCHRONOUSLY by
 * `catalogResolverCore.ts` — it is what `catalogFingerprint.ts`'s
 * `stableStringify` returns over the snapshot's own public content.
 * `fingerprint` is the SHA-256 hex digest of that canonical string's UTF-8
 * bytes, computed by a SEPARATE ASYNC step (`finalizeCatalogRevision`) —
 * deliberately not by this synchronous core, because a browser's only SHA-256
 * (`crypto.subtle.digest`) is inherently async. It is absent until that step
 * runs, which happens once, at submission, never on every keystroke.
 */
export type CatalogRevision = {
  canonical: string;
  fingerprint?: string;
};

export type PublicCatalogCurrency = 'CAD' | 'USD';

export type PublicCatalogSnapshot = {
  revision: CatalogRevision;
  /** ISO-8601 instant this snapshot was assembled. */
  generatedAt: string;
  currency: PublicCatalogCurrency;
  services: PublicCatalogService[];
  addOnGroups: PublicCatalogAddOnGroup[];
  addOns: PublicCatalogAddOn[];
  serviceAddOnBindings: PublicServiceAddOnBinding[];
  /** Flat, top-level — filter by `serviceScopeId` at resolve time rather than nesting per service. */
  ruleProjections: PublicCatalogRuleProjection[];
};

// =============================================================================
// VIOLATIONS — stable semantic anchors, never positional array paths
// =============================================================================

export type CatalogViolationAnchor =
  | { kind: 'family'; serviceId: string }
  | { kind: 'service'; serviceId: string }
  | { kind: 'variant'; serviceId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'addOn'; addOnId: string }
  | { kind: 'quantity'; addOnId: string }
  | { kind: 'technician'; technicianId: string | null }
  | { kind: 'summary' };

export type CatalogViolation =
  | { code: 'addon_unavailable'; anchor: CatalogViolationAnchor }
  | { code: 'quantity_exceeded'; anchor: CatalogViolationAnchor; limit: number; attempted: number }
  | { code: 'group_selection_below_minimum'; anchor: CatalogViolationAnchor; minimum: number; selected: number }
  | { code: 'group_selection_above_maximum'; anchor: CatalogViolationAnchor; maximum: number; selected: number }
  | { code: 'required_dependency_unmet'; anchor: CatalogViolationAnchor }
  | { code: 'mutually_exclusive_conflict'; anchor: CatalogViolationAnchor }
  | { code: 'capability_unavailable'; anchor: CatalogViolationAnchor };

/**
 * Structural corruption in the CATALOG DATA ITSELF (as opposed to a client's
 * selection, which produces `CatalogViolation`s instead). Fail-closed: the
 * resolver returns one of these rather than guessing at what a malformed
 * `catalog_rule` row, or a cyclic auto-add chain, was supposed to mean.
 */
export type CatalogCorruptionCode =
  | 'unknown_rule_type'
  | 'invalid_rule_params'
  | 'missing_referenced_object'
  | 'inactive_referenced_object'
  | 'invalid_subject_shape'
  | 'invalid_object_shape'
  | 'cyclic_auto_add';

export type CatalogCorruptionFailure = {
  code: CatalogCorruptionCode;
  anchor: CatalogViolationAnchor;
};

// =============================================================================
// EXPLANATIONS — the no-silent-material-change invariant
// =============================================================================

/**
 * Every projected effect that actually fires against a concrete selection
 * produces exactly one of these, UNCONDITIONALLY — including when
 * `presentation: 'silent'`. `presentation` is metadata a consumer may use to
 * decide how prominently to surface the explanation; it is never a signal
 * to omit the explanation from the result. See
 * `resolveCatalogSelection`'s tests for the invariant this encodes.
 */
export type CatalogExplanationKind =
  | 'add_on_auto_added'
  | 'add_on_required'
  | 'add_on_unavailable'
  | 'quantity_limited'
  | 'capability_required';

export type CatalogExplanation = {
  kind: CatalogExplanationKind;
  anchor: CatalogViolationAnchor;
  reasonCode: CatalogRuleReasonCode;
  reasonText: string;
  presentation: CatalogRulePresentation;
};

// =============================================================================
// RULE INPUT CONTRACT (capability-privacy boundary)
// =============================================================================

/**
 * What `catalogResolverCore.ts` accepts in place of a raw `catalog_rule`
 * row. The one deliberate omission is `capabilityId`: a `requires_capability`
 * row is represented by the boolean `hasCapabilityRequirement`, so the core
 * cannot leak a capability id it was structurally never given. `note` is
 * likewise omitted — it is owner-facing and irrelevant to resolution.
 *
 * `ruleType` and `params` are deliberately typed loosely (`string`,
 * `unknown`) rather than pre-narrowed: validating them — and failing closed
 * on an unknown type or a malformed shape — is the core's job, exercised
 * against exactly this input.
 */
export type CatalogRuleCoreInput = {
  /** Internal only. Never echoed into any DTO, projection, explanation or violation. */
  id: string;
  ruleType: string;
  /** Mirrors `catalog_rule.service_id`. Null = salon-wide. */
  serviceScopeId: string | null;
  subjectServiceId: string | null;
  subjectAddOnId: string | null;
  objectAddOnId: string | null;
  /** True iff this row is a `requires_capability` row with a capability assigned. Never the id itself. */
  hasCapabilityRequirement: boolean;
  params: unknown;
  priority: number;
  isActive: boolean;
};

/** One line of a client's requested selection, before resolution. */
export type CatalogSelectedAddOnInput = {
  addOnId: string;
  quantity?: number;
};

export type CatalogSelectionInput = {
  serviceId: string;
  technicianId?: string | null;
  selectedAddOns: CatalogSelectedAddOnInput[];
};

/**
 * Already-derived, public-safe technician eligibility for the CURRENT
 * selection — computed by a server wrapper that DOES have capability data.
 * `undefined`/omitted means "not evaluated"; the core treats that as "no
 * opinion" rather than as a failure, since PR3 ships no such wrapper yet.
 */
export type CatalogEligibilityInput = {
  technicianEligible?: boolean;
};

// =============================================================================
// RESOLVED SELECTION
// =============================================================================

export type ResolvedCatalogAddOnLine = {
  addOnId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  unitDurationMinutes: number;
  lineDurationMinutes: number;
  /** True when this line was not in the client's own selection and was added by an `include` rule with `autoAdd: true`. */
  autoAdded: boolean;
};

export type ResolvedCatalogSelection = {
  serviceId: string;
  basePriceCents: number;
  baseDurationMinutes: number;
  addOns: ResolvedCatalogAddOnLine[];
  subtotalCents: number;
  totalDurationMinutes: number;
  explanations: CatalogExplanation[];
  violations: CatalogViolation[];
  /** Derived convenience — `violations.length === 0`. A caller gates "Continue" on this rather than re-deriving it. */
  blocksContinue: boolean;
};

export type CatalogResolutionResult =
  | { ok: true; selection: ResolvedCatalogSelection }
  | { ok: false; failure: CatalogCorruptionFailure };

export type CatalogSnapshotResult =
  | { ok: true; snapshot: PublicCatalogSnapshot }
  | { ok: false; failure: CatalogCorruptionFailure };

// =============================================================================
// RESOLUTION FINGERPRINT — SELECTION-level, distinct from CatalogRevision
// =============================================================================

/**
 * Bumped only when the SHAPE of `CatalogResolutionFingerprintInput` changes,
 * so a fingerprint computed under an older shape can never be compared —
 * and mistaken as equal or unequal — against one computed under a newer one.
 */
export const CATALOG_RESOLUTION_FINGERPRINT_SCHEMA_VERSION = 1;

export type CatalogResolutionFingerprintAddOnLine = {
  addOnId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  unitDurationMinutes: number;
  lineDurationMinutes: number;
};

/**
 * `reasonCode` only — never `reasonText`. This is what makes "a localized
 * (en -> fr) reason swap must not move the fingerprint" true BY THE SHAPE
 * ITSELF, not by a filter applied after the fact: there is no field here
 * for translated prose to occupy.
 */
export type CatalogResolutionFingerprintAutoAddition = {
  addOnId: string;
  reasonCode: CatalogRuleReasonCode;
};

/**
 * The MATERIAL subset of ONE RESOLVED SELECTION — never a whole snapshot.
 * Answers "did THIS customer's configuration materially change?", the
 * selection-level counterpart to `CatalogRevision` (`revision.canonical` /
 * `.fingerprint`), which answers the SNAPSHOT-level question "did the
 * salon's catalog change?". This is the value that gates a
 * `409 CATALOG_SELECTION_CHANGED` conflict at submission time; `CatalogRevision`
 * gates a different, coarser conflict.
 *
 * Built by `buildCatalogResolutionFingerprintInput` (`catalogResolverCore.ts`)
 * from a `ResolvedCatalogSelection` plus the `PublicCatalogSnapshot` it was
 * resolved against — never re-implemented ad hoc by a caller — and hashed
 * via the SAME SHA-256 rails as `CatalogRevision`
 * (`hashCatalogFingerprintWebCrypto` / `hashCatalogFingerprintNode`), so
 * browser and server agree on identical bytes.
 *
 * Deliberately EXCLUDES: `generatedAt`, any localized or presentational text
 * (`reasonText`, `presentation`), internal rule ids, `projectionKey`,
 * analytics, and private capability metadata — none of those fields are
 * reachable from this type's shape at all, not merely omitted by
 * convention.
 */
export type CatalogResolutionFingerprintInput = {
  schemaVersion: number;
  /**
   * Null for a legacy flat service (`kind: 'legacy'`) — there is no family,
   * and none is invented. For a `parent` or `child`, this is the FAMILY's
   * id (the parent's own id either way).
   */
  familyId: string | null;
  /**
   * The concrete service actually selected — the legacy service's own id,
   * the parent's own id (when the parent itself is booked directly), or the
   * child's own id. Always present; this is what carries a legacy service's
   * identity now that `familyId` cannot.
   */
  selectedVariantId: string;
  /** Every resolved add-on line — client-selected AND auto-added alike. */
  addOns: CatalogResolutionFingerprintAddOnLine[];
  /** Which of the lines above were auto-added, and why (code only). */
  autoAdditions: CatalogResolutionFingerprintAutoAddition[];
  catalogSubtotalCents: number;
  totalDurationMinutes: number;
  /** See `PublicCatalogService.explicitConfirmationMode` — null means "the default", never a real owner decision. */
  explicitConfirmationMode: EffectiveConfirmationMode | null;
};

export type CatalogResolutionFingerprint = {
  canonical: string;
  fingerprint?: string;
};

// =============================================================================
// SMALL DETERMINISTIC COMPARATORS
// =============================================================================

/** Plain ordinal string comparison — deliberately not `localeCompare`, so the result is stable across environments/locales. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
