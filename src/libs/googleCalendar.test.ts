/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  fetchMock,
  resetConnectionRevision,
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
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };
  const select = vi.fn(() => query);
  let connectionRevision = 1;
  const resetConnectionRevision = () => {
    connectionRevision = 1;
  };
  const transaction = vi.fn(async (work: (tx: unknown) => unknown) => {
    let revisionRead = 0;
    const txQuery = {
      from: () => txQuery,
      where: () => txQuery,
      for: () => txQuery,
      limit: async () => [{
        revision: `rev_${revisionRead++ === 0 ? connectionRevision : connectionRevision + 1}`,
        status: 'active',
      }],
    };
    const txUpdate = { set };
    const result = await work({ select: () => txQuery, update: () => txUpdate });
    connectionRevision += 1;
    return result;
  });

  return {
    db: { select, transaction, update },
    fetchMock: vi.fn(),
    resetConnectionRevision,
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
  deterministicGoogleCalendarEventId,
  getGoogleCalendarBusyWindows,
  isBusyWindowConflict,
  listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment,
} from './googleCalendar';

describe('googleCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConnectionRevision();
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

      if (urlText.includes('/events/') && init?.method === 'GET') {
        return new Response(JSON.stringify({ id: 'gcal_event_1', etag: 'etag_1' }), { status: 200 });
      }

      if (urlText.includes('/events/') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 'gcal_event_1', etag: 'etag_2' }), { status: 200 });
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
      revision: 'rev_1',
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
      revision: 'rev_1',
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
      revision: 'rev_1',
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
      revision: 'rev_1',
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
      revision: 'rev_1',
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
      mutationVersion: '2026-06-10T12:34:56.789Z',
    });

    expect(result).toEqual({ status: 'synced', eventId: 'gcal_event_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/calendars/primary%40example.com/events?sendUpdates=none'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Gel Manicure - Bob - Kennedy & Ellesmere - 880 Ellesmere Rd Unit 2'),
      }),
    );

    const createBody = JSON.parse(
      fetchMock.mock.calls.find(([url, init]) => (
        String(url).includes('/calendar/v3/') && init?.method === 'POST'
      ))?.[1]?.body as string,
    );

    expect(createBody.extendedProperties.private).toEqual({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      mutationVersion: '2026-06-10T12:34:56.789Z',
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      googleCalendarEventId: 'gcal_event_1',
      googleCalendarSyncStatus: 'synced',
      googleCalendarSyncError: null,
    }));
  });

  it('returns the provider result without appointment bookkeeping for an outbox worker', async () => {
    const result = await syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_worker',
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
    }, {
      persistResult: false,
      targetCalendarId: 'pinned-calendar@example.com',
    });

    expect(result).toEqual({
      status: 'synced',
      eventId: 'gcal_event_1',
      calendarId: 'pinned-calendar@example.com',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/calendars/pinned-calendar%40example.com/events?'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses to patch an exact calendar pair owned by another appointment', async () => {
    const queue = [[], [{
      id: 'foreign_pair',
      salonId: 'salon_1',
      appointmentId: 'other_appointment',
      calendarId: 'pinned-calendar@example.com',
      deletedAt: null,
      googleEventId: 'foreign_event',
      googleStatus: 'confirmed',
      reviewStatus: 'appointment',
      sourceAccessRole: 'writer',
      syncMode: 'bidirectional',
    }]];
    const selectChain = () => {
      const rows = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = async () => rows;
      chain.then = (
        resolve: (value: unknown[]) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    };
    db.select
      .mockImplementationOnce(selectChain as unknown as typeof db.select)
      .mockImplementationOnce(selectChain as unknown as typeof db.select);

    await expect(syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_worker',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      clientPhone: '4373705050',
      serviceNames: ['Gel Manicure'],
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
      totalPrice: 4000,
      totalDurationMinutes: 60,
      timeZone: 'America/Toronto',
      googleCalendarEventId: 'foreign_event',
    }, {
      persistResult: false,
      targetCalendarId: 'pinned-calendar@example.com',
    })).rejects.toThrow('GOOGLE_CALENDAR_MIRROR_OWNERSHIP_CONFLICT');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('reports the pinned deterministic create candidate after PATCH 404 loses its POST response', async () => {
    const deterministicId = deterministicGoogleCalendarEventId({
      salonId: 'salon_1',
      appointmentId: 'appt_patch_fallback',
      idempotencyKey: 'appointment-revision:2026-06-10T00:00:00.000Z',
    });
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      if (init?.method === 'GET' && urlText.includes('/events/old_event')) {
        return new Response(JSON.stringify({ id: 'old_event', etag: 'etag_old' }), {
          status: 200,
        });
      }
      if (init?.method === 'PATCH' && urlText.includes('/events/old_event')) {
        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
        });
      }
      if (init?.method === 'POST') {
        throw new Error('response lost after remote acceptance');
      }
      return new Response('{}', { status: 200 });
    });

    const result = await syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_patch_fallback',
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
      googleCalendarEventId: 'old_event',
    }, {
      idempotencyKey: 'appointment-revision:2026-06-10T00:00:00.000Z',
      persistResult: false,
      targetCalendarId: 'pinned-calendar@example.com',
    });

    expect(result).toEqual({
      status: 'failed',
      error: 'Google Calendar request failed',
      eventId: 'old_event',
      calendarId: 'pinned-calendar@example.com',
      createAttempted: true,
    });

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');

    expect(post?.[0]).toEqual(expect.stringContaining(
      '/calendars/pinned-calendar%40example.com/events?',
    ));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual(expect.objectContaining({
      id: deterministicId,
    }));
  });

  it('holds one dispatch fence across conditional PATCH and its create fallback', async () => {
    const dispatchFenceCall = vi.fn();
    const dispatchFence = async <T>(operation: () => Promise<T>) => {
      dispatchFenceCall();
      return operation();
    };
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      if (init?.method === 'GET' && urlText.includes('/events/old_fenced_event')) {
        return new Response(JSON.stringify({
          id: 'old_fenced_event',
          etag: 'etag_old',
        }), { status: 200 });
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
        });
      }
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { id: string };
        return new Response(JSON.stringify({ id: body.id, etag: 'etag_created' }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });

    await expect(syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_fallback_fence',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      clientPhone: '4373705050',
      serviceNames: ['Gel Manicure'],
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
      totalPrice: 4000,
      totalDurationMinutes: 60,
      timeZone: 'America/Toronto',
      googleCalendarEventId: 'old_fenced_event',
      mutationVersion: '2026-06-10T00:00:00.000Z',
    }, {
      dispatchFence,
      idempotencyKey: 'appointment-lane:initial',
      persistResult: false,
      targetCalendarId: 'pinned-calendar@example.com',
    })).resolves.toMatchObject({ status: 'synced' });

    expect(dispatchFenceCall).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => (
      ['GET', 'PATCH', 'POST'].includes(init?.method ?? '')
    )).map(([, init]) => init?.method)).toEqual(['GET', 'PATCH', 'POST']);
  });

  it('does not swallow a stale conditional write when the refreshed remote revision is older', async () => {
    let eventGets = 0;

    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);

      if (urlText.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      if (init?.method === 'GET' && urlText.includes('/events/stale_event')) {
        eventGets += 1;
        return new Response(JSON.stringify({
          id: 'stale_event',
          etag: eventGets === 1 ? 'etag_read' : 'etag_refreshed',
          extendedProperties: {
            private: { mutationVersion: '2026-06-10T11:59:59.000Z' },
          },
        }), { status: 200 });
      }
      if (init?.method === 'PATCH' && urlText.includes('/events/stale_event')) {
        return new Response(JSON.stringify({
          error: { message: 'precondition failed' },
        }), { status: 412 });
      }
      return new Response('{}', { status: 200 });
    });

    await expect(syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_stale_412',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      clientName: 'Current intent',
      clientPhone: '4373705050',
      serviceNames: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
      totalPrice: 4000,
      totalDurationMinutes: 60,
      timeZone: 'America/Toronto',
      googleCalendarEventId: 'stale_event',
      mutationVersion: '2026-06-10T12:00:00.000Z',
    }, {
      idempotencyKey: 'appointment-lane:initial',
      persistResult: false,
      targetCalendarId: 'pinned-calendar@example.com',
    })).resolves.toEqual({
      calendarId: 'pinned-calendar@example.com',
      createAttempted: false,
      error: '{"error":{"message":"precondition failed"}}',
      eventId: 'stale_event',
      status: 'failed',
    });
    expect(eventGets).toBe(2);
  });

  it('converges delayed PATCH-404 fallback and newer revisions on one shared provider lane', async () => {
    type RemoteEvent = {
      id: string;
      etag: string;
      extendedProperties?: { private?: { mutationVersion?: string } };
      summary?: string;
    };
    const appointmentId = 'appt_shared_fallback_lane';
    const staleEventId = 'event_from_retired_lane';
    const sharedLaneIdentity = 'appointment-lane:initial';
    const laneEventId = deterministicGoogleCalendarEventId({
      salonId: 'salon_1',
      appointmentId,
      idempotencyKey: sharedLaneIdentity,
    });
    const revisions = {
      A: '2026-06-10T12:00:00.000Z',
      B: '2026-06-10T12:00:01.000Z',
      C: '2026-06-10T12:00:02.000Z',
    } as const;
    const windows = {
      A: ['2026-06-10T17:45:00.000Z', '2026-06-10T18:45:00.000Z'],
      B: ['2026-06-10T18:45:00.000Z', '2026-06-10T19:45:00.000Z'],
      C: ['2026-06-10T19:45:00.000Z', '2026-06-10T20:45:00.000Z'],
    } as const;
    const remoteEvents = new Map<string, RemoteEvent>([[staleEventId, {
      id: staleEventId,
      etag: 'etag_stale_lane',
      extendedProperties: { private: { mutationVersion: '2026-06-10T11:59:59.000Z' } },
      summary: 'retired lane',
    }]]);
    const patchRequests: Array<{ eventId: string; ifMatch: string | null }> = [];
    let nextEtag = 1;
    let retireStaleLaneAfterRead = true;
    let signalDelayedFallback!: () => void;
    let releaseDelayedFallback!: () => void;
    const delayedFallbackEntered = new Promise<void>((resolve) => {
      signalDelayedFallback = resolve;
    });
    const delayedFallbackRelease = new Promise<void>((resolve) => {
      releaseDelayedFallback = resolve;
    });

    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const method = init?.method ?? 'GET';
      if (urlText.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      const eventPath = urlText.match(/\/events\/([^?]+)/);
      const eventId = eventPath?.[1] ? decodeURIComponent(eventPath[1]) : null;

      if (method === 'GET' && eventId) {
        const current = remoteEvents.get(eventId);
        if (!current) {
          return new Response(JSON.stringify({ error: { message: 'not found' } }), {
            status: 404,
          });
        }
        if (eventId === staleEventId && retireStaleLaneAfterRead) {
          retireStaleLaneAfterRead = false;
          remoteEvents.delete(staleEventId);
        }
        return new Response(JSON.stringify(current), { status: 200 });
      }

      if (method === 'PATCH' && eventId) {
        const current = remoteEvents.get(eventId);
        if (!current) {
          return new Response(JSON.stringify({ error: { message: 'not found' } }), {
            status: 404,
          });
        }
        const ifMatch = new Headers(init?.headers).get('If-Match');
        patchRequests.push({ eventId, ifMatch });
        if (ifMatch !== null && ifMatch !== current.etag) {
          return new Response(JSON.stringify({ error: { message: 'precondition failed' } }), {
            status: 412,
          });
        }
        // Google treats a PATCH without If-Match as unconditional. Model that
        // explicitly so the test cannot gain safety from a fake CAS requirement.
        const body = JSON.parse(String(init?.body)) as Omit<RemoteEvent, 'etag'>;
        const updated = {
          ...body,
          id: eventId,
          etag: `etag_${nextEtag++}`,
        } satisfies RemoteEvent;
        remoteEvents.set(eventId, updated);
        return new Response(JSON.stringify(updated), { status: 200 });
      }

      if (method === 'POST' && urlText.includes('/events?')) {
        const body = JSON.parse(String(init?.body)) as RemoteEvent;
        const mutationVersion = body.extendedProperties?.private?.mutationVersion;

        expect(body.id).toBe(laneEventId);

        if (mutationVersion === revisions.A) {
          signalDelayedFallback();
          await delayedFallbackRelease;
        }
        if (remoteEvents.has(body.id)) {
          return new Response(JSON.stringify({ error: { message: 'already exists' } }), {
            status: 409,
          });
        }
        const created = { ...body, etag: `etag_${nextEtag++}` } satisfies RemoteEvent;
        remoteEvents.set(body.id, created);
        return new Response(JSON.stringify(created), { status: 200 });
      }

      return new Response('{}', { status: 200 });
    });

    const syncRevision = (revision: keyof typeof revisions) =>
      syncGoogleCalendarEventForAppointment({
        appointmentId,
        salonId: 'salon_1',
        salonName: 'Isla Nail Studio',
        clientName: revision,
        clientPhone: '4373705050',
        serviceNames: [`Revision ${revision}`],
        technicianName: 'Daniela',
        startTime: new Date(windows[revision][0]),
        endTime: new Date(windows[revision][1]),
        totalPrice: 4000,
        totalDurationMinutes: 60,
        timeZone: 'America/Toronto',
        googleCalendarEventId: staleEventId,
        mutationVersion: revisions[revision],
      }, {
        idempotencyKey: sharedLaneIdentity,
        persistResult: false,
        targetCalendarId: 'pinned-calendar@example.com',
      });

    const obsoleteA = syncRevision('A');
    await delayedFallbackEntered;

    await expect(syncRevision('B')).resolves.toMatchObject({
      status: 'synced',
      eventId: laneEventId,
    });
    await expect(syncRevision('C')).resolves.toMatchObject({
      status: 'synced',
      eventId: laneEventId,
    });

    releaseDelayedFallback();

    await expect(obsoleteA).resolves.toMatchObject({
      status: 'synced',
      eventId: laneEventId,
    });

    expect([...remoteEvents.values()]).toEqual([expect.objectContaining({
      id: laneEventId,
      summary: expect.stringContaining('Revision C - C'),
      extendedProperties: {
        private: expect.objectContaining({
          appointmentId,
          mutationVersion: revisions.C,
        }),
      },
    })]);
    expect(patchRequests).toEqual([{ eventId: laneEventId, ifMatch: 'etag_1' }]);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'))
      .toHaveLength(3);
  });

  it('aborts a hung provider request at the bounded default timeout', async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | null = null;
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      providerSignal = init?.signal ?? null;
      providerEntered();
      return await new Promise<Response>((_resolve, reject) => {
        providerSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    });

    try {
      const operation = syncGoogleCalendarEventForAppointment({
        appointmentId: 'appt_timeout',
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
      }, { persistResult: false });

      await entered;
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(operation).resolves.toMatchObject({
        status: 'failed',
        error: 'Google Calendar request timed out',
      });
      expect((providerSignal as AbortSignal | null)?.aborted).toBe(true);
      expect(set).not.toHaveBeenCalledWith(
        expect.objectContaining({ googleCalendarSyncStatus: expect.anything() }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('threads a caller abort through the provider request without bookkeeping', async () => {
    const controller = new AbortController();
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      providerEntered();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    });

    const operation = syncGoogleCalendarEventForAppointment({
      appointmentId: 'appt_abort',
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
    }, { persistResult: false, signal: controller.signal });

    await entered;
    controller.abort();

    await expect(operation).resolves.toMatchObject({
      status: 'failed',
      error: 'Google provider request was aborted',
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('does not dispatch a provider request when the list parent is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('parent budget expired'));

    await expect(listGoogleCalendarEventsForSalon({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T00:00:00.000Z'),
      endTime: new Date('2026-06-11T00:00:00.000Z'),
    }, { signal: controller.signal })).rejects.toThrow('Google provider request was aborted');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('round-trips the immutable appointment mutation marker from private event metadata', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      revision: 'rev_1',
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (url: string | URL) => (
      String(url).includes('oauth2.googleapis.com/token')
        ? new Response(JSON.stringify({ access_token: 'google_token', expires_in: 3600 }))
        : new Response(JSON.stringify({
          items: [{
            id: 'event_with_revision',
            status: 'confirmed',
            updated: '2026-06-10T13:00:00.000Z',
            start: { dateTime: '2026-06-10T17:45:00.000Z' },
            end: { dateTime: '2026-06-10T18:45:00.000Z' },
            extendedProperties: {
              private: {
                appointmentId: 'appt_1',
                salonId: 'salon_1',
                mutationVersion: '2026-06-10T12:34:56.789Z',
              },
            },
          }],
        }))
    ));

    await expect(listGoogleCalendarEventsForSalon({
      salonId: 'salon_1',
      calendarIds: ['primary'],
      startTime: new Date('2026-06-10T00:00:00.000Z'),
      endTime: new Date('2026-06-11T00:00:00.000Z'),
    })).resolves.toEqual([
      expect.objectContaining({
        id: 'event_with_revision',
        appointmentId: 'appt_1',
        salonId: 'salon_1',
        mutationVersion: '2026-06-10T12:34:56.789Z',
      }),
    ]);
  });

  it('bounds the whole event-list scan, including token acquisition', async () => {
    vi.useFakeTimers();
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      revision: 'rev_1',
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (_url: string | URL, init?: RequestInit) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      })
    ));

    try {
      const operation = listGoogleCalendarEventsForSalon({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T00:00:00.000Z'),
        endTime: new Date('2026-06-11T00:00:00.000Z'),
      }, { timeoutMs: 1_000 });
      const rejection = expect(operation).rejects.toThrow(
        'Google provider request timed out',
      );

      await vi.advanceTimersByTimeAsync(1_001);

      await rejection;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed at the event-list page ceiling without dispatching another page', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      revision: 'rev_1',
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [], nextPageToken: 'next' }), {
        status: 200,
      });
    });

    await expect(listGoogleCalendarEventsForSalon({
      salonId: 'salon_1',
      startTime: new Date('2026-06-10T00:00:00.000Z'),
      endTime: new Date('2026-06-11T00:00:00.000Z'),
    }, { maxPages: 2 })).rejects.toThrow('Google Calendar event list page limit exceeded');

    const eventListCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/calendar/v3/calendars/') && String(url).includes('/events?'),
    );

    expect(eventListCalls).toHaveLength(2);
  });

  it('applies the page ceiling per selected calendar', async () => {
    const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
    query.limit.mockResolvedValueOnce([{
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      revision: 'rev_1',
      tokenExpiresAt: null,
    }]);
    fetchMock.mockImplementation(async (url: string | URL) => (
      String(url).includes('oauth2.googleapis.com/token')
        ? new Response(JSON.stringify({
          access_token: 'google_token',
          expires_in: 3600,
        }), { status: 200 })
        : new Response(JSON.stringify({ items: [] }), { status: 200 })
    ));
    const calendarIds = Array.from({ length: 11 }, (_, index) => `calendar_${index}`);

    await expect(listGoogleCalendarEventsForSalon({
      salonId: 'salon_1',
      calendarIds,
      startTime: new Date('2026-06-10T00:00:00.000Z'),
      endTime: new Date('2026-06-11T00:00:00.000Z'),
    }, { maxPages: 1 })).resolves.toEqual([]);

    const eventListCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/calendar/v3/calendars/') && String(url).includes('/events?'),
    );

    expect(eventListCalls).toHaveLength(calendarIds.length);
  });

  describe('cancelled FreeBusy ghost suppression', () => {
    const BUSY_WINDOW = {
      startTime: new Date('2026-06-10T17:45:00.000Z'),
      endTime: new Date('2026-06-10T18:45:00.000Z'),
    };
    const CONNECTION = {
      salonId: 'salon_1',
      status: 'active',
      encryptedRefreshToken: 'ciphertext',
      encryptionKeyVersion: 1,
      destinationCalendarId: 'primary@example.com',
      busyCalendarIds: ['primary@example.com'],
      revision: 'rev_1',
      tokenExpiresAt: null,
    };
    const CANCELLED_MIRROR = {
      calendarId: 'primary@example.com',
      ...BUSY_WINDOW,
    };

    it('releases a cancelled mirror that events.list no longer returns', async () => {
      const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
      query.limit
        .mockResolvedValueOnce([CONNECTION])
        .mockResolvedValueOnce([CANCELLED_MIRROR]);

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
      });

      expect(windows).toEqual([]);
      expect(fetchMock.mock.calls.some(([url, init]) =>
        String(url).includes('/events?') && init?.method === 'GET',
      )).toBe(true);
    });

    it('keeps the window when a live busy event still overlaps it', async () => {
      const query = db.select() as unknown as { limit: ReturnType<typeof vi.fn> };
      query.limit
        .mockResolvedValueOnce([CONNECTION])
        .mockResolvedValueOnce([CANCELLED_MIRROR]);
      fetchMock.mockImplementation(async (url: string | URL) => {
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
                  start: BUSY_WINDOW.startTime.toISOString(),
                  end: BUSY_WINDOW.endTime.toISOString(),
                }],
              },
            },
          }), { status: 200 });
        }
        if (urlText.includes('/events?')) {
          return new Response(JSON.stringify({
            items: [{
              id: 'real_external_event',
              status: 'confirmed',
              start: { dateTime: BUSY_WINDOW.startTime.toISOString() },
              end: { dateTime: BUSY_WINDOW.endTime.toISOString() },
            }],
          }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const windows = await getGoogleCalendarBusyWindows({
        salonId: 'salon_1',
        startTime: new Date('2026-06-10T04:00:00.000Z'),
        endTime: new Date('2026-06-11T04:00:00.000Z'),
        timeZone: 'America/Toronto',
      });

      expect(windows).toEqual([BUSY_WINDOW]);
    });
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
        chain.then = (
          resolve: (value: unknown[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject);
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

    it('allows an inbound terminal barrier to repeat-delete its exact deleted mirror', async () => {
      queueSelects([
        [],
        [{
          id: 'linked_inbound_deleted',
          salonId: 'salon_1',
          appointmentId: 'appt_cancelled',
          calendarId: 'staff-calendar@example.com',
          deletedAt: new Date(),
          googleEventId: 'gcal_inbound_deleted',
          googleStatus: 'cancelled',
          reviewStatus: 'appointment',
          sourceAccessRole: 'writer',
          syncMode: 'bidirectional',
        }],
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: 'gcal_inbound_deleted',
      }, {
        persistResult: false,
        targetCalendarId: 'staff-calendar@example.com',
        authoritativeTerminalDelete: true,
      });

      expect(result).toEqual({
        status: 'deleted',
        eventId: 'gcal_inbound_deleted',
        calendarId: 'staff-calendar@example.com',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/calendars/staff-calendar%40example.com/events/gcal_inbound_deleted'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not let a terminal barrier delete an exact read-only mirror', async () => {
      queueSelects([
        [],
        [{
          id: 'linked_inbound_readonly',
          salonId: 'salon_1',
          appointmentId: 'appt_cancelled',
          calendarId: 'readonly@example.com',
          deletedAt: new Date(),
          googleEventId: 'gcal_inbound_readonly',
          googleStatus: 'cancelled',
          reviewStatus: 'appointment',
          sourceAccessRole: 'reader',
          syncMode: 'bidirectional',
        }],
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: 'gcal_inbound_readonly',
      }, {
        persistResult: false,
        targetCalendarId: 'readonly@example.com',
        authoritativeTerminalDelete: true,
      });

      expect(result).toEqual({ status: 'disabled' });
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    });

    it('lets reconciliation delete an exact same-owner mirror already marked deleted', async () => {
      queueSelects([
        [],
        [{
          id: 'linked_reconciliation_deleted',
          salonId: 'salon_1',
          appointmentId: 'appt_cancelled',
          calendarId: 'staff-calendar@example.com',
          deletedAt: new Date(),
          googleEventId: 'gcal_reconciliation_deleted',
          googleStatus: 'cancelled',
          reviewStatus: 'appointment',
          sourceAccessRole: 'owner',
          syncMode: 'bidirectional',
        }],
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: 'gcal_reconciliation_deleted',
      }, {
        persistResult: false,
        targetCalendarId: 'staff-calendar@example.com',
        reconciliationMirrorId: 'linked_reconciliation_deleted',
        reconciliationExpectedAppointmentId: 'appt_cancelled',
      });

      expect(result).toEqual({
        status: 'deleted',
        eventId: 'gcal_reconciliation_deleted',
        calendarId: 'staff-calendar@example.com',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/events/gcal_reconciliation_deleted'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('returns the deleted event id without event or appointment bookkeeping for an outbox worker', async () => {
      queueSelects([
        [],
        [{
          id: 'linked_worker',
          calendarId: 'staff-calendar@example.com',
          googleEventId: 'gcal_worker_delete',
          sourceAccessRole: 'writer',
          syncMode: 'bidirectional',
        }],
      ]);

      const result = await deleteGoogleCalendarEventForAppointment({
        appointmentId: 'appt_cancelled',
        salonId: 'salon_1',
        googleCalendarEventId: null,
      }, { persistResult: false });

      expect(result).toEqual({
        status: 'deleted',
        eventId: 'gcal_worker_delete',
        calendarId: 'staff-calendar@example.com',
      });
      expect(set).not.toHaveBeenCalled();
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
        chain.then = (
          resolve: (value: unknown[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject);
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
