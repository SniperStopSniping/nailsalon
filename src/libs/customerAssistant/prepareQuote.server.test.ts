import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareCustomerBookingQuote } from './prepareQuote.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  selection: vi.fn(),
  location: vi.fn(),
  deposit: vi.fn(),
}));
vi.mock('@/libs/publicBookingAvailability.server', () => ({ getAnonymousCustomerBookingAvailability: mocks.availability }));
vi.mock('@/libs/publicBookingSelection', () => ({ resolvePublicBookingSelection: mocks.selection }));
vi.mock('@/libs/queries', () => ({ getPrimaryLocation: mocks.location }));
vi.mock('@/libs/depositPolicy.server', () => ({ getDepositPolicyForSalon: mocks.deposit }));

const startTime = '2030-01-02T15:00:00.000Z';
const contact = { name: 'Ava', email: 'ava@example.com', phone: '4165551212' };
const selection = { baseServiceId: 'svc', selectedAddOns: [{ addOnId: 'addon', quantity: 2 }] };
const preference = { date: '2030-01-02', earliest: '09:00', latest: '12:00' };
const salon = {
  id: 's1',
  slug: 's1',
  name: 'Salon',
  address: '1 Main',
  city: 'Toronto',
  plan: 'free',
  settings: {
    payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } },
    booking: { timezone: 'America/Toronto', currency: 'CAD', confirmationMode: 'request_approval' },
  },
};

function input(overrides: Record<string, unknown> = {}) {
  return { salon, features: null, selection, preference, startTime, contact, smsConsent: { granted: true, selection: 'default_on' as const, wordingVersion: 'booking-sms-reminders-v1' }, now: new Date('2030-01-01T00:00:00.000Z'), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.location.mockResolvedValue({ name: 'Salon', address: '1 Main', city: 'Toronto', state: 'ON', zipCode: 'M1M1M1' });
  mocks.deposit.mockResolvedValue({ active: true, amountCents: 2500, currency: 'cad' });
  mocks.selection.mockResolvedValue({
    services: [{ id: 'svc', name: 'Gel', priceCents: 5000 }],
    addOns: [{ id: 'addon', name: 'Art', quantity: 2, lineTotalCents: 2000 }],
    subtotalBeforeDiscountCents: 7000,
    visibleDurationMinutes: 75,
    automaticDiscount: { kind: 'none', subtotalBeforeDiscountCents: 7000, discountAmountCents: 0, finalTotalCents: 7000, reward: null, firstVisit: null },
  });
  mocks.availability.mockResolvedValue(new Response(JSON.stringify({
    slots: [{ availability: 'available', startTime, time: '10:00' }],
  })));
});

describe('prepareCustomerBookingQuote', () => {
  it('uses canonical selection pricing and duration with tax, deposit, policy, and default-on SMS provenance', async () => {
    const material = await prepareCustomerBookingQuote(input({
      smsConsent: { granted: true, wordingVersion: 'booking-sms-reminders-v1', selection: 'default_on' },
    }));

    expect(mocks.availability).toHaveBeenCalledWith(expect.objectContaining({
      salon: { id: 's1', slug: 's1' },
      date: preference.date,
      baseServiceId: 'svc',
      selectedAddOns: JSON.stringify(selection.selectedAddOns),
    }));
    expect(mocks.selection).toHaveBeenCalledWith({
      salonId: 's1',
      baseServiceId: 'svc',
      selectedAddOns: selection.selectedAddOns,
      clientPhone: contact.phone,
    });
    expect(material).toMatchObject({
      expectedTotalCents: 7000,
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
      review: {
        status: 'READY',
        time: '10:00',
        timeZone: 'America/Toronto',
        durationMinutes: 75,
        services: [{ id: 'svc', name: 'Gel', priceCents: 5000 }],
        addOns: [{ id: 'addon', name: 'Art', quantity: 2, priceCents: 2000 }],
        financial: { subtotalCents: 7000, taxAmountCents: 910, totalDueCents: 7910, currency: 'CAD' },
        deposit: { status: 'required', amountCents: 2500, currency: 'CAD' },
        confirmationMode: 'request_approval',
        bookingPolicy: { required: true },
        reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true },
      },
    });
    expect(material?.review.deposit).toMatchObject({ label: expect.stringContaining('$25.00') });
    expect(material?.review.bookingPolicy).toMatchObject({ acknowledgmentText: expect.any(String), version: expect.any(String) });
  });

  it('uses an L1 service request-approval mode when no deposit is required', async () => {
    mocks.deposit.mockResolvedValue({ active: false, reason: 'not_required' });
    mocks.selection.mockResolvedValue({
      services: [{ id: 'svc', name: 'Gel', priceCents: 5000 }],
      addOns: [],
      subtotalBeforeDiscountCents: 5000,
      visibleDurationMinutes: 60,
      automaticDiscount: { kind: 'none', subtotalBeforeDiscountCents: 5000, discountAmountCents: 0, finalTotalCents: 5000, reward: null, firstVisit: null },
      l1ConfirmationMode: 'request_approval',
    });

    const material = await prepareCustomerBookingQuote(input({ salon: { ...salon, settings: { ...salon.settings, booking: { ...salon.settings.booking, confirmationMode: 'instant' } } } }));

    expect(material?.review.confirmationMode).toBe('request_approval');
    expect(material?.review.deposit).toMatchObject({ status: 'not_required' });
  });

  it('keeps deposit-required confirmation under the booking policy despite an L1 request-approval service', async () => {
    mocks.selection.mockResolvedValue({
      services: [{ id: 'svc', name: 'Gel', priceCents: 5000 }],
      addOns: [],
      subtotalBeforeDiscountCents: 5000,
      visibleDurationMinutes: 60,
      automaticDiscount: { kind: 'none', subtotalBeforeDiscountCents: 5000, discountAmountCents: 0, finalTotalCents: 5000, reward: null, firstVisit: null },
      l1ConfirmationMode: 'request_approval',
    });

    const material = await prepareCustomerBookingQuote(input({ salon: { ...salon, settings: { ...salon.settings, booking: { ...salon.settings.booking, confirmationMode: 'instant' } } } }));

    expect(material?.review.deposit).toMatchObject({ status: 'required', amountCents: 2500 });
    expect(material?.review.confirmationMode).toBe('instant');
  });

  it('keeps an explicit SMS off selection distinct from the salon default', async () => {
    const material = await prepareCustomerBookingQuote(input({
      smsConsent: { granted: false, wordingVersion: 'booking-sms-reminders-v1', selection: 'explicit_off' },
    }));

    expect(material?.smsConsent).toEqual({ granted: false, wordingVersion: 'booking-sms-reminders-v1', selection: 'explicit_off' });
    expect(material?.review.reminders).toEqual({ mode: 'default_on', selection: 'explicit_off', requestedEnabled: false });
  });

  it('rejects a stale slot before selecting or pricing a booking', async () => {
    mocks.availability.mockResolvedValueOnce(new Response(JSON.stringify({ slots: [] })));

    await expect(prepareCustomerBookingQuote(input())).resolves.toBeNull();

    expect(mocks.selection).not.toHaveBeenCalled();
    expect(mocks.location).not.toHaveBeenCalled();
    expect(mocks.deposit).not.toHaveBeenCalled();
  });

  it('binds every availability and selection lookup to the trusted salon', async () => {
    const otherSalon = { ...salon, id: 's2', slug: 's2' };
    await prepareCustomerBookingQuote(input({ salon: otherSalon }));

    expect(mocks.availability).toHaveBeenCalledWith(expect.objectContaining({ salon: { id: 's2', slug: 's2' } }));
    expect(mocks.selection).toHaveBeenCalledWith(expect.objectContaining({ salonId: 's2' }));
    expect(mocks.location).toHaveBeenCalledWith('s2');
    expect(mocks.deposit).toHaveBeenCalledWith(expect.objectContaining({ salonId: 's2', salon: otherSalon }));
  });

  it('uses the internal Smart Fit callback without serializing phone or evaluation data', async () => {
    const evaluation = {
      eligible: true,
      reason: 'ELIGIBLE',
      sides: {},
      qualifyingSides: [],
      remainingGapMinutes: 0,
      improvementMinutes: 60,
      consolidatedMinutes: 60,
      effectiveMaxGapMinutes: 15,
    };
    let callback: unknown;
    mocks.availability.mockImplementation(async (availabilityInput: {
      trustedClientPhone?: string;
      onSmartFitEvaluation?: (value: { startTime: string; evaluation: typeof evaluation }) => void;
    }) => {
      expect(availabilityInput.trustedClientPhone).toBe(contact.phone);

      callback = availabilityInput.onSmartFitEvaluation;
      availabilityInput.onSmartFitEvaluation?.({ startTime, evaluation });
      return new Response(JSON.stringify({ slots: [{ availability: 'available', startTime, time: '10:00' }] }));
    });

    const material = await prepareCustomerBookingQuote(input({
      salon: {
        ...salon,
        settings: {
          ...salon.settings,
          smartFit: { enabled: true, discountType: 'percent', value: 10 },
        },
      },
    }));

    expect(callback).toEqual(expect.any(Function));
    expect(material?.expectedTotalCents).toBe(6300);
    expect(material?.review.financial).toMatchObject({ discountAmountCents: 700, taxAmountCents: 819, totalDueCents: 7119 });
    expect(JSON.stringify(material)).not.toContain(contact.phone);
    expect(JSON.stringify(material)).not.toContain('ELIGIBLE');
    expect(JSON.stringify(material)).not.toContain('remainingGapMinutes');
  });

  it('redacts a private primary location and the salon-address fallback identically', async () => {
    const privateSalon = { ...salon, settings: { ...salon.settings, bookingPageContent: { live: { locationDisplayMode: 'after_booking' } } } };
    const primary = await prepareCustomerBookingQuote(input({ salon: privateSalon }));

    expect(primary?.review.location).toMatchObject({ address: null, zipCode: null, city: 'Toronto' });
    expect(JSON.stringify(primary)).not.toContain('1 Main');

    mocks.location.mockResolvedValue(null);
    mocks.availability.mockResolvedValue(new Response(JSON.stringify({ slots: [{ availability: 'available', startTime, time: '10:00' }] })));
    const fallback = await prepareCustomerBookingQuote(input({ salon: privateSalon }));

    expect(fallback?.review.location).toMatchObject({ address: null, zipCode: null, city: 'Toronto' });
  });

  it('uses the canonical salon address fallback and fails closed without any destination', async () => {
    mocks.location.mockResolvedValue(null);

    expect((await prepareCustomerBookingQuote(input()))?.review.location).toMatchObject({ address: '1 Main', city: 'Toronto' });

    mocks.availability.mockResolvedValue(new Response(JSON.stringify({ slots: [{ availability: 'available', startTime, time: '10:00' }] })));

    expect(await prepareCustomerBookingQuote(input({ salon: { ...salon, address: null, city: null } }))).toBeNull();
  });

  it('requires the canonical visible SMS preference for enabled controls and rejects undetermined deposits', async () => {
    expect(await prepareCustomerBookingQuote(input({ smsConsent: undefined }))).toBeNull();

    mocks.availability.mockResolvedValue(new Response(JSON.stringify({ slots: [{ availability: 'available', startTime, time: '10:00' }] })));
    mocks.deposit.mockResolvedValue({ active: false, reason: 'undetermined' });

    expect(await prepareCustomerBookingQuote(input())).toBeNull();
  });
});
