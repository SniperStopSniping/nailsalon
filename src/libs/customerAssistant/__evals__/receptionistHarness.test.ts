import { expect, it, vi } from 'vitest';

import { createCustomerConversation } from '../conversation.server';
import { customerInterpretationSchema } from '../interpretation';
import { evaluateReceptionistTurn } from './receptionistHarness';
import { SEMANTIC_L1_MENU } from './semanticCases';

vi.mock('server-only', () => ({}));
const patch = { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, origin: null, removal: null, repairCount: null };
const intent = (extra: Record<string, unknown>) => customerInterpretationSchema.parse({ factUpdates: patch, action: 'propose', answerTopic: null, addOnUpdates: { add: [], remove: [] }, serviceId: 'svc_semantic_gelx', addOns: [], question: 'details', optionIds: [], ...extra });

it('runs multi-turn corrections and education through runtime resolution and the L1 authority', async () => {
  let state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium', french: 'yes' } }), state, { message: 'medium Gel-X French bare nails', kinds: ['proposal'], price: 9000, duration: 120 });

  expect(first.failures).toEqual([]);

  state = first.next;
  const longer = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, length: 'long' } }), state, { message: 'Actually long', kinds: ['proposal'], price: 10000, duration: 135 });

  expect(longer.failures).toEqual([]);

  state = longer.next;
  const chrome = SEMANTIC_L1_MENU.addOns.find(item => item.name === 'Chrome Finish')!.id;
  const french = SEMANTIC_L1_MENU.addOns.find(item => item.name === 'French Tips')!.id;
  const changed = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, french: 'no' }, addOnUpdates: { add: [{ addOnId: chrome, quantity: 1 }], remove: [french] } }), state, { message: 'instead chrome', kinds: ['proposal'], price: 10200, duration: 130 });

  expect(changed.failures).toEqual([]);

  state = changed.next;
  const answer = await evaluateReceptionistTurn(intent({ action: 'answer', answerTopic: 'service_information', serviceId: 'svc_semantic_biab' }), state, { message: 'BIAB versus Gel-X?', kinds: ['answer'] });

  expect(answer.failures).toEqual([]);
  expect(answer.next.context?.selection).toEqual(state.context?.selection);
  expect(answer.next.requestedSelection).toEqual(state.requestedSelection);
});

it('diagnoses acrylic as a current-condition removal issue without replacing the desired service', async () => {
  const result = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'acrylic', length: 'medium', origin: 'other_salon', removal: 'yes' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'have acrylic want gelx', kinds: ['unavailable'], reason: 'unsupported_removal' });

  expect(result.failures).toEqual([]);
});

it('preserves desired design edits during answers and invalidates the old proposal authority', async () => {
  const chrome = 'addon_semantic_chrome';
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', existingProduct: 'none', length: 'medium' }, addOnUpdates: { add: [{ addOnId: chrome, quantity: 1 }], remove: [] } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium Gel-X with chrome, nothing on my nails', kinds: ['proposal'], price: 9200, duration: 115 });

  expect(first.failures).toEqual([]);

  const answer = await evaluateReceptionistTurn(intent({ action: 'answer', selectionChangeExplicitThisTurn: true, answerTopic: 'compare_treatments', addOnUpdates: { add: [], remove: [chrome] } }), first.next, { message: 'Remove chrome, and what is BIAB?', kinds: ['proposal'], price: 8000, duration: 105 });

  expect(answer.next.requestedSelection?.selectedAddOns.some(item => item.addOnId === chrome)).toBe(false);
  expect(answer.failures).toEqual([]);
  expect(answer.result).toMatchObject({ kind: 'proposal', proposal: { subtotalCents: 8000 } });
  expect(answer.next.context?.selection).toEqual(answer.next.requestedSelection);
  expect(answer.next.booking).toBeUndefined();

  const followup = await evaluateReceptionistTurn(intent({}), answer.next, { message: 'Keep the Gel-X', kinds: ['proposal'], price: 8000, duration: 105 });

  expect(followup.failures).toEqual([]);
});

it('applies an explicit add-on update through L1 despite consumed invalid clarification options', async () => {
  const french = SEMANTIC_L1_MENU.addOns.find(item => item.name === 'French Tips')!.id;
  const first = await evaluateReceptionistTurn(intent({
    factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium' },
  }), createCustomerConversation('synthetic-isla', 'synthetic-only'), {
    message: 'medium Gel-X on bare nails',
    kinds: ['proposal'],
    price: 8000,
    duration: 105,
  });

  const changed = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'product',
    optionIds: ['not-a-public-option'],
    addOns: [{ addOnId: french, quantity: 1 }],
    addOnUpdates: { add: [{ addOnId: french, quantity: 1 }], remove: [] },
    factUpdates: { ...patch, french: 'yes' },
  }), first.next, {
    message: 'add French',
    kinds: ['proposal'],
    price: 9000,
    duration: 120,
  });

  expect(changed.failures).toEqual([]);
  expect(changed.next.requestedSelection?.selectedAddOns).toContainEqual({ addOnId: french, quantity: 1 });
});

it('keeps an interpreted service while L1 asks only for its unresolved option', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = { schemaVersion: 1, treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'unknown', length: 'unknown', french: 'unknown', existingProduct: 'unknown', origin: 'unknown', removal: 'unknown', repairCount: 'unknown' };
  const result = await evaluateReceptionistTurn(intent({ action: 'clarify', question: 'length' }), state, { message: 'Okay Gel-X', kinds: ['clarification'] });

  expect(result.result).toMatchObject({ kind: 'clarification', question: 'length' });
});

it('asks about the starting condition instead of requiring a removal SKU when product is unknown', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  const first = await evaluateReceptionistTurn(intent({ action: 'clarify', question: 'removal', factUpdates: { ...patch, treatment: 'gel_x', maintenance: 'new_set', length: 'medium' } }), state, { message: 'Medium Gel-X', kinds: ['clarification'] });

  expect(first.result).toMatchObject({ kind: 'clarification', question: 'product', options: expect.arrayContaining(['Nothing']) });

  const bare = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, existingProduct: 'none', removal: 'no' } }), first.next, { message: 'Nothing', kinds: ['clarification'] });

  expect(bare.failures).toEqual([]);
  expect(bare.next.facts?.existingProduct).toBe('none');
  expect(bare.result).toMatchObject({ kind: 'clarification', question: 'finish' });

  const skipped = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, designPreference: 'skip' } }), bare.next, { message: 'Skip for now', kinds: ['proposal'], price: 8000, duration: 105 });

  expect(skipped.failures).toEqual([]);
});

it('does not inherit a refill into a changed service while retaining the existing product', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = {
    schemaVersion: 1,
    treatment: 'acrylic',
    desiredApplication: 'unknown',
    maintenance: 'refill',
    length: 'unknown',
    french: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
    removal: 'unknown',
    repairCount: 'unknown',
  };
  const result = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'removal',
    factUpdates: { ...patch, treatment: 'builder_gel' },
  }), state, {
    message: 'What about BIAB instead?',
    kinds: ['clarification'],
  });

  expect(result.failures).toEqual([]);
  expect(result.next.facts).toMatchObject({
    treatment: 'builder_gel',
    maintenance: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
  });
  expect(result.result).toEqual({ kind: 'clarification', question: 'origin', options: [] });
});

it('does not inherit an extension application into a changed natural-nail service', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = {
    schemaVersion: 1,
    treatment: 'acrylic',
    desiredApplication: 'extensions',
    maintenance: 'refill',
    length: 'medium',
    french: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
    removal: 'unknown',
    repairCount: 'unknown',
  };
  const result = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'removal',
    factUpdates: { ...patch, treatment: 'builder_gel' },
  }), state, {
    message: 'What about BIAB instead?',
    kinds: ['clarification'],
  });

  expect(result.failures).toEqual([]);
  expect(result.next.facts).toMatchObject({
    treatment: 'builder_gel',
    desiredApplication: 'unknown',
    maintenance: 'unknown',
    existingProduct: 'acrylic',
  });
  expect(result.result).toEqual({ kind: 'clarification', question: 'origin', options: [] });
});

it('does not reuse a prior no-removal answer after a changed service', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = {
    schemaVersion: 1,
    treatment: 'acrylic',
    desiredApplication: 'extensions',
    maintenance: 'refill',
    length: 'medium',
    french: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
    removal: 'no',
    repairCount: 'unknown',
  };
  const changed = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'removal',
    factUpdates: { ...patch, treatment: 'builder_gel' },
  }), state, {
    message: 'What about BIAB instead?',
    kinds: ['clarification'],
  });

  expect(changed.failures).toEqual([]);
  expect(changed.next.facts).toMatchObject({
    treatment: 'builder_gel',
    desiredApplication: 'unknown',
    maintenance: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
    removal: 'unknown',
  });
  expect(changed.result).toEqual({ kind: 'clarification', question: 'origin', options: [] });

  const continued = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'origin',
    factUpdates: { ...patch, origin: 'other_salon' },
  }), changed.next, {
    message: 'From another salon',
    kinds: ['clarification'],
  });

  expect(continued.failures).toEqual([]);
  expect(continued.result).toEqual({ kind: 'clarification', question: 'removal', options: [] });
});

it('does not treat an echoed refill as authority for a cross-product switch', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = {
    schemaVersion: 1,
    treatment: 'acrylic',
    desiredApplication: 'extensions',
    maintenance: 'refill',
    length: 'medium',
    french: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
    removal: 'yes',
    repairCount: 'unknown',
  };
  const result = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'removal',
    // This reproduces a provider echo from an earlier acrylic refill while the
    // latest customer message changes only the desired treatment to BIAB.
    factUpdates: { ...patch, treatment: 'builder_gel', desiredApplication: 'extensions', maintenance: 'refill', removal: 'yes' },
  }), state, {
    message: 'What about BIAB instead?',
    kinds: ['unavailable'],
    reason: 'transition_needs_confirmation',
  });

  expect(result.failures).toEqual([]);
  expect(result.next.facts).toMatchObject({
    treatment: 'builder_gel',
    desiredApplication: 'extensions',
    maintenance: 'refill',
    existingProduct: 'acrylic',
    removal: 'yes',
  });
});

it('does not quote a cross-product request as bare nails after an explicit no-removal answer', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = {
    schemaVersion: 1,
    treatment: 'acrylic',
    desiredApplication: 'extensions',
    maintenance: 'refill',
    length: 'medium',
    french: 'unknown',
    existingProduct: 'acrylic',
    origin: 'unknown',
    removal: 'unknown',
    repairCount: 'unknown',
  };
  const result = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'removal',
    factUpdates: { ...patch, treatment: 'builder_gel', removal: 'no' },
  }), state, {
    message: 'What about BIAB instead, with no removal?',
    kinds: ['unavailable'],
    reason: 'transition_needs_confirmation',
  });

  expect(result.failures).toEqual([]);
  expect(result.next.facts).toMatchObject({
    treatment: 'builder_gel',
    existingProduct: 'acrylic',
    removal: 'no',
  });
  expect(result.result).toEqual({ kind: 'unavailable', reason: 'transition_needs_confirmation' });
});

it('keeps an explicit removal choice when the customer changes service', async () => {
  const state = createCustomerConversation('synthetic-isla', 'synthetic-only');
  state.facts = {
    schemaVersion: 1,
    treatment: 'acrylic',
    desiredApplication: 'extensions',
    maintenance: 'refill',
    length: 'medium',
    french: 'unknown',
    existingProduct: 'acrylic',
    origin: 'other_salon',
    removal: 'yes',
    repairCount: 'unknown',
  };
  const result = await evaluateReceptionistTurn(intent({
    action: 'clarify',
    question: 'removal',
    factUpdates: { ...patch, treatment: 'builder_gel' },
  }), state, {
    message: 'What about BIAB instead?',
    kinds: ['proposal', 'unavailable'],
  });

  expect(result.failures).toEqual([]);
  expect(result.next.facts).toMatchObject({
    treatment: 'builder_gel',
    desiredApplication: 'unknown',
    maintenance: 'unknown',
    existingProduct: 'acrylic',
    origin: 'other_salon',
    removal: 'yes',
  });
  expect(result.result).not.toEqual({ kind: 'clarification', question: 'removal', options: [] });
});

it('leaves informational turns and same-product refills outside the cross-product guard', async () => {
  const informational = await evaluateReceptionistTurn(intent({
    action: 'answer',
    answerTopic: 'service_information',
    factUpdates: { ...patch, treatment: 'builder_gel', existingProduct: 'acrylic', removal: 'no' },
  }), createCustomerConversation('synthetic-isla', 'synthetic-only'), {
    message: 'What is BIAB?',
    kinds: ['answer'],
  });

  expect(informational.failures).toEqual([]);

  const refill = await evaluateReceptionistTurn(intent({
    serviceId: 'svc_semantic_gelx_fill',
    factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'refill', existingProduct: 'gel_x', origin: 'this_salon', removal: 'no', designPreference: 'plain' },
  }), createCustomerConversation('synthetic-isla', 'synthetic-only'), {
    message: 'Gel-X refill, no removal',
    kinds: ['proposal'],
    price: 6000,
    duration: 90,
  });

  expect(refill.failures).toEqual([]);
});

it('never offers a different product removal when a transition fact is known but removal is unanswered', async () => {
  const result = await evaluateReceptionistTurn(intent({ action: 'clarify', question: 'removal', factUpdates: { ...patch, treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'acrylic', origin: 'other_salon', length: 'medium', removal: 'unknown' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'I have acrylic but want Gel-X', kinds: ['unavailable'], reason: 'unsupported_removal' });

  expect(result.failures).toEqual([]);
  expect(result.next.facts?.removal).toBe('unknown');
});

it('re-resolves a length correction inside a price question before exposing the new total', async () => {
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium', designPreference: 'plain' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium Gel-X on bare nails', kinds: ['proposal'], price: 8000, duration: 105 });
  first.next.booking = { acceptedFingerprint: 'a'.repeat(64), datePreference: { date: '2026-09-19', earliest: '09:00', latest: '17:00' }, offeredSlots: [{ time: '09:00', startTime: '2026-09-19T13:00:00.000Z' }], selectedSlot: null };
  const corrected = await evaluateReceptionistTurn(intent({ action: 'answer', selectionChangeExplicitThisTurn: true, answerTopic: 'price', factUpdates: { ...patch, length: 'short' } }), first.next, { message: 'actually short, how much now?', kinds: ['proposal'], price: 7000, duration: 90 });

  expect(corrected.failures).toEqual([]);
  expect(corrected.next.facts?.existingProduct).toBe('none');
  expect(corrected.next.booking).toBeUndefined();
  expect(corrected.next.context?.selection).toEqual(corrected.next.requestedSelection);
  expect(corrected.next.requestedSelection?.selectedAddOns).not.toContainEqual({ addOnId: 'addon_semantic_medium', quantity: 1 });
});

it('clears an inherited extension length when an explicit treatment switch moves to natural nails', async () => {
  const gelx = 'svc_semantic_gelx';
  const biab = 'svc_semantic_biab';
  const first = await evaluateReceptionistTurn(intent({
    serviceId: gelx,
    factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'long', french: 'yes' },
  }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'long Gel-X with French on bare nails', kinds: ['proposal'] });

  const switched = await evaluateReceptionistTurn(intent({
    serviceId: biab,
    // Structured model output may echo the old long value while removing the
    // corresponding catalogue add-on; that echo is not a new design choice.
    factUpdates: { ...patch, treatment: 'builder_gel', desiredApplication: 'natural_nails', length: 'long' },
  }), first.next, { message: 'Actually forget Gel-X, I want BIAB', kinds: ['proposal'] });

  expect(switched.failures).toEqual([]);
  expect(switched.next.facts).toMatchObject({ treatment: 'builder_gel', desiredApplication: 'natural_nails', length: 'unknown', french: 'yes' });

  const noApplicationPatch = await evaluateReceptionistTurn(intent({
    serviceId: biab,
    factUpdates: { ...patch, treatment: 'builder_gel' },
  }), first.next, { message: 'Actually forget Gel-X, I want BIAB', kinds: ['proposal'] });

  expect(noApplicationPatch.failures).toEqual([]);
  expect(noApplicationPatch.next.facts).toMatchObject({ treatment: 'builder_gel', length: 'unknown', french: 'yes', existingProduct: 'none' });
  expect(noApplicationPatch.next.requestedSelection?.selectedAddOns).not.toContainEqual({ addOnId: 'addon_semantic_long', quantity: 1 });

  const explicitLength = await evaluateReceptionistTurn(intent({
    serviceId: gelx,
    factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'long' },
  }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'long Gel-X on bare nails', kinds: ['proposal'] });
  const switchedWithLength = await evaluateReceptionistTurn(intent({
    serviceId: biab,
    factUpdates: { ...patch, treatment: 'builder_gel', desiredApplication: 'natural_nails', length: 'short' },
  }), explicitLength.next, { message: 'Actually BIAB, but short', kinds: ['proposal'] });

  expect(switchedWithLength.next.facts?.length).toBe('short');

  const explicitlyRetained = await evaluateReceptionistTurn(intent({
    serviceId: biab,
    lengthExplicitThisTurn: true,
    factUpdates: { ...patch, treatment: 'builder_gel', desiredApplication: 'natural_nails', length: 'long' },
  }), explicitLength.next, { message: 'Actually BIAB, but keep them long', kinds: ['proposal', 'clarification', 'unavailable'] });

  expect(explicitlyRetained.next.facts?.length).toBe('long');
  expect(explicitlyRetained.result).toEqual({ kind: 'unavailable', reason: 'unsupported_combination' });
  expect(explicitlyRetained.next.facts?.treatment).toBe('builder_gel');
});

it('quotes without French as a hypothetical full selection while preserving every draft fact and choice', async () => {
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium', french: 'yes' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium Gel-X with French on bare nails', kinds: ['proposal'], price: 9000, duration: 120 });
  const answer = await evaluateReceptionistTurn(intent({ action: 'answer', answerTopic: 'price', priceComparison: 'without_french', factUpdates: { ...patch, french: 'no' }, addOnUpdates: { add: [], remove: ['addon_semantic_french'] } }), first.next, { message: 'How much without French?', kinds: ['answer'] });

  expect(answer.failures).toEqual([]);
  expect(answer.next.facts).toEqual(first.next.facts);
  expect(answer.next.requestedSelection).toEqual(first.next.requestedSelection);
  expect(answer.next.context?.selection).toEqual(first.next.context?.selection);
  expect(answer.result).toMatchObject({ kind: 'answer', alternatives: [{ label: 'Without French', subtotalCents: 8000, durationMinutes: 105, deltaCents: -1000, currency: 'CAD' }] });
});

it('updates a per-nail repair quantity through the full quote and preserves other choices', async () => {
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium', french: 'yes', repairCount: 2 } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium French Gel-X, bare nails, two repairs', kinds: ['proposal'], price: 9600, duration: 130 });
  const corrected = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, repairCount: 3 } }), first.next, { message: 'Actually three nails need repair', kinds: ['proposal'], price: 9900, duration: 135 });

  expect(first.failures).toEqual([]);
  expect(corrected.failures).toEqual([]);
  expect(corrected.next.facts).toMatchObject({ repairCount: 3, length: 'medium', french: 'yes', existingProduct: 'none' });
});

it('resolves an application-only switch without inheriting the incompatible prior treatment', async () => {
  const first = await evaluateReceptionistTurn(intent({ serviceId: 'svc_semantic_gel_manicure', factUpdates: { ...patch, treatment: 'gel_polish', desiredApplication: 'natural_nails', existingProduct: 'none' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'gel manicure, bare nails', kinds: ['clarification'] });
  const switched = await evaluateReceptionistTurn(intent({ action: 'clarify', serviceId: null, question: 'length', factUpdates: { ...patch, desiredApplication: 'extensions' } }), first.next, { message: 'Actually can I get an extension?', kinds: ['clarification'] });

  expect(switched.failures).toEqual([]);
  expect(switched.result).toMatchObject({ kind: 'clarification', question: 'length' });
  expect(switched.next.facts).toMatchObject({ treatment: 'unknown', desiredApplication: 'extensions', existingProduct: 'none' });

  const length = await evaluateReceptionistTurn(intent({ serviceId: 'svc_semantic_gelx', factUpdates: { ...patch, length: 'medium' } }), switched.next, { message: 'Medium', kinds: ['clarification'] });
  const design = await evaluateReceptionistTurn(intent({ serviceId: 'svc_semantic_gelx', factUpdates: { ...patch, french: 'yes' } }), length.next, { message: 'French', kinds: ['proposal'], price: 9000, duration: 120 });

  expect(length.failures).toEqual([]);
  expect(design.failures).toEqual([]);
});

it('clears inherited extension length on an application-only switch back to natural nails', async () => {
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium', french: 'yes' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium Gel-X French, bare nails', kinds: ['proposal'] });
  const switched = await evaluateReceptionistTurn(intent({ action: 'clarify', serviceId: null, question: 'service', factUpdates: { ...patch, desiredApplication: 'natural_nails' } }), first.next, { message: 'Actually just my natural nails', kinds: ['clarification'] });

  expect(switched.failures).toEqual([]);
  expect(switched.result).toMatchObject({ kind: 'clarification', question: 'service' });
  expect(switched.next.facts).toMatchObject({ treatment: 'unknown', desiredApplication: 'natural_nails', length: 'unknown', french: 'yes', existingProduct: 'none' });
});

it('retains explicit personal preferences in advice without selecting a service or authorizing handoff', async () => {
  const answer = await evaluateReceptionistTurn(intent({ action: 'answer', answerTopic: 'recommendation', serviceId: null, selectionChangeExplicitThisTurn: true, factUpdates: { ...patch, desiredApplication: 'extensions' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'I want longer nails but do not know what I need', kinds: ['answer'] });

  expect(answer.next.facts?.desiredApplication).toBe('extensions');
  expect(answer.next.context?.selection ?? null).toBeNull();
  expect(answer.next.requestedSelection).toBeUndefined();
});

it('recovers a blocked transition only after an explicit bare-nail starting-condition correction', async () => {
  const blocked = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', maintenance: 'new_set', desiredApplication: 'extensions', existingProduct: 'acrylic', origin: 'other_salon', removal: 'yes', length: 'medium', french: 'yes' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium Gel-X French with outside acrylic', kinds: ['unavailable'], reason: 'unsupported_removal' });

  expect(blocked.failures).toEqual([]);

  const refusal = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, removal: 'no' } }), blocked.next, { message: 'no removal', kinds: ['unavailable'], reason: 'transition_needs_confirmation' });

  expect(refusal.failures).toEqual([]);
  expect(refusal.next.facts?.existingProduct).toBe('acrylic');

  const corrected = await evaluateReceptionistTurn(intent({ selectionChangeExplicitThisTurn: true, factUpdates: { ...patch, existingProduct: 'none', removal: 'no', origin: 'unknown', currentProductUncertain: false } }), refusal.next, { message: 'it will be removed before my visit', kinds: ['proposal'], price: 9000, duration: 120 });

  expect(corrected.failures).toEqual([]);
  expect(corrected.next.facts).toMatchObject({ existingProduct: 'none', removal: 'no', length: 'medium', french: 'yes', treatment: 'gel_x' });
  expect(corrected.result.kind).toBe('proposal');

  if (corrected.result.kind === 'proposal') {
    expect(corrected.result.proposal.selection.selectedAddOns).toEqual(expect.arrayContaining([{ addOnId: 'addon_semantic_medium', quantity: 1 }, { addOnId: 'addon_semantic_french', quantity: 1 }]));
    expect(corrected.result.proposal.addOns.some(item => /removal/i.test(item.name))).toBe(false);
  }
});
