import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieGet, deleteClientSession, clearClientSessionCookies } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  deleteClientSession: vi.fn(),
  clearClientSessionCookies: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
  })),
}));

vi.mock('@/libs/clientAuth', () => ({
  CLIENT_SESSION_COOKIE: 'client_session',
  deleteClientSession,
  clearClientSessionCookies,
}));

import { POST } from './route';

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the remaining client helper cookies through session cleanup', async () => {
    cookieGet.mockReturnValue({ value: 'client_session_1' });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Logged out successfully',
    });
    expect(deleteClientSession).toHaveBeenCalledWith('client_session_1');
    expect(clearClientSessionCookies).toHaveBeenCalledTimes(1);
  });
});
