import { beforeEach, describe, expect, it, vi } from 'vitest';

const { andMock, descMock, eqMock, inArrayMock, select, db, requireClientApiSession, requireClientSalonFromQuery } = vi.hoisted(() => {
  const andMock = vi.fn(() => 'and');
  const descMock = vi.fn(() => 'desc');
  const eqMock = vi.fn(() => 'eq');
  const inArrayMock = vi.fn(() => 'inArray');
  const orderBy = vi.fn(async () => []);
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    andMock,
    descMock,
    eqMock,
    inArrayMock,
    orderBy,
    where,
    from,
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

import { GET } from './route';

describe('GET /api/appointments/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
