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

  it('allows conversational references and honest uncertainty without mistaking nouns for financial claims', () => {
    const facts = buildReplyInput(args).facts;
    for (const text of ['You asked about the cost.', 'I do not have the salon’s deposit policy.', 'I do not have its opening hours.', 'Please check with the salon about refunds.']) {
      expect(parseReceptionistReply(output(text), facts, menu).message).toBe(text);
    }
  });

  it('gives an honest branded recovery when a business-information reply fails grounding', () => {
    const input: ReplyInput = { ...args, message: 'Do you take a deposit?', result: { kind: 'answer', topic: 'salon_information', message: '', options: [] } };
    const facts = buildReplyInput(input).facts;
    for (const claim of ['We take a deposit.', 'It takes a day.', 'It takes a full hour.', 'It takes an hour.', 'There is no deposit.']) {
      expect(() => parseReceptionistReply(output(claim), facts, menu)).toThrow();
    }

    expect(fallbackReceptionistReply(input, facts)).toBe('I can’t verify that detail from Synthetic salon’s public booking information. Please check with the studio before booking.');
    expect(fallbackReceptionistReply({ ...input, locale: 'fr' }, facts)).toContain('informations publiques de Synthetic salon');
    expect(fallbackReceptionistReply({ ...input, result: { ...input.result, message: 'Verified public statement.' } }, facts)).toBe('Verified public statement.');
  });

  it('requires one canonical clarification rather than repeating it in natural prose', () => {
    const facts = { required_question: 'What product is currently on your nails?' };

    expect(parseReceptionistReply(output('What product is currently on your nails? [[required_question]]'), facts, menu).message).toBe(facts.required_question);
    expect(parseReceptionistReply(output('BIAB supports your natural nails. Before proceeding, we need to know what product is currently on your nails. [[required_question]]'), facts, menu).message).toBe('BIAB supports your natural nails. What product is currently on your nails?');
    expect(() => parseReceptionistReply(output('Do you want French? [[required_question]]'), facts, menu)).toThrow('CUSTOMER_REPLY_DUPLICATE_QUESTION');
    expect(() => parseReceptionistReply(output('What product is currently on your nails?'), facts, menu)).toThrow('CUSTOMER_REPLY_MISSING_REQUIREMENT');
    expect(() => parseReceptionistReply(output('Your appointment is confirmed, what product is currently on your nails? [[required_question]]'), facts, menu)).toThrow('CUSTOMER_REPLY_UNGROUNDED_CLAIM');
    expect(() => parseReceptionistReply(output('It costs $5, what product is currently on your nails? [[required_question]]'), facts, menu)).toThrow('CUSTOMER_REPLY_UNGROUNDED_VALUE');
    expect(parseReceptionistReply(output('I have noted your preferred length. [[required_question]]'), facts, menu).message).toBe('I have noted your preferred length. What product is currently on your nails?');
  });

  it('requires the receptionist to explain a salon-authorized manual-price item without inventing an amount', () => {
    const proposal = {
      selection: { baseServiceId: 'gel', selectedAddOns: [{ addOnId: 'removal', quantity: 1 }] },
      fingerprint: 'x',
      service: { id: 'gel', name: 'Gel Manicure', priceCents: 4000 },
      addOns: [],
      manualConfirmationItems: [{ id: 'removal', name: 'Builder Gel Removal', quantity: 1, durationMinutes: 30, priceStatus: 'to_be_confirmed' as const }],
      currency: 'CAD',
      subtotalCents: 4000,
      durationMinutes: 90,
      expiresAt: '',
    };
    const input: ReplyInput = { ...args, result: { kind: 'proposal', proposal }, currentProposal: proposal, message: 'I have BIAB that needs removal' };
    const { facts, requiredFactKeys } = buildReplyInput(input);

    expect(requiredFactKeys).toContain('manual_confirmation_0');
    expect(facts.manual_confirmation_0).toContain('price, which is not included in the current subtotal');
    expect(() => parseReceptionistReply(output('No problem, we can continue.'), facts, menu, requiredFactKeys)).toThrow('CUSTOMER_REPLY_MISSING_REQUIREMENT');
    expect(parseReceptionistReply(output('No problem 💅 [[manual_confirmation_0]]'), facts, menu, requiredFactKeys).message).toContain('the nail tech will confirm its price');
  });

  it('retains French explanation while rendering the localized required question once', () => {
    const facts = { required_question: 'Quel produit avez-vous sur les ongles ?' };

    expect(parseReceptionistReply(output('Le BIAB renforce les ongles naturels. Quel produit avez-vous sur les ongles ? [[required_question]]'), facts, menu).message).toBe('Le BIAB renforce les ongles naturels. Quel produit avez-vous sur les ongles ?');
  });

  it('renders recall as one complete, server-authored quote statement', () => {
    const { facts, data } = buildReplyInput({ ...args, conversation: { ...state, dialogue: [{ role: 'user', content: 'Is it $40?' }, { role: 'assistant', content: 'Let me check.' }] } });

    expect(JSON.parse(data).dialogue).toHaveLength(2);
    expect(parseReceptionistReply(output('[[customer_quote_0]]'), facts, menu).message).toBe('You asked: “Is it $40?”');
    expect(() => parseReceptionistReply(output('You asked “Is it $40?”. [[customer_quote_0]]'), facts, menu)).toThrow('CUSTOMER_REPLY_DUPLICATE_QUOTE');
  });

  it('localizes complete public fact statements for French replies', () => {
    const input: ReplyInput = {
      ...args,
      locale: 'fr',
      publicFacts: {
        ...publicFacts,
        salon: {
          name: 'Studio synthétique',
          description: 'Des soins pour les ongles.',
          location: { locality: 'Toronto, ON' },
          contact: { phone: '555-0100', email: 'bonjour@example.test' },
          hours: { today: 'Vendredi : 9 h–18 h', weekly: [{ day: 'Vendredi', value: '9 h–18 h' }] },
        },
      },
      conversation: { ...state, dialogue: [{ role: 'user', content: 'Quel est le prix ?' }] },
    };
    const facts = buildReplyInput(input).facts;

    expect(facts.salon_name).toBe('Le salon est Studio synthétique.');
    expect(facts.salon_location).toBe('Studio synthétique est situé à Toronto, ON.');
    expect(facts.salon_phone).toBe('Le numéro de téléphone du salon est 555-0100.');
    expect(facts.salon_email).toBe('L’adresse courriel du salon est bonjour@example.test.');
    expect(facts.salon_hours).toContain('Les heures affichées du salon sont');
    expect(facts.customer_quote_0).toBe('Vous avez demandé : «Quel est le prix ?»');
  });

  it('rejects a repeated fact and safely omits an incomplete lead-in before a fact', () => {
    const { facts } = buildReplyInput(args);

    expect(() => parseReceptionistReply(output('[[service_0_price]] [[service_0_price]]'), facts, menu)).toThrow('CUSTOMER_REPLY_DUPLICATE_FACT');
    expect(parseReceptionistReply(output('Gel Manicure is listed at [[service_0_price]]'), facts, menu).message).toBe(facts.service_0_price);
    expect(parseReceptionistReply(output('You asked: [[customer_quote_0]]'), { customer_quote_0: 'You asked: “What is BIAB?”' }, menu).message).toBe('You asked: “What is BIAB?”');
    expect(() => parseReceptionistReply(output('Gel Manicure is listed at'), facts, menu)).toThrow('CUSTOMER_REPLY_INCOMPLETE_TEXT');
    expect(parseReceptionistReply(output('I have the current selection. [[selection]]'), { selection: 'Gel Manicure: $40.00 subtotal.' }, menu).message).toBe('I have the current selection. Gel Manicure: $40.00 subtotal.');
  });

  it('allows a complete list introduction and closing quote or parenthesis punctuation', () => {
    const facts = buildReplyInput(args).facts;

    expect(parseReceptionistReply(output('For a natural wedding manicure, these are the good options:'), facts, menu).message).toBe('For a natural wedding manicure, these are the good options:');
    expect(parseReceptionistReply(output('The customer said “maybe.”'), facts, menu).message).toBe('The customer said “maybe.”');
    expect(parseReceptionistReply(output('That sounds good (for now).'), facts, menu).message).toBe('That sounds good (for now).');
  });

  it('preserves a complete public-hours fact when the model adds an incomplete lead-in', () => {
    const facts = { salon_hours: 'The salon\'s listed hours are Monday: 9:00 AM–6:00 PM.' };

    expect(parseReceptionistReply(output('Our listed opening hours are: [[salon_hours]]'), facts, menu).message).toBe(facts.salon_hours);
  });

  it('uses a limitation statement alone and keeps the fallback canonical', () => {
    const facts = { limitation: 'That removal is not available to book online with your chosen service.' };
    const unavailable: ReplyInput = { ...args, result: { kind: 'unavailable', reason: 'unsupported_removal', message: 'That option cannot proceed.' } };

    expect(parseReceptionistReply(output('I am sorry. [[limitation]]'), facts, menu).message).toBe('I am sorry. That removal is not available to book online with your chosen service.');
    expect(parseReceptionistReply(output('This cannot proceed. [[limitation]]'), facts, menu).message).toBe('This cannot proceed. That removal is not available to book online with your chosen service.');
    expect(() => parseReceptionistReply(output('That removal is not available to book online with your chosen service. [[limitation]]'), facts, menu)).toThrow('CUSTOMER_REPLY_LIMITATION_PROSE');
    expect(fallbackReceptionistReply(unavailable, facts)).toBe(facts.limitation);
  });

  it('uses grounded new-set versus maintenance guidance for an ambiguous extension request', () => {
    const extensionMenu: CustomerMenu = {
      services: [
        { id: 'gelx-new', name: 'Gel-X Extensions', description: '', category: 'extensions' },
        { id: 'gelx-fill', name: 'Gel-X Fill', description: '', category: 'extensions' },
      ],
      addOns: [],
      bindings: [],
    };
    const extensionFacts: CustomerPublicFacts = {
      salon: { name: 'Synthetic salon' },
      catalogue: {
        currency: 'CAD',
        services: extensionMenu.services.map((service, index) => ({ id: service.id, name: service.name, description: null, category: service.category, durationMinutes: 90, price: { baseCents: 7000 + index * 1000, baseDisplay: `$${70 + index * 10}.00`, displayLabel: null, range: null } })),
        addOns: [],
      },
    };
    const input: ReplyInput = {
      ...args,
      menu: extensionMenu,
      publicFacts: extensionFacts,
      result: { kind: 'clarification', question: 'service', options: ['Gel-X Extensions', 'Gel-X Fill'] },
      nextState: { ...state, facts: { desiredApplication: 'extensions', existingProduct: 'unknown' } } as CustomerConversation,
    };
    const { facts, requiredFactKeys, data } = buildReplyInput(input);

    expect(requiredFactKeys).not.toContain('service_guidance');
    expect(requiredFactKeys).not.toContain('required_question');
    expect(facts.service_guidance).toBeUndefined();
    expect(JSON.parse(data).serviceGuidanceOptions).toEqual([
      { id: 'gelx-new', name: 'Gel-X Extensions' },
      { id: 'gelx-fill', name: 'Gel-X Fill' },
    ]);
    expect(parseReceptionistReply(output('For added length, Gel-X Extensions is a new set. Gel-X Fill maintains a compatible existing set. What is currently on your nails?'), facts, extensionMenu, requiredFactKeys).message).toContain('Gel-X Extensions is a new set');
    expect(fallbackReceptionistReply(input, facts)).toContain('Gel-X Fill is for maintaining');
  });

  it('requires the checked availability summary and preserves fallback provenance', () => {
    const proposal = { selection: { baseServiceId: 'gel', selectedAddOns: [] }, fingerprint: 'x', service: { id: 'gel', name: 'Gel Manicure', priceCents: 4000 }, addOns: [], currency: 'CAD', subtotalCents: 4000, durationMinutes: 60, expiresAt: '' };
    const input: ReplyInput = {
      ...args,
      result: {
        kind: 'slots',
        proposal,
        preference: { date: '2026-09-20', earliest: '17:00', latest: '23:59' },
        timeZone: 'America/Toronto',
        checkedAt: '2026-09-18T12:00:00.000Z',
        slots: [{ time: '10:00', startTime: '2026-09-21T14:00:00.000Z' }],
        search: { requestedPreference: { date: '2026-09-20', earliest: '17:00', latest: '23:59' }, displayedPreference: { date: '2026-09-21', earliest: '00:00', latest: '23:59' }, fallback: true },
      },
    };
    const { facts, requiredFactKeys } = buildReplyInput(input);

    expect(requiredFactKeys).toContain('availability');
    expect(facts.availability).toContain('No times matched your requested search');
    expect(facts.availability).toContain('The times shown instead match');
    expect(() => parseReceptionistReply(output('Here are some options.'), facts, menu, requiredFactKeys)).toThrow('CUSTOMER_REPLY_MISSING_REQUIREMENT');
    expect(parseReceptionistReply(output('[[availability]]'), facts, menu, requiredFactKeys).message).toBe(facts.availability);
    expect(fallbackReceptionistReply({ ...input, result: { ...input.result, message: 'Generic availability message.' } }, facts)).toBe(facts.availability);
    expect(() => parseReceptionistReply(output('There are no earlier times.'), facts, menu)).toThrow('CUSTOMER_REPLY_UNGROUNDED_AVAILABILITY_COMPARISON');
  });

  it('requires the server-authored clarification after an ambiguous fallback follow-up', () => {
    const input: ReplyInput = {
      ...args,
      result: {
        kind: 'clarification',
        question: 'date',
        options: [],
        message: 'Do you mean an earlier time on the day you originally asked about, or earlier than the times I just showed?',
        availabilitySearch: { requestedPreference: { date: '2026-09-20', earliest: '17:00', latest: '23:59' }, displayedPreference: { date: '2026-09-21', earliest: '00:00', latest: '23:59' }, fallback: true },
      },
    };
    const { facts, requiredFactKeys } = buildReplyInput(input);

    expect(requiredFactKeys).toEqual(['availability_summary']);
    expect(parseReceptionistReply(output('[[availability_summary]]'), facts, menu, requiredFactKeys).message).toBe(facts.availability_summary);
    expect(fallbackReceptionistReply(input, facts)).toBe(facts.availability_summary);
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

  it('requires a server-resolved alternative for a configured price comparison without changing the draft', () => {
    const proposal = { selection: { baseServiceId: 'gel', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] }, fingerprint: 'x', service: { id: 'gel', name: 'Gel Manicure', priceCents: 4000 }, addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1500 }], currency: 'CAD', subtotalCents: 5500, durationMinutes: 75, expiresAt: '' };
    const input: ReplyInput = {
      ...args,
      currentProposal: proposal,
      result: { kind: 'answer', topic: 'price', message: '', options: [], alternatives: [{ label: 'Without French', message: 'Without French', subtotalCents: 4000, durationMinutes: 60, deltaCents: -1500, currency: 'CAD' }] },
    };
    const { facts, requiredFactKeys, data } = buildReplyInput(input);

    expect(requiredFactKeys).toContain('alternative_0');
    expect(facts.alternative_0).toMatch(/Without French: (?:CA)?\$40\.00 subtotal, 60 minutes, (?:CA)?\$15\.00 less/);
    expect(JSON.parse(data).result.alternatives).toEqual(['alternative_0']);
    expect(() => parseReceptionistReply(output('It would be less.'), facts, menu, requiredFactKeys)).toThrow('CUSTOMER_REPLY_MISSING_REQUIREMENT');
    expect(parseReceptionistReply(output('[[alternative_0]]'), facts, menu, requiredFactKeys).message).toBe(facts.alternative_0);
    expect(fallbackReceptionistReply(input, facts)).toBe(facts.alternative_0);
  });

  it('keeps a proposal fallback warm and concise without repeating the package card', () => {
    const proposal = { selection: { baseServiceId: 'gel', selectedAddOns: [] }, fingerprint: 'x', service: { id: 'gel', name: 'Gel Manicure', priceCents: 4000 }, addOns: [], currency: 'CAD', subtotalCents: 4000, durationMinutes: 60, expiresAt: '' };
    const input: ReplyInput = { ...args, result: { kind: 'proposal', proposal } };

    expect(fallbackReceptionistReply(input, buildReplyInput(input).facts)).toBe('Here’s your appointment package at Synthetic salon 💅');
  });

  it('accepts complete conversational sentences ending in tasteful emoji without weakening value guards', () => {
    const { facts } = buildReplyInput(args);

    expect(parseReceptionistReply(output('BIAB can help reinforce your natural nails. ✨'), facts, menu).message).toContain('✨');
    expect(() => parseReceptionistReply(output('It costs $20. ✨'), facts, menu)).toThrow('CUSTOMER_REPLY_UNGROUNDED_VALUE');
    expect(() => parseReceptionistReply(output('BIAB costs ✨'), facts, menu)).toThrow('CUSTOMER_REPLY_INCOMPLETE_TEXT');
  });

  it('omits unreachable add-on facts even when a legacy source returns one', () => {
    const extra = { id: 'private-addon', name: 'Unbound add-on', description: null, category: 'art', pricingType: 'fixed', durationMinutes: 10, price: { baseCents: 1000, baseDisplay: '$10', displayLabel: null, range: null } };
    const { data } = buildReplyInput({ ...args, publicFacts: { ...publicFacts, catalogue: { ...publicFacts.catalogue, addOns: [extra] } } });

    expect(data).not.toContain('Unbound add-on');
  });
});

describe('concise preference clarifications', () => {
  const facts = { required_question: 'Anything on your nails right now?', selection: 'Gel Manicure: $40.00 subtotal.' };

  it.each([
    'Lovely choice! Before finalizing, I need to check your current product.',
    'To proceed, we must establish your starting condition.',
    'Absolutely 💅.',
  ])('uses the direct authoritative question without model preambles: %s', (preamble) => {
    expect(parseReceptionistReply(output(`${preamble} [[required_question]]`), facts, menu, [], true).message).toBe(facts.required_question);
  });

  it('preserves explanation for informational/help requests and every referenced fact', () => {
    const explanation = 'Different products need different compatible removal choices.';

    expect(parseReceptionistReply(output(`${explanation} [[required_question]]`), facts, menu, [], false).message).toBe(`${explanation} ${facts.required_question}`);
    expect(parseReceptionistReply(output('Here are your current details. [[selection]] [[required_question]]'), facts, menu, ['selection'], true).message).toBe(`${facts.selection} ${facts.required_question}`);
  });

  it('does not relax grounding guards or change service guidance, answers or proposals', () => {
    expect(() => parseReceptionistReply(output('It costs $5. [[required_question]]'), facts, menu, [], true)).toThrow('CUSTOMER_REPLY_UNGROUNDED_VALUE');
    expect(parseReceptionistReply(output('A gel manicure colours natural nails.'), {}, menu, [], true).message).toBe('A gel manicure colours natural nails.');
  });
});
