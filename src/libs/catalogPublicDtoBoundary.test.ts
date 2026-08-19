import { describe, expect, it } from 'vitest';

import type { CatalogSnapshotResult, PublicCatalogSnapshot } from '@/libs/catalogDomain';
import { buildPublicCatalogSnapshot } from '@/libs/catalogResolverCore';
import {
  CATALOG_FIXTURE_SCENARIOS,
  makeFixtureAddOn,
  makeFixtureBinding,
  makeFixtureRule,
  makeFixtureService,
} from '@/libs/catalogResolverFixtures';

/**
 * H4 — the public catalog DTO forbidden-field guard (architecture hardening
 * pass).
 *
 * L1 PR3 (`catalogDomain.ts` / `catalogResolverCore.ts` / `catalogResolver.
 * server.ts`) drew a public/private line by TYPE: `PublicCatalogSnapshot`
 * and its nested shapes simply have no field for a rule id, a rule
 * priority, an owner note, a capability id, raw `params`, a tenant id, or
 * any payment/deposit internal. This suite turns that type-level promise
 * into a runtime CI invariant, by building the REAL public snapshot through
 * the REAL builder (`buildPublicCatalogSnapshot`) over the REAL fixture
 * scenarios (`catalogResolverFixtures.ts`) and scanning the ACTUAL output —
 * not the type names, which a future `{ ...rawRow }` spread could silently
 * outrun.
 *
 * Two complementary checks, both over the serialized snapshot:
 *
 *   1. DENYLIST, at every depth: none of a fixed set of known-sensitive key
 *      names may appear anywhere in the object graph. Catches a leak by
 *      NAME regardless of which shape it lands in.
 *   2. ALLOWLIST, per record shape: `Object.keys(...)` for every service /
 *      add-on / group / binding / rule-projection entry must be a subset of
 *      that shape's own known-public fields. Catches a leak that reuses an
 *      innocuous-sounding key name the denylist doesn't know to look for —
 *      e.g. a `{ ...rule }` spread would carry the rule's OWN `id` into a
 *      `ruleProjection`, which the denylist can't flag (`id` is legitimately
 *      public on a service/add-on) but the allowlist can, because
 *      `PublicCatalogRuleProjection` has no `id` field at all — it has
 *      `projectionKey` instead.
 *
 * Both checks are proven non-vacuous below: a mutation test injects each
 * category of forbidden field into a cloned REAL snapshot and asserts the
 * scanner actually catches it.
 */

function expectOk(result: CatalogSnapshotResult): asserts result is { ok: true; snapshot: PublicCatalogSnapshot } {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false: ${JSON.stringify(result)}`);
  }
}

/** Looks up a named scenario and narrows away the `material-change` variant, which has no `buildSnapshotInput`. */
function findSnapshotScenario(key: string) {
  const scenario = CATALOG_FIXTURE_SCENARIOS.find(s => s.key === key);
  if (!scenario) {
    throw new Error(`no fixture scenario named "${key}"`);
  }
  if (scenario.kind === 'material-change') {
    throw new Error(`scenario "${key}" is a material-change scenario, expected snapshot/selection/corrupt`);
  }
  return scenario;
}

// =============================================================================
// 1. DENYLIST — recursive, depth-agnostic
// =============================================================================

/**
 * Every category H4 names explicitly: rule ids, rule priorities, internal
 * notes, capability ids, raw private params, tenant internals, audit ids,
 * payment/deposit internals, and a few of this schema's own private DB-only
 * columns (`is_active`, `created_at`, `updated_at`) that have no equivalent
 * in any `Public*` type. This list is intentionally NOT `id` — `id` is
 * legitimately public on `PublicCatalogService`/`PublicCatalogAddOn`; a
 * bare-`id` leak (e.g. a raw rule's own id) is instead caught by the
 * allowlist check below, which knows `PublicCatalogRuleProjection` has no
 * `id` field at all.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  // rule ids / priorities
  'ruleId',
  'priority',
  // internal notes
  'note',
  'notes',
  'internalNote',
  'internalNotes',
  // capability ids
  'capabilityId',
  // raw private params
  'params',
  'rawParams',
  // tenant internals
  'salonId',
  'tenantId',
  // audit ids
  'auditId',
  // payment / deposit internals
  'depositId',
  'paymentIntentId',
  'paymentMethodId',
  'stripeCustomerId',
  'stripeAccountId',
  'stripeConnectAccountId',
  'chargeId',
  'refundId',
  // private DB-only columns with no public counterpart
  'isActive',
  'createdAt',
  'updatedAt',
]);

/** Every key path (dot/bracket notation) anywhere in `value` whose OWN key name is forbidden. */
function collectForbiddenKeyPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenKeyPaths(item, `${path}[${index}]`));
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) {
      found.push(childPath);
    }
    found.push(...collectForbiddenKeyPaths(child, childPath));
  }
  return found;
}

// =============================================================================
// 2. ALLOWLIST — per record shape, exact to `catalogDomain.ts`
// =============================================================================

const ALLOWED_KEYS = {
  revision: ['canonical', 'fingerprint'],
  snapshot: ['revision', 'generatedAt', 'currency', 'services', 'addOnGroups', 'addOns', 'serviceAddOnBindings', 'ruleProjections'],
  service: [
    'id',
    'kind',
    'name',
    'slug',
    'category',
    'descriptionItems',
    'priceCents',
    'priceDisplayText',
    'durationMinutes',
    'isIntroPrice',
    'introPriceLabel',
    'introPriceExpiresAt',
    'parentServiceId',
    'variantLabel',
    'variantKind',
    'selectionMode',
    'effectiveConfirmationMode',
    'explicitConfirmationMode',
    'rangeSummary',
  ],
  rangeSummary: ['minPriceCents', 'maxPriceCents', 'minDurationMinutes', 'maxDurationMinutes'],
  addOnGroup: ['id', 'name', 'slug', 'description', 'minSelections', 'maxSelections', 'isSingleSelect', 'sortOrder'],
  addOn: [
    'id',
    'name',
    'slug',
    'category',
    'descriptionItems',
    'priceCents',
    'priceDisplayText',
    'durationMinutes',
    'pricingType',
    'unitLabel',
    'baseMaxQuantity',
    'groupId',
  ],
  binding: ['serviceId', 'addOnId', 'displayOrder', 'selectionMode', 'defaultQuantity', 'effectiveMaxQuantity'],
  ruleProjection: ['projectionKey', 'effect', 'trigger', 'serviceScopeId', 'targetAddOnId', 'maxQuantity', 'reasonCode', 'reasonText', 'presentation'],
  trigger: ['subjectKind', 'subjectId'],
} as const;

/** Every key on `obj` not present in `allowed`, or `[]` if `obj` is null/absent. */
function extraKeys(obj: object | null | undefined, allowed: readonly string[]): string[] {
  if (!obj) {
    return [];
  }
  return Object.keys(obj).filter(key => !(allowed as readonly string[]).includes(key));
}

/** Runs BOTH checks over a real, built snapshot and returns everything found, unioned. */
function auditSnapshot(snapshot: PublicCatalogSnapshot): string[] {
  const problems: string[] = [];

  problems.push(...collectForbiddenKeyPaths(snapshot).map(p => `denylist: ${p}`));

  problems.push(...extraKeys(snapshot, ALLOWED_KEYS.snapshot).map(k => `allowlist: snapshot.${k}`));
  problems.push(...extraKeys(snapshot.revision, ALLOWED_KEYS.revision).map(k => `allowlist: revision.${k}`));

  snapshot.services.forEach((service, i) => {
    problems.push(...extraKeys(service, ALLOWED_KEYS.service).map(k => `allowlist: services[${i}].${k}`));
    if (service.rangeSummary) {
      problems.push(...extraKeys(service.rangeSummary, ALLOWED_KEYS.rangeSummary).map(k => `allowlist: services[${i}].rangeSummary.${k}`));
    }
  });
  snapshot.addOnGroups.forEach((group, i) => {
    problems.push(...extraKeys(group, ALLOWED_KEYS.addOnGroup).map(k => `allowlist: addOnGroups[${i}].${k}`));
  });
  snapshot.addOns.forEach((addOn, i) => {
    problems.push(...extraKeys(addOn, ALLOWED_KEYS.addOn).map(k => `allowlist: addOns[${i}].${k}`));
  });
  snapshot.serviceAddOnBindings.forEach((binding, i) => {
    problems.push(...extraKeys(binding, ALLOWED_KEYS.binding).map(k => `allowlist: serviceAddOnBindings[${i}].${k}`));
  });
  snapshot.ruleProjections.forEach((projection, i) => {
    problems.push(...extraKeys(projection, ALLOWED_KEYS.ruleProjection).map(k => `allowlist: ruleProjections[${i}].${k}`));
    problems.push(...extraKeys(projection.trigger, ALLOWED_KEYS.trigger).map(k => `allowlist: ruleProjections[${i}].trigger.${k}`));
  });

  return problems;
}

// =============================================================================
// Every buildable fixture scenario, run through the REAL builder
// =============================================================================

function builtSnapshots(): { key: string; snapshot: PublicCatalogSnapshot }[] {
  const fromScenarios = CATALOG_FIXTURE_SCENARIOS.flatMap((scenario) => {
    if (scenario.kind === 'corrupt') {
      return []; // deliberately ok:false — nothing public is produced to audit
    }
    const inputs = scenario.kind === 'material-change'
      ? [scenario.buildBeforeSnapshotInput(), scenario.buildAfterSnapshotInput()]
      : [scenario.buildSnapshotInput()];

    return inputs.map((input) => {
      const result = buildPublicCatalogSnapshot(input);
      expectOk(result);
      return { key: scenario.key, snapshot: result.snapshot };
    });
  });

  // None of the 16 Owner-named scenarios in catalogResolverFixtures.ts happen
  // to exercise a `max_quantity` rule (they only cover the INHERITED ceiling,
  // via `addOn.maxQuantity`/binding overrides, never a `catalog_rule` row) —
  // composed here from the same exported factories rather than editing that
  // ratified fixture file, purely to exercise `PublicCatalogRuleProjection`'s
  // other optional public field (`maxQuantity`, alongside `targetAddOnId`).
  const maxQuantityRuleResult = buildPublicCatalogSnapshot({
    salonSettings: null,
    services: [makeFixtureService({ id: 'svc_h4_quantity_cap' })],
    addOnGroups: [],
    addOns: [makeFixtureAddOn({ id: 'addon_h4_quantity_cap', pricingType: 'per_unit', maxQuantity: null })],
    serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_h4_quantity_cap', serviceId: 'svc_h4_quantity_cap', addOnId: 'addon_h4_quantity_cap' })],
    rules: [makeFixtureRule({
      id: 'rule_h4_quantity_cap',
      ruleType: 'max_quantity',
      subjectServiceId: 'svc_h4_quantity_cap',
      objectAddOnId: 'addon_h4_quantity_cap',
      params: { maxQuantity: 3 },
    })],
  });
  expectOk(maxQuantityRuleResult);

  return [...fromScenarios, { key: 'h4_max_quantity_rule_supplement', snapshot: maxQuantityRuleResult.snapshot }];
}

describe('public catalog DTO forbidden-field guard', () => {
  it('the fixture corpus is not vacuous: rule projections, groups, and bindings all actually appear', () => {
    const snapshots = builtSnapshots();

    expect(snapshots.some(s => s.snapshot.ruleProjections.length > 0)).toBe(true);
    expect(snapshots.some(s => s.snapshot.addOnGroups.length > 0)).toBe(true);
    expect(snapshots.some(s => s.snapshot.serviceAddOnBindings.length > 0)).toBe(true);
    // `targetAddOnId` and `maxQuantity` are the two OPTIONAL public fields —
    // prove at least one real projection actually carries each.
    expect(snapshots.some(s => s.snapshot.ruleProjections.some(p => p.targetAddOnId !== undefined))).toBe(true);
    expect(snapshots.some(s => s.snapshot.ruleProjections.some(p => p.maxQuantity !== undefined))).toBe(true);
  });

  it('a requires_capability rule produces no capability id anywhere, and no rule projection at all', () => {
    const scenario = findSnapshotScenario('capability_driven_server_outcome');
    const result = buildPublicCatalogSnapshot(scenario.buildSnapshotInput());
    expectOk(result);

    expect(result.snapshot.ruleProjections).toEqual([]);
    expect(collectForbiddenKeyPaths(result.snapshot)).toEqual([]);
  });

  it('every fixture scenario\'s real, built public snapshot has no forbidden key at any depth', () => {
    for (const { key, snapshot } of builtSnapshots()) {
      expect(collectForbiddenKeyPaths(snapshot), key).toEqual([]);
    }
  });

  it('every fixture scenario\'s real, built public snapshot carries no key outside its shape\'s known-public fields', () => {
    for (const { key, snapshot } of builtSnapshots()) {
      expect(auditSnapshot(snapshot), key).toEqual([]);
    }
  });

  // ===========================================================================
  // Non-vacuousness — prove the scanners actually catch a leak, on a real,
  // structurally-typed snapshot mutated to simulate one.
  // ===========================================================================

  describe('mutation tests — the scanners are not vacuous', () => {
    function realSnapshot(): PublicCatalogSnapshot {
      const scenario = findSnapshotScenario('auto_add_rule');
      const result = buildPublicCatalogSnapshot(scenario.buildSnapshotInput());
      expectOk(result);
      return result.snapshot;
    }

    it('denylist catches a leaked tenant id injected at the snapshot root', () => {
      const leaked = { ...realSnapshot(), salonId: 'salon_should_not_be_here' };

      expect(collectForbiddenKeyPaths(leaked)).toContain('$.salonId');
    });

    it('denylist catches an owner note leaked onto a nested service entry', () => {
      const snapshot = realSnapshot();

      expect(snapshot.services.length).toBeGreaterThan(0);

      const leaked: PublicCatalogSnapshot = {
        ...snapshot,
        services: [{ ...snapshot.services[0]!, note: 'owner-only text' } as any, ...snapshot.services.slice(1)],
      };

      expect(collectForbiddenKeyPaths(leaked)).toContain('$.services[0].note');
    });

    it('denylist catches a capability id and raw priority leaked onto a rule projection', () => {
      const snapshot = realSnapshot();

      expect(snapshot.ruleProjections.length).toBeGreaterThan(0);

      const leaked: PublicCatalogSnapshot = {
        ...snapshot,
        ruleProjections: [
          { ...snapshot.ruleProjections[0]!, capabilityId: 'cap_secret', priority: 5 } as any,
          ...snapshot.ruleProjections.slice(1),
        ],
      };
      const found = collectForbiddenKeyPaths(leaked);

      expect(found).toContain('$.ruleProjections[0].capabilityId');
      expect(found).toContain('$.ruleProjections[0].priority');
    });

    it('allowlist catches a raw rule spread onto a projection — including its bare `id`, which the denylist cannot name', () => {
      const snapshot = realSnapshot();
      const rawRule = makeFixtureRule({ id: 'rule_internal_secret' });
      const leaked: PublicCatalogSnapshot = {
        ...snapshot,
        ruleProjections: [
          // Simulates the exact bug shape H4 exists to prevent: a future
          // refactor doing `{ ...rawRule, ...projection }` instead of
          // building the projection field-by-field.
          { ...rawRule, ...snapshot.ruleProjections[0]! } as any,
          ...snapshot.ruleProjections.slice(1),
        ],
      };

      // The denylist alone would NOT catch this — `id` is a legitimate
      // public key on other shapes, so it is deliberately not on the
      // denylist. The allowlist is what catches it here.
      expect(collectForbiddenKeyPaths(leaked)).not.toContain('$.ruleProjections[0].id');
      expect(auditSnapshot(leaked)).toContain('allowlist: ruleProjections[0].id');
      expect(auditSnapshot(leaked)).toContain('allowlist: ruleProjections[0].subjectServiceId');
    });

    it('allowlist catches an extra key on a service entry that the denylist does not name', () => {
      const snapshot = realSnapshot();
      const leaked: PublicCatalogSnapshot = {
        ...snapshot,
        services: [{ ...snapshot.services[0]!, templateKey: 'some_internal_template' } as any, ...snapshot.services.slice(1)],
      };

      expect(auditSnapshot(leaked)).toContain('allowlist: services[0].templateKey');
    });
  });
});
