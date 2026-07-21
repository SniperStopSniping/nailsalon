/* eslint-disable import/first */
/**
 * Connection resilience for the Google Calendar integration.
 *
 * Production context: a salon silently lost online booking for hours. The
 * refresh token was rejected, the connection latched to `reconnect_required`,
 * the precise Google error was overwritten by a generic string, and nobody was
 * told. These cover the behaviours that prevent a repeat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  fetchMock,
  updateSet,
  updateReturning,
  selectRows,
  sendGoogleCalendarDisconnectedEmail,
  encryptIntegrationSecret,
  decryptIntegrationSecret,
} = vi.hoisted(() => {
  const updateReturning = vi.fn(async () => [{ salonId: 'salon_1' }]);
  const updateWhere = vi.fn(() => {
    const promise = Promise.resolve(undefined) as unknown as Promise<undefined> & { returning: unknown };
    promise.returning = updateReturning;
    return promise;
  });
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const selectRows: unknown[][] = [];
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => selectRows.shift() ?? [],
  };
  return {
    db: { select: () => query, update: () => ({ set: updateSet }) },
    fetchMock: vi.fn(),
    updateSet,
    updateReturning,
    selectRows,
    sendGoogleCalendarDisconnectedEmail: vi.fn(async () => true),
    encryptIntegrationSecret: vi.fn((plain: string) => ({ ciphertext: `enc(${plain})`, keyVersion: 7 })),
    decryptIntegrationSecret: vi.fn(() => 'stored-refresh-token'),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/lusterSecurity', () => ({ encryptIntegrationSecret, decryptIntegrationSecret }));
vi.mock('@/libs/googleCalendarAlerts', () => ({ sendGoogleCalendarDisconnectedEmail }));
vi.mock('@/libs/Env', () => ({
  Env: {
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALENDAR_ENABLED: 'false',
  },
}));

import { getGoogleCalendarBusyWindows } from './googleCalendar';

const SALON_ID = 'salon_1';

function connectionRow(status = 'active') {
  return {
    salonId: SALON_ID,
    status,
    encryptedRefreshToken: 'enc(stored-refresh-token)',
    encryptionKeyVersion: 1,
    destinationCalendarId: 'primary',
    busyCalendarIds: ['primary'],
  };
}

function tokenResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Drive the OAuth path by asking for busy windows. */
async function runBusyWindows() {
  return getGoogleCalendarBusyWindows({
    salonId: SALON_ID,
    startTime: new Date('2026-06-10T04:00:00.000Z'),
    endTime: new Date('2026-06-11T04:00:00.000Z'),
    timeZone: 'America/Toronto',
  });
}

function lastSetPayload() {
  return updateSet.mock.calls.at(-1)?.[0];
}

function allSetPayloads() {
  return updateSet.mock.calls.map(call => call[0]);
}

describe('refresh token rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    updateReturning.mockResolvedValue([{ salonId: SALON_ID }]);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('encrypts and saves a refresh token when Google rotates one', async () => {
    selectRows.push([connectionRow()]);
    fetchMock.mockImplementation(async (url: string) =>
      (String(url).includes('/token')
        ? tokenResponse({ access_token: 'at', expires_in: 3600, refresh_token: 'ROTATED-TOKEN' })
        : tokenResponse({ calendars: { primary: { busy: [] } } })));

    await runBusyWindows();

    expect(encryptIntegrationSecret).toHaveBeenCalledWith('ROTATED-TOKEN');
    expect(allSetPayloads()).toContainEqual(expect.objectContaining({
      status: 'active',
      encryptedRefreshToken: 'enc(ROTATED-TOKEN)',
      encryptionKeyVersion: 7,
    }));
  });

  it('preserves the stored token when Google returns none', async () => {
    selectRows.push([connectionRow()]);
    fetchMock.mockImplementation(async (url: string) =>
      (String(url).includes('/token')
        ? tokenResponse({ access_token: 'at', expires_in: 3600 })
        : tokenResponse({ calendars: { primary: { busy: [] } } })));

    await runBusyWindows();

    // Writing the field at all would blank the credential and break the salon.
    expect(encryptIntegrationSecret).not.toHaveBeenCalled();

    for (const payload of allSetPayloads()) {
      expect(payload).not.toHaveProperty('encryptedRefreshToken');
    }
  });
});

describe('failure classification and latching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    updateReturning.mockResolvedValue([{ salonId: SALON_ID }]);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not permanently latch on a temporary failure', async () => {
    selectRows.push([connectionRow()]);
    fetchMock.mockImplementation(async (url: string) =>
      (String(url).includes('/token') ? tokenResponse({ error: 'backend_error' }, 503) : tokenResponse({})));

    await expect(runBusyWindows()).rejects.toThrow();

    expect(lastSetPayload()).toMatchObject({
      status: 'degraded',
      lastError: expect.stringContaining('[temporary]'),
    });
    expect(sendGoogleCalendarDisconnectedEmail).not.toHaveBeenCalled();
  });

  it('retries a temporary failure exactly once', async () => {
    selectRows.push([connectionRow()]);
    let tokenCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/token')) {
        tokenCalls += 1;
        return tokenResponse({ error: 'backend_error' }, 503);
      }
      return tokenResponse({});
    });

    await expect(runBusyWindows()).rejects.toThrow();

    expect(tokenCalls).toBe(2);
  });

  it('never retries a confirmed invalid_grant', async () => {
    selectRows.push([connectionRow()]);
    let tokenCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/token')) {
        tokenCalls += 1;
        return tokenResponse({ error: 'invalid_grant', error_description: 'Token has been expired' }, 400);
      }
      return tokenResponse({});
    });

    await expect(runBusyWindows()).rejects.toThrow();

    // A second identical request cannot change the answer.
    expect(tokenCalls).toBe(1);
  });

  it('latches to reconnect_required on a confirmed invalid_grant and keeps Google’s reason', async () => {
    selectRows.push([connectionRow()]);
    fetchMock.mockImplementation(async (url: string) =>
      (String(url).includes('/token')
        ? tokenResponse({ error: 'invalid_grant', error_description: 'Token has been expired' }, 400)
        : tokenResponse({})));

    await expect(runBusyWindows()).rejects.toThrow();

    const payload = lastSetPayload();

    expect(payload).toMatchObject({ status: 'reconnect_required' });
    expect(String(payload?.lastError)).toContain('[invalid_grant]');
    // The generic string used to destroy this evidence in production.
    expect(String(payload?.lastError)).toContain('Token has been expired');
  });

  it('reports an unreadable stored token as a key problem, not a reconnect', async () => {
    selectRows.push([connectionRow()]);
    decryptIntegrationSecret.mockImplementationOnce(() => {
      throw new Error('bad key');
    });

    await expect(runBusyWindows()).rejects.toThrow();

    expect(lastSetPayload()).toMatchObject({
      status: 'degraded',
      lastError: expect.stringContaining('[token_decrypt_failed]'),
    });
    // Reconnecting would mask a key-management problem.
    expect(sendGoogleCalendarDisconnectedEmail).not.toHaveBeenCalled();
  });
});

describe('owner notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) =>
      (String(url).includes('/token')
        ? tokenResponse({ error: 'invalid_grant', error_description: 'Token has been expired' }, 400)
        : tokenResponse({})));
  });

  it('emails the owner once when the status first transitions', async () => {
    selectRows.push([connectionRow()]);
    updateReturning.mockResolvedValue([{ salonId: SALON_ID }]); // the update flipped it

    await expect(runBusyWindows()).rejects.toThrow();

    expect(sendGoogleCalendarDisconnectedEmail).toHaveBeenCalledTimes(1);
    expect(sendGoogleCalendarDisconnectedEmail).toHaveBeenCalledWith(expect.objectContaining({
      salonId: SALON_ID,
      classification: expect.objectContaining({ kind: 'invalid_grant' }),
    }));
  });

  it('does not email again on later requests while already disconnected', async () => {
    selectRows.push([connectionRow()]);
    // No rows returned = the row was already reconnect_required.
    updateReturning.mockResolvedValue([]);

    await expect(runBusyWindows()).rejects.toThrow();

    expect(sendGoogleCalendarDisconnectedEmail).not.toHaveBeenCalled();
    // The diagnosis is still refreshed so operators see the latest attempt.
    expect(lastSetPayload()).toMatchObject({ lastError: expect.stringContaining('[invalid_grant]') });
  });

  it('still fails closed when the alert itself throws', async () => {
    selectRows.push([connectionRow()]);
    updateReturning.mockResolvedValue([{ salonId: SALON_ID }]);
    sendGoogleCalendarDisconnectedEmail.mockRejectedValueOnce(new Error('smtp down'));

    // Availability must still refuse rather than silently allow bookings.
    await expect(runBusyWindows()).rejects.toThrow();
  });
});

describe('customer-facing availability while disconnected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses to return busy windows while a reconnect is required', async () => {
    // An already-latched connection short-circuits before any token request.
    selectRows.push([connectionRow('reconnect_required')]);

    await expect(runBusyWindows()).rejects.toMatchObject({ reconnectRequired: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the error state after a successful reconnection', async () => {
    selectRows.push([connectionRow('degraded')]);
    fetchMock.mockImplementation(async (url: string) =>
      (String(url).includes('/token')
        ? tokenResponse({ access_token: 'at', expires_in: 3600 })
        : tokenResponse({ calendars: { primary: { busy: [] } } })));

    await runBusyWindows();

    expect(allSetPayloads()).toContainEqual(expect.objectContaining({
      status: 'active',
      lastError: null,
    }));
    expect(sendGoogleCalendarDisconnectedEmail).not.toHaveBeenCalled();
  });
});
