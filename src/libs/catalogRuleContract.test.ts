/**
 * L1 PR2 — the typed catalog-rule contract.
 *
 * `params` is the one part of a catalog rule the database deliberately does
 * not shape-check, so these tests are the whole of that guarantee. They also
 * pin the contract to migration 0073 by reading the migration itself: a
 * seventh rule type added here without a migration fails, and a vocabulary
 * change in the migration without a contract change fails too.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addOnGroupBoundsSchema,
  CATALOG_RULE_TYPES,
  catalogRuleWriteSchema,
  isSingleSelectGroup,
  MAX_QUANTITY_CEILING,
  parseCatalogRuleParams,
  safeParseCatalogRuleParams,
} from './catalogRuleContract';

const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), 'migrations', '0073_l1_catalog_rules_foundation.sql'),
  'utf8',
);

describe('vocabulary is pinned to migration 0073', () => {
  it('declares exactly the six types the CHECK constraint allows', () => {
    const check = MIGRATION.match(
      /CONSTRAINT "catalog_rule_type_check" CHECK \("rule_type" IN \(([^)]*)\)\)/,
    );

    expect(check, 'catalog_rule_type_check not found in migration 0073').not.toBeNull();

    const migrationTypes = [...(check![1]!.matchAll(/'([a-z_]+)'/g))].map(m => m[1]);

    expect([...migrationTypes].sort()).toEqual([...CATALOG_RULE_TYPES].sort());
  });

  it('adds no price or duration rule type', () => {
    for (const type of CATALOG_RULE_TYPES) {
      expect(type).not.toMatch(/price|duration|discount|surcharge/);
    }
  });
});

describe('params — shared fields', () => {
  it('accepts an empty object for every rule type', () => {
    for (const type of CATALOG_RULE_TYPES) {
      if (type === 'max_quantity') {
        continue; // carries a required field of its own, covered below.
      }

      expect(() => parseCatalogRuleParams(type, {}), type).not.toThrow();
    }
  });

  it('treats null and undefined params as an empty object', () => {
    expect(parseCatalogRuleParams('exclude', null)).toEqual({});
    expect(parseCatalogRuleParams('exclude', undefined)).toEqual({});
  });

  it('accepts the bounded reason codes and rejects free text', () => {
    expect(parseCatalogRuleParams('requires', { reasonCode: 'required_for_selection' }))
      .toEqual({ reasonCode: 'required_for_selection' });

    expect(safeParseCatalogRuleParams('requires', { reasonCode: 'because the owner said so' }).success)
      .toBe(false);
  });

  it('accepts the bounded presentations and rejects anything else', () => {
    expect(parseCatalogRuleParams('include', { presentation: 'silent' }))
      .toEqual({ presentation: 'silent' });

    expect(safeParseCatalogRuleParams('include', { presentation: 'modal' }).success).toBe(false);
  });

  it('rejects an unknown key rather than carrying it through', () => {
    expect(safeParseCatalogRuleParams('exclude', { autoAdd: true }).success).toBe(false);
    expect(safeParseCatalogRuleParams('exclude', { priceCents: 500 }).success).toBe(false);
    expect(safeParseCatalogRuleParams('exclude', { __proto__: 'x', script: 'rm -rf' }).success)
      .toBe(false);
  });

  it('rejects a non-object', () => {
    for (const bad of ['{}', 42, true, ['a'], 'include']) {
      expect(safeParseCatalogRuleParams('exclude', bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('params — include', () => {
  it('accepts autoAdd', () => {
    expect(parseCatalogRuleParams('include', { autoAdd: true })).toEqual({ autoAdd: true });
  });

  it('rejects a non-boolean autoAdd', () => {
    expect(safeParseCatalogRuleParams('include', { autoAdd: 'yes' }).success).toBe(false);
  });
});

describe('params — max_quantity', () => {
  it('requires maxQuantity', () => {
    expect(safeParseCatalogRuleParams('max_quantity', {}).success).toBe(false);
  });

  it('accepts a positive integer within the ceiling', () => {
    expect(parseCatalogRuleParams('max_quantity', { maxQuantity: 3 }))
      .toEqual({ maxQuantity: 3 });
    expect(parseCatalogRuleParams('max_quantity', { maxQuantity: MAX_QUANTITY_CEILING }))
      .toEqual({ maxQuantity: MAX_QUANTITY_CEILING });
  });

  it('rejects zero, negatives, fractions and anything past the ceiling', () => {
    for (const bad of [0, -1, 1.5, MAX_QUANTITY_CEILING + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(safeParseCatalogRuleParams('max_quantity', { maxQuantity: bad }).success, String(bad))
        .toBe(false);
    }
  });

  it('rejects autoAdd, which belongs to include only', () => {
    expect(safeParseCatalogRuleParams('max_quantity', { maxQuantity: 2, autoAdd: true }).success)
      .toBe(false);
  });
});

describe('whole-row shape', () => {
  const base = {
    ruleType: 'requires' as const,
    subjectAddOnId: 'addon-a',
    objectAddOnId: 'addon-b',
  };

  it('accepts a well-formed add-on rule', () => {
    const parsed = catalogRuleWriteSchema.parse(base);

    expect(parsed.serviceId).toBeNull();
    expect(parsed.priority).toBe(0);
    expect(parsed.isActive).toBe(true);
  });

  it('accepts a service-scoped rule', () => {
    expect(() => catalogRuleWriteSchema.parse({ ...base, serviceId: 'svc-1' })).not.toThrow();
  });

  it('rejects a rule with no subject', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ruleType: 'requires',
      objectAddOnId: 'addon-b',
    }).success).toBe(false);
  });

  it('rejects a rule with two subjects', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ...base,
      subjectServiceId: 'svc-1',
    }).success).toBe(false);
  });

  it('rejects requires_capability without a capability', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ruleType: 'requires_capability',
      subjectServiceId: 'svc-1',
    }).success).toBe(false);
  });

  it('rejects requires_capability that also names an add-on', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ruleType: 'requires_capability',
      subjectServiceId: 'svc-1',
      capabilityId: 'cap-1',
      objectAddOnId: 'addon-b',
    }).success).toBe(false);
  });

  it('accepts a well-formed capability rule', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ruleType: 'requires_capability',
      subjectServiceId: 'svc-1',
      capabilityId: 'cap-1',
    }).success).toBe(true);
  });

  it('rejects a non-capability rule that names a capability', () => {
    expect(catalogRuleWriteSchema.safeParse({ ...base, capabilityId: 'cap-1' }).success)
      .toBe(false);
  });

  it('rejects a non-capability rule with no object add-on', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ruleType: 'exclude',
      subjectAddOnId: 'addon-a',
    }).success).toBe(false);
  });

  it('rejects an unknown rule type', () => {
    expect(catalogRuleWriteSchema.safeParse({ ...base, ruleType: 'adjust_price' }).success)
      .toBe(false);
  });

  it('rejects an add-on pointed at itself', () => {
    expect(catalogRuleWriteSchema.safeParse({
      ...base,
      objectAddOnId: 'addon-a',
    }).success).toBe(false);
  });

  it('rejects a negative priority', () => {
    expect(catalogRuleWriteSchema.safeParse({ ...base, priority: -1 }).success).toBe(false);
  });

  it('reports malformed params under the params path', () => {
    const result = catalogRuleWriteSchema.safeParse({
      ruleType: 'max_quantity',
      subjectAddOnId: 'addon-a',
      objectAddOnId: 'addon-b',
      params: { maxQuantity: 0 },
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues.some(i => i.path[0] === 'params'))
      .toBe(true);
  });
});

describe('add-on group bounds', () => {
  it('defaults to min 0 and unlimited max', () => {
    expect(addOnGroupBoundsSchema.parse({})).toEqual({ minSelections: 0, maxSelections: null });
  });

  it('rejects a negative minimum', () => {
    expect(addOnGroupBoundsSchema.safeParse({ minSelections: -1 }).success).toBe(false);
  });

  it('rejects a maximum of zero', () => {
    expect(addOnGroupBoundsSchema.safeParse({ maxSelections: 0 }).success).toBe(false);
  });

  it('rejects a maximum below the minimum', () => {
    expect(addOnGroupBoundsSchema.safeParse({ minSelections: 3, maxSelections: 2 }).success)
      .toBe(false);
  });

  it('accepts an unlimited group with a minimum', () => {
    expect(addOnGroupBoundsSchema.safeParse({ minSelections: 2, maxSelections: null }).success)
      .toBe(true);
  });

  it('recognises the single-select shape', () => {
    expect(isSingleSelectGroup(addOnGroupBoundsSchema.parse({ minSelections: 1, maxSelections: 1 })))
      .toBe(true);
    expect(isSingleSelectGroup(addOnGroupBoundsSchema.parse({ maxSelections: 2 })))
      .toBe(false);
    expect(isSingleSelectGroup(addOnGroupBoundsSchema.parse({})))
      .toBe(false);
  });
});
