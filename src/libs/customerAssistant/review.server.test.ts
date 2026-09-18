import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  lookup: vi.fn(),
  config: vi.fn(),
  location: vi.fn(),
  deposit: vi.fn(),
  ledger: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'customer', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./budget.server', () => ({ reserveCustomerAssistantTurn: mocks.reserve }));
vi.mock('./slots.server', () => ({ lookupCustomerSlots: mocks.lookup }));
vi.mock('@/libs/bookingConfig', () => ({ getBookingConfigForSalon: mocks.config }));
vi.mock('@/libs/queries', () => ({ getPrimaryLocation: mocks.location }));
vi.mock('@/libs/depositPolicy.server', () => ({ getDepositPolicyForSalon: mocks.deposit }));
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
  mocks.config.mockResolvedValue({ currency: 'CAD', confirmationMode: 'instant', timezone: 'America/Toronto' });
  mocks.location.mockResolvedValue({ name: 'Main Studio', address: '123 Private St', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' });
  mocks.deposit.mockResolvedValue({ active: false, reason: 'disabled', amountCents: 500, readinessStale: false, readinessAgeMs: null });
  mocks.ledger.mockResolvedValue(undefined);
});

describe('customer assistant incomplete review', () => {
  it('returns a PII-free incomplete snapshot without booking authority', async () => {
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toMatchObject({
      kind: 'review_prepared',
      review: {
        status: 'INCOMPLETE',
        technician: { kind: 'any_artist' },
        blockers: ['reminder_integration', 'identity_pricing'],
        financial: { subtotalCents: 7500, currency: 'CAD' },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/ava@example\.com|4165550101|Ava Client/);
    expect(JSON.stringify(response)).not.toMatch(/confirmed|appointmentId|payment/i);
    expect(mocks.lookup).toHaveBeenCalledWith(expect.objectContaining({ requiredStartTime: slot.startTime }));
    expect(mocks.ledger).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'review_prepared', deterministic: true, usage: null }));
  });

  it('redacts a private location before serialization', async () => {
    const privateContent = input();
    privateContent.salon.settings = { bookingPageContent: { live: { locationDisplayMode: 'after_booking' } } };
    const response = await prepareCustomerAssistantReview(privateContent);

    expect(response.result).toMatchObject({ kind: 'review_prepared', review: { location: { address: null, zipCode: null, city: 'Toronto' } } });
    expect(JSON.stringify(response)).not.toContain('123 Private St');
  });

  it('uses the manual-booking salon-address fallback when no location row exists', async () => {
    mocks.location.mockResolvedValueOnce(null);
    const fallbackInput = input();
    fallbackInput.salon = { ...fallbackInput.salon, address: '10 Salon Lane', city: 'Toronto', state: 'ON', zipCode: 'M5V 2A1' };

    const response = await prepareCustomerAssistantReview(fallbackInput);

    expect(response.result).toMatchObject({ kind: 'review_prepared', review: { location: { name: 'Isla Nail Studio', address: '10 Salon Lane', city: 'Toronto', zipCode: 'M5V 2A1' } } });
  });

  it('redacts private salon-address fallback before serialization', async () => {
    mocks.location.mockResolvedValueOnce(null);
    const fallbackInput = input();
    fallbackInput.salon = {
      ...fallbackInput.salon,
      address: '10 Salon Lane',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5V 2A1',
      settings: { bookingPageContent: { live: { locationDisplayMode: 'after_booking' } } },
    };

    const response = await prepareCustomerAssistantReview(fallbackInput);

    expect(response.result).toMatchObject({ kind: 'review_prepared', review: { location: { address: null, zipCode: null, city: 'Toronto' } } });
    expect(JSON.stringify(response)).not.toContain('10 Salon Lane');
  });

  it('fails closed when neither a location row nor a salon address can form a destination', async () => {
    mocks.location.mockResolvedValueOnce(null);
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
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

  it('fails closed on an undetermined deposit policy without logging contact', async () => {
    mocks.deposit.mockResolvedValueOnce({ active: false, reason: 'undetermined', amountCents: null, readinessStale: false, readinessAgeMs: null });
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(JSON.stringify(response)).not.toContain('ava@example.com');
  });

  it('fails closed if booking timezone changed after slot revalidation', async () => {
    mocks.config.mockResolvedValueOnce({ currency: 'CAD', confirmationMode: 'instant', timezone: 'America/Vancouver' });
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
  });

  it('fails closed if currency authority changed after quote revalidation', async () => {
    mocks.config.mockResolvedValueOnce({ currency: 'USD', confirmationMode: 'instant', timezone: 'America/Toronto' });
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
  });

  it('bases a deposit estimate on the service subtotal rather than tax-inclusive total', async () => {
    const taxInput = input();
    taxInput.salon.settings = { payments: { tax: { enabled: true, rateBps: 1300, pricesIncludeTax: false } } };
    mocks.deposit.mockResolvedValueOnce({ active: true, amountCents: 15_000, currency: 'cad', readinessStale: false, readinessAgeMs: null });

    const response = await prepareCustomerAssistantReview(taxInput);

    expect(response.result).toMatchObject({
      kind: 'review_prepared',
      review: { financial: { estimatedTaxCents: 975, estimatedTotalCents: 8475 }, deposit: { status: 'required', amountCents: 7500 } },
    });
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
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.location).not.toHaveBeenCalled();
    expect(mocks.deposit).not.toHaveBeenCalled();
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('signs a next state after an availability/config dependency failure', async () => {
    mocks.lookup.mockRejectedValueOnce(new Error('temporary failure'));
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).turnIndex).toBe(1);
  });

  it('signs a next state after booking configuration cannot be re-read', async () => {
    mocks.config.mockRejectedValueOnce(new Error('temporary failure'));
    const response = await prepareCustomerAssistantReview(input());

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).turnIndex).toBe(1);
  });
});
