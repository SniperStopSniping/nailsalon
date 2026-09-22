import { describe, expect, it, vi } from 'vitest';

import { POST } from './[salonId]/prepare/route';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  secret: vi.fn(),
  quote: vi.fn(),
  prepare: vi.fn(),
  read: vi.fn(),
  reference: vi.fn(),
  status: vi.fn(),
  limit: vi.fn(),
  salon: vi.fn(),
  guard: vi.fn(),
  online: vi.fn(),
  verify: vi.fn(),
  nextVisitOffer: vi.fn(),
}));
vi.mock('@/libs/customerAssistant/access.server', () => ({ getCustomerBookingRecoverySecret: mocks.secret }));
vi.mock('@/libs/customerAssistant/prepareQuote.server', () => ({ prepareCustomerBookingQuote: mocks.quote }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({
  CustomerBookingOperationError: class CustomerBookingOperationError extends Error {
    constructor(readonly code: string, readonly operation?: unknown) {
      super('CUSTOMER_BOOKING_OPERATION_REJECTED');
    }
  },
  prepareCustomerBookingOperation: mocks.prepare,
  customerBookingOperationReference: mocks.reference,
  readCustomerBookingOperation: mocks.read,
}));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
vi.mock('@/libs/publicBookingRateLimit.server', () => ({ checkPublicBookingRateLimit: mocks.limit, getPublicBookingClientIp: () => '127.0.0.1' }));
vi.mock('@/libs/queries', () => ({ getSalonById: mocks.salon }));
vi.mock('@/libs/salonStatus', () => ({ guardSalonApiRoute: mocks.guard, isOnlineBookingEnabled: mocks.online }));
vi.mock('@/libs/customerAssistant/normalConfirmHandoff.server', () => ({ verifyNormalConfirmHandoff: mocks.verify }));
vi.mock('@/libs/nextVisitOffer.server', () => ({ resolveNextVisitOfferPreview: mocks.nextVisitOffer }));

const id = 's1';
const flowId = '123e4567-e89b-12d3-a456-426614174000';
const flowToken = 'flow';
const contact = { clientName: 'Ava', clientEmail: 'ava@example.test', clientPhone: '4165551212' };
const displayed = {
  totalCents: 5000,
  durationMinutes: 50,
  currency: 'CAD',
  salonName: 'Salon',
  timeZone: 'America/Toronto',
  technician: null,
  location: null,
  services: [{ id: 'svc', name: 'Service', priceCents: 5000 }],
  addOns: [],
  confirmationMode: 'instant',
  reminderMode: 'default_on',
  policyVersion: null,
};
const booking = {
  salonSlug: 'salon',
  baseServiceId: 'svc',
  selectedAddOns: [],
  technicianId: null,
  startTime: '2030-01-02T15:00:00.000Z',
  appointmentDate: '2030-01-02',
  appointmentTime: '10:00',
  bookingSubject: 'guest',
  smsConsent: { granted: true, selection: 'default_on', wordingVersion: 'booking-sms-reminders-v1' },
  expectedDepositFingerprint: 'deposit-v1:none',
  ...contact,
};
const material = {
  review: {
    ...displayed,
    salon: { name: 'Salon' },
    time: '10:00',
    financial: { totalDueCents: 5000, currency: 'CAD' },
    bookingPolicy: { required: false },
    reminders: { mode: 'default_on' },
    technician: { kind: 'any_artist' },
    location: null,
  },
  expectedDepositFingerprint: 'deposit-v1:none',
  expectedBookingFinancialQuote: { currency: 'CAD', totalDueCents: 5000, taxConfigurationIdentity: 'tax' },
  expectedTotalCents: 5000,
  expectedDiscountType: null,
};

function request(body: unknown, origin = 'https://app.test') {
  return new Request('https://app.test/api/public/customer-booking/s1/prepare', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ salonId: id }) };
}

function seed() {
  vi.clearAllMocks();
  mocks.secret.mockReturnValue('x'.repeat(32));
  mocks.verify.mockReturnValue({ flowId });
  mocks.limit.mockResolvedValue({ allowed: true, reason: null });
  mocks.salon.mockResolvedValue({ id, slug: 'salon', publicationStatus: 'published', features: null });
  mocks.guard.mockResolvedValue(false);
  mocks.online.mockResolvedValue(true);
  mocks.nextVisitOffer.mockResolvedValue(null);
  mocks.quote.mockResolvedValue(material);
  mocks.prepare.mockResolvedValue({ material, appointmentId: null });
  mocks.reference.mockReturnValue({ capability: 'cap', revision: 1, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00Z' });
}

function staleDisplayed(key: keyof typeof displayed) {
  const changes: Record<keyof typeof displayed, unknown> = {
    totalCents: 1,
    durationMinutes: 1,
    currency: 'USD',
    salonName: 'Other Salon',
    timeZone: 'UTC',
    technician: { id: 'x', name: 'X' },
    location: { name: 'X', address: null, city: null, state: null, zipCode: null },
    services: [],
    addOns: [{ id: 'x', name: 'X', quantity: 1, priceCents: 1 }],
    confirmationMode: 'request_approval',
    reminderMode: 'disabled',
    policyVersion: 'v2',
  };
  return { ...displayed, [key]: changes[key] };
}

describe('normal booking prepare route', () => {
  it('rejects cross-origin and wrong tenant slug before operation writes', async () => {
    seed();

    expect((await POST(request({ flowToken, expectedRevision: 0, booking, displayed }, 'https://evil.test'), context())).status).toBe(403);
    expect((await POST(request({ flowToken, expectedRevision: 0, booking: { ...booking, salonSlug: 'other' }, displayed }), context())).status).toBe(404);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each([
    'totalCents',
    'durationMinutes',
    'currency',
    'salonName',
    'timeZone',
    'technician',
    'location',
    'services',
    'addOns',
    'confirmationMode',
    'reminderMode',
    'policyVersion',
  ] as const)('rejects stale displayed %s without writing', async (key) => {
    seed();
    const response = await POST(request({ flowToken, expectedRevision: 0, booking, displayed: staleDisplayed(key) }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'review_changed' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('refuses legacy campaign/reschedule modes but admits only a verified next-visit capability', async () => {
    seed();

    expect((await POST(request({ flowToken, expectedRevision: 0, booking: { ...booking, campaignToken: 'x' }, displayed }), context())).status).toBe(409);

    mocks.nextVisitOffer.mockResolvedValueOnce({ status: 'eligible' });

    expect((await POST(request({ flowToken, expectedRevision: 0, booking: { ...booking, campaignToken: 'a'.repeat(32) }, displayed }), context())).status).toBe(200);

    const response = await POST(request({ flowToken, expectedRevision: 0, booking, displayed }), context());

    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ salonId: id, sessionId: flowId }));
  });

  it('fails closed if next-visit capability verification is unavailable', async () => {
    seed();
    mocks.nextVisitOffer.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request({ flowToken, expectedRevision: 0, booking: { ...booking, campaignToken: 'a'.repeat(32) }, displayed }), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: 'review_unavailable' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('preserves server-owned manual confirmation context through normal confirm preparation', async () => {
    seed();
    const manualItem = { id: 'removal', name: 'Builder Gel Removal', quantity: 1, durationMinutes: 30, priceStatus: 'to_be_confirmed' as const };
    const manualMaterial = { ...material, review: { ...material.review, manualConfirmationItems: [manualItem], durationMinutes: 80 } };
    mocks.quote.mockResolvedValueOnce(manualMaterial);
    mocks.verify.mockReturnValueOnce({ flowId, manualConfirmationContext: { currentProduct: 'builder_gel', itemIds: ['removal'] } });
    mocks.prepare.mockImplementationOnce(args => Promise.resolve({ material: args.material, appointmentId: null }));

    const response = await POST(request({ flowToken, expectedRevision: 0, booking, displayed: { ...displayed, durationMinutes: 80, manualConfirmationItems: [manualItem] } }), context());

    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ material: expect.objectContaining({ manualConfirmationContext: { currentProduct: 'builder_gel', itemIds: ['removal'] } }) }));
  });

  it('accepts the same authoritative single-digit hour in canonical normal-booking format', async () => {
    seed();
    mocks.quote.mockResolvedValue({ ...material, review: { ...material.review, time: '9:00' } });
    const response = await POST(request({ flowToken, expectedRevision: 0, booking: { ...booking, appointmentTime: '09:00' }, displayed }), context());

    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('recovers the original status and capability after a matching revision_changed prepare', async () => {
    seed();
    const existing = { salonId: id, sessionId: flowId, id: 'operation-1', appointmentId: null };
    const { CustomerBookingOperationError } = await import('@/libs/customerAssistant/operationStore.server');
    mocks.prepare.mockRejectedValueOnce(new CustomerBookingOperationError(
      'revision_changed',
      existing as ConstructorParameters<typeof CustomerBookingOperationError>[1],
    ));
    mocks.status.mockResolvedValue({ kind: 'booking_status', operation: { capability: 'cap', revision: 1 }, status: 'not_created' });

    const response = await POST(request({ flowToken, expectedRevision: 0, booking, displayed }), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: { kind: 'booking_status', operation: { capability: 'cap', revision: 1 }, status: 'not_created' } });
    expect(mocks.status).toHaveBeenCalledWith(existing, 'x'.repeat(32));
  });

  it.each([
    { salonId: 'other-salon', sessionId: flowId },
    { salonId: id, sessionId: 'other-flow' },
  ])('does not recover a revision_changed operation from another tenant or flow', async (existing) => {
    seed();
    const { CustomerBookingOperationError } = await import('@/libs/customerAssistant/operationStore.server');
    mocks.prepare.mockRejectedValueOnce(new CustomerBookingOperationError(
      'revision_changed',
      existing as ConstructorParameters<typeof CustomerBookingOperationError>[1],
    ));

    const response = await POST(request({ flowToken, expectedRevision: 0, booking, displayed }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ reason: 'revision_changed' });
    expect(mocks.status).not.toHaveBeenCalled();
  });
});

describe('deposit term changes do not create a booking operation', () => {
  it('returns only revised payment terms and accepts the reviewed second attempt', async () => {
    seed();
    const updated = {
      ...material,
      expectedDepositFingerprint: 'deposit-v1:cad:2500',
      review: { ...material.review, deposit: { status: 'required', amountCents: 2500, currency: 'CAD', label: 'Deposit required' } },
    };
    mocks.quote.mockResolvedValue(updated);
    const first = await POST(request({ flowToken, expectedRevision: 0, booking, displayed }), context());

    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ reason: 'deposit_changed', deposit: { required: true, amountCents: 2500, currency: 'CAD', fingerprint: 'deposit-v1:cad:2500' }, confirmationMode: 'instant' });
    expect(mocks.prepare).not.toHaveBeenCalled();

    const second = await POST(request({ flowToken, expectedRevision: 0, booking: { ...booking, expectedDepositFingerprint: 'deposit-v1:cad:2500' }, displayed }), context());

    expect(second.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('does not allow revised deposit terms to bypass unrelated price review', async () => {
    seed();
    mocks.quote.mockResolvedValue({ ...material, expectedDepositFingerprint: 'deposit-v1:cad:2500' });
    const result = await POST(request({ flowToken, expectedRevision: 0, booking, displayed: { ...displayed, totalCents: 1 } }), context());

    expect(await result.json()).toEqual({ reason: 'review_changed' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
