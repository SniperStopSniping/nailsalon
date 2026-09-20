import { describe, expect, it } from 'vitest';

import type { CustomerMenu } from './catalogue.server';
import { emptyFacts } from './semanticFacts';
import { resolveSemanticSelection, selectionConflictsWithExplicitFacts } from './semanticSelection';

const menu: CustomerMenu = {
  services: [
    { id: 'gel-manicure', name: 'Gel Manicure', description: 'Gel polish on natural nails.', category: 'nails' },
    { id: 'biab', name: 'BIAB Builder Gel', description: 'Builder gel overlay.', category: 'nails' },
    { id: 'gelx', name: 'Gel-X Extensions', description: 'New soft gel extensions.', category: 'nails' },
    { id: 'gelx-fill', name: 'Gel-X Fill', description: 'Refill for existing Gel-X.', category: 'nails' },
  ],
  addOns: [
    { id: 'french', name: 'French Tips', description: '', category: 'finish', pricingType: 'fixed', maxQuantity: 1 },
    { id: 'short', name: 'Short Length', description: '', category: 'length', pricingType: 'fixed', maxQuantity: 1 },
    { id: 'medium', name: 'Medium Length', description: '', category: 'length', pricingType: 'fixed', maxQuantity: 1 },
    { id: 'repair', name: 'Nail Repair', description: 'Per damaged nail.', category: 'repair', pricingType: 'per_unit', maxQuantity: 5 },
    { id: 'gelx-removal', name: 'Gel-X Removal', description: 'Removal of Gel-X done at this salon.', category: 'removal', pricingType: 'fixed', maxQuantity: 1 },
    { id: 'foreign-extension-removal', name: 'Other Salon Gel-X Removal', description: 'Removal of extensions from another salon.', category: 'removal', pricingType: 'fixed', maxQuantity: 1 },
    { id: 'art', name: 'Simple Nail Art', description: '', category: 'art', pricingType: 'fixed', maxQuantity: 1 },
  ],
  bindings: [
    ...['gel-manicure', 'biab', 'gelx', 'gelx-fill'].flatMap(serviceId => [
      { serviceId, addOnId: 'french', required: false, defaultQuantity: 1, maxQuantity: 1 },
      { serviceId, addOnId: 'repair', required: false, defaultQuantity: 1, maxQuantity: 5 },
      { serviceId, addOnId: 'art', required: false, defaultQuantity: 1, maxQuantity: 1 },
    ]),
    ...['gelx'].flatMap(serviceId => [
      { serviceId, addOnId: 'short', required: true, defaultQuantity: 1, maxQuantity: 1 },
      { serviceId, addOnId: 'medium', required: true, defaultQuantity: 1, maxQuantity: 1 },
      { serviceId, addOnId: 'gelx-removal', required: false, defaultQuantity: 1, maxQuantity: 1 },
      { serviceId, addOnId: 'foreign-extension-removal', required: false, defaultQuantity: 1, maxQuantity: 1 },
    ]),
  ],
};

const facts = (patch: Partial<ReturnType<typeof emptyFacts>>) => ({ ...emptyFacts(), ...patch });

describe('customer assistant semantic selection', () => {
  it('preserves the Gel-X, short, French and Isla-origin removal facts from the pilot failure', () => {
    const result = resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set', length: 'short', french: 'yes', existingProduct: 'gel_x', origin: 'this_salon', removal: 'yes' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'medium', quantity: 1 }, { addOnId: 'foreign-extension-removal', quantity: 1 }] } });

    expect(result).toEqual({ kind: 'selection', selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }, { addOnId: 'short', quantity: 1 }, { addOnId: 'gelx-removal', quantity: 1 }] } });
  });

  it('maps a known other-salon Gel-X removal only to the explicitly public foreign removal', () => {
    const result = resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'gel_x', origin: 'other_salon', removal: 'yes' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [] } });

    expect(result).toEqual({ kind: 'selection', selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'foreign-extension-removal', quantity: 1 }] } });
  });

  it('does not infer an origin or product for requested removal', () => {
    expect(resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_x', removal: 'yes', existingProduct: 'gel_x' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [] } })).toEqual({ kind: 'clarification', question: 'origin', optionIds: [] });
    expect(resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_x', removal: 'yes', origin: 'other_salon' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [] } })).toEqual({ kind: 'clarification', question: 'product', optionIds: [] });
  });

  it('retains unrelated valid extras while replacing known semantic facts', () => {
    const result = resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_x', maintenance: 'new_set', length: 'short', french: 'yes' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'medium', quantity: 1 }, { addOnId: 'art', quantity: 1 }] } });

    expect(result).toEqual({ kind: 'selection', selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'art', quantity: 1 }, { addOnId: 'french', quantity: 1 }, { addOnId: 'short', quantity: 1 }] } });
  });

  it('maps bounded per-unit repairs and asks rather than clamps an unsupported count', () => {
    expect(resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_polish', repairCount: 3 }), candidate: { baseServiceId: 'gel-manicure', selectedAddOns: [] } })).toEqual({ kind: 'selection', selection: { baseServiceId: 'gel-manicure', selectedAddOns: [{ addOnId: 'repair', quantity: 3 }] } });
    expect(resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_polish', repairCount: 6 }), candidate: { baseServiceId: 'gel-manicure', selectedAddOns: [] } })).toEqual({ kind: 'clarification', question: 'quantity', optionIds: ['repair'] });
    expect(resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_polish' }), candidate: { baseServiceId: 'gel-manicure', selectedAddOns: [{ addOnId: 'repair', quantity: 1 }] } })).toEqual({ kind: 'clarification', question: 'quantity', optionIds: ['repair'] });
  });

  it('does not let a candidate contradict the stated desired natural-nail or extension treatment', () => {
    expect(resolveSemanticSelection({ menu, facts: facts({ treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set' }), candidate: { baseServiceId: 'gel-manicure', selectedAddOns: [] } })).toEqual({ kind: 'selection', selection: { baseServiceId: 'gelx', selectedAddOns: [] } });
    expect(selectionConflictsWithExplicitFacts(menu, facts({ treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set' }), { baseServiceId: 'gelx-fill', selectedAddOns: [] })).toBe(true);
  });

  it('rejects duplicate or cross-service model choices instead of silently accepting them', () => {
    expect(resolveSemanticSelection({ menu, facts: emptyFacts(), candidate: { baseServiceId: 'gel-manicure', selectedAddOns: [{ addOnId: 'short', quantity: 1 }] } })).toEqual({ kind: 'clarification', question: 'details', optionIds: [] });
    expect(resolveSemanticSelection({ menu, facts: emptyFacts(), candidate: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'art', quantity: 1 }, { addOnId: 'art', quantity: 1 }] } })).toEqual({ kind: 'clarification', question: 'details', optionIds: [] });
  });

  it('asks about real lengths instead of inventing a short base option', () => {
    const withoutShort: CustomerMenu = { ...menu, addOns: menu.addOns.filter(item => item.id !== 'short'), bindings: menu.bindings.filter(item => item.addOnId !== 'short') };

    expect(resolveSemanticSelection({ menu: withoutShort, facts: facts({ treatment: 'gel_x', maintenance: 'new_set', length: 'short' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'medium', quantity: 1 }] } })).toEqual({ kind: 'clarification', question: 'length', optionIds: ['medium'] });
  });

  it('does not treat descriptions, generic extensions, or a manicure-pedicure combo as product identities', () => {
    const narrowMenu: CustomerMenu = {
      ...menu,
      services: [...menu.services, { id: 'combo', name: 'Gel Manicure + Pedicure', description: '', category: 'nails' }],
      addOns: [...menu.addOns, { id: 'generic-extension-removal', name: 'Extensions Removal', description: 'For Gel-X from another salon.', category: 'removal', pricingType: 'fixed', maxQuantity: 1 }],
      bindings: [...menu.bindings, { serviceId: 'gelx', addOnId: 'generic-extension-removal', required: false, defaultQuantity: 1, maxQuantity: 1 }],
    };

    expect(resolveSemanticSelection({ menu: narrowMenu, facts: facts({ treatment: 'gel_polish' }), candidate: { baseServiceId: 'combo', selectedAddOns: [] } })).toEqual({ kind: 'clarification', question: 'service', optionIds: [] });
    expect(resolveSemanticSelection({ menu: narrowMenu, facts: facts({ treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'gel_x', origin: 'other_salon', removal: 'yes' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [] } })).toEqual({ kind: 'selection', selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'foreign-extension-removal', quantity: 1 }] } });

    const onlyGeneric: CustomerMenu = { ...narrowMenu, addOns: narrowMenu.addOns.filter(item => item.id !== 'foreign-extension-removal'), bindings: narrowMenu.bindings.filter(item => item.addOnId !== 'foreign-extension-removal') };

    expect(resolveSemanticSelection({ menu: onlyGeneric, facts: facts({ treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'gel_x', origin: 'other_salon', removal: 'yes' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [] } })).toEqual({ kind: 'clarification', question: 'removal', optionIds: ['gelx-removal'] });
  });

  it('does not let a mismatching L1 service variant override a stated length', () => {
    const variants: CustomerMenu = {
      ...menu,
      l1: {
        services: [
          { id: 'gelx', kind: 'child', parentServiceId: 'gelx-parent', variantLabel: 'Medium', selectionMode: null },
          { id: 'gelx-short', kind: 'child', parentServiceId: 'gelx-parent', variantLabel: 'Short', selectionMode: null },
        ],
        addOns: [],
        addOnGroups: [],
        ruleProjections: [],
      },
      services: [...menu.services, { id: 'gelx-short', name: 'Gel-X Extensions', description: '', category: 'nails' }],
    };

    expect(resolveSemanticSelection({ menu: variants, facts: facts({ treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set', length: 'short' }), candidate: { baseServiceId: 'gelx', selectedAddOns: [] } })).toMatchObject({ kind: 'selection', selection: { baseServiceId: 'gelx-short' } });
    expect(selectionConflictsWithExplicitFacts(variants, facts({ treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set', length: 'short' }), { baseServiceId: 'gelx', selectedAddOns: [] })).toBe(true);
  });

  it('detects authoritative post-quote additions that conflict with explicit facts', () => {
    expect(selectionConflictsWithExplicitFacts(menu, facts({ treatment: 'gel_x', french: 'no', length: 'short' }), { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'medium', quantity: 1 }, { addOnId: 'french', quantity: 1 }] })).toBe(true);
    expect(selectionConflictsWithExplicitFacts(menu, facts({ treatment: 'gel_x', french: 'yes', length: 'short' }), { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'short', quantity: 1 }, { addOnId: 'french', quantity: 1 }] })).toBe(false);
    expect(selectionConflictsWithExplicitFacts(menu, facts({ treatment: 'gel_x', french: 'no', length: 'short' }), { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'short', quantity: 1 }] }, [{ id: 'short', quantity: 1 }, { id: 'french', quantity: 1 }])).toBe(true);
  });
});
