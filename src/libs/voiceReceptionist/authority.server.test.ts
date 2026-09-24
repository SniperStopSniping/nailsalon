import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerMenu } from '../customerAssistant/catalogue.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  apply: vi.fn(),
  model: vi.fn(),
  lookup: vi.fn(),
  readiness: vi.fn(),
  quote: vi.fn(),
  prepare: vi.fn(),
  reference: vi.fn(),
  confirm: vi.fn(),
  menu: { services: [], addOns: [], bindings: [], l1: undefined } as CustomerMenu,
}));
vi.mock('../customerAssistant/catalogue.server', () => ({
  loadCustomerMenu: vi.fn(async () => mocks.menu),
  loadCustomerClarificationSnapshot: vi.fn(),
  buildCustomerProposal: vi.fn(),
}));
vi.mock('../customerAssistant/slots.server', () => ({
  getCustomerAvailabilityContext: vi.fn(async () => ({ today: '2026-09-22', timeZone: 'America/Toronto' })),
  lookupCustomerSlots: mocks.lookup,
  lookupNextCustomerSlots: vi.fn(),
}));
vi.mock('../customerAssistant/publicFacts.server', () => ({ loadCustomerPublicFacts: vi.fn(async () => ({ salon: { name: 'Synthetic Isla' }, catalogue: { currency: 'CAD', services: [], addOns: [] } })) }));
vi.mock('../customerAssistant/resolveTurn', () => ({ resolveCustomerTurn: mocks.resolve, applyCustomerTurnResult: mocks.apply }));
vi.mock('../customerAssistant/readiness.server', () => ({ assessReadyCustomerProposal: mocks.readiness }));
vi.mock('../customerAssistant/prepareQuote.server', () => ({ prepareCustomerBookingQuote: mocks.quote }));
vi.mock('../customerAssistant/confirmBooking.server', () => ({ confirmCustomerBooking: mocks.confirm }));
vi.mock('../customerAssistant/operationStore.server', async () => {
  const actual = await vi.importActual<typeof import('../customerAssistant/operationStore.server')>('../customerAssistant/operationStore.server');
  return { ...actual, prepareCustomerBookingOperation: mocks.prepare, customerBookingOperationReference: mocks.reference };
});

const { chooseVoiceSlot, commitVoiceBooking, createVoiceDraft, prepareVoiceReview, runVoiceConsultation } = await import('./authority.server');
type VoiceDraft = import('./authority.server').VoiceDraft;

const callId = 'b883cdd1-f08e-41c4-a9f0-90fa5c946630';
const salon = { id: 'synthetic-isla', slug: 'synthetic-isla', name: 'Synthetic Isla', features: null, settings: { currency: 'CAD' }, plan: { name: 'test' }, address: '1 Test Street', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.menu = { services: [], addOns: [], bindings: [], l1: undefined };
  mocks.resolve.mockResolvedValue({ kind: 'answer', topic: 'conversation', message: '', options: [] });
  mocks.readiness.mockResolvedValue({ proposal: { selection: { baseServiceId: 'gel-x', selectedAddOns: [] }, fingerprint: 'f'.repeat(64) } });
  mocks.lookup.mockResolvedValue({ quoteChanged: false, selected: { time: '4:00 PM', startTime: '2026-09-26T20:00:00.000Z' }, slots: [{ time: '4:00 PM', startTime: '2026-09-26T20:00:00.000Z' }], proposal: { selection: { baseServiceId: 'gel-x', selectedAddOns: [] }, fingerprint: 'f'.repeat(64), currency: 'CAD' }, timeZone: 'America/Toronto' });
  mocks.quote.mockResolvedValue({ selection: { baseServiceId: 'gel-x', selectedAddOns: [] }, preference: { date: '2026-09-26', earliest: '00:00', latest: '23:59' }, startTime: '2026-09-26T20:00:00.000Z', technicianSelection: 'any', review: { status: 'READY', timeZone: 'America/Toronto', financial: { currency: 'CAD' }, manualConfirmationItems: [{ id: 'removal', name: 'Removal', quantity: 1, durationMinutes: 20, priceStatus: 'to_be_confirmed' }] } });
  mocks.prepare.mockResolvedValue({ material: { review: { status: 'READY', timeZone: 'America/Toronto', financial: { currency: 'CAD' } } }, revision: 3 });
  mocks.reference.mockReturnValue({ capability: 'voice-op', revision: 3, fingerprint: 'b'.repeat(64), expiresAt: '2026-09-26T20:05:00.000Z' });
  mocks.confirm.mockResolvedValue({ kind: 'booking_status', status: 'confirmed' });
});

function selectedDraft() {
  const draft = createVoiceDraft(salon.id, callId);
  const selection = { baseServiceId: 'gel-x', selectedAddOns: [] };
  const slot = { time: '4:00 PM', startTime: '2026-09-26T20:00:00.000Z' };
  draft.conversation.context = { question: null, options: [], selection };
  draft.conversation.booking = { acceptedFingerprint: 'f'.repeat(64), datePreference: { date: '2026-09-26', earliest: '00:00', latest: '23:59' }, offeredSlots: [slot], selectedSlot: slot };
  draft.conversation.facts = { schemaVersion: 1, treatment: 'gel_x', desiredApplication: 'extensions', maintenance: 'new_set', length: 'medium', french: 'unknown', existingProduct: 'acrylic', origin: 'other_salon', removal: 'yes', repairCount: 'unknown' };
  return draft;
}

function clarificationDraft(question: 'length' | 'origin' | 'product' | 'finish' | 'details') {
  const draft = createVoiceDraft(salon.id, callId);
  draft.conversation.context = { question, options: [], selection: { baseServiceId: 'gel-x', selectedAddOns: [] } };
  return draft;
}

const interpreterFallback = {
  factUpdates: { schemaVersion: 1, treatment: null, desiredApplication: null, maintenance: null, length: null, lengthChoice: null, french: null, designPreference: null, existingProduct: null, currentProductUncertain: null, origin: null, removal: null, repairCount: null },
  lengthExplicitThisTurn: false,
  selectionChangeExplicitThisTurn: false,
  priceComparison: null,
  action: 'clarify',
  timingFeedback: 'none',
  timeDirection: 'none',
  availabilityScope: 'next_available',
  dateExplicitThisTurn: false,
  timeWindowExplicitThisTurn: false,
  availabilityAnchor: null,
  answerTopic: null,
  addOnUpdates: { add: [], remove: [] },
  informationServiceIds: [],
  serviceId: 'gel-x',
  addOns: [],
  question: 'length',
  optionIds: [],
  datePreference: null,
};

describe('voice receptionist shared authority adapter', () => {
  it('binds the trusted telephony call ID as the customer-authority session', () => {
    const draft = createVoiceDraft(salon.id, callId, Date.parse('2026-09-22T12:00:00Z'));

    expect(draft).toMatchObject({
      lastResult: null,
      contact: null,
      operation: null,
      review: null,
      conversation: { salonId: salon.id, sessionId: callId, turnIndex: 0 },
    });
  });

  it('does not fall back to Customer AI configuration when the voice interpreter is absent', async () => {
    const draft = createVoiceDraft(salon.id, callId);

    await expect(runVoiceConsultation({ salon, draft, message: 'I want Gel-X' })).resolves.toMatchObject({
      result: { kind: 'unavailable', reason: 'unavailable' },
    });
  });

  it('rejects a draft from another tenant before loading voice or booking authority', async () => {
    const draft = createVoiceDraft('other-salon', callId);

    await expect(runVoiceConsultation({ salon, draft, message: 'Gel-X' })).resolves.toMatchObject({
      result: { kind: 'unavailable', reason: 'invalid_conversation' },
    });
  });

  it('fails closed when the bounded interpreter fails', async () => {
    const draft = createVoiceDraft(salon.id, callId);
    const provider = { createResponse: vi.fn(async () => ({ status: 'failed' as const, items: [], usage: null })) };

    await expect(runVoiceConsultation({ salon, draft, message: 'Gel-X' }, provider)).resolves.toMatchObject({
      result: { kind: 'unavailable', reason: 'unavailable' },
      publicFacts: { salon: { name: salon.name } },
    });
    expect(provider.createResponse).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-terra', reasoningEffort: 'low', tools: [], toolChoice: 'none', maxOutputTokens: 1_800, timeoutMs: 15_000 }));
  });

  it('handles an exact current service clarification choice without a model call', async () => {
    mocks.menu = { services: [{ id: 'gel-x', name: 'Gel-X', description: '', category: 'Extensions' }], addOns: [], bindings: [], l1: undefined };
    const draft = createVoiceDraft(salon.id, callId);
    draft.conversation.context = { question: 'service', options: ['Gel-X'], selection: null };

    await runVoiceConsultation({ salon, draft, message: 'Gel-X' });

    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: 'propose', serviceId: 'gel-x' }), expect.anything(), expect.anything(), expect.anything());
  });

  it('handles spoken Spanish removal and short-length clarifications without an interpreter', async () => {
    const removal = createVoiceDraft(salon.id, callId);
    removal.conversation.context = { question: 'removal', options: ['Yes', 'No'], selection: { baseServiceId: 'gel-x', selectedAddOns: [] } };
    await runVoiceConsultation({ salon, draft: removal, message: 'sí' });

    expect(mocks.resolve).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: 'clarify', question: 'removal', factUpdates: expect.objectContaining({ removal: 'yes' }) }), expect.anything(), expect.anything(), expect.anything());

    const length = createVoiceDraft(salon.id, 'e883cdd1-f08e-41c4-a9f0-90fa5c946630');
    length.conversation.context = { question: 'length', options: ['Short', 'Medium'], selection: { baseServiceId: 'gel-x', selectedAddOns: [] } };
    await runVoiceConsultation({ salon, draft: length, message: 'corto' });

    expect(mocks.resolve).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ question: 'length', lengthExplicitThisTurn: true, factUpdates: expect.objectContaining({ length: 'short' }) }), expect.anything(), expect.anything(), expect.anything());
  });

  it.each([
    ['short please', 'length', { length: 'short' }],
    ['actually make them short', 'length', { length: 'short' }],
    ['from another salon', 'origin', { origin: 'other_salon' }],
    ['I don\'t know what I have on my nails', 'product', { existingProduct: 'unknown', currentProductUncertain: true }],
    ['French tips', 'finish', { french: 'yes' }],
    ['no design', 'details', { french: 'no', designPreference: 'plain' }],
  ] as const)('handles the whole current clarification answer %s locally', async (message, question, facts) => {
    const provider = { createResponse: vi.fn() };
    const response = await runVoiceConsultation({ salon, draft: clarificationDraft(question), message }, provider);

    expect(response.modelCalls).toBe(0);
    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ question, factUpdates: expect.objectContaining(facts) }), expect.anything(), expect.anything(), expect.anything());
  });

  it('sends compound corrections through the bounded interpreter instead of dropping details', async () => {
    const provider = {
      createResponse: vi.fn(async () => ({
        status: 'completed' as const,
        items: [{ type: 'message' as const, text: JSON.stringify(interpreterFallback) }],
        usage: null,
      })),
    };

    const response = await runVoiceConsultation({ salon, draft: clarificationDraft('length'), message: 'short with French next Saturday' }, provider);

    expect(response.modelCalls).toBe(1);
    expect(provider.createResponse).toHaveBeenCalledTimes(1);
  });

  it('repeats only an exact cached-price question without silently ignoring a correction', async () => {
    const draft = createVoiceDraft(salon.id, callId);
    draft.lastResult = {
      kind: 'proposal',
      proposal: {
        selection: { baseServiceId: 'gel-x', selectedAddOns: [] },
        fingerprint: 'a'.repeat(64),
        service: { id: 'gel-x', name: 'Gel-X', priceCents: 6000 },
        addOns: [],
        currency: 'CAD',
        subtotalCents: 6000,
        durationMinutes: 90,
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    };

    await expect(runVoiceConsultation({ salon, draft, message: 'What was that price?' })).resolves.toMatchObject({ result: draft.lastResult });
    await expect(runVoiceConsultation({ salon, draft, message: 'make it short and what is the price?' })).resolves.toMatchObject({ result: { kind: 'unavailable' } });
  });

  it('rebuilds canonical material with actual salon settings and preserves manual removal context', async () => {
    const draft = selectedDraft();
    const contact = { name: 'Ava Client', email: 'ava@example.test', phone: '4165550100' };

    const response = await prepareVoiceReview({ salon, draft, contact, secret: 'v'.repeat(32) });

    expect(mocks.quote).toHaveBeenCalledWith(expect.objectContaining({ salon, contact }));
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0, material: expect.objectContaining({ manualConfirmationContext: { currentProduct: 'acrylic', itemIds: ['removal'], removalRequired: true } }) }));
    expect(response.draft.operation).toMatchObject({ capability: 'voice-op', revision: 3 });
    expect(response.draft.lastOperationRevision).toBe(3);
  });

  it('uses the retained durable revision when a changed draft invalidates a prior review', async () => {
    const draft = selectedDraft();
    draft.operation = { capability: 'old', revision: 3, fingerprint: 'c'.repeat(64), expiresAt: '2026-09-26T20:05:00.000Z' };
    draft.lastOperationRevision = 3;
    draft.review = { status: 'READY' } as never;

    await prepareVoiceReview({ salon, draft, contact: { name: 'Ava', email: 'ava@example.test', phone: '4165550100' }, secret: 'v'.repeat(32) });

    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
  });

  it('uses the salon reminder default unless a signed explicit choice is supplied', async () => {
    const draft = selectedDraft();
    const defaultOffSalon = { ...salon, settings: { communications: { sms: { bookingDefault: 'default_off' } } } };

    await prepareVoiceReview({ salon: defaultOffSalon, draft, contact: { name: 'Ava', email: 'ava@example.test', phone: '4165550100' }, secret: 'v'.repeat(32) });

    expect(mocks.quote).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: { granted: false, selection: 'default_off', wordingVersion: 'booking-sms-reminders-v1' } }));

    await prepareVoiceReview({ salon: { ...salon, settings: { communications: { sms: { bookingDefault: 'disabled' } } } }, draft: selectedDraft(), contact: { name: 'Ava', email: 'ava@example.test', phone: '4165550100' }, smsConsent: { granted: true, selection: 'explicit_on', wordingVersion: 'booking-sms-reminders-v1' }, secret: 'v'.repeat(32) });

    expect(mocks.quote).toHaveBeenLastCalledWith(expect.objectContaining({ smsConsent: undefined }));
  });

  it('invalidates review material if an offered slot changes before explicit selection', async () => {
    const draft = selectedDraft();
    mocks.lookup.mockResolvedValueOnce({ quoteChanged: true, selected: null, slots: [], proposal: { selection: { baseServiceId: 'gel-x', selectedAddOns: [] }, fingerprint: 'changed', currency: 'CAD' }, timeZone: 'America/Toronto' });

    const response = await chooseVoiceSlot({ salon, draft, startTime: '2026-09-26T20:00:00.000Z' });

    expect(response.result).toMatchObject({ kind: 'unavailable', reason: 'selection_changed' });
    expect(response.draft.review).toBeNull();
    expect(response.draft.operation).toBeNull();
  });

  it('commits only the contact and operation stored by the prepared review', async () => {
    const draft = selectedDraft();
    draft.contact = { name: 'Ava Client', email: 'ava@example.test', phone: '4165550100' };
    draft.review = { status: 'READY' } as never;
    draft.operation = { capability: 'stored-capability', revision: 3, fingerprint: 'd'.repeat(64), expiresAt: '2026-09-26T20:05:00.000Z' };
    const request = new Request('https://voice.test/commit', { method: 'POST' });

    await commitVoiceBooking({ salon, draft, request, secret: 'v'.repeat(32), policyAccepted: true });

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ capability: 'stored-capability', contact: draft.contact, revision: 3 }));
  });

  it('cannot commit a caller transcript without a server-prepared operation and contact', async () => {
    const draft: VoiceDraft = createVoiceDraft(salon.id, callId);
    const request = new Request('https://voice.test/api/voice/commit', { method: 'POST' });

    await expect(commitVoiceBooking({ salon, draft, request, secret: 'voice-signing-secret', policyAccepted: true }))
      .rejects.toThrow('VOICE_BOOKING_REVIEW_MISSING');
  });
});
