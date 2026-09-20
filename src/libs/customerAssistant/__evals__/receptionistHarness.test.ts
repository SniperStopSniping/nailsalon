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

  const answer = await evaluateReceptionistTurn(intent({ action: 'answer', answerTopic: 'compare_treatments', addOnUpdates: { add: [], remove: [chrome] } }), first.next, { message: 'Remove chrome, and what is BIAB?', kinds: ['proposal'], price: 8000, duration: 105 });

  expect(answer.next.requestedSelection?.selectedAddOns.some(item => item.addOnId === chrome)).toBe(false);
  expect(answer.failures).toEqual([]);
  expect(answer.result).toMatchObject({ kind: 'proposal', proposal: { subtotalCents: 8000 } });
  expect(answer.next.context?.selection).toEqual(answer.next.requestedSelection);
  expect(answer.next.booking).toBeUndefined();

  const followup = await evaluateReceptionistTurn(intent({}), answer.next, { message: 'Keep the Gel-X', kinds: ['proposal'], price: 8000, duration: 105 });

  expect(followup.failures).toEqual([]);
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

  const bare = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, existingProduct: 'none', removal: 'no' } }), first.next, { message: 'Nothing', kinds: ['proposal'], price: 8000, duration: 105 });

  expect(bare.failures).toEqual([]);
  expect(bare.next.facts?.existingProduct).toBe('none');
});

it('never offers a different product removal when a transition fact is known but removal is unanswered', async () => {
  const result = await evaluateReceptionistTurn(intent({ action: 'clarify', question: 'removal', factUpdates: { ...patch, treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'acrylic', origin: 'other_salon', length: 'medium', removal: 'unknown' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'I have acrylic but want Gel-X', kinds: ['unavailable'], reason: 'unsupported_removal' });

  expect(result.failures).toEqual([]);
  expect(result.next.facts?.removal).toBe('unknown');
});

it('re-resolves a length correction inside a price question before exposing the new total', async () => {
  const first = await evaluateReceptionistTurn(intent({ factUpdates: { ...patch, treatment: 'gel_x', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium' } }), createCustomerConversation('synthetic-isla', 'synthetic-only'), { message: 'medium Gel-X on bare nails', kinds: ['proposal'], price: 8000, duration: 105 });
  first.next.booking = { acceptedFingerprint: 'a'.repeat(64), datePreference: { date: '2026-09-19', earliest: '09:00', latest: '17:00' }, offeredSlots: [{ time: '09:00', startTime: '2026-09-19T13:00:00.000Z' }], selectedSlot: null };
  const corrected = await evaluateReceptionistTurn(intent({ action: 'answer', answerTopic: 'price', factUpdates: { ...patch, length: 'short' } }), first.next, { message: 'actually short, how much now?', kinds: ['proposal'], price: 7000, duration: 90 });

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
});
