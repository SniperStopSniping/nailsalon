import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), menu: vi.fn(), proposal: vi.fn(), record: vi.fn(), validate: vi.fn(), lookup: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'customer-only', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./budget.server', () => ({ reserveCustomerAssistantTurn: mocks.reserve }));
vi.mock('./catalogue.server', () => ({ loadCustomerMenu: mocks.menu, buildCustomerProposal: mocks.proposal, validateCustomerMenuSelection: mocks.validate }));
vi.mock('./ledger.server', () => ({ recordCustomerAssistantUsage: mocks.record }));
vi.mock('./slots.server', () => ({
  getCustomerAvailabilityContext: vi.fn().mockResolvedValue({ today: '2026-09-18', timeZone: 'America/Toronto' }),
  lookupCustomerSlots: mocks.lookup,
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
const interpretation = { action: 'propose', serviceId: 'gelx', addOns: [{ addOnId: 'french', quantity: 1 }], question: 'details', optionIds: [] };
const provider = (output: unknown = interpretation) => ({ createResponse: vi.fn().mockResolvedValue({ status: 'completed', usage, items: [{ type: 'message', text: JSON.stringify(output) }] }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ ok: true });
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

  it('keeps an accepted selection while asking for a missing date and uses bounded availability only after acceptance', async () => {
    const accepted = signCustomerConversation({
      ...createCustomerConversation('salon-a', secret),
      context: { question: null, options: [], selection: interpretation.serviceId ? { baseServiceId: interpretation.serviceId, selectedAddOns: interpretation.addOns } : null },
      booking: { acceptedFingerprint, datePreference: null, offeredSlots: [], selectedSlot: null },
    }, secret);
    const missingDate = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Can I come after 5?' }, provider({ ...interpretation, action: 'availability', datePreference: null }));

    expect(missingDate.result).toMatchObject({ kind: 'clarification', question: 'date' });
    expect(verifyCustomerConversation(missingDate.conversation, 'salon-a', secret).context?.selection).toEqual(expect.objectContaining({ baseServiceId: 'gelx' }));
    expect(verifyCustomerConversation(missingDate.conversation, 'salon-a', secret).booking?.acceptedFingerprint).toBe(acceptedFingerprint);
    expect(mocks.lookup).not.toHaveBeenCalled();

    const withDate = await runCustomerAssistantTurn({ ...input(), conversation: accepted, message: 'Saturday afternoon' }, provider({ ...interpretation, action: 'availability', datePreference: { date: '2026-09-20', earliest: '12:00', latest: '17:00' } }));

    expect(withDate.result).toMatchObject({ kind: 'slots', slots: [{ time: '15:00' }] });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
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
