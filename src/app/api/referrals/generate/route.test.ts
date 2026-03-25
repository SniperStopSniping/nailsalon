import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireClientApiSession,
  requireClientSalonFromBody,
  guardModuleOr403,
  values,
  db,
} = vi.hoisted(() => {
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));

  return {
    requireClientApiSession: vi.fn(),
    requireClientSalonFromBody: vi.fn(),
    guardModuleOr403: vi.fn(),
    values,
    db: {
      insert,
    },
  };
});

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { POST } from './route';

describe('POST /api/referrals/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardModuleOr403.mockResolvedValue(null);
  });

  it('rejects unauthenticated referral generation', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
  });

  it('fails safely when tenant context is missing', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: 'MISSING_SALON', message: 'Salon slug is required' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a' }),
      }),
    );

    expect(response.status).toBe(400);
    expect(values).not.toHaveBeenCalled();
  });

  it('derives the referrer identity from the authenticated client session', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1' },
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          referrerPhone: '9999999999',
          referrerName: 'Spoofed Name',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      referrerPhone: '1111111111',
      referrerName: 'Ava',
      status: 'sent',
    }));
    expect(body.data.referralId).toMatch(/^ref_/);
  });
});
