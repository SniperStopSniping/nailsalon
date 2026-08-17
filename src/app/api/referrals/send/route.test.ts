/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireClientApiSession,
  requireClientSalonFromBody,
  ClientLifecycleStabilizationError,
  resolveCanonicalSalonClientIdentity,
  guardModuleOr403,
  sendReferralInvite,
  selectResults,
  values,
  db,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const values = vi.fn(async () => undefined);

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        return {
          limit: vi.fn(async () => result),
        };
      }),
    })),
  }));

  const insert = vi.fn(() => ({ values }));

  return {
    requireClientApiSession: vi.fn(),
    requireClientSalonFromBody: vi.fn(),
    ClientLifecycleStabilizationError: class ClientLifecycleStabilizationError extends Error {},
    resolveCanonicalSalonClientIdentity: vi.fn(),
    guardModuleOr403: vi.fn(),
    sendReferralInvite: vi.fn(),
    selectResults,
    values,
    db: {
      select,
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

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError,
  resolveCanonicalSalonClientIdentity,
}));

vi.mock('@/libs/SMS', () => ({
  sendReferralInvite,
}));

vi.mock('@/libs/communicationMaterialization', () => ({
  // These suites pin the LEGACY (BYO-mode) behavior of the send legs; the
  // shared-mode intent path has its own suites. connected_byo preserves the
  // exact pre-C1 semantics under test, and the materializers are inert.
  resolveSalonCommunicationContext: vi.fn(async () => ({
    settings: null,
    mode: 'connected_byo',
    smsEligible: false,
    timeZone: null,
    salonName: null,
  })),
  materializeClientEvent: vi.fn(async () => []),
  materializeReminders: vi.fn(async () => ({ materialized: [], skipped: [] })),
  formatIntentStartTime: vi.fn(() => 'Wed Aug 26, 12:30 PM'),
  loadAppointmentClientEmail: vi.fn(async () => null),
}));
vi.mock('@/libs/DB', () => ({
  db,
}));

import { POST } from './route';

describe('POST /api/referrals/send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    guardModuleOr403.mockResolvedValue(null);
    sendReferralInvite.mockResolvedValue(true);
    resolveCanonicalSalonClientIdentity.mockResolvedValue({
      terminal: { phone: '1111111111' },
      externalClientId: null,
    });
  });

  it('rejects unauthenticated referral sends', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a', refereePhone: '2223334444' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
  });

  it('derives referral sender identity from the authenticated client session', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', name: 'Salon A', customDomain: 'islanailsalon.com' },
    });
    selectResults.push([], [], []);

    const response = await POST(
      new Request('http://localhost/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          referrerPhone: '9999999999',
          referrerName: 'Spoofed Name',
          refereePhone: '2223334444',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      referrerPhone: '1111111111',
      referrerName: 'Ava',
      refereePhone: '2223334444',
      status: 'sent',
    }));
    expect(sendReferralInvite).toHaveBeenCalledWith('salon_1', {
      refereePhone: '2223334444',
      referrerName: 'Ava',
      salonName: 'Salon A',
      salonCustomDomain: 'islanailsalon.com',
      referralId: expect.stringMatching(/^ref_/),
    });
    expect(body.data.smsSent).toBe(true);
  });

  it('rejects an alias-only session before referral or delivery side effects', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', name: 'Salon A', customDomain: 'islanailsalon.com' },
    });
    resolveCanonicalSalonClientIdentity.mockResolvedValue({
      terminal: { phone: '3333333333' },
      externalClientId: null,
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          refereePhone: '2223334444',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: 'INVALID_SESSION',
        message: 'Client session is invalid',
      },
    });
    expect(values).not.toHaveBeenCalled();
    expect(sendReferralInvite).not.toHaveBeenCalled();
  });

  it('fails closed for an unsupported external identity relationship', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', name: 'Salon A', customDomain: 'islanailsalon.com' },
    });
    resolveCanonicalSalonClientIdentity.mockResolvedValue({
      terminal: { phone: '1111111111' },
      externalClientId: 'unsupported_global_client',
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          refereePhone: '2223334444',
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
    expect(sendReferralInvite).not.toHaveBeenCalled();
  });

  it.each([
    ['missing terminal', null],
    [
      'invalid same-salon lineage',
      new ClientLifecycleStabilizationError('Client lifecycle state is unavailable.'),
    ],
  ])('uses the same non-disclosing failure for %s', async (_label, result) => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: { id: 'salon_1', name: 'Salon A', customDomain: 'islanailsalon.com' },
    });
    if (result instanceof Error) {
      resolveCanonicalSalonClientIdentity.mockRejectedValue(result);
    } else {
      resolveCanonicalSalonClientIdentity.mockResolvedValue(result);
    }

    const response = await POST(
      new Request('http://localhost/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          refereePhone: '2223334444',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: 'INVALID_SESSION',
        message: 'Client session is invalid',
      },
    });
    expect(values).not.toHaveBeenCalled();
    expect(sendReferralInvite).not.toHaveBeenCalled();
  });
});
