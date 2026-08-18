import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  CATALOG_RULE_REASON_TEXT,
  type CatalogCorruptionFailure,
  type CatalogEligibilityInput,
  type CatalogExplanation,
  type CatalogProjectionEffect,
  type CatalogResolutionResult,
  type CatalogRuleCoreInput,
  type CatalogRuleTrigger,
  type CatalogSelectionInput,
  type CatalogSnapshotResult,
  type CatalogViolation,
  type CatalogViolationAnchor,
  compareIds,
  DEFAULT_REASON_CODE_BY_EFFECT,
  type PublicCatalogAddOn,
  type PublicCatalogAddOnGroup,
  type PublicCatalogRangeSummary,
  type PublicCatalogRuleProjection,
  type PublicCatalogService,
  type PublicCatalogServiceKind,
  type PublicCatalogSnapshot,
  type PublicServiceAddOnBinding,
  type ResolvedCatalogAddOnLine,
  type ResolvedCatalogSelection,
} from '@/libs/catalogDomain';
import { canonicalizeCatalogPayload, catalogCanonicalBytes } from '@/libs/catalogFingerprint';
import {
  addOnGroupBoundsSchema,
  CATALOG_RULE_TYPES,
  type CatalogRuleParams,
  type CatalogRuleType,
  isSingleSelectGroup,
  safeParseCatalogRuleParams,
} from '@/libs/catalogRuleContract';
import {
  type CatalogAutoAddEdge,
  type CatalogAutoAddNode,
  detectAutoAddCycle,
  expandAutoAddClosure,
} from '@/libs/catalogRuleGraph';
import { resolveEffectivePublicConfirmationMode } from '@/libs/confirmationMode';
import type {
  AddOn,
  AddOnGroup,
  Service,
  ServiceAddOn,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

/**
 * Luster L1 PR3 — the shared pure catalog-resolver core.
 *
 * DETERMINISTIC, SYNCHRONOUS, DB-FREE, SERVER-SECRET-FREE, BROWSER-COMPATIBLE.
 * No `@/libs/DB`, no `server-only`, no tenant auth, no capability loading. It
 * knows nothing about how its inputs were fetched — a caller (a later PR,
 * out of scope here) loads services/add-ons/groups/bindings/rules from
 * Postgres and hands them to `buildPublicCatalogSnapshot`; the same or a
 * different caller hands a client's selection to `resolveCatalogSelection`.
 * Nothing here is invoked from a production path in this PR.
 *
 * TWO ENTRY POINTS
 *
 *   `buildPublicCatalogSnapshot` — turns raw salon rows into the flat public
 *   DTO defined in `catalogDomain.ts`: identity (legacy/parent/child),
 *   inheritance, groups, resolved add-on ceilings, and the declarative rule
 *   projection list. Fails closed (returns `{ ok: false, failure }`) on
 *   corrupt rule data rather than guessing.
 *
 *   `resolveCatalogSelection` — given a snapshot and a client's selection,
 *   computes auto-add expansion, quantity/group/dependency validation, and
 *   an atomic set of explanations + violations. Also fails closed.
 *
 * A THIRD, ASYNC FUNCTION: `finalizeCatalogRevision`
 *
 * `buildPublicCatalogSnapshot` computes `revision.canonical` synchronously,
 * but never hashes it — SHA-256 (`crypto.subtle.digest` in a browser) is
 * inherently async, and the core must stay synchronous. `finalizeCatalogRevision`
 * is the deliberately separate async step that turns `revision.canonical`
 * into `revision.fingerprint`, run once at submission time against either
 * `hashCatalogFingerprintWebCrypto` (`catalogFingerprint.ts`) or
 * `hashCatalogFingerprintNode` (`catalogFingerprint.server.ts`).
 */

// =============================================================================
// SNAPSHOT BUILDING
// =============================================================================

export type BuildPublicCatalogSnapshotInput = {
  salonSettings: SalonSettings | null | undefined;
  /** ALL services for the salon, active and inactive — inactive rows are needed to validate rule references, but never appear in the output. */
  services: Service[];
  addOnGroups: AddOnGroup[];
  addOns: AddOn[];
  serviceAddOnBindings: ServiceAddOn[];
  rules: CatalogRuleCoreInput[];
  now?: Date;
};

type ValidatedRule = {
  rule: CatalogRuleCoreInput;
  ruleType: CatalogRuleType;
  subjectKind: 'service' | 'addOn';
  subjectId: string;
  parsedParams: CatalogRuleParams;
};

function fail(code: CatalogCorruptionFailure['code'], anchor: CatalogViolationAnchor): CatalogCorruptionFailure {
  return { code, anchor };
}

function subjectAnchor(rule: CatalogRuleCoreInput): CatalogViolationAnchor {
  if (rule.subjectServiceId) {
    return { kind: 'service', serviceId: rule.subjectServiceId };
  }
  if (rule.subjectAddOnId) {
    return { kind: 'addOn', addOnId: rule.subjectAddOnId };
  }
  return { kind: 'summary' };
}

function isKnownRuleType(value: string): value is CatalogRuleType {
  return (CATALOG_RULE_TYPES as readonly string[]).includes(value);
}

/**
 * Validates and normalizes every ACTIVE rule row. Inactive rows are inert —
 * `is_active` is this schema's soft-disable throughout (`add_on_group`,
 * `capability`, `catalog_rule` all follow it) — so a deactivated rule is
 * treated as if it does not exist at all, including for fail-closed
 * purposes: deactivating a bad row is how an owner fixes it without losing
 * history, and must not itself keep tripping the failure path.
 */
function validateRules(
  rules: CatalogRuleCoreInput[],
  serviceById: Map<string, Service>,
  addOnById: Map<string, AddOn>,
): { ok: true; validated: ValidatedRule[] } | { ok: false; failure: CatalogCorruptionFailure } {
  const validated: ValidatedRule[] = [];

  for (const rule of rules.filter(r => r.isActive)) {
    if (!isKnownRuleType(rule.ruleType)) {
      return { ok: false, failure: fail('unknown_rule_type', subjectAnchor(rule)) };
    }
    const ruleType = rule.ruleType;

    const hasSubjectService = rule.subjectServiceId !== null;
    const hasSubjectAddOn = rule.subjectAddOnId !== null;
    if (hasSubjectService === hasSubjectAddOn) {
      // Both set or both null — the XOR the database enforces at write time.
      return { ok: false, failure: fail('invalid_subject_shape', subjectAnchor(rule)) };
    }

    const isCapabilityRule = ruleType === 'requires_capability';
    const objectShapeValid = isCapabilityRule
      ? rule.hasCapabilityRequirement && rule.objectAddOnId === null
      : !rule.hasCapabilityRequirement && rule.objectAddOnId !== null;
    if (!objectShapeValid) {
      return { ok: false, failure: fail('invalid_object_shape', subjectAnchor(rule)) };
    }

    if (rule.subjectAddOnId !== null && rule.objectAddOnId !== null && rule.subjectAddOnId === rule.objectAddOnId) {
      return { ok: false, failure: fail('invalid_object_shape', subjectAnchor(rule)) };
    }

    const parsedParamsResult = safeParseCatalogRuleParams(ruleType, rule.params);
    if (!parsedParamsResult.success) {
      return { ok: false, failure: fail('invalid_rule_params', subjectAnchor(rule)) };
    }

    // Reference validation: every named service/add-on must exist and be active.
    const referenceChecks: Array<{ id: string | null; anchor: (id: string) => CatalogViolationAnchor; lookup: Map<string, { isActive: boolean | null }> }> = [
      { id: rule.serviceScopeId, anchor: id => ({ kind: 'service', serviceId: id }), lookup: serviceById },
      { id: rule.subjectServiceId, anchor: id => ({ kind: 'service', serviceId: id }), lookup: serviceById },
      { id: rule.subjectAddOnId, anchor: id => ({ kind: 'addOn', addOnId: id }), lookup: addOnById },
      { id: rule.objectAddOnId, anchor: id => ({ kind: 'addOn', addOnId: id }), lookup: addOnById },
    ];
    for (const check of referenceChecks) {
      if (check.id === null) {
        continue;
      }
      const found = check.lookup.get(check.id);
      if (!found) {
        return { ok: false, failure: fail('missing_referenced_object', check.anchor(check.id)) };
      }
      if (found.isActive === false) {
        return { ok: false, failure: fail('inactive_referenced_object', check.anchor(check.id)) };
      }
    }

    validated.push({
      rule,
      ruleType,
      subjectKind: hasSubjectService ? 'service' : 'addOn',
      subjectId: (rule.subjectServiceId ?? rule.subjectAddOnId)!,
      parsedParams: parsedParamsResult.data,
    });
  }

  return { ok: true, validated };
}

/**
 * Six rule types, at most five public effects. See the PR report for the
 * full table; the two non-obvious rows:
 *
 *   - `include` only projects when `autoAdd` is true (-> `auto_add`). A
 *     plain `include` merely OFFERS the add-on (the Owner ruling in
 *     `catalogDomain.ts`) and produces no projection at all.
 *   - `requires_capability` NEVER projects. The ratified truth table marks
 *     it server-only: a public `require` with no `targetAddOnId` would
 *     itself announce "a hidden eligibility gate exists here", which is
 *     exactly the leak `hasCapabilityRequirement` (a boolean, never the
 *     capability id) exists to avoid one layer down. Capability handling is
 *     entirely the server wrapper's job — see `resolveCatalogSelection`'s
 *     standalone `eligibility.technicianEligible` check, which does not
 *     read `ruleProjections` at all.
 *
 * `exclude` and `mutually_exclusive` BOTH project `disable`: migration
 * 0073 describes `exclude` as making the object add-on "unavailable", not
 * hidden, and a hidden element has nowhere to carry the no-silent-material-
 * change explanation. `hide` is consequently unproduced by every current
 * rule type; it stays in `CATALOG_PROJECTION_EFFECTS` for a future one.
 */
function deriveProjectionEffect(ruleType: CatalogRuleType, autoAdd: boolean): CatalogProjectionEffect | null {
  switch (ruleType) {
    case 'include':
      return autoAdd ? 'auto_add' : null;
    case 'exclude':
      return 'disable';
    case 'requires':
      return 'require';
    case 'mutually_exclusive':
      return 'disable';
    case 'max_quantity':
      return 'limit_quantity';
    case 'requires_capability':
      return null;
    default:
      return null;
  }
}

/**
 * An opaque, deterministic correlation key for one projection — NOT a
 * content hash. It is built from fields that are ALREADY public on this same
 * projection object (`effect`, `serviceScopeId`, the trigger, the target),
 * so encoding them again here reveals nothing new; the one thing it must
 * never be is the internal `catalog_rule.id`, which it structurally cannot
 * be, since that id is never one of its inputs. Kept deliberately
 * hash-free — and therefore synchronous — because this key is needed
 * immediately, inside the synchronous core, unlike the catalog-wide revision
 * fingerprint (`finalizeCatalogRevision`), which gates a real
 * concurrency/conflict decision and is computed asynchronously with SHA-256.
 */
function buildProjectionKey(parts: {
  effect: CatalogProjectionEffect;
  serviceScopeId: string | null;
  subjectKind: 'service' | 'addOn';
  subjectId: string;
  targetAddOnId: string | null;
}): string {
  const encode = (value: string) => value.replaceAll('.', '_dot_');
  return [
    'pk',
    parts.effect,
    parts.serviceScopeId ? encode(parts.serviceScopeId) : 'salon',
    parts.subjectKind,
    encode(parts.subjectId),
    parts.targetAddOnId ? encode(parts.targetAddOnId) : 'none',
  ].join('.');
}

function buildRuleProjections(validated: ValidatedRule[]): PublicCatalogRuleProjection[] {
  const projections: PublicCatalogRuleProjection[] = [];

  for (const entry of validated) {
    const { rule, ruleType, parsedParams } = entry;
    const autoAdd = ruleType === 'include' && (parsedParams as CatalogRuleParams<'include'>).autoAdd === true;
    const effect = deriveProjectionEffect(ruleType, autoAdd);
    if (!effect) {
      continue;
    }

    const reasonCode = parsedParams.reasonCode ?? DEFAULT_REASON_CODE_BY_EFFECT[effect];
    const presentation = parsedParams.presentation ?? 'surface';
    const trigger: CatalogRuleTrigger = { subjectKind: entry.subjectKind, subjectId: entry.subjectId };

    const projection: PublicCatalogRuleProjection = {
      projectionKey: buildProjectionKey({
        effect,
        serviceScopeId: rule.serviceScopeId,
        subjectKind: entry.subjectKind,
        subjectId: entry.subjectId,
        targetAddOnId: rule.objectAddOnId,
      }),
      effect,
      trigger,
      serviceScopeId: rule.serviceScopeId,
      reasonCode,
      reasonText: CATALOG_RULE_REASON_TEXT[reasonCode],
      presentation,
    };
    if (rule.objectAddOnId) {
      projection.targetAddOnId = rule.objectAddOnId;
    }
    if (effect === 'limit_quantity') {
      projection.maxQuantity = (parsedParams as CatalogRuleParams<'max_quantity'>).maxQuantity;
    }

    projections.push(projection);
  }

  return projections;
}

function buildAutoAddEdges(validated: ValidatedRule[]): CatalogAutoAddEdge[] {
  const edges: CatalogAutoAddEdge[] = [];
  for (const entry of validated) {
    if (entry.ruleType !== 'include') {
      continue;
    }
    const autoAdd = (entry.parsedParams as CatalogRuleParams<'include'>).autoAdd === true;
    if (!autoAdd || !entry.rule.objectAddOnId) {
      continue;
    }
    edges.push({
      from: { kind: entry.subjectKind, id: entry.subjectId },
      toAddOnId: entry.rule.objectAddOnId,
    });
  }
  return edges;
}

function determineServiceKind(
  service: Service,
  activeChildrenByParentId: Map<string, Service[]>,
): PublicCatalogServiceKind {
  if (service.parentServiceId) {
    return 'child';
  }
  const children = activeChildrenByParentId.get(service.id);
  return children && children.length > 0 ? 'parent' : 'legacy';
}

function computeRangeSummary(parent: Service, activeChildren: Service[]): PublicCatalogRangeSummary {
  const candidates = [parent, ...activeChildren];
  const prices = candidates.map(c => c.price);
  const durations = candidates.map(c => c.durationMinutes);
  return {
    minPriceCents: Math.min(...prices),
    maxPriceCents: Math.max(...prices),
    minDurationMinutes: Math.min(...durations),
    maxDurationMinutes: Math.max(...durations),
  };
}

/**
 * The effective per-item ceiling BEFORE any catalog `max_quantity` rule is
 * applied, mirroring `bookingQuote.ts`'s `validatePublicBookingSelection`
 * EXACTLY (lines ~470-481 of that file), which is the live, authoritative
 * server behaviour this must stay in parity with:
 *
 *   ```
 *   if (addOn.pricingType === 'per_unit') {
 *     const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
 *     if (quantity > maxQuantity) throw ...
 *   } else if (quantity !== 1) { throw ... }
 *   ```
 *
 * A non-`per_unit` (`fixed`) add-on's ceiling is always exactly `1` — the
 * server rejects any other quantity outright, not merely quantities above a
 * cap. A `per_unit` add-on's ceiling is `override ?? addOn.maxQuantity ?? 10`
 * — the `10` is INHERITED server behaviour for an unset ceiling, copied
 * verbatim rather than invented here, so a client can never be offered a
 * quantity the server would reject with `invalid_add_on`.
 */
function baseMaxQuantity(pricingType: string, addOnMaxQuantity: number | null, override: number | null): number {
  if (pricingType !== 'per_unit') {
    return 1;
  }
  return override ?? addOnMaxQuantity ?? 10;
}

/** A `max_quantity` rule may only TIGHTEN — never raise — whatever ceiling is already in force. */
function tighten(current: number, caps: number[]): number {
  return caps.length === 0 ? current : Math.min(current, ...caps);
}

function buildBindingsForService(
  serviceId: string,
  sourceRows: ServiceAddOn[],
  addOnById: Map<string, AddOn>,
  staticQuantityCapsByAddOnId: Map<string, number[]>,
): PublicServiceAddOnBinding[] {
  const usable = sourceRows.filter((row) => {
    const addOn = addOnById.get(row.addOnId);
    return addOn && addOn.isActive !== false;
  });

  // Deterministic tiebreak: `reconcileSalonServiceAddOnCompatibility`'s
  // legacy add-on-side path writes `displayOrder: 0` for every row it
  // creates, so the stored value alone is not always meaningful. Sorting by
  // (storedDisplayOrder, addOnId) first makes the resulting ARRAY order
  // deterministic regardless of that; re-numbering the OUTPUT `displayOrder`
  // field to the resolved 0-based rank (rather than passing the raw,
  // frequently-tied value through) means a consumer can trust the field
  // itself, without knowing about the tiebreak.
  const sorted = [...usable].sort((a, b) => {
    const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
    return orderDiff !== 0 ? orderDiff : compareIds(a.addOnId, b.addOnId);
  });

  return sorted.map((row, index) => {
    const addOn = addOnById.get(row.addOnId)!;
    // `maxQuantityOverride` only ever applies to a `per_unit` add-on —
    // `baseMaxQuantity` already ignores it for `fixed`, matching
    // `bookingQuote.ts`'s `else if (quantity !== 1)` branch, which never
    // consults `maxQuantityOverride` at all for a non-`per_unit` add-on.
    const base = baseMaxQuantity(addOn.pricingType, addOn.maxQuantity ?? null, row.maxQuantityOverride ?? null);
    const caps = staticQuantityCapsByAddOnId.get(row.addOnId) ?? [];
    const effectiveMaxQuantity = tighten(base, caps);

    return {
      serviceId,
      addOnId: row.addOnId,
      displayOrder: index,
      selectionMode: row.selectionMode,
      defaultQuantity: row.defaultQuantity ?? null,
      effectiveMaxQuantity,
    };
  });
}

export function buildPublicCatalogSnapshot(input: BuildPublicCatalogSnapshotInput): CatalogSnapshotResult {
  const now = input.now ?? new Date();
  const serviceById = new Map(input.services.map(s => [s.id, s]));
  const addOnById = new Map(input.addOns.map(a => [a.id, a]));

  const validation = validateRules(input.rules, serviceById, addOnById);
  if (!validation.ok) {
    return { ok: false, failure: validation.failure };
  }
  const { validated } = validation;

  const edges = buildAutoAddEdges(validated);
  const cycle = detectAutoAddCycle(edges);
  if (cycle) {
    const addOnNode = cycle.find(key => key.startsWith('addOn:'));
    const anchor: CatalogViolationAnchor = addOnNode
      ? { kind: 'addOn', addOnId: addOnNode.slice('addOn:'.length) }
      : { kind: 'summary' };
    return { ok: false, failure: fail('cyclic_auto_add', anchor) };
  }

  const ruleProjections = buildRuleProjections(validated);

  // Static (service-conditioned) quantity ceilings: a `max_quantity` rule
  // whose SUBJECT IS THE SERVICE ITSELF is unconditionally in force whenever
  // that service/add-on pairing is displayed, so it can be baked into the
  // declarative snapshot. A rule whose subject is a DIFFERENT add-on is
  // conditional on that add-on being selected — it cannot be a static fact
  // about the pairing, so `resolveCatalogSelection` applies it dynamically
  // from this same `ruleProjections` list instead. Both layers only ever
  // tighten, never loosen, and are combined with `Math.min`.
  const staticQuantityCapsByAddOnId = new Map<string, number[]>();
  for (const projection of ruleProjections) {
    if (
      projection.effect === 'limit_quantity'
      && projection.trigger.subjectKind === 'service'
      && projection.targetAddOnId
      && projection.maxQuantity !== undefined
      && (projection.serviceScopeId === null || projection.serviceScopeId === projection.trigger.subjectId)
    ) {
      const list = staticQuantityCapsByAddOnId.get(projection.targetAddOnId) ?? [];
      list.push(projection.maxQuantity);
      staticQuantityCapsByAddOnId.set(projection.targetAddOnId, list);
    }
  }

  const activeChildrenByParentId = new Map<string, Service[]>();
  for (const service of input.services) {
    if (service.parentServiceId && service.isActive !== false) {
      const list = activeChildrenByParentId.get(service.parentServiceId) ?? [];
      list.push(service);
      activeChildrenByParentId.set(service.parentServiceId, list);
    }
  }

  const bindingsByServiceId = new Map<string, ServiceAddOn[]>();
  for (const row of input.serviceAddOnBindings) {
    const list = bindingsByServiceId.get(row.serviceId) ?? [];
    list.push(row);
    bindingsByServiceId.set(row.serviceId, list);
  }

  const activeServices = input.services
    .filter(s => s.isActive !== false)
    .sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      return orderDiff !== 0 ? orderDiff : compareIds(a.id, b.id);
    });

  const services: PublicCatalogService[] = [];
  const serviceAddOnBindings: PublicServiceAddOnBinding[] = [];

  for (const service of activeServices) {
    const kind = determineServiceKind(service, activeChildrenByParentId);
    const parent = service.parentServiceId ? serviceById.get(service.parentServiceId) : undefined;

    const effectiveConfirmationMode = resolveEffectivePublicConfirmationMode({
      ownConfirmationMode: service.confirmationMode,
      parentConfirmationMode: parent?.confirmationMode ?? null,
    });

    const rangeSummary = kind === 'parent'
      ? computeRangeSummary(service, activeChildrenByParentId.get(service.id) ?? [])
      : null;

    services.push({
      id: service.id,
      kind,
      name: service.name,
      slug: service.slug ?? null,
      category: service.category,
      descriptionItems: normalizeDescriptionItemsLocal(service.descriptionItems),
      priceCents: service.price,
      priceDisplayText: service.priceDisplayText ?? null,
      durationMinutes: service.durationMinutes,
      isIntroPrice: service.isIntroPrice ?? false,
      introPriceLabel: service.introPriceLabel ?? null,
      introPriceExpiresAt: service.introPriceExpiresAt ?? null,
      parentServiceId: service.parentServiceId ?? null,
      variantLabel: service.variantLabel ?? null,
      variantKind: service.variantKind ?? null,
      selectionMode: normalizeSelectionMode(service.selectionMode),
      effectiveConfirmationMode,
      rangeSummary,
    });

    // A service that declares its own add-on bindings is authoritative — a
    // parent's rows never widen or merge with a child's own. Inheritance
    // only fills a COMPLETE gap (mirrors the same principle
    // `reconcileSalonServiceAddOnCompatibility` already applies to the
    // add-on-side legacy reconciliation path).
    const ownRows = bindingsByServiceId.get(service.id) ?? [];
    const sourceRows = ownRows.length > 0
      ? ownRows
      : (kind === 'child' && parent ? bindingsByServiceId.get(parent.id) ?? [] : []);

    serviceAddOnBindings.push(
      ...buildBindingsForService(service.id, sourceRows, addOnById, staticQuantityCapsByAddOnId),
    );
  }

  const addOnGroups: PublicCatalogAddOnGroup[] = input.addOnGroups
    .filter(g => g.isActive !== false)
    .sort((a, b) => {
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      return orderDiff !== 0 ? orderDiff : compareIds(a.id, b.id);
    })
    .map((group) => {
      const bounds = addOnGroupBoundsSchema.parse({
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
      });
      return {
        id: group.id,
        name: group.name,
        slug: group.slug,
        description: group.description ?? null,
        minSelections: bounds.minSelections,
        maxSelections: bounds.maxSelections,
        isSingleSelect: isSingleSelectGroup(bounds),
        sortOrder: group.sortOrder ?? 0,
      };
    });

  const addOns: PublicCatalogAddOn[] = input.addOns
    .filter(a => a.isActive !== false)
    .sort((a, b) => {
      const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      return orderDiff !== 0 ? orderDiff : compareIds(a.id, b.id);
    })
    .map(addOn => ({
      id: addOn.id,
      name: addOn.name,
      slug: addOn.slug,
      category: addOn.category,
      descriptionItems: normalizeDescriptionItemsLocal(addOn.descriptionItems),
      priceCents: addOn.priceCents,
      priceDisplayText: addOn.priceDisplayText ?? null,
      durationMinutes: addOn.durationMinutes,
      pricingType: addOn.pricingType,
      unitLabel: addOn.unitLabel ?? null,
      baseMaxQuantity: baseMaxQuantity(addOn.pricingType, addOn.maxQuantity ?? null, null),
      groupId: addOn.groupId ?? null,
    }));

  const bookingConfig = resolveBookingConfigFromSettings(input.salonSettings);

  // Content-derived, not time-derived: canonicalized directly from the FINAL
  // public arrays this function is about to return, so it changes exactly
  // when what a client would see changes — not indirectly through
  // `updated_at`, which a caller could (in principle) forget to bump.
  //
  // Deliberately NOT hashed here. SHA-256 (`crypto.subtle.digest` in a
  // browser) is inherently async, and this function must stay synchronous —
  // see `finalizeCatalogRevision` below for the separate async step that
  // turns this canonical string into `revision.fingerprint`.
  const canonical = canonicalizeCatalogPayload({
    currency: bookingConfig.currency,
    services,
    addOnGroups,
    addOns,
    serviceAddOnBindings,
    ruleProjections,
  });

  const snapshot: PublicCatalogSnapshot = {
    revision: { canonical },
    generatedAt: now.toISOString(),
    currency: bookingConfig.currency,
    services,
    addOnGroups,
    addOns,
    serviceAddOnBindings,
    ruleProjections,
  };

  return { ok: true, snapshot };
}

/**
 * Turns a snapshot's synchronous `revision.canonical` into a SHA-256
 * `revision.fingerprint`, via an injected hasher — either
 * `hashCatalogFingerprintWebCrypto` (`catalogFingerprint.ts`, browser) or
 * `hashCatalogFingerprintNode` (`catalogFingerprint.server.ts`, server).
 * This function itself does not care which: it stays platform-agnostic by
 * taking the hashing implementation as a parameter rather than importing
 * either one, which is what lets it live in this browser-compatible file
 * without ever importing `node:crypto`.
 *
 * Called ONCE, at submission — not on every keystroke a resolver-in-a-loop
 * might trigger — which is exactly why it is fine for this one step to be
 * async even though the rest of the core is not.
 */
export async function finalizeCatalogRevision(
  snapshot: PublicCatalogSnapshot,
  hasher: (bytes: Uint8Array) => Promise<string>,
): Promise<PublicCatalogSnapshot> {
  const fingerprint = await hasher(catalogCanonicalBytes(snapshot.revision.canonical));
  return {
    ...snapshot,
    revision: { ...snapshot.revision, fingerprint },
  };
}

function normalizeSelectionMode(value: string | null | undefined): 'direct' | 'guided' | null {
  return value === 'direct' || value === 'guided' ? value : null;
}

/** Mirrors `normalizeDescriptionItems` in `bookingCatalog.ts` closely enough for this DTO's purposes, without importing that module (keeps this core independent, per its header note). */
function normalizeDescriptionItemsLocal(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length > 0 ? items : null;
}

// =============================================================================
// SELECTION RESOLUTION
// =============================================================================

function mergeCatalogSelectedAddOns(selectedAddOns: CatalogSelectionInput['selectedAddOns']): Map<string, number> {
  const merged = new Map<string, number>();
  for (const input of selectedAddOns) {
    const existing = merged.get(input.addOnId) ?? 0;
    merged.set(input.addOnId, existing + (input.quantity ?? 1));
  }
  return merged;
}

export function resolveCatalogSelection(
  snapshot: PublicCatalogSnapshot,
  selection: CatalogSelectionInput,
  eligibility: CatalogEligibilityInput = {},
): CatalogResolutionResult {
  const service = snapshot.services.find(s => s.id === selection.serviceId);
  if (!service) {
    return { ok: false, failure: fail('missing_referenced_object', { kind: 'service', serviceId: selection.serviceId }) };
  }

  const addOnById = new Map(snapshot.addOns.map(a => [a.id, a]));
  const bindingsForService = snapshot.serviceAddOnBindings.filter(b => b.serviceId === service.id);
  const bindingByAddOnId = new Map(bindingsForService.map(b => [b.addOnId, b]));

  const clientQuantities = mergeCatalogSelectedAddOns(selection.selectedAddOns);
  const clientSelectedIds = new Set(clientQuantities.keys());

  const projectionsInScope = snapshot.ruleProjections.filter(
    p => p.serviceScopeId === null || p.serviceScopeId === service.id,
  );

  const autoAddProjections = projectionsInScope.filter(p => p.effect === 'auto_add' && p.targetAddOnId);
  const edges: CatalogAutoAddEdge[] = autoAddProjections.map(p => ({
    from: { kind: p.trigger.subjectKind, id: p.trigger.subjectId },
    toAddOnId: p.targetAddOnId!,
  }));

  const cycle = detectAutoAddCycle(edges);
  if (cycle) {
    const addOnNode = cycle.find(key => key.startsWith('addOn:'));
    const anchor: CatalogViolationAnchor = addOnNode
      ? { kind: 'addOn', addOnId: addOnNode.slice('addOn:'.length) }
      : { kind: 'summary' };
    return { ok: false, failure: fail('cyclic_auto_add', anchor) };
  }

  const roots: CatalogAutoAddNode[] = [
    { kind: 'service', id: service.id },
    ...[...clientSelectedIds].sort(compareIds).map(id => ({ kind: 'addOn' as const, id })),
  ];
  const closure = expandAutoAddClosure(edges, roots);
  const autoAddedIds = closure.filter(id => !clientSelectedIds.has(id));

  const explanations: CatalogExplanation[] = [];
  const violations: CatalogViolation[] = [];

  // Auto-add is definitionally material: a line the client did not ask for
  // is entering the selection. Always explained, per rule, regardless of
  // `presentation`.
  for (const addOnId of autoAddedIds) {
    const firing = autoAddProjections
      .filter(p => p.targetAddOnId === addOnId)
      .sort((a, b) => compareIds(a.projectionKey, b.projectionKey))[0];
    if (firing) {
      explanations.push({
        kind: 'add_on_auto_added',
        anchor: { kind: 'addOn', addOnId },
        reasonCode: firing.reasonCode,
        reasonText: firing.reasonText,
        presentation: firing.presentation,
      });
    }
  }

  const finalSelectedIds = new Set<string>([...clientSelectedIds, ...autoAddedIds]);

  // Lines: client-selected quantities as given (never silently clamped),
  // auto-added quantities default to the resolved binding's default, or 1.
  const lines: ResolvedCatalogAddOnLine[] = [];
  const orderedIds = [...finalSelectedIds].sort(compareIds);

  for (const addOnId of orderedIds) {
    const addOn = addOnById.get(addOnId);
    if (!addOn) {
      violations.push({ code: 'addon_unavailable', anchor: { kind: 'addOn', addOnId } });
      continue;
    }

    const isAutoAdded = !clientSelectedIds.has(addOnId);
    const binding = bindingByAddOnId.get(addOnId) ?? null;
    const requestedQuantity = isAutoAdded
      ? (binding?.defaultQuantity ?? 1)
      : (clientQuantities.get(addOnId) ?? 1);

    // `binding.effectiveMaxQuantity` is authoritative when a binding exists;
    // `addOn.baseMaxQuantity` is the correct fallback when one does not
    // (e.g. an add-on auto-added by a rule with no matching `service_add_on`
    // row) — both already mirror `bookingQuote.ts`'s own precedence.
    const staticCeiling = binding?.effectiveMaxQuantity ?? addOn.baseMaxQuantity;
    const dynamicCaps: number[] = [];
    for (const projection of projectionsInScope) {
      if (
        projection.effect === 'limit_quantity'
        && projection.trigger.subjectKind === 'addOn'
        && projection.targetAddOnId === addOnId
        && projection.maxQuantity !== undefined
        && finalSelectedIds.has(projection.trigger.subjectId)
      ) {
        dynamicCaps.push(projection.maxQuantity);
        explanations.push({
          kind: 'quantity_limited',
          anchor: { kind: 'quantity', addOnId },
          reasonCode: projection.reasonCode,
          reasonText: projection.reasonText,
          presentation: projection.presentation,
        });
      }
    }
    const effectiveCeiling = tighten(staticCeiling, dynamicCaps);

    // Mirrors `bookingQuote.ts` exactly: a `per_unit` add-on must be a
    // positive integer within its ceiling, and a `fixed` add-on's ceiling is
    // always exactly 1 — so requesting anything else (0, 2, 1.5, ...) is
    // equally invalid there, not merely "above a cap". No silent clamp
    // either way: the line below still carries the REQUESTED quantity.
    const isValidQuantityShape = Number.isInteger(requestedQuantity) && requestedQuantity >= 1;
    if (!isValidQuantityShape || requestedQuantity > effectiveCeiling) {
      violations.push({
        code: 'quantity_exceeded',
        anchor: { kind: 'quantity', addOnId },
        limit: effectiveCeiling,
        attempted: requestedQuantity,
      });
    }

    lines.push({
      addOnId,
      quantity: requestedQuantity,
      unitPriceCents: addOn.priceCents,
      lineTotalCents: addOn.priceCents * requestedQuantity,
      unitDurationMinutes: addOn.durationMinutes,
      lineDurationMinutes: addOn.durationMinutes * requestedQuantity,
      autoAdded: isAutoAdded,
    });
  }

  // `requires` (validation, never auto-add): the required add-on must be in
  // the final selection. `require` projections always carry a
  // `targetAddOnId` now — `requires_capability` never produces a public
  // projection at all (see `deriveProjectionEffect`), so there is no
  // capability-flavoured branch to handle here.
  for (const projection of projectionsInScope) {
    if (projection.effect !== 'require' || !projection.targetAddOnId) {
      continue;
    }
    const triggerSelected = projection.trigger.subjectKind === 'service'
      ? projection.trigger.subjectId === service.id
      : finalSelectedIds.has(projection.trigger.subjectId);
    if (!triggerSelected || finalSelectedIds.has(projection.targetAddOnId)) {
      continue;
    }

    violations.push({
      code: 'required_dependency_unmet',
      anchor: { kind: 'addOn', addOnId: projection.targetAddOnId },
    });
    explanations.push({
      kind: 'add_on_required',
      anchor: { kind: 'addOn', addOnId: projection.targetAddOnId },
      reasonCode: projection.reasonCode,
      reasonText: projection.reasonText,
      presentation: projection.presentation,
    });
  }

  // Capability eligibility is entirely the server wrapper's call (see the
  // CAPABILITY PRIVACY note in `catalogDomain.ts`): it alone reads the
  // technician capability graph and decides eligibility FOR THIS EXACT
  // selection before calling us, so an explicit `false` is trusted
  // unconditionally — this deliberately does NOT scan `ruleProjections`,
  // because no `requires_capability` row ever appears there.
  if (eligibility.technicianEligible === false) {
    const technicianAnchor: CatalogViolationAnchor = { kind: 'technician', technicianId: selection.technicianId ?? null };
    violations.push({ code: 'capability_unavailable', anchor: technicianAnchor });
    explanations.push({
      kind: 'capability_required',
      anchor: technicianAnchor,
      reasonCode: 'capability_required',
      reasonText: CATALOG_RULE_REASON_TEXT.capability_required,
      presentation: 'surface',
    });
  }

  // `exclude` (hide) / `mutually_exclusive` (disable): both mean "cannot
  // coexist" once the client has actually selected both sides.
  for (const projection of projectionsInScope) {
    if (
      (projection.effect === 'hide' || projection.effect === 'disable')
      && projection.targetAddOnId
    ) {
      const triggerSelected = projection.trigger.subjectKind === 'service'
        ? projection.trigger.subjectId === service.id
        : finalSelectedIds.has(projection.trigger.subjectId);
      if (triggerSelected && finalSelectedIds.has(projection.targetAddOnId)) {
        violations.push({
          code: 'mutually_exclusive_conflict',
          anchor: { kind: 'addOn', addOnId: projection.targetAddOnId },
        });
        explanations.push({
          kind: 'add_on_unavailable',
          anchor: { kind: 'addOn', addOnId: projection.targetAddOnId },
          reasonCode: projection.reasonCode,
          reasonText: projection.reasonText,
          presentation: projection.presentation,
        });
      }
    }
  }

  // Group bounds: distinct-selection counts, never a per-item cap.
  for (const group of snapshot.addOnGroups) {
    const memberIds = snapshot.addOns.filter(a => a.groupId === group.id).map(a => a.id);
    const selectedCount = memberIds.filter(id => finalSelectedIds.has(id)).length;

    if (group.maxSelections !== null && selectedCount > group.maxSelections) {
      violations.push({
        code: 'group_selection_above_maximum',
        anchor: { kind: 'group', groupId: group.id },
        maximum: group.maxSelections,
        selected: selectedCount,
      });
    }
    if (group.minSelections > 0 && selectedCount < group.minSelections) {
      violations.push({
        code: 'group_selection_below_minimum',
        anchor: { kind: 'group', groupId: group.id },
        minimum: group.minSelections,
        selected: selectedCount,
      });
    }
  }

  const subtotalCents = service.priceCents + lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const totalDurationMinutes = service.durationMinutes + lines.reduce((sum, line) => sum + line.lineDurationMinutes, 0);

  const resolved: ResolvedCatalogSelection = {
    serviceId: service.id,
    basePriceCents: service.priceCents,
    baseDurationMinutes: service.durationMinutes,
    addOns: lines,
    subtotalCents,
    totalDurationMinutes,
    explanations,
    violations,
    blocksContinue: violations.length > 0,
  };

  return { ok: true, selection: resolved };
}
