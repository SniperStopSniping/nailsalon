import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { clearClientSessionCookies, setClientSessionCookies } from './clientAuth';

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
});
