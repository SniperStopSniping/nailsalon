/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cookieSet,
  dbDelete,
  dbInsert,
  dbSelect,
  dbUpdate,
} = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  dbDelete: vi.fn(),
  dbInsert: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
  })),
}));

vi.mock('@/libs/DB', () => ({
  db: {
    delete: dbDelete,
    insert: dbInsert,
    select: dbSelect,
    update: dbUpdate,
  },
}));

import {
  assertClientSessionStorageReady,
  clearClientSessionCookies,
  createClientSession,
  LEGACY_CUSTOMER_AUTH_DISABLED_CODE,
  LEGACY_CUSTOMER_AUTH_DISABLED_MESSAGE,
  legacyCustomerAuthDisabledResponse,
  refreshClientSession,
  setClientSessionCookies,
} from './clientAuth';

describe('legacy client session shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the stable disabled response without exposing account data', async () => {
    const response = legacyCustomerAuthDisabledResponse();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE,
        message: LEGACY_CUSTOMER_AUTH_DISABLED_MESSAGE,
      },
    });
  });

  it('clears the session and all legacy helper cookies', async () => {
    await clearClientSessionCookies();

    expect(cookieSet).toHaveBeenCalledWith('client_session', '', expect.objectContaining({
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
    }));

    for (const name of ['client_phone', 'client_name', 'client_email']) {
      expect(cookieSet).toHaveBeenCalledWith(name, '', expect.objectContaining({
        httpOnly: false,
        maxAge: 0,
        path: '/',
        sameSite: 'lax',
      }));
    }
  });

  it('cannot issue a customer session cookie', async () => {
    await expect(setClientSessionCookies({
      sessionId: 'client_session_1',
      phone: '+15551234567',
      clientName: 'Ava',
    })).rejects.toMatchObject({ code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE });

    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('cannot inspect, create, or renew legacy session storage', async () => {
    await expect(assertClientSessionStorageReady()).rejects.toMatchObject({
      code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE,
    });
    await expect(createClientSession('+15551234567')).rejects.toMatchObject({
      code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE,
    });
    await expect(refreshClientSession('client_session_1')).rejects.toMatchObject({
      code: LEGACY_CUSTOMER_AUTH_DISABLED_CODE,
    });

    expect(dbSelect).not.toHaveBeenCalled();
    expect(dbInsert).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(dbDelete).not.toHaveBeenCalled();
  });
});
