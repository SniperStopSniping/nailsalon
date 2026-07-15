/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listExternalGoogleCalendarEvents, processGoogleCalendarInboundSync, requireAdminSalon } = vi.hoisted(() => ({
  listExternalGoogleCalendarEvents: vi.fn(),
  processGoogleCalendarInboundSync: vi.fn(),
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/googleCalendar', () => ({ listExternalGoogleCalendarEvents }));
vi.mock('@/libs/googleCalendarInbound', () => ({ processGoogleCalendarInboundSync }));

import { GET } from './route';

describe('Google external events route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns privacy-safe tenant-scoped busy blocks', async () => {
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1' }, error: null });
    listExternalGoogleCalendarEvents.mockResolvedValue([{
      id: 'event_1',
      startTime: new Date('2026-07-20T14:00:00.000Z'),
      endTime: new Date('2026-07-20T15:00:00.000Z'),
    }]);
    const response = await GET(new Request(
      'http://localhost/api/integrations/google/events?salonSlug=best&startTime=2026-07-01T00%3A00%3A00.000Z&endTime=2026-08-01T00%3A00%3A00.000Z',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalon).toHaveBeenCalledWith('best');
    expect(processGoogleCalendarInboundSync).toHaveBeenCalledWith(1, 'salon_1');
    expect(listExternalGoogleCalendarEvents).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon_1' }));
    expect(body.data.events).toEqual([{
      id: 'event_1',
      startTime: '2026-07-20T14:00:00.000Z',
      endTime: '2026-07-20T15:00:00.000Z',
      label: 'Google Calendar busy',
    }]);
    expect(JSON.stringify(body)).not.toContain('summary');
  });

  it('rejects access when the salon guard fails', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const response = await GET(new Request(
      'http://localhost/api/integrations/google/events?salonSlug=other&startTime=2026-07-01T00%3A00%3A00.000Z&endTime=2026-08-01T00%3A00%3A00.000Z',
    ));

    expect(response.status).toBe(403);
    expect(listExternalGoogleCalendarEvents).not.toHaveBeenCalled();
  });
});
