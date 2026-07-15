/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  fetchMock,
  privateKey,
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
    privateKey: '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCxYqnXECWSkuVj\\nJVeFoknKJ9IM0dk9vFmHSxl568UK/HZzlJxXfP4qj56IkhNaV9a7YCZW4nA+Jgcm\\nHsw2TmfZ1oZM7E7JK6wezExkxbC2dOwyUP+s1vYRaVnZQ2aF1yyFDHPSP01+N5G+\\n1RNzsyZXGvEEgLLV71zCpmBbtumRR62gASNn1L9RYGJw1im8VFdAGeDKDDoqaj8K\\nxI+Tn3yOAcjvhR4rwkIxBM/isF5xi1C+MLFFI6H5yivqbgwkPJXOGFgpa8xlsxef\\ncVPcdE2E/btRAtvTSoWcxh/vf964BsMA0Vg3llyKZyWtI4kqGFRw4HmOPX5F+aO3\\nCzC1GRIVAgMBAAECggEASNVHASv7EWTJVN03Q4JwI9YX0/Wx6jxU0k1Op5Xb8Pfa\\nNvjU/MMwpQ8VO+QmmBiq7YK8Gz6ccZgxpUBN/xpQX8xKlnkMnGMXKAogb9wQA8qc\\nVMiXQkN9A4crQh7/kILaH8MOJ0ygp+tvJ1jbxMzROECyp3OkelzuzGl99Qp0epax\\nrxPc/Zz7HFO9IXZKmGcAELzoLClwWQoUdQmESTMfSXcdTUOcezLR8jT/BBMto/nX\\nwSQEQoDJDMxAc5+M2MvEtwNoqDdz9l+csar0HbxZaPeEy1JQ1vS7d/wHR3LuvgbN\\nO8o/3GLXfp2oecKvdU1/TVRTX2UAzpLJkXjBvPUDHQKBgQDa/4edndA7u3UzTfo4\\nwApHek85BSwWoygXzkH808KNw5Y6ROiUD4+Xjajniy0xtnbJYhvwbtkvKjMjnX3l\\nx4V4exMIFodvunBG9uvWYUqMqoWBSxXZjw89iSOGxyXA31aKo8GoIyFn2Sin1beX\\nug3hL+y3ShaZLrSWfZIOzxzAdwKBgQDPWzrbMnx0MwRtwJ5GJOgO4X7OANpGCfhw\\nBfz4sJcDWnhua+O2ds/DKe29FUSKTfb5BKdc2rH1ybBOuwKBq325Vsl06e9nz53G\\nAB2zDgnOMqkvhY75thWQ2TedrnjTEgMGCm55fqF/17cmp8a6krpGGDWOr7o/jynN\\nszl0zVkQ0wKBgQC20Zau9618D/O5DqGSeo6aOPqlyTGS/EVeCiuAGm9R1TM2FYxq\\n/cqLZBDaqo7h70aeuy5DuuXHv9zNII6XIcbEW0n5+IS7utI8C6m5X6LSZw/obXwi\\nEJFSd4eW3e0gY9FlD2t9J0ad4OVVps4K9aDcmhtsr4bJ/fl3oAAsKK4B5QKBgDJR\\n0VagSdNpDgoUVFRxYF88GamkS1Pz13ZX/avcLsmBivhA9mGxM3oJEshwANIPWX/U\\nwUinSch7yW1RtKoDE9+GUB0vKAnpOEB0hsCNB5QidywxHSE8Lr+X9wcs7+VI2bL9\\nlRGmyUpc7vVSgceFE+8usNCPlIMYGuzwMWFG8/ZBAoGBAIWVpwaOURMcdMAefljG\\nT74f3Hpl0e3zYDf3wkb8f44JGn7CmNglDd4MIA38r0lWdEYFEk7Y/jj1hNYqLLQO\\n6BjvYcZqEUinipCtJ6Dfldu8RAhLAZP5CRJvPdjGh3Cnxy9reWchTUGN7r98zGJl\\nnEG3MviNb17XCbtt7nnGdnOg\\n-----END PRIVATE KEY-----\\n',
    set,
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/libs/Env', () => ({
  Env: {
    GOOGLE_CALENDAR_ENABLED: 'true',
    GOOGLE_CALENDAR_ID: 'primary@example.com',
    GOOGLE_CALENDAR_CLIENT_EMAIL: 'calendar-bot@example.iam.gserviceaccount.com',
    GOOGLE_CALENDAR_PRIVATE_KEY: privateKey,
  },
}));

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
