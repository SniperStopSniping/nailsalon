import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const { andMock, descMock, eqMock, inArrayMock, select, selectQueue, db, requireClientApiSession, requireClientSalonFromQuery } = vi.hoisted(() => {
  const andMock = vi.fn(() => 'and');
  const descMock = vi.fn(() => 'desc');
  const eqMock = vi.fn(() => 'eq');
  const inArrayMock = vi.fn(() => 'inArray');
  const selectQueue: unknown[] = [];
  const select = vi.fn(() => {
    const result = selectQueue.shift() ?? [];
    const orderBy = vi.fn(async () => result);
    const where = vi.fn(() => {
      const query = Promise.resolve(result) as Promise<unknown> & {
        orderBy: typeof orderBy;
      };
      query.orderBy = orderBy;
      return query;
    });
    const from = vi.fn(() => ({ where }));
    return { from };
  });

  return {
    andMock,
    descMock,
    eqMock,
    inArrayMock,
    selectQueue,
    select,
    db: {
      select,
    },
    requireClientApiSession: vi.fn(),
    requireClientSalonFromQuery: vi.fn(),
  };
});

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();

  return {
    ...actual,
    and: andMock,
    desc: descMock,
    eq: eqMock,
    inArray: inArrayMock,
  };
});

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromQuery,
}));

describe('GET /api/appointments/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('rejects caller-supplied phone access when there is no authenticated client session', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/appointments/history?phone=9999999999&salonSlug=salon-a'),
    );

    expect(response.status).toBe(401);
    expect(requireClientSalonFromQuery).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('ignores caller-supplied phone and scopes lookups to the authenticated client session', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111', '+11111111111'],
      session: {
        phone: '+11111111111',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
    });
    requireClientSalonFromQuery.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1' },
    });

    const response = await GET(
      new Request('http://localhost/api/appointments/history?phone=9999999999&salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { appointments: [] } });
    expect(inArrayMock).toHaveBeenCalledWith(expect.anything(), ['1111111111', '+11111111111']);
    expect(inArrayMock).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['9999999999']));
  });

  it('fails safely when tenant context is missing', async () => {
    const tenantFailure = new Response(
      JSON.stringify({ error: { code: 'MISSING_SALON', message: 'Salon slug is required' } }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111'],
      session: {
        phone: '+11111111111',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
    });
    requireClientSalonFromQuery.mockResolvedValue({
      ok: false,
      response: tenantFailure,
    });

    const response = await GET(new Request('http://localhost/api/appointments/history'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'MISSING_SALON',
        message: 'Salon slug is required',
      },
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('loads cross-tenant payment children and blocks the history response', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111'],
      session: {
        phone: '+11111111111',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
    });
    requireClientSalonFromQuery.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1' },
    });
    selectQueue.push(
      [{
        id: 'appt_dirty_payment',
        salonId: 'salon_1',
        clientPhone: '1111111111',
        startTime: new Date('2026-07-01T14:00:00.000Z'),
        endTime: new Date('2026-07-01T15:00:00.000Z'),
        status: 'completed',
        totalPrice: 5000,
        totalDurationMinutes: 60,
        amountPaidCents: null,
        paymentStatus: 'paid',
        invoiceCurrency: 'CAD',
        bookingTaxSnapshot: null,
        rescheduleTaxSnapshot: null,
        finalTaxSnapshot: null,
      }],
      [],
      [],
      [{
        id: 'payment_dirty_tenant',
        appointmentId: 'appt_dirty_payment',
        salonId: 'salon_foreign',
        amountCents: 5000,
        voidedAt: null,
      }],
    );

    const response = await GET(new Request(
      'http://localhost/api/appointments/history?salonSlug=salon-a',
    ));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
  });
});
