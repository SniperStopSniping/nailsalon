import { describe, expect, it } from 'vitest';

import { emptyFacts, factsSchema, mergeFacts, type Patch, patchJSONSchema, patchSchema } from './semanticFacts';

const absentPatch = (): Patch => ({ schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null });

describe('customer assistant semantic facts', () => {
  it('starts bounded and unknown without catalog, price, contact, or tenant fields', () => {
    expect(emptyFacts()).toEqual({ schemaVersion: 1, treatment: 'unknown', desiredApplication: 'unknown', maintenance: 'unknown', length: 'unknown', french: 'unknown', existingProduct: 'unknown', origin: 'unknown', removal: 'unknown', repairCount: 'unknown' });
    expect(Object.keys(emptyFacts())).not.toEqual(expect.arrayContaining(['price', 'duration', 'salonId', 'phone', 'email']));
  });

  it('preserves unmentioned facts across turns and applies a later correction', () => {
    const first = mergeFacts(emptyFacts(), { ...absentPatch(), treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'refill', origin: 'this_salon', french: 'yes' });
    const corrected = mergeFacts(first, { ...absentPatch(), maintenance: 'new_set', length: 'medium', origin: 'other_salon' });

    expect(corrected).toMatchObject({ treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set', length: 'medium', origin: 'other_salon', french: 'yes' });
  });

  it('treats explicit unknown and none as clearing values rather than absent patches', () => {
    const populated = mergeFacts(emptyFacts(), { ...absentPatch(), existingProduct: 'gel_x', origin: 'other_salon', removal: 'yes', repairCount: 3 });
    const cleared = mergeFacts(populated, { ...absentPatch(), existingProduct: 'none', origin: 'unknown', removal: 'unknown', repairCount: 'unknown' });

    expect(cleared).toMatchObject({ existingProduct: 'none', origin: 'unknown', removal: 'unknown', repairCount: 'unknown' });
  });

  it('keeps exact repair quantities and rejects out-of-range values in state and patches', () => {
    expect(mergeFacts(emptyFacts(), { ...absentPatch(), repairCount: 2 }).repairCount).toBe(2);
    expect(() => patchSchema.parse({ ...absentPatch(), repairCount: 21 })).toThrow();
    expect(() => factsSchema.parse({ ...emptyFacts(), repairCount: -1 })).toThrow();
  });

  it('keeps the JSON schema strict and makes every patch field explicit', () => {
    expect(patchJSONSchema.required).toHaveLength(10);
    // Responses structured output requires a type even for a literal branch.
    expect(patchJSONSchema.properties.repairCount.anyOf).toEqual([
      { type: 'integer', minimum: 0, maximum: 20 },
      { type: 'string', const: 'unknown' },
      { type: 'null' },
    ]);
    expect(() => patchSchema.parse({ schemaVersion: 1, treatment: null })).toThrow();
    expect(() => patchSchema.parse({ ...absentPatch(), extra: 'not allowed' })).toThrow();
  });
});
