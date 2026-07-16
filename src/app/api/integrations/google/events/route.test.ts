/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbSelect, processGoogleCalendarInboundSync, requireAdminSalon } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  processGoogleCalendarInboundSync: vi.fn(),
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/DB', () => ({ db: { select: dbSelect } }));
vi.mock('@/libs/googleCalendarInbound', () => ({ processGoogleCalendarInboundSync }));

import { GET } from './route';

describe('Google external events route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelect.mockReturnValue({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) });
  });

  it('returns privacy-safe tenant-scoped busy blocks', async () => {
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1' }, error: null });
    dbSelect.mockReturnValue({ from: () => ({ where: vi.fn().mockResolvedValue([{
      id: 'event_1',
      googleEventId: 'google_1',
      calendarId: 'primary@example.com',
      appointmentId: null,
      title: 'Private appointment',
      description: 'Owner only',
      location: null,
      startTime: new Date('2026-07-20T14:00:00.000Z'),
      endTime: new Date('2026-07-20T15:00:00.000Z'),
      durationMinutes: 60,
      isAllDay: false,
      transparency: 'busy',
      reviewStatus: 'needs_review',
      sourceAccessRole: 'owner',
      syncMode: 'bidirectional',
      lastSyncedAt: new Date('2026-07-15T15:00:00.000Z'),
    }]) }) });
    const response = await GET(new Request(
      'http://localhost/api/integrations/google/events?salonSlug=best&startTime=2026-07-01T00%3A00%3A00.000Z&endTime=2026-08-01T00%3A00%3A00.000Z',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalon).toHaveBeenCalledWith('best');
    expect(processGoogleCalendarInboundSync).toHaveBeenCalledWith(1, 'salon_1');
    expect(body.data.events).toEqual([expect.objectContaining({
      id: 'event_1',
      startTime: '2026-07-20T14:00:00.000Z',
      endTime: '2026-07-20T15:00:00.000Z',
      label: 'Private appointment',
      needsDetails: true,
      isReadOnly: false,
    })]);
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
    expect(dbSelect).not.toHaveBeenCalled();
  });
});
