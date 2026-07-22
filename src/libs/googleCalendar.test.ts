/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  fetchMock,
  set,
} = vi.hoisted(() => {
  // The transition-detecting UPDATE chains .returning(); rows returned means
  // "this call flipped the status", which is what gates the owner alert.
  const updateReturning = vi.fn(async () => [{ salonId: 'salon_1' }]);
  const where = vi.fn(() => {
    const promise: any = Promise.resolve(undefined);
    promise.returning = updateReturning;
    return promise;
  });
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(async () => []),
  };
  const select = vi.fn(() => query);

  return {
    db: { select, update },
    fetchMock: vi.fn(),
    set,
  };
});

vi.mock('@/libs/googleCalendarAlerts', () => ({
  sendGoogleCalendarDisconnectedEmail: vi.fn(async () => true),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/libs/lusterSecurity', () => ({
  decryptIntegrationSecret: vi.fn(() => 'refresh_token_plain'),
}));

vi.mock('@/libs/Env', async () => {
  // Throwaway keypair generated per test run so no key material lives in the repo.
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    Env: {
      GOOGLE_OAUTH_CLIENT_ID: 'oauth-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'oauth-client-secret',
      GOOGLE_CALENDAR_ENABLED: 'true',
      GOOGLE_CALENDAR_ID: 'primary@example.com',
      GOOGLE_CALENDAR_CLIENT_EMAIL: 'calendar-bot@example.iam.gserviceaccount.com',
      GOOGLE_CALENDAR_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
    },
  };
});

vi.mock('@/libs/DB', () => ({
  db,
}));

import {
  deleteGoogleCalendarEventForAppointment,
  getGoogleCalendarBusyWindows,
  isBusyWindowConflict,
  syncGoogleCalendarEventForAppointment,
} from './googleCalendar';

describe('googleCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);

      if (urlText.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }

      if (urlText.endsWith('/freeBusy')) {
        return new Response(JSON.stringify({
          calendars: {
            'primary@example.com': {
              busy: [{
                start: '2026-06-10T17:45:00.000Z',
                end: '2026-06-10T18:45:00.000Z',
              }],
            },
          },
        }), { status: 200 });
      }

      if (urlText.includes('/events') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'gcal_event_1' }), { status: 200 });
      }

      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('detects overlaps with Google busy windows', () => {
    expect(isBusyWindowConflict(
      new Date('2026-06-10T18:00:00.000Z'),
      new Date('2026-06-10T18:30:00.000Z'),
      [{
        startTime: new Date('2026-06-10T17:45:00.000Z'),
        endTime: new Date('2026-06-10T18:45:00.000Z'),
      }],
    )).toBe(true);
  });

  it('loads busy windows from Google Calendar freeBusy', async () => {
    const windows = await getGoogleCalendarBusyWindows({
      startTime: new Date('2026-06-10T04:00:00.000Z'),
      endTime: new Date('2026-06-11T04:00:00.000Z'),
      timeZone: 'America/Toronto',
    });

    expect(windows).toEqual([{
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('still blocks on the primary calendar while calendar setup is incomplete', async () => {
    // A connected salon with no saved blocking calendars (setup_incomplete)
    // must never be silently double-bookable: the safety floor consults the
    // primary calendar until the owner confirms a selection.
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: [],
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    }]);

    await getGoogleCalendarBusyWindows({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T04:00:00.000Z'),
      endTime: new Date('2026-06-11T04:00:00.000Z'),
      timeZone: 'America/Toronto',
    });

    const freeBusyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/freeBusy'));

    expect(freeBusyCall).toBeTruthy();
    expect(JSON.parse((freeBusyCall![1] as RequestInit).body as string).items).toEqual([{ id: 'primary' }]);
  });

  it('marks an OAuth connection reconnect-required when freeBusy rejects its access token', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'rejected_token', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        error: {
          code: 401,
          message: 'Request had invalid authentication credentials.',
        },
      }), { status: 401 });
    });

    await expect(getGoogleCalendarBusyWindows({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T04:00:00.000Z'),
      endTime: new Date('2026-06-11T04:00:00.000Z'),
      timeZone: 'America/Toronto',
    })).rejects.toMatchObject({
      name: 'GoogleCalendarAvailabilityError',
      reconnectRequired: true,
    });

    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'reconnect_required',
      // Classified now, so an operator can tell WHY it died.
      lastError: expect.stringContaining('[api_unauthorized]'),
    }));
  });

  it('marks an OAuth connection degraded for a non-auth freeBusy failure', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'google_token', expires_in: 3600 }), { status: 200 });
      }
      return new Response('temporarily unavailable', { status: 503 });
    });

    await expect(getGoogleCalendarBusyWindows({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T04:00:00.000Z'),
      endTime: new Date('2026-06-11T04:00:00.000Z'),
      timeZone: 'America/Toronto',
    })).rejects.toMatchObject({
      name: 'GoogleCalendarAvailabilityError',
      reconnectRequired: false,
    });

    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'degraded',
      lastError: expect.stringContaining('[temporary]'),
    }));
  });

  it('marks the connection degraded when Google returns malformed freeBusy JSON', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'google_token', expires_in: 3600 }), { status: 200 });
      }
      return new Response('<html>upstream error</html>', { status: 200 });
    });

    await expect(getGoogleCalendarBusyWindows({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T04:00:00.000Z'),
      endTime: new Date('2026-06-11T04:00:00.000Z'),
      timeZone: 'America/Toronto',
    })).rejects.toMatchObject({
      name: 'GoogleCalendarAvailabilityError',
      reconnectRequired: false,
    });

    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'degraded',
      lastError: expect.stringContaining('[temporary]'),
    }));
  });

  it('marks the connection degraded when OAuth returns malformed JSON', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      tokenExpiresAt: null,
    }]);
    fetchMock.mockResolvedValue(new Response('<html>upstream error</html>', { status: 200 }));

    await expect(getGoogleCalendarBusyWindows({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T04:00:00.000Z'),
      endTime: new Date('2026-06-11T04:00:00.000Z'),
      timeZone: 'America/Toronto',
    })).rejects.toMatchObject({
      name: 'GoogleCalendarAvailabilityError',
      reconnectRequired: false,
    });

    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'degraded',
      lastError: expect.stringContaining('[temporary]'),
    }));
  });

  it('creates calendar events and records the synced event id', async () => {
    const result = await syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      clientName: 'Bob',
      clientPhone: '4373705050',
      serviceNames: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
      totalPrice: 4000,
      totalDurationMinutes: 60,
      timeZone: 'America/Toronto',
      locationName: 'Kennedy & Ellesmere',
      locationAddress: '880 Ellesmere Rd Unit 2',
    });

    expect(result).toEqual({ status: 'synced', eventId: 'gcal_event_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/calendars/primary%40example.com/events?sendUpdates=none'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Gel Manicure - Bob - Kennedy & Ellesmere - 880 Ellesmere Rd Unit 2'),
      }),
    );
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      googleCalendarEventId: 'gcal_event_1',
      googleCalendarSyncStatus: 'synced',
      googleCalendarSyncError: null,
    }));
  });

  describe('cancelled event deletion', () => {
    function queueSelects(results: unknown[][]) {
      const queue = [...results];
      db.select.mockImplementation((() => {
        const rows = queue.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = () => chain;
        chain.limit = async () => rows;
        return chain;
      }) as unknown as typeof db.select);
    }

    it('resolves an event id recorded after its delete job was queued', async () => {
      queueSelects([
        [], // no OAuth connection row -> legacy Env config
        [], // no linked provider row before the appointment id is resolved
        [{ googleCalendarEventId: 'gcal_event_late' }],
        [], // outbound-only mirror has no linked provider row
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: null,
      });

      expect(result).toEqual({ status: 'deleted' });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/events/gcal_event_late?sendUpdates=none'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('deletes a writable linked event when the appointment event id is blank', async () => {
      queueSelects([
        [],
        [{
          id: 'linked_1',
          calendarId: 'staff-calendar@example.com',
          googleEventId: 'gcal_linked',
          sourceAccessRole: 'writer',
          syncMode: 'bidirectional',
        }],
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: null,
      });

      expect(result).toEqual({ status: 'deleted' });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/calendars/staff-calendar%40example.com/events/gcal_linked'),
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(set).toHaveBeenCalledWith(expect.objectContaining({
        googleStatus: 'cancelled',
        deletedAt: expect.any(Date),
      }));
      expect(set).toHaveBeenCalledWith(expect.objectContaining({
        googleCalendarEventId: null,
        googleCalendarSyncStatus: 'deleted',
      }));
    });

    it('does not delete a linked event from a read-only calendar', async () => {
      queueSelects([
        [],
        [{
          id: 'linked_read_only',
          calendarId: 'readonly@example.com',
          googleEventId: 'gcal_read_only',
          sourceAccessRole: 'reader',
          syncMode: 'inbound_only',
        }],
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: null,
      });

      expect(result).toEqual({ status: 'disabled' });
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    });
  });

  describe('reschedule mirror exclusion', () => {
    /**
     * Queues one result per `db.select()` chain, in call order. The busy-window
     * path selects: the salon connection, then the linked google_calendar_event
     * row, then (only if that was empty) the appointment row.
     */
    function queueSelects(results: unknown[][]) {
      const queue = [...results];
      db.select.mockImplementation((() => {
        const rows = queue.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.where = () => chain;
        chain.limit = async () => rows;
        return chain;
      }) as unknown as typeof db.select);
    }

    const BUSY_WINDOW = {
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
    };

    it('drops the busy window belonging to the appointment being rescheduled', async () => {
      queueSelects([
        [], // no OAuth connection row -> legacy Env config
        [{ startTime: BUSY_WINDOW.startTime, endTime: BUSY_WINDOW.endTime }],
      ]);

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
        excludeAppointmentId: 'appt_1',
      });

      expect(windows).toEqual([]);
    });

    it('falls back to the appointment window for an outbound-only mirror', async () => {
      queueSelects([
        [],
        [], // no google_calendar_event row
        [{
          startTime: BUSY_WINDOW.startTime,
          endTime: BUSY_WINDOW.endTime,
          googleCalendarEventId: 'gcal_event_1',
        }],
      ]);

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
        excludeAppointmentId: 'appt_1',
      });

      expect(windows).toEqual([]);
    });

    it('keeps a busy window that is not this appointment’s own mirror', async () => {
      queueSelects([
        [],
        [{
          // Same day, different window: a real external conflict.
          startTime: new Date('2026-06-10T20:00:00.000Z'),
          endTime: new Date('2026-06-10T21:00:00.000Z'),
        }],
      ]);

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
        excludeAppointmentId: 'appt_1',
      });

      expect(windows).toEqual([BUSY_WINDOW]);
    });

    it('suppresses nothing when the appointment has no Google mirror at all', async () => {
      queueSelects([
        [],
        [],
        [{
          startTime: BUSY_WINDOW.startTime,
          endTime: BUSY_WINDOW.endTime,
          googleCalendarEventId: null,
        }],
      ]);

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
        excludeAppointmentId: 'appt_1',
      });

      expect(windows).toEqual([BUSY_WINDOW]);
    });

    it('leaves ordinary availability requests untouched', async () => {
      queueSelects([[]]);

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
      });

      expect(windows).toEqual([BUSY_WINDOW]);
      // No mirror lookup happens without an authorized exclusion.
      expect(db.select).toHaveBeenCalledTimes(1);
    });
  });
});
