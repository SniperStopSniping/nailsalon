import { describe, expect, it } from 'vitest';

import { SEMANTIC_L1_MENU as menu, SEMANTIC_L1_SNAPSHOT as snapshot } from './__evals__/semanticCases';
import { planCustomerClarification } from './clarification';
import { applyTimingFeedback, clarificationChoices, desiredServices, mergeCatalogChoices, receptionistAnswer, transitionFailure } from './receptionist';
import { emptyFacts, mergeFacts } from './semanticFacts';

const gelx = menu.services.find(item => item.name === 'Gel-X Extensions')!.id;
const french = menu.addOns.find(item => item.name === 'French Tips')!.id;
const medium = menu.addOns.find(item => item.name === 'Medium Length')!.id;
const long = menu.addOns.find(item => item.name === 'Long Length')!.id;
const patch = { schemaVersion: 1 as const, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null };

describe('receptionist semantic boundaries', () => {
  it('separates acrylic starting condition from the desired Gel-X service', () => {
    const facts = { ...emptyFacts(), treatment: 'gel_x' as const, existingProduct: 'acrylic' as const, origin: 'other_salon' as const, removal: 'yes' as const };

    expect(desiredServices(menu, facts).map(item => item.name)).toContain('Gel-X Extensions');
    expect(transitionFailure(menu, facts)).toBe('unsupported_removal');
  });

  it('answers an outcome-first question using only relevant extension services', () => {
    const facts = { ...emptyFacts(), desiredApplication: 'extensions' as const };
    const result = receptionistAnswer({ menu, facts, topic: 'length_options', locale: 'en', serviceId: null });

    expect(result.options).toEqual(['Gel-X Extensions']);
    expect(receptionistAnswer({ menu, facts, topic: 'service_options', locale: 'en', serviceId: null }).options).toEqual(['Gel-X Extensions']);
    expect(result.message).not.toMatch(/\$|\bminutes\b|confirmed/i);
  });

  it('answers terminology questions without changing preserved facts or requiring a form answer', () => {
    const facts = { ...emptyFacts(), treatment: 'gel_x' as const, length: 'medium' as const, french: 'yes' as const };
    const result = receptionistAnswer({ menu, facts, topic: 'compare_treatments', locale: 'en', serviceId: null });

    expect(result.kind).toBe('answer');
    expect(result.message).toContain('natural nails');
    expect(mergeFacts(facts, patch)).toEqual(facts);
  });

  it('updates medium to long while preserving French and the current bare nail state', () => {
    const facts = mergeFacts({ ...emptyFacts(), treatment: 'gel_x', length: 'medium', french: 'yes', existingProduct: 'none' }, { ...patch, length: 'long' });
    const result = planCustomerClarification({ menu, snapshot, facts, candidate: { baseServiceId: gelx, selectedAddOns: [{ addOnId: medium, quantity: 1 }, { addOnId: french, quantity: 1 }] }, question: 'details', optionIds: [], action: 'propose' });

    expect(result).toMatchObject({ kind: 'selection', selection: { baseServiceId: gelx, selectedAddOns: expect.arrayContaining([{ addOnId: long, quantity: 1 }, { addOnId: french, quantity: 1 }]) } });
    expect(result.kind === 'selection' && result.selection.selectedAddOns.some(item => item.addOnId === medium)).toBe(false);
  });

  it('applies explicit addition/removal patches without resetting other catalogue choices', () => {
    const previous = { baseServiceId: gelx, selectedAddOns: [{ addOnId: medium, quantity: 1 }, { addOnId: french, quantity: 1 }] };

    expect(mergeCatalogChoices({ menu, previous, serviceId: null, addOns: [], updates: { add: [], remove: [french] } })).toEqual({ baseServiceId: gelx, selectedAddOns: [{ addOnId: medium, quantity: 1 }] });
    expect(mergeCatalogChoices({ menu, previous, serviceId: null, addOns: [], updates: { add: [], remove: [] } })).toEqual(previous);
    expect(() => mergeCatalogChoices({ menu, previous, serviceId: gelx, addOns: [], updates: { add: [], remove: ['another-salon-private'] } })).toThrow();
  });

  it('keeps compatible designs across a service switch and drops inherited length options', () => {
    const chrome = menu.addOns.find(item => item.name === 'Chrome Finish')!.id;
    const manicure = menu.services.find(item => item.name === 'Gel Manicure')!.id;
    const previous = { baseServiceId: gelx, selectedAddOns: [{ addOnId: medium, quantity: 1 }, { addOnId: chrome, quantity: 1 }] };

    expect(mergeCatalogChoices({ menu, previous, serviceId: manicure, addOns: previous.selectedAddOns, updates: { add: [], remove: [] } })).toEqual({ baseServiceId: manicure, selectedAddOns: [{ addOnId: chrome, quantity: 1 }] });
    expect(mergeCatalogChoices({ menu, previous, serviceId: manicure, addOns: [], updates: { add: [{ addOnId: medium, quantity: 1 }], remove: [] } })?.selectedAddOns).toContainEqual({ addOnId: medium, quantity: 1 });
  });

  it('records expressed uncertainty separately from an unanswered current-product question', () => {
    expect(emptyFacts().currentProductUncertain).toBeUndefined();

    const uncertain = mergeFacts(emptyFacts(), { ...patch, existingProduct: 'unknown', currentProductUncertain: true });

    expect(uncertain.currentProductUncertain).toBe(true);
    expect(mergeFacts(uncertain, { ...patch, existingProduct: 'none' }).currentProductUncertain).toBe(false);
    expect(clarificationChoices('product', [], 'en')).toContain('Other / Not sure');
  });
});

it('treats rejected times independently from date-only corrections', () => {
  const sunday = { date: '2026-09-20', earliest: '17:00', latest: '23:59' };
  const offered = [{ time: '17:00', startTime: '2026-09-19T21:00:00Z' }];

  expect(applyTimingFeedback(sunday, 'none', offered)).toEqual(sunday);
  expect(applyTimingFeedback(sunday, 'too_late', offered)).toEqual({ ...sunday, earliest: '00:00', latest: '16:59' });
  expect(applyTimingFeedback(sunday, 'too_early', offered)).toEqual({ ...sunday, earliest: '17:01' });
});
