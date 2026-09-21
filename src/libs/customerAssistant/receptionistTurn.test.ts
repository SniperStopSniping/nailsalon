import { describe, expect, it } from 'vitest';

import type { CustomerMenu } from './catalogue.server';
import type { CustomerConversation } from './conversation.server';
import type { CustomerPublicFacts } from './publicFacts.server';
import { createReceptionistTurnSchema, receptionistContext, receptionistTurnSchema, renderReceptionistTurn } from './receptionistTurn';
import type { ReplyInput } from './reply';
import { emptyFacts, patchSchema } from './semanticFacts';

const menu: CustomerMenu = {
  services: [
    { id: 'gelx', name: 'Gel-X Extensions', category: 'extensions', description: 'Soft gel tips for added length.' },
    { id: 'fill', name: 'Gel-X Refill', category: 'extensions', description: 'Maintenance of a compatible set.' },
  ],
  addOns: [{ id: 'french', name: 'French Tips', description: '', category: 'nail_art', pricingType: 'fixed', maxQuantity: 1 }],
  bindings: [{ serviceId: 'gelx', addOnId: 'french', required: false, defaultQuantity: 1, maxQuantity: 1 }],
};
const publicFacts: CustomerPublicFacts = { salon: { name: 'Synthetic Nail Studio' }, catalogue: { currency: 'CAD', services: menu.services.map(service => ({ ...service, durationMinutes: 75, price: { baseCents: 6500, baseDisplay: '$65.00', displayLabel: null, range: null } })), addOns: [] } };
const state: CustomerConversation = { version: 2, salonId: 'synthetic', sessionId: 'b883cdd1-f08e-41c4-a9f0-90fa5c946630', issuedAtMs: 0, expiresAtMs: 1_800_000, turnIndex: 0, messages: [], facts: emptyFacts() };
const args: ReplyInput = { menu, publicFacts, conversation: state, nextState: { ...state }, message: 'I want hard gel extensions', locale: 'en', result: { kind: 'unavailable', reason: 'unsupported_service' } };
const patch = Object.fromEntries(Object.keys(patchSchema.shape).map(key => [key, key === 'schemaVersion' ? 1 : null]));
const intent = (reply: unknown, extra = {}) => receptionistTurnSchema.parse({ action: 'no_match', serviceId: null, addOns: [], question: 'service', optionIds: [], factUpdates: patch, reply, ...extra });
const recoveryReply = { segments: [{ kind: 'fact', key: 'limitation' }, { kind: 'text', text: 'We do have Gel-X Extensions for added length. They use soft gel tips, so they are a different system. Would you like to explore that option? 💅' }], serviceOptions: ['gelx'] };
const upgradePriceInput = (): ReplyInput => {
  const nextState = { ...state, subjects: ['gelx'], requestedSelection: { baseServiceId: 'gelx', selectedAddOns: [] } };
  return {
    ...args,
    nextState,
    currentProposal: { selection: nextState.requestedSelection, fingerprint: 'synthetic', service: { id: 'gelx', name: 'Gel-X Extensions', priceCents: 6500 }, addOns: [], currency: 'CAD', subtotalCents: 6500, durationMinutes: 75, expiresAt: '' },
    publicFacts: { ...publicFacts, catalogue: { ...publicFacts.catalogue, addOns: [{ ...menu.addOns[0]!, durationMinutes: 15, price: { baseCents: 1000, baseDisplay: '$10.00', displayLabel: null, range: null } }] } },
    message: 'What detail could I add, and what does it cost?',
    result: { kind: 'answer', topic: 'price', message: '', options: [] },
  };
};

describe('one-call receptionist', () => {
  it('ignores empty provider text padding without discarding a useful grounded answer', () => {
    const parsed = intent({ ...recoveryReply, segments: [...recoveryReply.segments, { kind: 'text', text: '  \n  ' }] });
    const result = renderReceptionistTurn(args, parsed);

    expect(parsed.reply?.segments).toHaveLength(2);
    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('We do have Gel-X Extensions');
    expect(result.options).toEqual(['Gel-X Extensions']);
  });

  it('still rejects a reply that contains only blank padding', () => {
    expect(() => intent({ segments: [{ kind: 'text', text: ' ' }], serviceOptions: [] })).toThrow();
  });

  it('explains a catalogue-backed alternative without selecting or quoting it', () => {
    const nextState = { ...state, unsupportedRequest: { kind: 'treatment' as const, label: 'Hard Gel Extensions' } };
    const result = renderReceptionistTurn({ ...args, nextState }, intent(recoveryReply));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('We don’t offer Hard Gel Extensions at Synthetic Nail Studio.');
    expect(result.message).toContain('soft gel tips');
    expect(result.options).toEqual(['Gel-X Extensions']);
    expect(nextState).not.toHaveProperty('requestedSelection');
  });

  it('rejects missing required limitation instead of attaching it to an incompatible promise', () => {
    const result = renderReceptionistTurn(args, intent({ segments: [{ kind: 'text', text: 'We can do that for you!' }], serviceOptions: ['gelx'] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.message).not.toContain('We can do that');
    expect(result.message).toContain('What result are you hoping for?');
    expect(result.options).toEqual([]);
  });

  it.each([
    { kind: 'treatment' as const, label: 'Hard Gel Extensions' },
    { kind: 'design' as const, label: 'Raised floral sculptures' },
    { kind: 'removal' as const, label: 'Acrylic removal' },
  ])('retains a pending $kind limitation in a natural follow-up answer', (unsupportedRequest) => {
    const nextState = { ...state, unsupportedRequest };
    const message = 'Gel-X Extensions can add length once your current nails are ready for a new set. Would you like to discuss that option?';
    const result = renderReceptionistTurn({ ...args, nextState, message: 'What do you recommend?', result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent({ segments: [{ kind: 'fact', key: 'limitation' }, { kind: 'text', text: message }], serviceOptions: ['gelx'] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toBe(`We don’t offer ${unsupportedRequest.label} at Synthetic Nail Studio. ${message}`);
    expect(result.options).toEqual(['Gel-X Extensions']);
    expect(nextState.unsupportedRequest).toEqual(unsupportedRequest);
    expect(nextState).not.toHaveProperty('requestedSelection');
  });

  it('does not force a pending limitation into an alternative price answer', () => {
    const nextState = { ...state, unsupportedRequest: { kind: 'treatment' as const, label: 'Hard Gel Extensions' } };
    const result = renderReceptionistTurn({ ...args, nextState, result: { kind: 'answer', topic: 'price', message: '', options: [] } }, intent({ segments: [{ kind: 'fact', key: 'service_0_price' }], serviceOptions: [] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('$65.00');
    expect(result.message).not.toContain('Hard Gel Extensions');
    expect(nextState.unsupportedRequest).toEqual({ kind: 'treatment', label: 'Hard Gel Extensions' });
  });

  it('rejects a stale limitation after the customer has resolved the unsupported request', () => {
    const conversation = { ...state, unsupportedRequest: { kind: 'treatment' as const, label: 'Hard Gel Extensions' } };
    const result = renderReceptionistTurn({ ...args, conversation, nextState: { ...state }, result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent(recoveryReply));

    expect(result.usedModelReply).toBe(false);
    expect(result.rejectionReason).toBe('CUSTOMER_REPLY_INVALID_REFERENCE');
    expect(result.message).not.toContain('Hard Gel Extensions');
  });

  it('keeps the pending removal limitation when an optional upgrade is rejected on a follow-up', () => {
    const nextState = { ...state, unsupportedRequest: { kind: 'removal' as const, label: 'Acrylic removal' } };
    const result = renderReceptionistTurn({ ...args, nextState, result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent(recoveryReply, { suggestedAddOnIds: ['foreign-upgrade'] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.rejectionReason).toBe('CUSTOMER_REPLY_INCOMPATIBLE_UPSELL');
    expect(result.message).toContain('We don’t offer Acrylic removal at Synthetic Nail Studio.');
    expect(result.message).toContain('Soft gel tips for added length.');
    expect(result.options).toEqual(['Gel-X Extensions']);
    expect(nextState.unsupportedRequest.kind).toBe('removal');
    expect(nextState).not.toHaveProperty('requestedSelection');
  });

  it.each(['foreign-service', 'fill'])('does not offer a foreign or unsuitable service: %s', (id) => {
    const result = renderReceptionistTurn({ ...args, nextState: { ...state, facts: { ...emptyFacts(), existingProduct: 'none' } } }, intent({ ...recoveryReply, serviceOptions: [id] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.options).toEqual([]);
  });

  it('preserves general nail education in ordinary prose', () => {
    const message = 'Hard gel is sculpted and filed into shape, while Gel-X uses soft gel tips to add length. Your preferred look and current nails help guide the choice.';
    const result = renderReceptionistTurn({ ...args, result: { kind: 'answer', topic: 'conversation', message: '', options: [] } }, intent({ segments: [{ kind: 'text', text: message }], serviceOptions: [] }));

    expect(result.message).toBe(message);
    expect(result.usedModelReply).toBe(true);
  });

  it('lets the receptionist explain a viable service choice and ask its own question', () => {
    const message = 'Gel-X Extensions can give you added length. What kind of finish are you picturing?';
    const result = renderReceptionistTurn({ ...args, message: 'I want extensions', result: { kind: 'clarification', question: 'service', options: ['Gel-X Extensions'] } }, intent({ segments: [{ kind: 'text', text: message }], serviceOptions: ['gelx'] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toBe(message);
    expect(result.options).toEqual(['Gel-X Extensions']);
  });

  it.each(['It costs $1.', 'Your appointment is confirmed.', 'It costs twenty dollars.'])('rejects ungrounded concrete claims: %s', (text) => {
    const result = renderReceptionistTurn(args, intent({ segments: [{ kind: 'fact', key: 'limitation' }, { kind: 'text', text }], serviceOptions: [] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.message).not.toContain(text);
  });

  it('uses the fresh authoritative price after model generation', () => {
    const result = renderReceptionistTurn({ ...args, result: { kind: 'answer', topic: 'price', message: '', options: [] } }, intent({ segments: [{ kind: 'fact', key: 'service_0_price' }], serviceOptions: [] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('$65.00');
    expect(result.message).toContain('before any additional options');
  });

  it('rejects unavailable deferred quote references as a whole', () => {
    const result = renderReceptionistTurn({ ...args, result: { kind: 'answer', topic: 'price', message: '', options: [] } }, intent({ segments: [{ kind: 'fact', key: 'selection' }, { kind: 'text', text: 'That includes everything you requested.' }], serviceOptions: [] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.message).not.toContain('includes everything');
  });

  it('allows compatible optional suggestions without mutating the selected package', () => {
    const nextState = { ...state, requestedSelection: { baseServiceId: 'gelx', selectedAddOns: [] } };
    const result = renderReceptionistTurn({ ...args, nextState, result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent({ segments: [{ kind: 'text', text: 'French Tips could give that set a polished finish, if you would like a little detail.' }], serviceOptions: [] }, { suggestedAddOnIds: ['french'] }));

    expect(result.usedModelReply).toBe(true);
    expect(nextState.requestedSelection.selectedAddOns).toEqual([]);
  });

  it.each(['price', 'duration'] as const)('answers an optional add-on %s question while preserving the checked current package', (topic) => {
    const input = upgradePriceInput();
    const candidate = intent({ segments: [{ kind: 'text', text: 'French Tips could add a polished detail to your set.' }, { kind: 'fact', key: 'addon_0' }], serviceOptions: [] }, { suggestedAddOnIds: ['french'] });
    const result = renderReceptionistTurn({ ...input, result: { kind: 'answer', topic, message: '', options: [] } }, candidate);

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('French Tips could add a polished detail');
    expect(result.message).toContain('French Tips: $10.00 (CAD), 15 min.');
    expect(result.message).toContain('Your current package, before optional changes:');
    expect(result.message).toContain('CA$65.00 subtotal and 75 minutes');
    expect(input.nextState.requestedSelection?.selectedAddOns).toEqual([]);
    expect(candidate.reply?.segments).toHaveLength(2);
  });

  it('labels add-on advice and the unchanged package in French', () => {
    const result = renderReceptionistTurn({ ...upgradePriceInput(), locale: 'fr' }, intent({ segments: [{ kind: 'fact', key: 'addon_0' }], serviceOptions: [] }, { suggestedAddOnIds: ['french'] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('Option au tarif indiqué: French Tips');
    expect(result.message).toContain('Votre sélection actuelle, avant toute modification facultative:');
  });

  it('does not pair the current package with an upgrade bound only to a different recommended service', () => {
    const input = upgradePriceInput();
    input.menu = { ...menu, services: [...menu.services, { id: 'manicure', name: 'Manicure', category: 'manicure', description: '' }], bindings: [{ ...menu.bindings[0]!, serviceId: 'manicure' }] };
    const result = renderReceptionistTurn(input, intent({ segments: [{ kind: 'fact', key: 'addon_0' }], serviceOptions: ['manicure'] }, { suggestedAddOnIds: ['french'] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.rejectionReason).toBe('CUSTOMER_REPLY_MISSING_REQUIREMENT');
    expect(result.message).not.toContain('French Tips');
  });

  it.each(['declined', 'missing-limitation', 'invented-value', 'segment-overflow', 'unrecorded-suggestion'] as const)('keeps the full reply guards while supplementing upgrade advice: %s', (kind) => {
    const input = upgradePriceInput();
    if (kind === 'declined') {
      input.nextState.facts = { ...emptyFacts(), designPreference: 'plain' };
    }
    if (kind === 'missing-limitation') {
      input.nextState.unsupportedRequest = { kind: 'design', label: 'Sculpted flowers' };
      input.result = { kind: 'unavailable', reason: 'no_match' };
    }
    const segments = [{ kind: 'text', text: kind === 'invented-value' ? 'It costs $1.' : 'French Tips could add a polished detail.' }, { kind: 'fact', key: 'addon_0' }];
    if (kind === 'segment-overflow') {
      segments.push(...Array.from({ length: 10 }, () => ({ kind: 'text', text: 'Only if you would like that detail.' })));
    }
    const result = renderReceptionistTurn(input, intent({ segments, serviceOptions: [] }, { suggestedAddOnIds: kind === 'unrecorded-suggestion' ? [] : ['french'] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.message).not.toContain('It costs $1.');
    expect(result.message).not.toContain('Listed add-on');
    expect(input.nextState.requestedSelection?.selectedAddOns).toEqual([]);

    if (kind === 'missing-limitation') {
      expect(result.message).toContain('We don’t offer Sculpted flowers');
    }
  });

  it('can suggest a compatible upgrade alongside a recommended service before selection', () => {
    const nextState = { ...state };
    const result = renderReceptionistTurn({ ...args, nextState, result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent({ segments: [{ kind: 'text', text: 'Gel-X could suit your added-length goal, with optional French Tips for a polished finish.' }], serviceOptions: ['gelx'] }, { suggestedAddOnIds: ['french'] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.options).toEqual(['Gel-X Extensions']);
    expect(nextState).not.toHaveProperty('requestedSelection');
  });

  it('can discuss a supported design alternative before the customer chooses a base service', () => {
    const nextState = { ...state, unsupportedRequest: { kind: 'design' as const, label: 'Sculpted flowers' } };
    const result = renderReceptionistTurn({ ...args, nextState }, intent({ segments: [{ kind: 'fact', key: 'limitation' }, { kind: 'text', text: 'French Tips could give you a polished detail instead. What kind of manicure are you thinking of?' }], serviceOptions: [] }, { suggestedAddOnIds: ['french'] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain('French Tips could');
    expect(result.message).toContain('We don’t offer Sculpted flowers at Synthetic Nail Studio.');
    expect(nextState.unsupportedRequest).toEqual({ kind: 'design', label: 'Sculpted flowers' });
    expect(nextState).not.toHaveProperty('requestedSelection');
  });

  it.each(['unknown', 'unbound', 'foreign-binding', 'incompatible-selected'] as const)('rejects unsupported upgrade advice: %s', (kind) => {
    const candidateMenu = { ...menu, bindings: kind === 'unbound' ? [] : kind === 'foreign-binding' ? [{ ...menu.bindings[0]!, serviceId: 'foreign-service' }] : menu.bindings };
    const nextState = kind === 'incompatible-selected' ? { ...state, requestedSelection: { baseServiceId: 'fill', selectedAddOns: [] } } : { ...state };
    const result = renderReceptionistTurn({ ...args, menu: candidateMenu, nextState, result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent({ segments: [{ kind: 'text', text: 'Try French Tips!' }], serviceOptions: [] }, { suggestedAddOnIds: [kind === 'unknown' ? 'foreign-addon' : 'french'] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.rejectionReason).toBe('CUSTOMER_REPLY_INCOMPATIBLE_UPSELL');
  });

  it.each(['en', 'fr'] as const)('preserves an owner price label without duplicating its qualifier in %s', (locale) => {
    const facts = structuredClone(publicFacts);
    facts.catalogue.services[0]!.price.displayLabel = 'From $65';
    const result = renderReceptionistTurn({ ...args, locale, publicFacts: facts, result: { kind: 'answer', topic: 'price', message: '', options: [] } }, intent({ segments: [{ kind: 'fact', key: 'service_0_price' }], serviceOptions: [] }));

    expect(result.usedModelReply).toBe(true);
    expect(result.message).toContain(': From $65 (CAD)');
    expect(result.message).not.toMatch(/from From|à partir de From/u);
  });

  it.each(['plain', 'skip'] as const)('respects a declined upsell: %s', (designPreference) => {
    const result = renderReceptionistTurn({ ...args, nextState: { ...state, facts: { ...emptyFacts(), designPreference }, requestedSelection: { baseServiceId: 'gelx', selectedAddOns: [] } }, result: { kind: 'answer', topic: 'recommendation', message: '', options: [] } }, intent({ segments: [{ kind: 'text', text: 'Try French Tips!' }], serviceOptions: [] }, { suggestedAddOnIds: ['french'] }));

    expect(result.usedModelReply).toBe(false);
  });

  it.each(['recommendation', 'unsupported'] as const)('keeps authoritative service guidance when an optional upgrade is invalid: %s', (kind) => {
    const nextState = { ...state, unsupportedRequest: { kind: 'treatment' as const, label: 'Hard gel' } };
    const result = renderReceptionistTurn({ ...args, nextState, result: kind === 'recommendation' ? { kind: 'answer', topic: 'recommendation', message: '', options: [] } : args.result }, intent({ segments: [{ kind: 'text', text: 'This invented upgrade is included!' }], serviceOptions: ['foreign-service', 'fill', 'gelx'] }, { suggestedAddOnIds: ['foreign-addon'] }));

    expect(result.usedModelReply).toBe(false);
    expect(result.rejectionReason).toBe('CUSTOMER_REPLY_INCOMPATIBLE_UPSELL');
    expect(result.message).toContain('Soft gel tips for added length.');
    expect(result.message).not.toContain('invented upgrade');
    expect(result.options).toEqual(['Gel-X Extensions']);
    expect(nextState).not.toHaveProperty('requestedSelection');

    if (kind === 'unsupported') {
      expect(result.message).toContain('We don’t offer Hard gel at Synthetic Nail Studio.');
    }
  });

  it('uses the actual server clarification instead of a predicted question or success', () => {
    const result = renderReceptionistTurn({ ...args, result: { kind: 'clarification', question: 'product', options: [] } }, intent({ segments: [{ kind: 'text', text: 'All set! Which day?' }], serviceOptions: [] }));

    expect(result.message).toBe('Anything on your nails right now?');
    expect(result.usedModelReply).toBe(false);
  });

  it('keeps the public context bounded and excludes signed or private authority', () => {
    const context = receptionistContext({ ...args, conversation: { ...state, unsupportedRequest: { kind: 'design', label: 'Sculpted flowers' }, nextVisitOffer: { campaignId: 'secret-campaign', entitlementId: 'secret-entitlement' } } });
    const schema = createReceptionistTurnSchema(Object.keys(context.replyFacts));

    expect(context.unsupportedRequest?.label).toBe('Sculpted flowers');
    expect(JSON.stringify(context)).not.toContain('secret-');
    expect(schema.required).toContain('reply');
    expect(schema.required).toContain('unsupportedResolution');
  });
});
