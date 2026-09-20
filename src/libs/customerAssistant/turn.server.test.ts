import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SEMANTIC_L1_MENU, SEMANTIC_L1_SNAPSHOT } from './__evals__/semanticCases';

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), menu: vi.fn(), snapshot: vi.fn(), proposal: vi.fn(), record: vi.fn(), validate: vi.fn(), lookup: vi.fn(), nextSlots: vi.fn(), publicFacts: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'customer-only', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./budget.server', () => ({ reserveCustomerAssistantTurn: mocks.reserve }));
vi.mock('./catalogue.server', () => ({ loadCustomerMenu: mocks.menu, loadCustomerClarificationSnapshot: mocks.snapshot, buildCustomerProposal: mocks.proposal, validateCustomerMenuSelection: mocks.validate }));
vi.mock('./publicFacts.server', () => ({ loadCustomerPublicFacts: mocks.publicFacts }));
vi.mock('./ledger.server', () => ({ recordCustomerAssistantUsage: mocks.record }));
vi.mock('./turnReplay.server', () => ({
  readCompletedCustomerTurn: vi.fn().mockResolvedValue(null),
  storeCompletedCustomerTurn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./slots.server', () => ({
  getCustomerAvailabilityContext: vi.fn().mockResolvedValue({ today: '2026-09-18', timeZone: 'America/Toronto' }),
  lookupCustomerSlots: mocks.lookup,
  lookupNextCustomerSlots: mocks.nextSlots,
}));
vi.mock('@/libs/ai/openaiResponses.server', () => ({ createOpenAiResponsesProvider: vi.fn(() => {
  throw new Error('REAL_PROVIDER_FORBIDDEN');
}) }));

const { createCustomerConversation, signCustomerConversation, verifyCustomerConversation } = await import('./conversation.server');
const { runCustomerAssistantTurn } = await import('./turn.server');
const secret = 'x'.repeat(32);
const acceptedFingerprint = 'a'.repeat(64);
const input = () => ({ salonId: 'salon-a', salonSlug: 'isla-nail-studio', features: null, clientIp: '192.0.2.1', locale: 'en' as const, message: 'Gel-X with French', conversation: signCustomerConversation(createCustomerConversation('salon-a', secret), secret) });
const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 };
const noFactUpdates = { schemaVersion: 1 as const, treatment: null, desiredApplication: null, maintenance: null, length: null, french: null, existingProduct: null, currentProductUncertain: null, origin: null, removal: null, repairCount: null };
const interpretation = { factUpdates: noFactUpdates, action: 'propose', serviceId: 'gelx', addOns: [{ addOnId: 'french', quantity: 1 }], question: 'details', optionIds: [] };
const provider = (output: unknown = interpretation) => ({ createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(output) }] }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicFacts.mockRejectedValue(new Error('PUBLIC_FACTS_UNAVAILABLE'));
  mocks.reserve.mockResolvedValue({ ok: true });
  mocks.nextSlots.mockResolvedValue(null);
  mocks.snapshot.mockResolvedValue(SEMANTIC_L1_SNAPSHOT);
  mocks.menu.mockResolvedValue({ services: [{ id: 'gelx', name: 'Gel-X' }], addOns: [{ id: 'french', name: 'French' }], bindings: [{ serviceId: 'gelx', addOnId: 'french' }] });
  mocks.proposal.mockResolvedValue({ selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] }, fingerprint: acceptedFingerprint, service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 }, addOns: [], subtotalCents: 6000, durationMinutes: 60, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' });
  mocks.record.mockResolvedValue(undefined);
  mocks.lookup.mockResolvedValue({ proposal: { selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] }, fingerprint: acceptedFingerprint, service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 }, addOns: [], subtotalCents: 6000, durationMinutes: 60, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' }, today: '2026-09-18', timeZone: 'America/Toronto', slots: [{ time: '15:00', startTime: '2026-09-20T19:00:00.000Z' }], selected: null, quoteChanged: false });
});

describe('customer assistant bounded turn', () => {
  it('uses one Luna low call without tools and only the authoritative proposal', async () => {
    const model = provider();
    const result = await runCustomerAssistantTurn(input(), model);

    expect(result.result).toMatchObject({ kind: 'proposal', proposal: { subtotalCents: 6000, durationMinutes: 60 } });
    expect(model.createResponse).toHaveBeenCalledTimes(1);
    expect(model.createResponse).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-luna', reasoningEffort: 'low', tools: [], toolChoice: 'none', maxOutputTokens: 1200 }));
    expect(mocks.record.mock.invocationCallOrder[0]).toBeLessThan(model.createResponse.mock.invocationCallOrder[0]!);
    expect(verifyCustomerConversation(result.conversation, 'salon-a', secret).messages).toEqual(['Gel-X with French']);
  });

  it('proposes services before availability for the Gel Manicure and French dated-request regression', async () => {
    const request = { ...input(), message: 'I would like a Gel Manicure on natural nails with French Tips, no removal and no other extras, on Saturday September 19.' };
    mocks.menu.mockResolvedValue({ services: [{ id: 'gel-manicure', name: 'Gel Manicure' }], addOns: [{ id: 'french', name: 'French Tips' }], bindings: [{ serviceId: 'gel-manicure', addOnId: 'french' }] });
    const selection = { baseServiceId: 'gel-manicure', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] };
    mocks.proposal.mockResolvedValue({ selection, fingerprint: acceptedFingerprint, service: { id: 'gel-manicure', name: 'Gel Manicure', priceCents: 4000 }, addOns: [{ id: 'french', name: 'French Tips', quantity: 1, priceCents: 1000 }], subtotalCents: 5000, durationMinutes: 75, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' });
    const output = { ...interpretation, serviceId: 'gel-manicure', datePreference: null };
    const result = await runCustomerAssistantTurn(request, provider(output));

    expect(mocks.proposal).toHaveBeenCalledWith('salon-a', null, selection);
    expect(result.result).toMatchObject({ kind: 'proposal', proposal: { subtotalCents: 5000, durationMinutes: 75 } });
    expect(verifyCustomerConversation(result.conversation, 'salon-a', secret).context?.selection).toEqual(selection);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('still fails closed before proposal authority if a provider returns the reproduced malformed times', async () => {
    const result = await runCustomerAssistantTurn(input(), provider({ ...interpretation, datePreference: { date: '2026-09-19', earliest: '', latest: '' } }));

    expect(result.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(mocks.proposal).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenLastCalledWith(expect.objectContaining({ usage, outcome: 'failed' }));
  });

  it('replaces incompatible model length clarification with an authoritative BIAB proposal without leaking the snapshot', async () => {
    mocks.menu.mockResolvedValue(SEMANTIC_L1_MENU);
    const biab = SEMANTIC_L1_MENU.services.find(item => item.name === 'BIAB Builder Gel')!.id;
    const lengths = SEMANTIC_L1_MENU.addOns.filter(item => item.name.includes('Length')).map(item => item.id);
    const selection = { baseServiceId: biab, selectedAddOns: [] };
    mocks.proposal.mockResolvedValue({ selection, fingerprint: acceptedFingerprint, service: { id: biab, name: 'BIAB Builder Gel', priceCents: 5500 }, addOns: [], subtotalCents: 5500, durationMinutes: 90, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' });
    const model = provider({ ...interpretation, action: 'clarify', serviceId: biab, question: 'length', optionIds: lengths, addOns: [], factUpdates: { ...noFactUpdates, treatment: 'builder_gel', desiredApplication: 'natural_nails', existingProduct: 'none' } });
    const result = await runCustomerAssistantTurn({ ...input(), message: 'BIAB on my natural nails' }, model);

    expect(result.result).toMatchObject({ kind: 'proposal', proposal: { subtotalCents: 5500, durationMinutes: 90 } });
    expect(mocks.snapshot).toHaveBeenCalledWith('salon-a');
    expect(mocks.proposal).toHaveBeenCalledWith('salon-a', null, selection);

    const payload = model.createResponse.mock.calls[0]![0].input[1].content;

    expect(payload).not.toContain(SEMANTIC_L1_SNAPSHOT.revision.canonical);
    expect(JSON.parse(payload).menu).not.toHaveProperty('revision');
  });

  it('preserves a genuinely unknown length clarification instead of quoting an incomplete L1 selection', async () => {
    mocks.menu.mockResolvedValue({ services: [{ id: 'gelx', name: 'Gel-X Extensions' }], addOns: [{ id: 'medium', name: 'Medium Length' }], bindings: [{ serviceId: 'gelx', addOnId: 'medium' }] });
    mocks.proposal.mockRejectedValue(new Error('L1_REQUIRED_SELECTION_MISSING'));
    const result = await runCustomerAssistantTurn(input(), provider({ ...interpretation, action: 'clarify', question: 'length', optionIds: ['medium'], addOns: [], factUpdates: { ...noFactUpdates, treatment: 'gel_x', french: 'yes' } }));

    expect(result.result).toEqual({ kind: 'clarification', question: 'length', options: ['Medium Length'] });
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it('keeps customer facts across clarification and corrects conflicting model IDs before the authoritative proposal', async () => {
    mocks.menu.mockResolvedValue({
      services: [{ id: 'gelx', name: 'Gel-X Extensions', description: '', category: 'gel_x' }],
      addOns: [
        { id: 'french', name: 'French Tips', description: '', category: 'nail_art', pricingType: 'fixed', maxQuantity: 1 },
        { id: 'own-removal', name: 'Gel-X Removal', description: '', category: 'removal', pricingType: 'fixed', maxQuantity: 1 },
        { id: 'foreign-removal', name: 'Removal From Another Salon', description: '', category: 'removal', pricingType: 'fixed', maxQuantity: 1 },
        { id: 'medium', name: 'Medium Length', description: '', category: 'nail_art', pricingType: 'fixed', maxQuantity: 1 },
      ],
      bindings: ['french', 'own-removal', 'foreign-removal', 'medium'].map(addOnId => ({ serviceId: 'gelx', addOnId, required: false, maxQuantity: 1 })),
    });
    mocks.proposal.mockImplementation(async (_salon, _features, selection) => ({ selection, fingerprint: acceptedFingerprint, service: { id: 'gelx', name: 'Gel-X Extensions', priceCents: 7000 }, addOns: selection.selectedAddOns.map((item: { addOnId: string; quantity: number }) => ({ id: item.addOnId, name: item.addOnId, quantity: item.quantity, priceCents: 1000 })), subtotalCents: 9000, durationMinutes: 125, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' }));
    const firstModel = provider({ ...interpretation, action: 'clarify', question: 'length', optionIds: ['medium'], addOns: [{ addOnId: 'foreign-removal', quantity: 1 }], factUpdates: { ...noFactUpdates, treatment: 'gel_x', maintenance: 'new_set', length: 'short', french: 'yes', existingProduct: 'gel_x', origin: 'this_salon', removal: 'yes' } });
    const first = await runCustomerAssistantTurn({ ...input(), salonName: 'Isla Nail Studio', message: 'short Gel-X + French, removing existing Gel-X from Isla' }, firstModel);

    expect(first.result).toMatchObject({ kind: 'proposal' });
    expect(mocks.proposal).toHaveBeenLastCalledWith('salon-a', null, { baseServiceId: 'gelx', selectedAddOns: expect.arrayContaining([{ addOnId: 'own-removal', quantity: 1 }, { addOnId: 'french', quantity: 1 }]) });

    const firstState = verifyCustomerConversation(first.conversation, 'salon-a', secret);

    expect(firstState.facts).toMatchObject({ length: 'short', origin: 'this_salon', existingProduct: 'gel_x' });
    expect(firstState.context?.selection?.selectedAddOns).not.toContainEqual({ addOnId: 'foreign-removal', quantity: 1 });
    expect(JSON.parse(firstModel.createResponse.mock.calls[0]![0].input[1].content).bookingSalon).toEqual({ name: 'Isla Nail Studio', slug: 'isla-nail-studio' });

    const accepted = signCustomerConversation({ ...firstState, booking: { acceptedFingerprint, datePreference: null, offeredSlots: [], selectedSlot: null } }, secret);
    const second = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Actually make them medium' }, provider({ ...interpretation, factUpdates: { ...noFactUpdates, length: 'medium' } }));
    const secondState = verifyCustomerConversation(second.conversation, 'salon-a', secret);

    expect(second.result).toMatchObject({ kind: 'proposal' });
    expect(secondState.facts).toMatchObject({ length: 'medium', origin: 'this_salon', french: 'yes', removal: 'yes' });
    expect(secondState.context?.selection?.selectedAddOns).toEqual(expect.arrayContaining([{ addOnId: 'medium', quantity: 1 }, { addOnId: 'own-removal', quantity: 1 }, { addOnId: 'french', quantity: 1 }]));
    expect(secondState.booking).toBeUndefined();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('keeps changed facts but removes stale selection authority when no replacement proposal can be shown', async () => {
    const first = await runCustomerAssistantTurn(input(), provider());
    const prior = verifyCustomerConversation(first.conversation, 'salon-a', secret);
    const accepted = signCustomerConversation({ ...prior, booking: { acceptedFingerprint, datePreference: null, offeredSlots: [], selectedSlot: null } }, secret);
    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Actually no French, and I need something unsupported' }, provider({ ...interpretation, action: 'no_match', factUpdates: { ...noFactUpdates, french: 'no' } }));
    const next = verifyCustomerConversation(response.conversation, 'salon-a', secret);

    expect(response.result).toMatchObject({ kind: 'unavailable', reason: 'no_match' });
    expect(next.facts?.french).toBe('no');
    expect(next.context).toBeUndefined();
    expect(next.booking).toBeUndefined();
  });

  it('rejects a cross-tenant or forged capability before quota, tools or provider', async () => {
    const model = provider();
    const otherSalon = { ...input(), salonId: 'salon-b' };

    expect((await runCustomerAssistantTurn(otherSalon, model)).result).toEqual({ kind: 'unavailable', reason: 'invalid_conversation' });
    expect((await runCustomerAssistantTurn({ ...input(), conversation: 'forged.token' }, model)).result).toEqual({ kind: 'unavailable', reason: 'invalid_conversation' });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(model.createResponse).not.toHaveBeenCalled();
  });

  it('fails closed on exhausted quota or unavailable durable ledger', async () => {
    const model = provider();
    mocks.reserve.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });

    expect((await runCustomerAssistantTurn(input(), model)).result).toEqual({ kind: 'unavailable', reason: 'rate_limited' });

    mocks.record.mockRejectedValue(new Error('no database'));
    await runCustomerAssistantTurn(input(), model);

    expect(model.createResponse).not.toHaveBeenCalled();
  });

  it.each([
    { ...interpretation, price: 1, confirmation: 'booked' },
    { ...interpretation, action: 'clarify', optionIds: ['foreign-service'] },
  ])('does not render invented output or foreign clarification options', async (output) => {
    const result = await runCustomerAssistantTurn(input(), provider(output));

    expect(result.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(mocks.record).toHaveBeenLastCalledWith(expect.objectContaining({ usage, outcome: 'failed' }));
  });

  it('preserves usage on invalid output without logging generated content', async () => {
    const model = provider('CANARY_SECRET');
    const result = await runCustomerAssistantTurn(input(), model);

    expect(JSON.stringify(result)).not.toContain('CANARY_SECRET');
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('CANARY_SECRET');
    expect(mocks.record).toHaveBeenLastCalledWith(expect.objectContaining({ usage, outcome: 'failed' }));
  });

  it('carries the actual question/options and selected service across contextual follow-ups', async () => {
    const first = await runCustomerAssistantTurn(input(), provider({ ...interpretation, action: 'clarify', question: 'finish', optionIds: ['french'] }));
    const secondModel = provider();
    const second = await runCustomerAssistantTurn({ ...input(), conversation: first.conversation, message: 'Yes, that one' }, secondModel);
    const secondRequest = secondModel.createResponse.mock.calls[0]![0];

    expect(JSON.parse(secondRequest.input[1].content).lastShown).toEqual({ question: 'finish', options: ['French'], selection: null });
    expect(verifyCustomerConversation(second.conversation, 'salon-a', secret).context?.selection?.baseServiceId).toBe('gelx');

    const thirdModel = provider();
    await runCustomerAssistantTurn({ ...input(), conversation: second.conversation, message: 'Same but short' }, thirdModel);

    expect(mocks.validate).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ baseServiceId: 'gelx' }));
    expect(JSON.parse(thirdModel.createResponse.mock.calls[0]![0].input[1].content).lastShown.selection.baseServiceId).toBe('gelx');
  });

  it('keeps the selection during a bounded next-availability search and an explicit date lookup', async () => {
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: interpretation.serviceId ? { baseServiceId: interpretation.serviceId, selectedAddOns: interpretation.addOns } : null },
      booking: { acceptedFingerprint, datePreference: null, offeredSlots: [], selectedSlot: null },
    }, secret);
    const missingDate = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Can I come after 5?' }, provider({ ...interpretation, action: 'availability', datePreference: null }));

    expect(missingDate.result).toMatchObject({ kind: 'unavailable', reason: 'no_availability' });
    expect(verifyCustomerConversation(missingDate.conversation, 'salon-a', secret).context?.selection).toEqual(expect.objectContaining({ baseServiceId: 'gelx' }));
    expect(verifyCustomerConversation(missingDate.conversation, 'salon-a', secret).booking?.acceptedFingerprint).toBe(acceptedFingerprint);
    expect(mocks.lookup).not.toHaveBeenCalled();

    const withDate = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Saturday afternoon' }, provider({ ...interpretation, action: 'availability', datePreference: { date: '2026-09-20', earliest: '12:00', latest: '17:00' } }));

    expect(withDate.result).toMatchObject({ kind: 'slots', slots: [{ time: '15:00' }] });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it('asks for a date rather than silently using next available when a named window was not resolved', async () => {
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: null, offeredSlots: [], selectedSlot: null },
    }, secret);
    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Saturday after 5' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: null,
      availabilityScope: 'specific_window',
    }));

    expect(response.result).toEqual({ kind: 'clarification', question: 'date', options: [] });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.nextSlots).not.toHaveBeenCalled();
  });

  it('keeps a direct relative follow-up on the displayed date instead of trusting a model-inferred future date', async () => {
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: displayed, displayedPreference: displayed, fallback: false },
    }, secret);
    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'anything earlier?' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: { date: '2026-09-29', earliest: '00:00', latest: '23:59' },
      timingFeedback: 'too_late',
      dateExplicitThisTurn: false,
    }));

    expect(mocks.lookup).toHaveBeenCalledWith(expect.objectContaining({
      preference: { date: '2026-09-28', earliest: '00:00', latest: '09:59' },
    }));
    expect(response.result).toMatchObject({
      kind: 'slots',
      search: { requestedPreference: { date: '2026-09-28', earliest: '00:00', latest: '09:59' }, displayedPreference: { date: '2026-09-28', earliest: '00:00', latest: '09:59' }, fallback: false },
    });
  });

  it('preserves requested and displayed availability windows when a specific search falls back', async () => {
    const requested = { date: '2026-09-26', earliest: '17:00', latest: '23:59' };
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: null, offeredSlots: [], selectedSlot: null },
    }, secret);
    mocks.lookup.mockResolvedValueOnce({
      proposal: await mocks.proposal('salon-a', null, { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] }),
      today: '2026-09-18',
      timeZone: 'America/Toronto',
      slots: [],
      selected: null,
      quoteChanged: false,
    });
    mocks.nextSlots.mockResolvedValueOnce({
      proposal: await mocks.proposal('salon-a', null, { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] }),
      today: '2026-09-18',
      timeZone: 'America/Toronto',
      preference: displayed,
      slots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }],
      selected: null,
      quoteChanged: false,
    });
    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'anything Saturday after 5?' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: requested,
    }));

    expect(response.result).toMatchObject({
      kind: 'slots',
      search: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret).availabilitySearch).toEqual({
      requestedPreference: requested,
      displayedPreference: displayed,
      fallback: true,
    });
  });

  it('asks one focused question for an ambiguous relative follow-up after a fallback instead of moving to another day', async () => {
    const requested = { date: '2026-09-26', earliest: '17:00', latest: '23:59' };
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    }, secret);
    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'anything earlier?' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: { date: '2026-09-29', earliest: '00:00', latest: '23:59' },
      timingFeedback: 'too_late',
      dateExplicitThisTurn: false,
    }));

    expect(response.result).toMatchObject({
      kind: 'clarification',
      question: 'date',
      message: expect.stringContaining('earlier on'),
      availabilitySearch: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.nextSlots).not.toHaveBeenCalled();
  });

  it('resolves requested and displayed anchors from signed fallback context with the pending direction', async () => {
    const requested = { date: '2026-09-26', earliest: '17:00', latest: '23:59' };
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const fallback = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    }, secret);
    const asked = await runCustomerAssistantTurn({ ...input(), conversation: fallback, message: 'anything earlier?' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: { date: '2099-01-01', earliest: '00:00', latest: '23:59' },
      timingFeedback: 'too_late',
      dateExplicitThisTurn: false,
    }));
    const requestedAnchor = await runCustomerAssistantTurn({ ...input(), conversation: asked.conversation, message: 'the original day' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: null,
      timingFeedback: 'none',
      dateExplicitThisTurn: false,
      availabilityAnchor: 'requested',
    }));

    expect(mocks.lookup).toHaveBeenLastCalledWith(expect.objectContaining({
      preference: { date: '2026-09-26', earliest: '00:00', latest: '16:59' },
    }));
    expect(requestedAnchor.result).toMatchObject({ kind: 'slots' });

    const laterFallback = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    }, secret);
    const askedLater = await runCustomerAssistantTurn({ ...input(), conversation: laterFallback, message: 'anything later?' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: null,
      timingFeedback: 'too_early',
      dateExplicitThisTurn: false,
    }));
    const shownModel = provider({
      ...interpretation,
      action: 'availability',
      datePreference: null,
      timingFeedback: 'none',
      dateExplicitThisTurn: false,
      availabilityAnchor: 'displayed',
    });
    await runCustomerAssistantTurn({ ...input(), conversation: askedLater.conversation, message: 'the shown times' }, shownModel);

    expect(askedLater.result).toMatchObject({ message: expect.stringContaining('later on') });
    expect(JSON.parse(shownModel.createResponse.mock.calls[0]![0].input[1].content).availabilitySearch).toMatchObject({
      requestedPreference: requested,
      displayedPreference: displayed,
      fallback: true,
      pendingTimingFeedback: 'too_early',
    });
    expect(mocks.lookup).toHaveBeenLastCalledWith(expect.objectContaining({
      preference: { date: '2026-09-28', earliest: '10:01', latest: '23:59' },
    }));

    const correctionModel = provider({
      ...interpretation,
      action: 'availability',
      datePreference: null,
      timingFeedback: 'too_early',
      dateExplicitThisTurn: false,
      availabilityAnchor: 'displayed',
    });
    await runCustomerAssistantTurn({ ...input(), conversation: asked.conversation, message: 'the shown day, actually later' }, correctionModel);

    expect(mocks.lookup).toHaveBeenLastCalledWith(expect.objectContaining({
      preference: { date: '2026-09-28', earliest: '10:01', latest: '23:59' },
    }));
  });

  it('uses the original requested boundary for an explicitly named original fallback day', async () => {
    const requested = { date: '2026-09-26', earliest: '17:00', latest: '23:59' };
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '09:00', startTime: '2026-09-28T13:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    }, secret);
    await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'earlier on Saturday please' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: { date: '2026-09-26', earliest: '00:00', latest: '23:59' },
      timingFeedback: 'too_early',
      timeDirection: 'earlier',
      dateExplicitThisTurn: true,
    }));

    expect(mocks.lookup).toHaveBeenLastCalledWith(expect.objectContaining({
      preference: { date: '2026-09-26', earliest: '00:00', latest: '16:59' },
    }));
  });

  it('clears stale fallback provenance after an explicit date search finds no matching times', async () => {
    const requested = { date: '2026-09-26', earliest: '17:00', latest: '23:59' };
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: requested, displayedPreference: displayed, fallback: true },
    }, secret);
    mocks.lookup.mockResolvedValueOnce({
      proposal: await mocks.proposal('salon-a', null, { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] }),
      today: '2026-09-18',
      timeZone: 'America/Toronto',
      slots: [],
      selected: null,
      quoteChanged: false,
    });
    mocks.nextSlots.mockResolvedValueOnce(null);
    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Tuesday instead' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: { date: '2026-09-29', earliest: '00:00', latest: '23:59' },
      dateExplicitThisTurn: true,
    }));
    const state = verifyCustomerConversation(response.conversation, 'salon-a', secret);

    expect(response.result).toMatchObject({ kind: 'unavailable', reason: 'no_availability' });
    expect(state.availabilitySearch).toBeUndefined();
    expect(state.booking).toBeUndefined();
  });

  it('honours an explicitly named date when a customer rejects a displayed time', async () => {
    const displayed = { date: '2026-09-28', earliest: '00:00', latest: '23:59' };
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: displayed, offeredSlots: [{ time: '10:00', startTime: '2026-09-28T14:00:00.000Z' }], selectedSlot: null },
      availabilitySearch: { requestedPreference: displayed, displayedPreference: displayed, fallback: false },
    }, secret);
    await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'What about Tuesday instead, earlier?' }, provider({
      ...interpretation,
      action: 'availability',
      datePreference: { date: '2026-09-29', earliest: '00:00', latest: '23:59' },
      timingFeedback: 'too_late',
      dateExplicitThisTurn: true,
    }));

    expect(mocks.lookup).toHaveBeenCalledWith(expect.objectContaining({
      preference: { date: '2026-09-29', earliest: '00:00', latest: '09:59' },
    }));
  });

  it('does not quote an existing outside set before removal or maintenance is clarified', async () => {
    const response = await runCustomerAssistantTurn({ ...input(), message: 'I have Gel-X from another salon and want medium Gel-X with French' }, provider({
      ...interpretation,
      action: 'clarify',
      serviceId: null,
      addOns: [],
      question: 'service',
      optionIds: ['gelx'],
      factUpdates: { ...noFactUpdates, treatment: 'gel_x', desiredApplication: 'extensions', length: 'medium', french: 'yes', existingProduct: 'gel_x', origin: 'other_salon' },
    }));

    expect(response.result).toEqual({ kind: 'clarification', question: 'removal', options: [] });
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it('resolves an explicit add-on update through the normal proposal path even when the model also asks an invalid product question', async () => {
    const prior = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      requestedSelection: { baseServiceId: 'gelx', selectedAddOns: [] },
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [] } },
    }, secret);
    mocks.proposal.mockResolvedValueOnce({
      selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
      fingerprint: acceptedFingerprint,
      service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 },
      addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1000 }],
      subtotalCents: 7000,
      durationMinutes: 75,
      currency: 'CAD',
      expiresAt: '2026-09-18T00:00:00Z',
    });
    const response = await runCustomerAssistantTurn({ ...input(), conversation: prior, message: 'add French' }, provider({
      ...interpretation,
      action: 'clarify',
      serviceId: 'gelx',
      addOns: [{ addOnId: 'french', quantity: 1 }],
      addOnUpdates: { add: [{ addOnId: 'french', quantity: 1 }], remove: [] },
      question: 'product',
      optionIds: ['not-public'],
      factUpdates: { ...noFactUpdates, french: 'yes', existingProduct: 'unknown' },
    }));

    expect(response.result).toMatchObject({
      kind: 'proposal',
      proposal: { selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
    });
  });

  it('does not let the model ask for a date before a customer accepts a proposal', async () => {
    const response = await runCustomerAssistantTurn(input(), provider({
      ...interpretation,
      action: 'clarify',
      question: 'date',
      optionIds: [],
    }));

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'no_match' });
  });

  it('clears a same-fingerprint accepted booking when post-read context changed', async () => {
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] } },
      booking: { acceptedFingerprint, datePreference: { date: '2026-09-20', earliest: '12:00', latest: '17:00' }, offeredSlots: [], selectedSlot: null },
    }, secret);
    mocks.lookup.mockResolvedValueOnce({
      proposal: {
        selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
        fingerprint: acceptedFingerprint,
        service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 },
        addOns: [],
        subtotalCents: 6000,
        durationMinutes: 60,
        currency: 'CAD',
        expiresAt: '2026-09-18T00:00:00Z',
      },
      today: '2026-09-18',
      timeZone: 'America/Vancouver',
      slots: [],
      selected: null,
      quoteChanged: true,
    });

    const response = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Saturday afternoon' }, provider({ ...interpretation, action: 'availability', datePreference: { date: '2026-09-20', earliest: '12:00', latest: '17:00' } }));

    expect(response.result).toMatchObject({ kind: 'proposal' });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret).booking).toBeUndefined();
  });
});

describe('natural receptionist orchestration', () => {
  const enablePublicFacts = () => mocks.publicFacts.mockResolvedValue({ salon: { name: 'Synthetic salon' }, catalogue: { currency: 'CAD', services: [{ id: 'gelx', name: 'Gel-X', category: 'manicure', description: null, durationMinutes: 60, price: { baseCents: 6000, baseDisplay: '$60.00', displayLabel: null, range: null } }], addOns: [] } });
  const information = { ...interpretation, action: 'answer', answerTopic: 'price', informationServiceIds: ['gelx'], addOnUpdates: { add: [], remove: [] }, addOns: [] };
  const answer = (message: string) => ({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify({ segments: message.startsWith('[[') ? [{ kind: 'fact', key: message.slice(2, -2) }] : [{ kind: 'text', text: message }], serviceOptions: ['gelx'] }) }] });

  it.each(['gelx', 'pedicure'])('keeps service guidance optional, viable and identical to signed displayed choices: %s', async (option) => {
    const services = [{ id: 'biab', name: 'BIAB' }, { id: 'gelx', name: 'Gel-X' }, { id: 'pedicure', name: 'Pedicure' }];
    mocks.menu.mockResolvedValue({ services, addOns: [], bindings: [] });
    mocks.publicFacts.mockResolvedValue({ salon: { name: 'Synthetic salon' }, catalogue: { currency: 'CAD', services: services.map(service => ({ ...service, description: `${service.name} from the public menu.`, durationMinutes: 60, price: { baseCents: 6000, baseDisplay: '$60.00', displayLabel: null, range: null } })), addOns: [] } });
    const unresolved = { ...interpretation, action: 'clarify', question: 'service', serviceId: null, addOns: [], optionIds: ['biab', 'gelx'] };
    const model = provider(unresolved);
    model.createResponse.mockResolvedValueOnce({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(unresolved) }] }).mockResolvedValueOnce({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify({ segments: [{ kind: 'text', text: 'For added length, consider extensions.' }], serviceOptions: [option] }) }] });
    const response = await runCustomerAssistantTurn({ ...input(), message: 'I am not sure which service suits me.' }, model);
    const expectedOptions = option === 'gelx' ? ['Gel-X'] : [];

    expect(response.result).toMatchObject({ kind: 'clarification', question: 'service', options: expectedOptions });

    const restored = verifyCustomerConversation(response.conversation, 'salon-a', secret);

    expect(restored.context?.options).toEqual(expectedOptions);
    expect(restored.requestedSelection).toBeUndefined();
    expect(restored.booking).toBeUndefined();
    expect(mocks.proposal).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('answers price through fresh facts, stores actual dialogue and does not select a booking', async () => {
    enablePublicFacts();
    const model = provider(information);
    model.createResponse.mockResolvedValueOnce({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(information) }] }).mockResolvedValueOnce(answer('[[service_0_price]]'));
    const result = await runCustomerAssistantTurn({ ...input(), message: 'How much is Gel-X?' }, model);

    expect(result.result).toMatchObject({ kind: 'answer', message: expect.stringContaining('$60.00') });

    const restored = verifyCustomerConversation(result.conversation, 'salon-a', secret);

    expect(restored.requestedSelection).toBeUndefined();
    expect(restored.dialogue).toEqual([{ role: 'user', content: 'How much is Gel-X?' }, { role: 'assistant', content: result.result.message }]);
    expect(model.createResponse).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenLastCalledWith(expect.objectContaining({ usage: { inputTokens: 200, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 100 } }));
    expect(mocks.proposal).not.toHaveBeenCalled();
  });

  it.each([false, true])('only refreshes a configured quote from resolved selection authority: %s', async (resolved) => {
    enablePublicFacts();
    const selection = { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] };
    const state = { ...createCustomerConversation('salon-a', secret), requestedSelection: selection, ...(resolved ? { context: { question: null, options: [], selection } } : {}) };
    const model = provider(information);
    model.createResponse.mockResolvedValueOnce({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(information) }] }).mockResolvedValueOnce(answer('[[service_0_price]]'));
    const result = await runCustomerAssistantTurn({ ...input(), conversation: signCustomerConversation(state, secret), message: 'What is the normal Gel-X price?' }, model);

    expect(result.result.kind).toBe('answer');
    expect(result.result.message).toContain('$60.00');

    if (resolved) {
      expect(mocks.proposal).toHaveBeenCalledWith('salon-a', null, selection);
      expect(result.result.message).toContain('subtotal');
    } else {
      expect(mocks.proposal).not.toHaveBeenCalled();
      expect(result.result.message).not.toContain('subtotal');
    }
  });

  it('keeps an authoritative useful price fallback when composer output invents a value', async () => {
    enablePublicFacts();
    const model = provider(information);
    model.createResponse.mockResolvedValueOnce({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(information) }] }).mockResolvedValueOnce(answer('It costs $1.'));
    const result = await runCustomerAssistantTurn({ ...input(), message: 'How much?' }, model);

    expect(result.result.message).toContain('$60.00');
    expect(result.result.message).not.toContain('$1.');
  });

  it('does not emit a silent answer when public facts fail', async () => {
    const result = await runCustomerAssistantTurn(input(), provider(information));

    expect(result.result).toMatchObject({ kind: 'answer', message: expect.stringContaining('can’t verify') });
  });

  it('marks aggregate usage unknown when the second call fails without usage', async () => {
    enablePublicFacts();
    const model = provider(information);
    model.createResponse.mockResolvedValueOnce({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(information) }] }).mockRejectedValueOnce(new Error('synthetic transport failure'));
    const result = await runCustomerAssistantTurn(input(), model);

    expect(result.result.message).toContain('$60.00');
    expect(mocks.record).toHaveBeenLastCalledWith(expect.objectContaining({ usage: null }));
  });
});
