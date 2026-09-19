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

  const answer = await evaluateReceptionistTurn(intent({ action: 'answer', answerTopic: 'compare_treatments', addOnUpdates: { add: [], remove: [chrome] } }), first.next, { message: 'Remove chrome, and what is BIAB?', kinds: ['answer'] });

  expect(answer.next.requestedSelection?.selectedAddOns.some(item => item.addOnId === chrome)).toBe(false);
  expect(answer.next.context?.selection).toBeNull();
  expect(answer.next.context?.answerTopic).toBe('compare_treatments');
  expect(answer.next.context?.options).toEqual(['BIAB Builder Gel', 'Gel-X Extensions']);

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
