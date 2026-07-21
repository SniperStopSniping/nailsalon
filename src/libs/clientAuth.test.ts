import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearClientSessionCookies, setClientSessionCookies } from './clientAuth';

const { cookieSet, cookieDelete } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
    delete: cookieDelete,
    get: vi.fn(),
  })),
}));

describe('clientAuth cookie cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears remaining client helper cookies on logout/session invalidation', async () => {
    await clearClientSessionCookies();

    expect(cookieSet).toHaveBeenCalledWith('client_session', '', expect.objectContaining({ maxAge: 0 }));
    expect(cookieSet).toHaveBeenCalledWith('client_phone', '', expect.objectContaining({ maxAge: 0 }));
    expect(cookieSet).toHaveBeenCalledWith('client_name', '', expect.objectContaining({ maxAge: 0 }));
    expect(cookieSet).toHaveBeenCalledWith('client_email', '', expect.objectContaining({ maxAge: 0 }));
    expect(cookieDelete).not.toHaveBeenCalled();
  });

  it('clears stale client helper cookies during normal session refresh', async () => {
    await setClientSessionCookies({
      sessionId: 'client_session_1',
      phone: '+15551234567',
      clientName: 'Ava',
    });

    expect(cookieSet).toHaveBeenCalledWith('client_session', 'client_session_1', expect.objectContaining({ maxAge: expect.any(Number) }));
    expect(cookieSet).toHaveBeenCalledWith('client_phone', '', expect.objectContaining({ maxAge: 0 }));
    expect(cookieSet).toHaveBeenCalledWith('client_name', '', expect.objectContaining({ maxAge: 0 }));
    expect(cookieSet).toHaveBeenCalledWith('client_email', '', expect.objectContaining({ maxAge: 0 }));
  });

  /**
   * Sign-out has to clear the cookie with the SAME attributes it was written
   * with. A mismatched path/secure/sameSite/domain leaves the browser holding
   * the original cookie, which is what makes a stale session feel permanent.
   */
  it('clears the session cookie with the same attributes it was set with', async () => {
    await setClientSessionCookies({
      sessionId: 'client_session_1',
      phone: '+15551234567',
      clientName: 'Ava',
    });
    const setCall = cookieSet.mock.calls.find(call => call[0] === 'client_session');

    cookieSet.mockClear();
    await clearClientSessionCookies();
    const clearCall = cookieSet.mock.calls.find(call => call[0] === 'client_session');

    expect(setCall).toBeDefined();
    expect(clearCall).toBeDefined();

    const setOptions = setCall![2] as Record<string, unknown>;
    const clearOptions = clearCall![2] as Record<string, unknown>;

    for (const attribute of ['path', 'httpOnly', 'secure', 'sameSite', 'domain'] as const) {
      expect(clearOptions[attribute]).toEqual(setOptions[attribute]);
    }

    // The only intended difference: the clear expires it immediately.
    expect(clearCall![1]).toBe('');
    expect(clearOptions.maxAge).toBe(0);
    expect(setOptions.maxAge).toBeGreaterThan(0);
  });
});
