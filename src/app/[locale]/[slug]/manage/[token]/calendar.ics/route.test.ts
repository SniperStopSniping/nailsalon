/* eslint-disable import/first */
/**
 * The .ics the customer hands to their own calendar app.
 *
 * Two properties are load-bearing here and both are privacy/expectation
 * promises rather than formatting details: an unaccepted request must not be
 * written into the calendar as CONFIRMED, and the LOCATION line must carry
 * exactly what the capability-scoped address projection allows — no more.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyAppointmentAccessToken,
  getLocationById,
  getPrimaryLocation,
  selectResults,
} = vi.hoisted(() => ({
  verifyAppointmentAccessToken: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  selectResults: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/libs/appointmentAccess', () => ({ verifyAppointmentAccessToken }));

vi.mock('@/libs/queries', () => ({ getLocationById, getPrimaryLocation }));

vi.mock('@/libs/DB', () => {
  const chain = () => {
    const target: Record<string, unknown> = {};
    target.from = () => target;
    target.where = async () => selectResults.shift() ?? [];
    return target;
  };
  return { db: { select: chain } };
});

import { GET } from './route';

const TOKEN = 'TEST_TOKEN_NOT_A_REAL_CAPABILITY';
const PRIVATE_STREET = '18 Maple Grove Lane, Unit 4B';

function capability(status: string, locationDisplayMode: string) {
  const startTime = new Date('2026-09-07T15:00:00.000Z');
  return {
    appointmentId: 'appt_1',
    salonId: 'salon_1',
    salonSlug: 'lacquer-lab-studio',
    salonName: 'Lacquer Lab Studio',
    salonSettings: { bookingPageContent: { version: 1, live: { locationDisplayMode } } },
    appointment: {
      id: 'appt_1',
      salonId: 'salon_1',
      locationId: null,
      status,
      startTime,
      endTime: new Date(startTime.getTime() + 75 * 60 * 1000),
    },
  };
}

async function fetchIcs(status: string, locationDisplayMode = 'after_booking'): Promise<string> {
  verifyAppointmentAccessToken.mockResolvedValue(capability(status, locationDisplayMode));
  selectResults.push([{ name: 'Gel Manicure' }, { name: 'French Tips' }]);
  const response = await GET(new Request('https://example.com/calendar.ics'), {
    params: Promise.resolve({ slug: 'lacquer-lab-studio', token: TOKEN }),
  });

  expect(response.status).toBe(200);

  return response.text();
}

describe('manage calendar.ics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    getLocationById.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue({
      name: 'Primary location',
      address: PRIVATE_STREET,
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M4K 1N2',
    });
  });

  it('exports an unreviewed request as TENTATIVE, not CONFIRMED', async () => {
    for (const status of ['pending', 'awaiting_payment']) {
      expect(await fetchIcs(status)).toContain('STATUS:TENTATIVE');
    }
  });

  it('exports an accepted appointment as CONFIRMED and a cancelled one as CANCELLED', async () => {
    for (const status of ['confirmed', 'in_progress', 'completed']) {
      expect(await fetchIcs(status)).toContain('STATUS:CONFIRMED');
    }

    expect(await fetchIcs('cancelled')).toContain('STATUS:CANCELLED');
  });

  it('withholds the street address until the request is confirmed, and says so', async () => {
    const pending = await fetchIcs('pending', 'after_booking');

    expect(pending).toContain('LOCATION:Toronto\\, ON');
    expect(pending).not.toContain('Maple Grove');
    expect(pending).toContain('Exact address is shared once your request is confirmed.');

    const confirmed = await fetchIcs('confirmed', 'after_booking');

    expect(confirmed).toContain('LOCATION:18 Maple Grove Lane\\, Unit 4B\\, Toronto\\, ON\\, M4K 1N2');
    expect(confirmed).not.toContain('Exact address is shared once');
  });

  it('never discloses the address of a city_only salon, confirmed or not', async () => {
    for (const status of ['pending', 'confirmed', 'completed']) {
      const ics = await fetchIcs(status, 'city_only');

      expect(ics).toContain('LOCATION:Toronto\\, ON');
      expect(ics).not.toContain('Maple Grove');
      // city_only never promises an address later, so no notice either.
      expect(ics).not.toContain('Exact address is shared once');
    }
  });
});
