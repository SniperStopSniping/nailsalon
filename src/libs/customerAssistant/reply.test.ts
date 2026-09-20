import { describe, expect, it } from 'vitest';

import type { CustomerMenu } from './catalogue.server';
import type { CustomerConversation } from './conversation.server';
import type { CustomerPublicFacts } from './publicFacts.server';
import { buildReplyInput, fallbackReceptionistReply, parseReceptionistReply, type ReplyInput } from './reply';

const menu: CustomerMenu = { services: [{ id: 'gel', name: 'Gel Manicure', description: '', category: 'manicure' }], addOns: [], bindings: [] };
const state = { version: 2, salonId: 'a', sessionId: 'synthetic', issuedAtMs: 0, expiresAtMs: 1, turnIndex: 0, messages: ['How much is gel manicure?'], subjects: ['gel'] } as CustomerConversation;
const publicFacts: CustomerPublicFacts = { salon: { name: 'Synthetic salon' }, catalogue: { currency: 'CAD', services: [{ id: 'gel', name: 'Gel Manicure', description: null, category: 'manicure', durationMinutes: 60, price: { baseCents: 4000, baseDisplay: '$40.00', displayLabel: null, range: null } }], addOns: [] } };
const output = (message: string, serviceOptions: string[] = []) => JSON.stringify({
  segments: message.split(/(\[\[[a-z0-9_]+\]\])/).filter(part => part.trim()).map(part => part.startsWith('[[') ? { kind: 'fact', key: part.slice(2, -2) } : { kind: 'text', text: part.trim() }),
  serviceOptions,
});
const args: ReplyInput = { menu, publicFacts, result: { kind: 'answer', topic: 'price', message: '', options: [] }, conversation: state, nextState: state, message: 'No, how much?', locale: 'en' };

describe('grounded receptionist reply boundary', () => {
  it('substitutes current authoritative facts and validates optional choices independently', () => {
    const { facts } = buildReplyInput(args);
    const rendered = parseReceptionistReply(output('Sorry I missed that. [[service_0_price]]', ['gel']), facts, menu);

    expect(rendered.message).toContain('$40.00');
    expect(rendered.message).toContain('before any additional options');
    expect(rendered.options).toEqual(['Gel Manicure']);
  });

  it.each([
    { message: '[[other_salon_price]]', serviceOptions: [] },
    { message: 'It costs $5.', serviceOptions: [] },
    { message: 'Gel Manicure costs forty dollars and takes an hour.', serviceOptions: [] },
    { message: 'You can cancel anytime for free.', serviceOptions: [] },
    { message: 'Your appointment is confirmed.', serviceOptions: [] },
    { message: 'See https://wrong.example.', serviceOptions: [] },
    { message: 'Happy to help.', serviceOptions: ['private-service'] },
  ])('rejects ungrounded references, value claims and unsupported actions: %j', (value) => {
    expect(() => parseReceptionistReply(output(value.message, value.serviceOptions), buildReplyInput(args).facts, menu)).toThrow();
  });

  it('requires one canonical clarification rather than repeating it in natural prose', () => {
    const facts = { required_question: 'What product is currently on your nails?' };

    expect(() => parseReceptionistReply(output('What product is currently on your nails? [[required_question]]'), facts, menu)).toThrow('CUSTOMER_REPLY_DUPLICATE_QUESTION');
    expect(parseReceptionistReply(output('I have noted your preferred length. [[required_question]]'), facts, menu).message).toBe('I have noted your preferred length. What product is currently on your nails?');
  });

  it('supports recall verbatim without allowing recalled numbers to become a current quote', () => {
    const { facts, data } = buildReplyInput({ ...args, conversation: { ...state, dialogue: [{ role: 'user', content: 'Is it $40?' }, { role: 'assistant', content: 'Let me check.' }] } });

    expect(JSON.parse(data).dialogue).toHaveLength(2);
    expect(parseReceptionistReply(output('You asked [[customer_quote_0]]'), facts, menu).message).toBe('You asked “Is it $40?”');
  });

  it('does not substitute a selected Gel-X quote for a Gel Manicure information question on fallback', () => {
    const other = { selection: { baseServiceId: 'gelx', selectedAddOns: [] }, fingerprint: 'x', service: { id: 'gelx', name: 'Gel-X', priceCents: 8000 }, addOns: [], currency: 'CAD', subtotalCents: 8000, durationMinutes: 100, expiresAt: '' };
    const input = { ...args, currentProposal: other };

    expect(fallbackReceptionistReply(input, buildReplyInput(input).facts)).toContain('$40.00');
    expect(fallbackReceptionistReply(input, buildReplyInput(input).facts)).not.toContain('80');
  });

  it('requires the configured selection on price and duration answers rather than silently quoting the base service', () => {
    const proposal = { selection: { baseServiceId: 'gel', selectedAddOns: [] }, fingerprint: 'x', service: { id: 'gel', name: 'Gel Manicure', priceCents: 4000 }, addOns: [], currency: 'CAD', subtotalCents: 5000, durationMinutes: 75, expiresAt: '' };
    const input = { ...args, currentProposal: proposal, result: { kind: 'answer' as const, topic: 'duration' as const, message: '', options: [] } };
    const { facts, requiredFactKeys } = buildReplyInput(input);

    expect(requiredFactKeys).toContain('selection');
    expect(() => parseReceptionistReply(output('[[service_0_duration]]'), facts, menu, requiredFactKeys)).toThrow('CUSTOMER_REPLY_MISSING_REQUIREMENT');
    expect(parseReceptionistReply(output('[[selection]]'), facts, menu, requiredFactKeys).message).toContain('75 minutes');
    expect(fallbackReceptionistReply(input, facts)).toContain('75 minutes');
  });

  it('omits unreachable add-on facts even when a legacy source returns one', () => {
    const extra = { id: 'private-addon', name: 'Unbound add-on', description: null, category: 'art', pricingType: 'fixed', durationMinutes: 10, price: { baseCents: 1000, baseDisplay: '$10', displayLabel: null, range: null } };
    const { data } = buildReplyInput({ ...args, publicFacts: { ...publicFacts, catalogue: { ...publicFacts.catalogue, addOns: [extra] } } });

    expect(data).not.toContain('Unbound add-on');
  });
});
