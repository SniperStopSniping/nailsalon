import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), failure: vi.fn(), status: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/appointmentCreation.server', () => ({ createAppointmentFromRequest: mocks.create }));
vi.mock('./operationStore.server', () => ({
  readCustomerBookingOperation: mocks.read,
  recordCustomerBookingFailure: mocks.failure,
  CustomerBookingOperationError: class extends Error {},
}));
vi.mock('./bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
const { confirmCustomerBooking } = await import('./confirmBooking.server');
const material = {
  selection: { baseServiceId: 'service', selectedAddOns: [{ addOnId: 'addon', quantity: 2 }] },
  startTime: '2030-01-02T15:00:00.000Z',
  smsConsent: { granted: false, selection: 'explicit_off', wordingVersion: 'booking-sms-reminders-v1' },
  expectedTotalCents: 7000,
  expectedDiscountType: null,
  expectedBookingFinancialQuote: { currency: 'CAD', totalDueCents: 7910, taxConfigurationIdentity: 'tax' },
  expectedDepositFingerprint: 'deposit-v1:none',
  review: { bookingPolicy: { required: true, version: 'policy-v1:approved' } },
};
const operation = { id: 'operation', revision: 1, requestHash: 'fingerprint', appointmentId: null, material };
function input() {
  return {
    request: new Request('https://app.test/confirm', { headers: { origin: 'https://app.test', cookie: 'owner-session=privileged' } }),
    salon: { id: 'salon', slug: 'synthetic-salon' },
    secret: 's'.repeat(32),
    capability: 'opaque',
    revision: 1,
    fingerprint: 'fingerprint',
    contact: { name: 'Synthetic', email: 'synthetic@example.test', phone: '4165550100' },
    policyAccepted: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(operation);
  mocks.status.mockImplementation(async (row: { appointmentId?: string; lastFailure?: string }) => ({ kind: 'booking_status', appointmentId: row.appointmentId, lastFailure: row.lastFailure }));
  mocks.failure.mockImplementation(async (args: { failure: string }) => ({ ...operation, lastFailure: args.failure }));
  mocks.create.mockResolvedValue(new Response(null, { status: 503 }));
});

describe('explicit customer booking adapter', () => {
  it('replays a linked operation without creation even if contact or review changed', async () => {
    mocks.read.mockResolvedValue({ ...operation, appointmentId: 'original' });
    await confirmCustomerBooking({ ...input(), revision: 99, policyAccepted: false });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'original' }), 's'.repeat(32));
  });

  it('creates exclusively from stored material and omits ambient auth cookies', async () => {
    mocks.read.mockResolvedValueOnce(operation).mockResolvedValueOnce({ ...operation, appointmentId: 'one' });
    await confirmCustomerBooking(input());
    const [request, access] = mocks.create.mock.calls[0]!;
    const body = await request.json();

    expect(request.headers.get('cookie')).toBeNull();
    expect(access).toMatchObject({ kind: 'anonymous_customer', salon: { id: 'salon' }, operation: { capability: 'opaque' } });
    expect(body).toMatchObject({ baseServiceId: 'service', selectedAddOns: material.selection.selectedAddOns, smsConsent: material.smsConsent, technicianId: null, expectedTotalCents: 7000, expectedBookingFinancialQuote: material.expectedBookingFinancialQuote });
    expect(body).not.toHaveProperty('bookingSubject');
  });

  it('forwards only the server-stored next-visit reference through access, never through public JSON', async () => {
    const withOffer = { ...operation, material: { ...material, nextVisitOffer: { campaignId: 'campaign', entitlementId: 'offer' } } };
    mocks.read.mockResolvedValueOnce(withOffer).mockResolvedValueOnce({ ...withOffer, appointmentId: 'one' });
    await confirmCustomerBooking(input());
    const [request, access] = mocks.create.mock.calls[0]!;

    expect(access).toMatchObject({ nextVisitOffer: { campaignId: 'campaign', entitlementId: 'offer' } });
    expect(await request.json()).not.toHaveProperty('nextVisitOffer');
  });

  it('recovers a committed appointment after a thrown/lost successful response', async () => {
    mocks.create.mockRejectedValue(new Error('timeout after commit'));
    mocks.read.mockResolvedValueOnce(operation).mockResolvedValueOnce({ ...operation, appointmentId: 'original' });

    await expect(confirmCustomerBooking(input())).resolves.toMatchObject({ appointmentId: 'original' });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it.each([['PAST_TIME', 400], ['OUTSIDE_SCHEDULE', 400], ['NO_AVAILABLE_TECHNICIAN', 409], ['TIME_CONFLICT', 409]])('classifies %s as a definite lost slot after rechecking commit', async (code, status) => {
    mocks.create.mockResolvedValue(Response.json({ error: { code } }, { status: Number(status) }));

    await expect(confirmCustomerBooking(input())).resolves.toMatchObject({ lastFailure: 'slot_unavailable' });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each([['EXISTING_APPOINTMENT', 'existing_appointment'], ['CONTACT_IDENTITY_CONFLICT', 'contact_conflict']])('reports canonical %s without disclosing client or booking details', async (code, lastFailure) => {
    mocks.create.mockResolvedValue(Response.json({ error: { code, privateClient: 'not-forwarded' } }, { status: 409 }));
    const result = await confirmCustomerBooking(input());

    expect(result).toMatchObject({ lastFailure });
    expect(JSON.stringify(result)).not.toContain('not-forwarded');
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('keeps in-progress and unknown conflicts unresolved', async () => {
    mocks.create.mockResolvedValue(Response.json({ error: { code: 'BOOKING_IN_PROGRESS' } }, { status: 409 }));

    await expect(confirmCustomerBooking(input())).rejects.toThrow('UNRESOLVED');
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it('does not attempt another create when recovery itself is ambiguous', async () => {
    mocks.read.mockResolvedValueOnce(operation).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(confirmCustomerBooking(input())).rejects.toThrow('database unavailable');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it('rejects stale reviews and absent required policy acceptance before creating', async () => {
    await expect(confirmCustomerBooking({ ...input(), revision: 2 })).rejects.toThrow();
    await expect(confirmCustomerBooking({ ...input(), policyAccepted: false })).rejects.toThrow();

    expect(mocks.create).not.toHaveBeenCalled();
  });
});
