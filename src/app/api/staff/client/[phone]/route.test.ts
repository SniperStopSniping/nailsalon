import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const {
  requireStaffOrAdminSalonAccess,
  getCompletedFinancialResolution,
  loadBookingEmailFinancialSummary,
  db,
  selectQueue,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const limit = vi.fn(async () => selectQueue.shift() ?? []);
  const orderBy = vi.fn(async () => selectQueue.shift() ?? []);
  const where = vi.fn(() => ({
    limit,
    orderBy,
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
  }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    requireStaffOrAdminSalonAccess: vi.fn(),
    getCompletedFinancialResolution: vi.fn(),
    loadBookingEmailFinancialSummary: vi.fn(),
    selectQueue,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({
  requireStaffOrAdminSalonAccess,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/financialReportingServer', () => ({
  getCompletedFinancialResolution,
}));

vi.mock('@/libs/bookingEmailFinancialSummary.server', () => ({
  loadBookingEmailFinancialSummary,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/libs/visibilityPolicy', () => ({
  getEffectiveVisibility: vi.fn(() => 'full_access'),
}));

vi.mock('@/libs/redact', () => ({
  isFullAccess: vi.fn(() => true),
  redactClientForStaff: vi.fn(client => client),
}));

describe('GET /api/staff/client/[phone]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    getCompletedFinancialResolution.mockResolvedValue({
      resolvedRows: [],
      unresolvedRows: [],
    });
    loadBookingEmailFinancialSummary.mockResolvedValue(null);
  });

  it('rejects unauthenticated access', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: Promise.resolve({ phone: '5551234567' }) },
    );

    expect(response.status).toBe(401);
  });

  it('rejects wrong-tenant access', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: Promise.resolve({ phone: '5551234567' }) },
    );

    expect(response.status).toBe(403);
  });

  it('allows authorized staff to view scoped client data', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    selectQueue.push(
      [{ visibility: null }],
      // Salon-scoped record first: it gates the global identity lookup.
      [{ hasGoogleReview: false }],
      [{ firstName: 'Ava', createdAt: new Date('2026-01-01T00:00:00Z') }],
      [],
      [],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: Promise.resolve({ phone: '5551234567' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        client: {
          phone: '5551234567',
          name: 'Ava',
          memberSince: '2026-01-01T00:00:00.000Z',
          hasGoogleReview: false,
        },
        stats: {
          totalVisits: 0,
          totalSpent: 0,
          currency: 'CAD',
          spendState: 'resolved',
          lastVisit: null,
        },
        preferences: null,
        appointments: [],
        photos: [],
      },
    });
  });

  it('does not label spend settled when a completed financial record is unresolved', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: { id: 'salon_1', slug: 'salon-a' },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    getCompletedFinancialResolution.mockResolvedValue({
      resolvedRows: [],
      unresolvedRows: [{
        appointmentId: 'appt_needs_review',
        salonClientId: null,
        clientPhone: '5551234567',
      }],
    });
    selectQueue.push(
      [{ visibility: null }],
      [{ hasGoogleReview: false }],
      [{ firstName: 'Ava', createdAt: new Date('2026-01-01T00:00:00Z') }],
      [],
      [],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: Promise.resolve({ phone: '5551234567' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.stats).toMatchObject({
      totalSpent: null,
      spendState: 'under_review',
    });
  });

  it.each([
    ['pending refund', 'DEPOSIT_REFUND_IN_FLIGHT'],
    ['failed refund', 'DEPOSIT_REFUND_UNRESOLVED'],
    ['refund conflict', 'DEPOSIT_REFUND_CONFLICT'],
  ])('suppresses every appointment amount for a %s summary', async (_case, blockCode) => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: { id: 'salon_1', slug: 'salon-a' },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    loadBookingEmailFinancialSummary.mockResolvedValue({
      appointmentStatus: 'completed',
      currency: 'CAD',
      serviceInvoiceTotalCents: 12345,
      totalDueCents: 13456,
      taxAmountCents: 1111,
      taxLabel: 'HST',
      taxMode: 'added',
      taxClassification: 'actual',
      taxApplied: true,
      collectedDepositCents: 2500,
      refundedDepositCents: 0,
      forfeitedDepositCents: 0,
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 4000,
      amountAlreadyPaidCents: 4000,
      balanceCents: 9456,
      depositBlockedCode: blockCode,
      depositPresentationState: 'blocked',
    });
    selectQueue.push(
      [{ visibility: null }],
      [{ hasGoogleReview: false }],
      [{ firstName: 'Ava', createdAt: new Date('2026-01-01T00:00:00Z') }],
      [],
      [{
        id: 'appt_blocked',
        startTime: new Date('2026-03-10T14:00:00.000Z'),
        endTime: new Date('2026-03-10T15:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'completed',
        totalPrice: 12345,
        invoiceCurrency: 'CAD',
        technicianId: null,
        clientName: 'Ava',
      }],
      [{ serviceName: 'Gel manicure', priceAtBooking: 12345 }],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: Promise.resolve({ phone: '5551234567' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.appointments).toEqual([
      expect.objectContaining({
        id: 'appt_blocked',
        totalPrice: null,
        currency: 'CAD',
        financialState: 'blocked',
        financialBlockCode: blockCode,
        financial: null,
      }),
    ]);
    expect(JSON.stringify(body.data.appointments)).not.toContain('12345');
    expect(JSON.stringify(body.data.appointments)).not.toContain('13456');
    expect(JSON.stringify(body.data.appointments)).not.toContain('9456');
  });

  it('does not disclose another salon\'s client identity for an unknown phone', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    // No salon-scoped record for this phone at salon_1 — even though a global
    // client record exists (created by another salon), it must not be read.
    selectQueue.push(
      [{ visibility: null }],
      [], // no salon_client relationship
      [], // preferences
      [], // appointments
      [], // photos
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: Promise.resolve({ phone: '5551234567' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.name).toBeNull();
    expect(body.data.client.memberSince).toBeNull();
  });
});
