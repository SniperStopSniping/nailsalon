import { describe, expect, it } from 'vitest';

import { buildPublicCatalogSnapshot, resolveCatalogSelection } from '@/libs/catalogResolverCore';
import { makeFixtureAddOn, makeFixtureBinding, makeFixtureRule, makeFixtureService } from '@/libs/catalogResolverFixtures';
import { projectPublicBookingCatalog } from '@/libs/publicBookingCatalog';

import { SEMANTIC_L1_MENU as menu, SEMANTIC_L1_SNAPSHOT as snapshot } from './__evals__/semanticCases';
import { assessCustomerConsultation, customerConsultationChoices, customerPartialQuoteSelection } from './consultation';
import type { CustomerSelection } from './contracts';
import { emptyFacts, type Facts, mergeFacts } from './semanticFacts';
import { resolveSemanticSelection } from './semanticSelection';

const gelx = menu.services.find(item => item.name === 'Gel-X Extensions')!.id;
const biab = menu.services.find(item => item.name === 'BIAB Builder Gel')!.id;
const addon = (name: string) => menu.addOns.find(item => item.name === name)!.id;
const short = addon('Short Length');
const medium = addon('Medium Length');
const chrome = addon('Chrome Finish');
const french = addon('French Tips');
const base: CustomerSelection = { baseServiceId: gelx, selectedAddOns: [] };
const readyFacts: Facts = { ...emptyFacts(), treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'short', designPreference: 'skip' };
const optionalLengths = { ...snapshot, addOnGroups: snapshot.addOnGroups.map(group => ({ ...group, minSelections: 0 })) };
const assess = (facts: Facts, candidate = base, catalogue = snapshot) => assessCustomerConsultation({ menu, snapshot: catalogue, facts, candidate });

describe('server-owned consultation completeness', () => {
  it('asks an optional extension length even if a model directly proposes a valid base', () => {
    expect(assess({ ...readyFacts, length: 'unknown' }, base, optionalLengths)).toMatchObject({ kind: 'clarification', question: 'length' });
  });

  it('does not count an unrequested model length as a customer decision', () => {
    expect(assess({ ...readyFacts, length: 'unknown' }, { ...base, selectedAddOns: [{ addOnId: medium, quantity: 1 }] }, optionalLengths)).toMatchObject({ kind: 'clarification', question: 'length' });
  });

  it('offers an explicitly named base choice without inventing Short or a paid upgrade', () => {
    const noShortMenu = { ...menu, addOns: menu.addOns.filter(item => item.id !== short), bindings: menu.bindings.filter(item => item.addOnId !== short) };
    const noShortSnapshot = { ...optionalLengths, addOns: optionalLengths.addOns.filter(item => item.id !== short), serviceAddOnBindings: optionalLengths.serviceAddOnBindings.filter(item => item.addOnId !== short) };
    const facts = { ...readyFacts, length: 'unknown' } as Facts;
    const result = assessCustomerConsultation({ menu: noShortMenu, snapshot: noShortSnapshot, facts, candidate: base });

    expect(result.kind).toBe('clarification');

    if (result.kind !== 'clarification') {
      return;
    }
    const choices = customerConsultationChoices({ menu: noShortMenu, snapshot: noShortSnapshot, facts, candidate: base, result, locale: 'en' });

    expect(choices[0]).toMatchObject({ label: 'Base service / no length upgrade', subtotalCents: 7000, deltaCents: 0 });
    expect(choices.some(choice => /short/i.test(choice.label))).toBe(false);
    expect(assessCustomerConsultation({ menu: noShortMenu, snapshot: noShortSnapshot, facts: { ...facts, lengthChoice: 'base' }, candidate: base }).kind).toBe('selection');
  });

  it('requires known starting product and removal origin before completing a viable removal path', () => {
    expect(assess({ ...readyFacts, existingProduct: 'unknown' })).toMatchObject({ kind: 'clarification', question: 'product' });
    expect(assess({ ...readyFacts, existingProduct: 'gel_x', removal: 'yes' })).toMatchObject({ kind: 'clarification', question: 'origin' });
  });

  it('offers designs once, and no French alone still allows chrome', () => {
    const facts: Facts = { ...readyFacts, designPreference: 'unknown', french: 'no' };
    const result = assess(facts);

    expect(result).toMatchObject({ kind: 'clarification', question: 'finish' });

    if (result.kind !== 'clarification') {
      return;
    }

    expect(result.optionIds).toContain(chrome);
    expect(result.optionIds).not.toContain(french);

    for (const designPreference of ['plain', 'skip'] as const) {
      expect(assess({ ...facts, designPreference }).kind).toBe('selection');
    }
  });

  it('asks about existing product on a natural-nail service even when no removal SKU exists', () => {
    const manicure = menu.services.find(item => item.name === 'Gel Manicure')!.id;

    expect(assess({ ...emptyFacts(), treatment: 'gel_polish', desiredApplication: 'natural_nails', designPreference: 'plain' }, { baseServiceId: manicure, selectedAddOns: [] })).toMatchObject({ kind: 'clarification', question: 'product' });
  });

  it('can book a gel-polish refresh as the normal gel manicure without a removal add-on', () => {
    const manicure = menu.services.find(item => item.name === 'Gel Manicure')!.id;
    const facts: Facts = { ...emptyFacts(), treatment: 'gel_polish', desiredApplication: 'natural_nails', existingProduct: 'gel_polish', removal: 'unknown', designPreference: 'plain' };

    expect(assess(facts, { baseServiceId: manicure, selectedAddOns: [] })).toEqual({ kind: 'selection', selection: { baseServiceId: manicure, selectedAddOns: [] } });
  });

  it('keeps a salon-automatic gel removal in the authoritative refresh quote', () => {
    const serviceId = 'svc_refresh';
    const addOnId = 'addon_required_removal';
    const built = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: serviceId, name: 'Gel Manicure', price: 4000, durationMinutes: 60 })],
      addOns: [makeFixtureAddOn({ id: addOnId, name: 'Gel Polish Removal', priceCents: 1000, durationMinutes: 15, category: 'removal' })],
      serviceAddOnBindings: [makeFixtureBinding({ id: 'binding_required_removal', serviceId, addOnId })],
      addOnGroups: [],
      rules: [makeFixtureRule({ id: 'rule_include_removal', ruleType: 'include', subjectServiceId: serviceId, objectAddOnId: addOnId, params: { autoAdd: true } })],
    });

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }
    const catalogue = projectPublicBookingCatalog(built.snapshot, new Set([serviceId]));
    const configuredMenu = {
      services: [{ id: serviceId, name: 'Gel Manicure', description: '', category: 'manicure' }],
      addOns: [{ id: addOnId, name: 'Gel Polish Removal', description: '', category: 'removal', pricingType: 'fixed', maxQuantity: 1, durationMinutes: 15 }],
      bindings: [{ serviceId, addOnId, required: false, defaultQuantity: 1, maxQuantity: 1 }],
    };
    const currentFacts: Facts = { ...emptyFacts(), treatment: 'gel_polish', desiredApplication: 'natural_nails', existingProduct: 'gel_polish', designPreference: 'plain' };
    const outcome = assessCustomerConsultation({ menu: configuredMenu, snapshot: catalogue, facts: currentFacts, candidate: { baseServiceId: serviceId, selectedAddOns: [] } });

    expect(outcome.kind).toBe('selection');

    if (outcome.kind === 'selection') {
      expect(resolveCatalogSelection(catalogue, { serviceId, selectedAddOns: outcome.selection.selectedAddOns })).toMatchObject({ ok: true, selection: { totalDurationMinutes: 75, addOns: [{ addOnId }] } });
    }
  });

  it('keeps an unknown-product assessment in the real selection and reserves its twenty minutes', () => {
    const serviceId = 'svc_assessment_manicure';
    const addOnId = 'addon_assessment';
    const built = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: serviceId, name: 'Gel Manicure', price: 4000, durationMinutes: 60 })],
      addOns: [makeFixtureAddOn({ id: addOnId, name: 'Existing product assessment', priceCents: 0, durationMinutes: 20, category: 'removal' })],
      serviceAddOnBindings: [makeFixtureBinding({ id: 'binding_assessment', serviceId, addOnId, priceMode: 'manual_confirmation' })],
      addOnGroups: [],
      rules: [],
    });

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }
    const catalogue = projectPublicBookingCatalog(built.snapshot, new Set([serviceId]));
    const configuredMenu = {
      services: [{ id: serviceId, name: 'Gel Manicure', description: '', category: 'manicure' }],
      addOns: [{ id: addOnId, name: 'Existing product assessment', description: '', category: 'removal', pricingType: 'fixed', maxQuantity: 1, durationMinutes: 20 }],
      bindings: [{ serviceId, addOnId, required: false, defaultQuantity: 1, maxQuantity: 1, priceMode: 'manual_confirmation' as const }],
    };
    const currentFacts: Facts = { ...emptyFacts(), treatment: 'gel_polish', desiredApplication: 'natural_nails', existingProduct: 'unknown', currentProductUncertain: true, designPreference: 'plain' };
    const outcome = assessCustomerConsultation({ menu: configuredMenu, snapshot: catalogue, facts: currentFacts, candidate: { baseServiceId: serviceId, selectedAddOns: [] } });

    expect(outcome).toEqual({ kind: 'selection', selection: { baseServiceId: serviceId, selectedAddOns: [{ addOnId, quantity: 1 }] } });

    if (outcome.kind === 'selection') {
      expect(resolveCatalogSelection(catalogue, { serviceId, selectedAddOns: outcome.selection.selectedAddOns })).toMatchObject({ ok: true, selection: { totalDurationMinutes: 80, addOns: [{ addOnId, priceMode: 'manual_confirmation' }] } });
    }
  });

  it('uses one salon-configured general other-salon removal without requiring the product name in the add-on', () => {
    const manicure = menu.services.find(item => item.name === 'Gel Manicure')!.id;
    const generalRemoval = addon('Removal From Another Salon');
    const facts: Facts = {
      ...emptyFacts(),
      treatment: 'gel_polish',
      desiredApplication: 'natural_nails',
      existingProduct: 'builder_gel',
      origin: 'other_salon',
      removal: 'yes',
      designPreference: 'plain',
    };

    const expected = {
      kind: 'selection',
      selection: { baseServiceId: manicure, selectedAddOns: [{ addOnId: generalRemoval, quantity: 1 }] },
    } as const;

    expect(resolveSemanticSelection({ menu, facts, candidate: { baseServiceId: manicure, selectedAddOns: [] } })).toEqual(expected);
    expect(assess(facts, { baseServiceId: manicure, selectedAddOns: [] })).toEqual(expected);
  });

  it('uses an included own-work removal with its configured duration and no extra charge', () => {
    const manicure = menu.services.find(item => item.name === 'Gel Manicure')!.id;
    const ownRemoval = addon('Removal of Our Work');
    const facts: Facts = {
      ...emptyFacts(),
      treatment: 'gel_polish',
      desiredApplication: 'natural_nails',
      existingProduct: 'builder_gel',
      origin: 'this_salon',
      removal: 'yes',
      designPreference: 'plain',
    };
    const result = assess(facts, { baseServiceId: manicure, selectedAddOns: [] });
    const quote = resolveCatalogSelection(snapshot, { serviceId: manicure, selectedAddOns: [{ addOnId: ownRemoval, quantity: 1 }] });

    expect(result).toEqual({ kind: 'selection', selection: { baseServiceId: manicure, selectedAddOns: [{ addOnId: ownRemoval, quantity: 1 }] } });

    expect(quote).toMatchObject({ ok: true, selection: { subtotalCents: 4000, totalDurationMinutes: 75 } });
  });

  it('accepts an explicitly included base length without a fabricated add-on ID', () => {
    const includedMenu = { ...menu, services: menu.services.map(item => item.id === gelx ? { ...item, description: 'Short length included.' } : item), addOns: menu.addOns.filter(item => item.id !== short), bindings: menu.bindings.filter(item => item.addOnId !== short) };
    const includedSnapshot = { ...optionalLengths, addOns: optionalLengths.addOns.filter(item => item.id !== short), serviceAddOnBindings: optionalLengths.serviceAddOnBindings.filter(item => item.addOnId !== short) };
    const result = assessCustomerConsultation({ menu: includedMenu, snapshot: includedSnapshot, facts: readyFacts, candidate: base });

    expect(result).toEqual({ kind: 'selection', selection: base });
  });

  it('never labels an unavailable requested Short as an included base but offers real alternatives', () => {
    const noShortMenu = { ...menu, addOns: menu.addOns.filter(item => item.id !== short), bindings: menu.bindings.filter(item => item.addOnId !== short) };
    const noShortSnapshot = { ...optionalLengths, addOns: optionalLengths.addOns.filter(item => item.id !== short), serviceAddOnBindings: optionalLengths.serviceAddOnBindings.filter(item => item.addOnId !== short) };

    expect(assessCustomerConsultation({ menu: noShortMenu, snapshot: noShortSnapshot, facts: readyFacts, candidate: base })).toMatchObject({ kind: 'clarification', question: 'length' });
  });

  it.each(['Chrome Finish', 'French Tips'])('does not accept an unrequested model %s as a paid choice', (name) => {
    const result = assess({ ...readyFacts, designPreference: 'unknown' }, { ...base, selectedAddOns: [{ addOnId: addon(name), quantity: 1 }] });

    expect(result).toMatchObject({ kind: 'clarification', question: 'finish' });

    if (result.kind === 'clarification') {
      expect(result.selection?.selectedAddOns.some(item => item.addOnId === addon(name))).toBe(false);
    }
  });

  it('clears a prior paid length when switching to a publicly included base length, preserving French', () => {
    const includedMenu = { ...menu, services: menu.services.map(item => item.id === gelx ? { ...item, description: 'Short length included.' } : item), addOns: menu.addOns.filter(item => item.id !== short), bindings: menu.bindings.filter(item => item.addOnId !== short) };
    const includedSnapshot = { ...optionalLengths, addOns: optionalLengths.addOns.filter(item => item.id !== short), serviceAddOnBindings: optionalLengths.serviceAddOnBindings.filter(item => item.addOnId !== short) };

    expect(assessCustomerConsultation({ menu: includedMenu, snapshot: includedSnapshot, facts: { ...readyFacts, french: 'yes' }, candidate: { ...base, selectedAddOns: [{ addOnId: medium, quantity: 1 }, { addOnId: french, quantity: 1 }] } })).toEqual({ kind: 'selection', selection: { ...base, selectedAddOns: [{ addOnId: french, quantity: 1 }] } });
  });

  it('offers a sole glitter design through the shared design vocabulary', () => {
    const glitterMenu = { ...menu, addOns: menu.addOns.filter(item => item.id !== french).map(item => item.id === chrome ? { ...item, name: 'Glitter' } : item), bindings: menu.bindings.filter(item => item.addOnId !== french) };
    const glitterSnapshot = { ...snapshot, addOns: snapshot.addOns.filter(item => item.id !== french).map(item => item.id === chrome ? { ...item, name: 'Glitter' } : item), serviceAddOnBindings: snapshot.serviceAddOnBindings.filter(item => item.addOnId !== french) };

    expect(assessCustomerConsultation({ menu: glitterMenu, snapshot: glitterSnapshot, facts: { ...readyFacts, designPreference: 'unknown' }, candidate: base })).toMatchObject({ kind: 'clarification', question: 'finish', optionIds: [chrome] });
  });

  it('prices variant choices with the same preserved French and removal selection as the switch', () => {
    const baseService = snapshot.services.find(item => item.id === gelx)!;
    const shortId = 'variant_short';
    const mediumId = 'variant_medium';
    const variantServices = [
      { ...baseService, id: shortId, kind: 'child' as const, parentServiceId: gelx, variantLabel: 'Short', priceCents: 7000 },
      { ...baseService, id: mediumId, kind: 'child' as const, parentServiceId: gelx, variantLabel: 'Medium', priceCents: 8000 },
    ];
    const variantBindings = snapshot.serviceAddOnBindings.filter(item => item.serviceId === gelx && ![short, medium, addon('Long Length')].includes(item.addOnId)).flatMap(binding => [shortId, mediumId].map(serviceId => ({ ...binding, serviceId })));
    const variantSnapshot = { ...optionalLengths, services: [...snapshot.services.map(item => item.id === gelx ? { ...item, kind: 'parent' as const, selectionMode: 'guided' as const } : item), ...variantServices], serviceAddOnBindings: [...snapshot.serviceAddOnBindings, ...variantBindings] };
    const variantMenu = { ...menu, l1: { ...menu.l1!, services: variantSnapshot.services }, services: [...menu.services, ...variantServices.map(item => ({ id: item.id, name: `Gel-X Extensions · ${item.variantLabel}`, description: '', category: item.category }))], bindings: [...menu.bindings, ...variantBindings.map(item => ({ serviceId: item.serviceId, addOnId: item.addOnId, required: false, defaultQuantity: 1, maxQuantity: item.effectiveMaxQuantity }))] };
    const removal = addon('Gel-X Removal');
    const candidate = { baseServiceId: mediumId, selectedAddOns: [{ addOnId: french, quantity: 1 }, { addOnId: removal, quantity: 1 }] };
    const facts: Facts = { ...readyFacts, length: 'medium', french: 'yes', existingProduct: 'gel_x', origin: 'this_salon', removal: 'yes' };
    const choices = customerConsultationChoices({ menu: variantMenu, snapshot: variantSnapshot, facts, candidate, result: { kind: 'clarification', question: 'service', optionIds: [shortId] }, locale: 'en' });

    expect(choices[0]).toMatchObject({ subtotalCents: 9500, durationMinutes: 125, deltaCents: -1000 });
    expect(assessCustomerConsultation({ menu: variantMenu, snapshot: variantSnapshot, facts: { ...facts, length: 'unknown' }, candidate })).toMatchObject({ kind: 'clarification', question: 'length', optionIds: expect.arrayContaining([shortId, mediumId]) });

    const requiredChrome = { ...variantSnapshot, ruleProjections: [{ projectionKey: 'short-requires-chrome', effect: 'require' as const, trigger: { subjectKind: 'service' as const, subjectId: shortId }, serviceScopeId: shortId, targetAddOnId: chrome, reasonCode: 'required_for_selection' as const, reasonText: 'Required', presentation: 'surface' as const }] };

    expect(assessCustomerConsultation({ menu: variantMenu, snapshot: requiredChrome, facts: { ...facts, length: 'unknown' }, candidate })).toMatchObject({ kind: 'clarification', question: 'length', optionIds: expect.arrayContaining([shortId, mediumId]) });
  });

  it('never gives an irrelevant extension length question for natural-nail services', () => {
    expect(assess({ ...emptyFacts(), treatment: 'builder_gel', desiredApplication: 'natural_nails', existingProduct: 'none', designPreference: 'plain' }, { baseServiceId: biab, selectedAddOns: [] }).kind).toBe('selection');
  });

  it('requires the requested repair quantity instead of retaining a guessed one', () => {
    expect(assess(readyFacts, { ...base, selectedAddOns: [{ addOnId: addon('Nail Repair'), quantity: 1 }] })).toMatchObject({ kind: 'clarification', question: 'quantity' });
  });

  it('allows a fixed automatic length only after confirming no different length can be selected', () => {
    const fixed = { ...snapshot, ruleProjections: [{ projectionKey: 'included-short', effect: 'auto_add' as const, trigger: { subjectKind: 'service' as const, subjectId: gelx }, serviceScopeId: gelx, targetAddOnId: short, reasonCode: 'included_with_selection' as const, reasonText: 'Included', presentation: 'surface' as const }] };

    expect(assess({ ...readyFacts, length: 'unknown' }, base, fixed)).toEqual({ kind: 'selection', selection: base });
  });

  it('prices complete choices with automatic extras using L1 and never exposes incomplete totals', () => {
    const pricedSnapshot = { ...snapshot, ruleProjections: [...snapshot.ruleProjections, { projectionKey: 'medium-includes-chrome', effect: 'auto_add' as const, trigger: { subjectKind: 'addOn' as const, subjectId: medium }, serviceScopeId: gelx, targetAddOnId: chrome, reasonCode: 'included_with_selection' as const, reasonText: 'Included', presentation: 'surface' as const }] };
    const result = { kind: 'clarification' as const, question: 'length' as const, optionIds: [medium] };
    const choices = customerConsultationChoices({ menu, snapshot: pricedSnapshot, facts: readyFacts, candidate: base, result, locale: 'en' });
    const authoritative = resolveCatalogSelection(pricedSnapshot, { serviceId: gelx, selectedAddOns: [{ addOnId: medium, quantity: 1 }] });

    expect(authoritative.ok).toBe(true);

    if (authoritative.ok) {
      expect(choices[0]).toMatchObject({ subtotalCents: authoritative.selection.subtotalCents, durationMinutes: authoritative.selection.totalDurationMinutes });
    }

    expect(choices[0]!.deltaCents).toBeUndefined();

    const incomplete = customerConsultationChoices({ menu, snapshot, facts: readyFacts, candidate: base, result: { ...result, question: 'finish', optionIds: [chrome] }, locale: 'en' });

    expect(incomplete[0]!.subtotalCents).toBeUndefined();
    expect(incomplete).toHaveLength(1);
  });

  it('plain removes designs but does not remove a requested repair or length', () => {
    const result = assess({ ...readyFacts, repairCount: 2, designPreference: 'plain' }, { ...base, selectedAddOns: [{ addOnId: chrome, quantity: 1 }] });

    expect(result).toMatchObject({ kind: 'selection' });

    if (result.kind === 'selection') {
      expect(result.selection.selectedAddOns).toEqual(expect.arrayContaining([{ addOnId: short, quantity: 1 }, { addOnId: addon('Nail Repair'), quantity: 2 }]));
      expect(result.selection.selectedAddOns.some(item => item.addOnId === chrome)).toBe(false);
    }
  });

  it('a new physical length clears a previous base choice and a base choice never asserts Short', () => {
    const patch = { schemaVersion: 1 as const, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null };

    expect(mergeFacts(readyFacts, { ...patch, lengthChoice: 'base' })).toMatchObject({ length: 'unknown', lengthChoice: 'base' });
    expect(mergeFacts({ ...readyFacts, lengthChoice: 'base' }, { ...patch, length: 'medium' }).lengthChoice).toBeUndefined();
  });
});

it('quotes known configuration only when optional finish is the sole remaining question', () => {
  const facts = { ...readyFacts, length: 'medium' as const, designPreference: 'unknown' as const };
  const draft = { ...base, selectedAddOns: [{ addOnId: medium, quantity: 1 }] };
  const selected = customerPartialQuoteSelection({ menu, snapshot, facts, candidate: draft });

  expect(selected).toEqual(draft);
  expect(customerPartialQuoteSelection({ menu, snapshot, facts: { ...facts, length: 'unknown' }, candidate: draft })).toBeNull();
  expect(customerPartialQuoteSelection({ menu, snapshot, facts: { ...facts, existingProduct: 'unknown' }, candidate: draft })).toBeNull();
  expect(customerPartialQuoteSelection({ menu, snapshot, facts: { ...facts, existingProduct: 'acrylic', origin: 'other_salon' }, candidate: draft })).toBeNull();
});
