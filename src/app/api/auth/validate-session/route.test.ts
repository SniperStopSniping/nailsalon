import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieGet, clearClientSessionCookies, getClientSession, refreshClientSession, setClientSessionCookies } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  clearClientSessionCookies: vi.fn(),
  getClientSession: vi.fn(),
  refreshClientSession: vi.fn(),
  setClientSessionCookies: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
  })),
}));

vi.mock('@/libs/clientAuth', () => ({
  CLIENT_SESSION_COOKIE: 'client_session',
  clearClientSessionCookies,
  getClientSession,
  refreshClientSession,
  setClientSessionCookies,
}));

import { GET } from './route';

describe('GET /api/auth/validate-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid response and refreshes the server-backed session', async () => {
    cookieGet.mockReturnValue({ value: 'client_session_1' });
    getClientSession.mockResolvedValue({
      phone: '+15551234567',
      clientName: 'Ava',
      clientEmail: 'ava@example.com',
      sessionId: 'client_session_1',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      valid: true,
      phone: '+15551234567',
      clientName: 'Ava',
      clientEmail: 'ava@example.com',
    });
    expect(refreshClientSession).toHaveBeenCalledWith('client_session_1');
    expect(setClientSessionCookies).toHaveBeenCalledWith({
      sessionId: 'client_session_1',
      phone: '+15551234567',
      clientName: 'Ava',
    });
    expect(clearClientSessionCookies).not.toHaveBeenCalled();
  });

  it('fails closed when the cookie exists but the session row is invalid', async () => {
    cookieGet.mockReturnValue({ value: 'stale_session' });
    getClientSession.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      valid: false,
      reason: 'Invalid or expired session',
    });
    expect(clearClientSessionCookies).toHaveBeenCalledTimes(1);
    expect(refreshClientSession).not.toHaveBeenCalled();
    expect(setClientSessionCookies).not.toHaveBeenCalled();
  });
});
