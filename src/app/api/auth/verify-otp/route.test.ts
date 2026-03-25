import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertClientSessionStorageReady,
  createClientSession,
  fetchMock,
  getClientByPhone,
  setClientSessionCookies,
} = vi.hoisted(() => ({
  assertClientSessionStorageReady: vi.fn(),
  createClientSession: vi.fn(),
  fetchMock: vi.fn(),
  getClientByPhone: vi.fn(),
  setClientSessionCookies: vi.fn(),
}));

vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = 'acct';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  process.env.TWILIO_VERIFY_SERVICE_SID = 'service';
});

vi.mock('@/libs/clientAuth', () => ({
  assertClientSessionStorageReady,
  createClientSession,
  setClientSessionCookies,
}));

vi.mock('@/libs/queries', () => ({
  getClientByPhone,
}));

import { POST } from './route';

describe('POST /api/auth/verify-otp', () => {
  const originalEnv = { ...process.env };
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertClientSessionStorageReady.mockResolvedValue(undefined);
  });

  it('returns a specific 401 when Twilio says the code is no longer current', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sid: 'VE123',
        status: 'pending',
        to: '+15551234567',
        channel: 'sms',
        valid: false,
      }),
    });

    const response = await POST(new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5551234567',
        code: '123456',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: 'This verification code is incorrect or no longer current. Please request a new code and try again.',
    });
    expect(getClientByPhone).not.toHaveBeenCalled();
    expect(createClientSession).not.toHaveBeenCalled();
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });

  it('returns a specific 401 when Twilio marks the code canceled', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sid: 'VE123',
        status: 'canceled',
        to: '+15551234567',
        channel: 'sms',
        valid: false,
      }),
    });

    const response = await POST(new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5551234567',
        code: '123456',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: 'This verification code has expired or was already used. Please request a new code.',
    });
  });

  it('fails before consuming the code when customer session storage is missing', async () => {
    assertClientSessionStorageReady.mockRejectedValue({
      code: '42P01',
      message: 'relation "client_session" does not exist',
    });

    const response = await POST(new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5551234567',
        code: '123456',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Verification succeeded, but customer login storage is not ready. Run the latest database migrations and try again.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createClientSession).not.toHaveBeenCalled();
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });

  it('returns a specific 500 when session creation fails after approval', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sid: 'VE123',
        status: 'approved',
        to: '+15551234567',
        channel: 'sms',
        valid: true,
      }),
    });
    getClientByPhone.mockResolvedValue({ firstName: 'Ava' });
    createClientSession.mockRejectedValue(new Error('insert failed'));

    const response = await POST(new Request('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '5551234567',
        code: '123456',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Verification succeeded, but we could not create your login session. Please try again.',
    });
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    process.env = { ...originalEnv };
  });
});
