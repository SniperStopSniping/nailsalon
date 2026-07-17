/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  fetchMock,
  set,
} = vi.hoisted(() => {
  const where = vi.fn(async () => undefined);
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

vi.mock('server-only', () => ({}));

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
});
