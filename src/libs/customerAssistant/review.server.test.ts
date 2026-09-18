import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  lookup: vi.fn(),
  quote: vi.fn(),
  prepare: vi.fn(),
  ledger: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'customer', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./budget.server', () => ({ reserveCustomerAssistantTurn: mocks.reserve }));
vi.mock('./slots.server', () => ({ lookupCustomerSlots: mocks.lookup }));
vi.mock('./prepareQuote.server', () => ({ prepareCustomerBookingQuote: mocks.quote }));
vi.mock('./operationStore.server', () => ({
  prepareCustomerBookingOperation: mocks.prepare,
  customerBookingOperationReference: () => ({ capability: 'opaque-operation', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2026-09-18T12:05:00Z' }),
}));
vi.mock('./ledger.server', () => ({ recordCustomerAssistantUsage: mocks.ledger }));

const { createCustomerConversation, signCustomerConversation, verifyCustomerConversation } = await import('./conversation.server');
const { prepareCustomerAssistantReview } = await import('./review.server');

const secret = 'x'.repeat(32);
const fingerprint = 'a'.repeat(64);
const slot = { time: '15:00', startTime: '2026-09-20T19:00:00.000Z' };
const proposal = {
  selection: { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
  fingerprint,
  service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 },
  addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1500 }],
  subtotalCents: 7500,
  durationMinutes: 90,
  currency: 'CAD',
  expiresAt: '2026-09-18T00:00:00Z',
};
const conversation = () => signCustomerConversation({
  ...createCustomerConversation('salon-a', secret, Date.parse('2026-09-18T12:00:00Z')),
  context: { question: null, options: [], selection: proposal.selection },
  booking: { acceptedFingerprint: fingerprint, datePreference: { date: '2026-09-20', earliest: '12:00', latest: '17:00' }, offeredSlots: [slot], selectedSlot: slot },
}, secret);
const input = (token = conversation()) => ({
  salon: { id: 'salon-a', slug: 'isla-nail-studio', name: 'Isla Nail Studio', settings: {}, features: null, address: null as string | null, city: null as string | null, state: null as string | null, zipCode: null as string | null },
  features: null,
  conversation: token,
  contact: { name: 'Ava Client', email: 'ava@example.com', phone: '4165550101' },
  clientIp: '192.0.2.5',
  now: new Date('2026-09-18T12:00:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ ok: true });
  mocks.lookup.mockResolvedValue({ proposal, today: '2026-09-18', timeZone: 'America/Toronto', slots: [slot], selected: slot, quoteChanged: false });
  mocks.quote.mockResolvedValue({ review: { status: 'READY', timeZone: 'America/Toronto', financial: { subtotalCents: 7500, currency: 'CAD' }, reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true } } });
  mocks.prepare.mockImplementation(async (args: { material: unknown }) => ({ material: args.material }));
  mocks.ledger.mockResolvedValue(undefined);
});

describe('customer assistant durable review', () => {
  it('returns a PII-free authoritative review with a durable explicit-action reference', async () => {
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toMatchObject({
      kind: 'booking_review',
      review: {
        status: 'READY',
        financial: { subtotalCents: 7500, currency: 'CAD' },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/ava@example\.com|4165550101|Ava Client/);
    expect(JSON.stringify(response)).not.toMatch(/confirmed|appointmentId|payment/i);
    expect(mocks.lookup).toHaveBeenCalledWith(expect.objectContaining({ requiredStartTime: slot.startTime }));
    expect(mocks.ledger).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'review_prepared', deterministic: true, usage: null }));
  });

  it('returns a fresh proposal and clears acceptance when quote authority changed', async () => {
    mocks.lookup.mockResolvedValueOnce({ proposal, today: '2026-09-18', timeZone: 'America/Toronto', slots: [slot], selected: slot, quoteChanged: true });
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'proposal', proposal });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking).toBeUndefined();
  });

  it('offers refreshed alternatives rather than reviewing a disappeared slot', async () => {
    const alternative = { time: '16:00', startTime: '2026-09-20T20:00:00.000Z' };
    mocks.lookup.mockResolvedValueOnce({ proposal, today: '2026-09-18', timeZone: 'America/Toronto', slots: [alternative], selected: null, quoteChanged: false });
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toMatchObject({ kind: 'slots', slotDisappeared: true, slots: [alternative] });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking?.selectedSlot).toBeNull();
  });

  it('creates no operation when authoritative preparation fails closed', async () => {
    mocks.quote.mockResolvedValueOnce(null);
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'selection_changed' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('does not persist a quote with a changed timezone or currency', async () => {
    mocks.quote.mockResolvedValueOnce({ review: { timeZone: 'America/Vancouver', financial: { currency: 'CAD' } } });

    expect((await prepareCustomerAssistantReview(input())).result).toEqual({ kind: 'unavailable', reason: 'selection_changed' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('rejects a wrong-tenant capability before quota or availability work', async () => {
    const response = await prepareCustomerAssistantReview({ ...input(), salon: { ...input().salon, id: 'salon-b' } });

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'invalid_conversation' });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('does no review lookup, configuration, provider-policy, or ledger work when reservation is denied', async () => {
    mocks.reserve.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'rate_limited' });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('signs a next state after an availability/config dependency failure', async () => {
    mocks.lookup.mockRejectedValueOnce(new Error('temporary failure'));
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).turnIndex).toBe(1);
  });

  it('signs a next state after booking configuration cannot be re-read', async () => {
    mocks.quote.mockRejectedValueOnce(new Error('temporary failure'));
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).turnIndex).toBe(1);
  });
});
