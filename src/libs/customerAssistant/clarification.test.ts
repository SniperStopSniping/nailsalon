import { describe, expect, it } from 'vitest';

import type { PublicCatalogSnapshot } from '@/libs/catalogDomain';
import { resolveCatalogSelection } from '@/libs/catalogResolverCore';

import { SEMANTIC_L1_MENU, SEMANTIC_L1_SNAPSHOT } from './__evals__/semanticCases';
import type { CustomerMenu } from './catalogue.server';
import { planCustomerClarification } from './clarification';
import { emptyFacts, type Facts } from './semanticFacts';

const id = (name: string) => SEMANTIC_L1_MENU.services.find(item => item.name === name)!.id;
const addon = (name: string) => SEMANTIC_L1_MENU.addOns.find(item => item.name === name)!.id;
const biab = id('BIAB Builder Gel');
const gelx = id('Gel-X Extensions');
const manicure = id('Gel Manicure');
const short = addon('Short Length');
const medium = addon('Medium Length');
const long = addon('Long Length');
const french = addon('French Tips');
const ownRemoval = addon('Gel-X Removal');
const foreignRemoval = addon('Other Salon Gel-X Removal');
const repair = addon('Nail Repair');
const biabFacts = { ...emptyFacts(), treatment: 'builder_gel', desiredApplication: 'natural_nails', existingProduct: 'none' } as Facts;
const gelxFacts = { ...emptyFacts(), treatment: 'gel_x', maintenance: 'new_set', desiredApplication: 'extensions' } as Facts;
const manicureFacts = { ...emptyFacts(), treatment: 'gel_polish', desiredApplication: 'natural_nails' } as Facts;
const plan = (overrides: Partial<Parameters<typeof planCustomerClarification>[0]> = {}) => planCustomerClarification({ menu: SEMANTIC_L1_MENU, snapshot: SEMANTIC_L1_SNAPSHOT, facts: biabFacts, candidate: { baseServiceId: biab, selectedAddOns: [] }, question: 'length', optionIds: [short, medium, long], ...overrides });

function withRules(rules: PublicCatalogSnapshot['ruleProjections']) {
  return { ...SEMANTIC_L1_SNAPSHOT, ruleProjections: rules };
}

const exclude = (targetAddOnId: string, serviceId = gelx): PublicCatalogSnapshot['ruleProjections'][number] => ({ projectionKey: 'test-exclude', effect: 'hide', trigger: { subjectKind: 'service', subjectId: serviceId }, serviceScopeId: serviceId, targetAddOnId, reasonCode: 'unavailable_with_selection', reasonText: 'Unavailable with this selection', presentation: 'surface' });

describe('authoritative customer clarification applicability', () => {
  it.each([
    ['BIAB', biab, biabFacts],
    ['gel manicure', manicure, manicureFacts],
    ['refill', id('Gel-X Fill'), { ...gelxFacts, maintenance: 'refill' }],
  ] as const)('never asks Gel-X-only lengths for %s', (_name, serviceId, facts) => {
    expect(plan({ facts, candidate: { baseServiceId: serviceId, selectedAddOns: [] } })).toEqual({ kind: 'selection', selection: { baseServiceId: serviceId, selectedAddOns: [] } });
  });

  it('asks a genuine required length question without selecting a completion witness', () => {
    expect(plan({ facts: gelxFacts, candidate: { baseServiceId: gelx, selectedAddOns: [] } })).toEqual({ kind: 'clarification', question: 'length', optionIds: [long, medium, short].sort() });
  });

  it('recovers a proposed selection with a missing required group', () => {
    expect(plan({ action: 'propose', question: 'details', optionIds: [], facts: gelxFacts, candidate: { baseServiceId: gelx, selectedAddOns: [] } })).toMatchObject({ kind: 'clarification', question: 'length' });
  });

  it('never offers a rule-hidden or incompatible group choice', () => {
    const result = plan({ snapshot: withRules([exclude(long)]), facts: gelxFacts, candidate: { baseServiceId: gelx, selectedAddOns: [] } });

    expect(result).toMatchObject({ kind: 'clarification', question: 'length' });

    if (result.kind === 'clarification') {
      expect(result.optionIds).toEqual(expect.arrayContaining([short, medium]));
      expect(result.optionIds).not.toContain(long);
    }
  });

  it('fails closed when no required completion exists or search budget is exhausted', () => {
    expect(plan({ snapshot: withRules([exclude(short), exclude(medium), exclude(long)]), facts: gelxFacts, candidate: { baseServiceId: gelx, selectedAddOns: [] } })).toEqual({ kind: 'no_match' });
    expect(plan({ maxVisits: 0 })).toEqual({ kind: 'no_match' });
  });

  it('lets automatic required choices satisfy the catalog without asking or selecting them manually', () => {
    const snapshot = withRules([{ ...exclude(short), effect: 'auto_add', reasonCode: 'included_with_selection' }]);

    expect(plan({ snapshot, action: 'propose', facts: gelxFacts, candidate: { baseServiceId: gelx, selectedAddOns: [] }, question: 'details', optionIds: [] })).toEqual({ kind: 'selection', selection: { baseServiceId: gelx, selectedAddOns: [] } });
  });

  it('does not ask an optional finish question whose only choice is already automatic', () => {
    const snapshot = withRules([{ ...exclude(french, manicure), effect: 'auto_add', reasonCode: 'included_with_selection' }]);

    expect(plan({ snapshot, facts: manicureFacts, candidate: { baseServiceId: manicure, selectedAddOns: [] }, question: 'finish', optionIds: [french] })).toEqual({ kind: 'selection', selection: { baseServiceId: manicure, selectedAddOns: [] } });
  });

  it('requires review of real candidate services when treatment is genuinely ambiguous', () => {
    const result = plan({ facts: { ...emptyFacts(), desiredApplication: 'natural_nails', existingProduct: 'none' }, candidate: null, question: 'service', optionIds: [biab, manicure] });

    expect(result).toEqual({ kind: 'clarification', question: 'service', optionIds: [biab, manicure].sort() });
  });

  it('retains exact Gel-X facts and a corrected length through canonical L1', () => {
    const facts: Facts = { ...gelxFacts, length: 'medium', french: 'yes', removal: 'yes', existingProduct: 'gel_x', origin: 'this_salon' };
    const result = plan({ facts, candidate: { baseServiceId: gelx, selectedAddOns: [{ addOnId: foreignRemoval, quantity: 1 }] } });

    expect(result.kind).toBe('selection');

    if (result.kind === 'selection') {
      const actual = resolveCatalogSelection(SEMANTIC_L1_SNAPSHOT, { serviceId: gelx, selectedAddOns: result.selection.selectedAddOns });
      const expected = resolveCatalogSelection(SEMANTIC_L1_SNAPSHOT, { serviceId: gelx, selectedAddOns: [{ addOnId: medium, quantity: 1 }, { addOnId: french, quantity: 1 }, { addOnId: ownRemoval, quantity: 1 }] });

      expect(actual).toEqual(expected);
    }
  });

  it('asks origin only for a viable removal path and never guesses generic foreign-removal meaning', () => {
    const facts: Facts = { ...gelxFacts, length: 'short', removal: 'yes', existingProduct: 'gel_x' };

    expect(plan({ facts, candidate: { baseServiceId: gelx, selectedAddOns: [] }, question: 'origin', optionIds: [] })).toEqual({ kind: 'clarification', question: 'origin', optionIds: [] });

    const menu: CustomerMenu = { ...SEMANTIC_L1_MENU, addOns: SEMANTIC_L1_MENU.addOns.map(item => item.id === foreignRemoval ? { ...item, name: 'Removal From Another Salon' } : item) };

    expect(plan({ menu, facts: { ...facts, origin: 'other_salon' }, candidate: { baseServiceId: gelx, selectedAddOns: [] }, question: 'removal', optionIds: [ownRemoval] })).toEqual({ kind: 'no_match' });
  });

  it('does not ask removal for bare natural nails or an unrelated refill path', () => {
    expect(plan({ question: 'removal', optionIds: [ownRemoval] }).kind).toBe('selection');
    expect(plan({ facts: { ...gelxFacts, maintenance: 'refill', existingProduct: 'gel_x' }, candidate: { baseServiceId: id('Gel-X Fill'), selectedAddOns: [] }, question: 'removal', optionIds: [ownRemoval] }).kind).toBe('selection');
  });

  it('preserves French and exact repair count instead of asking unrelated length', () => {
    const result = plan({ facts: { ...manicureFacts, french: 'yes', repairCount: 3 }, candidate: { baseServiceId: manicure, selectedAddOns: [] } });

    expect(result).toEqual({ kind: 'selection', selection: { baseServiceId: manicure, selectedAddOns: [{ addOnId: french, quantity: 1 }, { addOnId: repair, quantity: 3 }] } });
  });

  it('asks only supported nail-art options even when French is already known', () => {
    const art = 'art';
    const menu: CustomerMenu = { ...SEMANTIC_L1_MENU, addOns: [...SEMANTIC_L1_MENU.addOns, { ...SEMANTIC_L1_MENU.addOns[0]!, id: art, name: 'Simple Nail Art' }], bindings: [...SEMANTIC_L1_MENU.bindings, { serviceId: manicure, addOnId: art, required: false, defaultQuantity: 1, maxQuantity: 1 }] };
    const snapshot: PublicCatalogSnapshot = { ...SEMANTIC_L1_SNAPSHOT, addOns: [...SEMANTIC_L1_SNAPSHOT.addOns, { ...SEMANTIC_L1_SNAPSHOT.addOns[0]!, id: art, name: 'Simple Nail Art', groupId: null }], serviceAddOnBindings: [...SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings, { ...SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings.find(item => item.serviceId === manicure)!, addOnId: art }] };

    expect(plan({ menu, snapshot, facts: { ...manicureFacts, french: 'yes' }, candidate: { baseServiceId: manicure, selectedAddOns: [] }, question: 'finish', optionIds: [art, short] })).toEqual({ kind: 'clarification', question: 'finish', optionIds: [art] });
  });

  it('preserves already selected art while resolving French alternatives', () => {
    const art = 'art';
    const alternative = 'french-alternative';
    const extras = [{ id: art, name: 'Simple Nail Art' }, { id: alternative, name: 'French Alternative' }];
    const menu: CustomerMenu = { ...SEMANTIC_L1_MENU, addOns: [...SEMANTIC_L1_MENU.addOns, ...extras.map(item => ({ ...SEMANTIC_L1_MENU.addOns[0]!, ...item }))], bindings: [...SEMANTIC_L1_MENU.bindings, ...extras.map(item => ({ serviceId: manicure, addOnId: item.id, required: false, defaultQuantity: 1, maxQuantity: 1 }))] };
    const snapshot: PublicCatalogSnapshot = { ...SEMANTIC_L1_SNAPSHOT, addOns: [...SEMANTIC_L1_SNAPSHOT.addOns, ...extras.map(item => ({ ...SEMANTIC_L1_SNAPSHOT.addOns[0]!, ...item, groupId: null }))], serviceAddOnBindings: [...SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings, ...extras.map(item => ({ ...SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings.find(binding => binding.serviceId === manicure)!, addOnId: item.id }))], ruleProjections: [{ ...exclude(alternative, manicure), trigger: { subjectKind: 'addOn', subjectId: art } }] };
    const result = plan({ menu, snapshot, facts: { ...manicureFacts, french: 'yes' }, candidate: { baseServiceId: manicure, selectedAddOns: [{ addOnId: art, quantity: 1 }] }, question: 'finish', optionIds: [french, alternative] });

    expect(result).toEqual({ kind: 'selection', selection: { baseServiceId: manicure, selectedAddOns: [{ addOnId: art, quantity: 1 }, { addOnId: french, quantity: 1 }] } });
  });

  it('continues to an unresolved origin after uniquely resolving a French ambiguity', () => {
    const alternative = 'french-alternative';
    const menu: CustomerMenu = { ...SEMANTIC_L1_MENU, addOns: [...SEMANTIC_L1_MENU.addOns, { ...SEMANTIC_L1_MENU.addOns.find(item => item.id === french)!, id: alternative, name: 'French Alternative' }], bindings: [...SEMANTIC_L1_MENU.bindings, { serviceId: gelx, addOnId: alternative, required: false, defaultQuantity: 1, maxQuantity: 1 }] };
    const snapshot: PublicCatalogSnapshot = { ...SEMANTIC_L1_SNAPSHOT, addOns: [...SEMANTIC_L1_SNAPSHOT.addOns, { ...SEMANTIC_L1_SNAPSHOT.addOns.find(item => item.id === french)!, id: alternative, name: 'French Alternative' }], serviceAddOnBindings: [...SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings, { ...SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings.find(item => item.serviceId === gelx)!, addOnId: alternative }], ruleProjections: [exclude(alternative)] };

    expect(plan({ menu, snapshot, facts: { ...gelxFacts, length: 'short', french: 'yes', existingProduct: 'gel_x', removal: 'yes' }, candidate: { baseServiceId: gelx, selectedAddOns: [] }, question: 'finish', optionIds: [french, alternative] })).toEqual({ kind: 'clarification', question: 'origin', optionIds: [] });
  });

  it('honors quantity ceilings and asks a repair count only when a repair is viable', () => {
    expect(plan({ facts: { ...manicureFacts, repairCount: 6 }, candidate: { baseServiceId: manicure, selectedAddOns: [] }, question: 'quantity', optionIds: [repair] })).toEqual({ kind: 'no_match' });
    expect(plan({ facts: manicureFacts, candidate: { baseServiceId: manicure, selectedAddOns: [{ addOnId: repair, quantity: 1 }] }, question: 'quantity', optionIds: [repair] })).toEqual({ kind: 'clarification', question: 'quantity', optionIds: [] });
  });

  it('proves dependency completion and excludes an option whose dependency is impossible', () => {
    const dependency = { ...exclude(long), effect: 'require' as const, trigger: { subjectKind: 'addOn' as const, subjectId: medium }, targetAddOnId: french, reasonCode: 'required_for_selection' as const };
    const result = plan({ snapshot: withRules([dependency, exclude(french)]), facts: gelxFacts, candidate: { baseServiceId: gelx, selectedAddOns: [] } });

    expect(result).toMatchObject({ kind: 'clarification', question: 'length' });

    if (result.kind === 'clarification') {
      expect(result.optionIds).not.toContain(medium);
      expect(result.optionIds).toEqual(expect.arrayContaining([short, long]));
    }
  });

  it('rejects unknown or wrong-tenant IDs instead of filtering them into a valid request', () => {
    expect(plan({ optionIds: ['other-tenant'] })).toEqual({ kind: 'no_match' });
    expect(plan({ candidate: { baseServiceId: biab, selectedAddOns: [{ addOnId: 'other-tenant', quantity: 1 }] } })).toEqual({ kind: 'no_match' });
  });
});
