/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbSelect, listGoogleCalendarsForSalon, requireAdminSalon, updateSet } = vi.hoisted(() => {
  const limit = vi.fn(async () => [{ destinationCalendarId: 'primary', busyCalendarIds: ['primary'] }]);
  const dbSelect = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  return {
    dbSelect,
    listGoogleCalendarsForSalon: vi.fn(),
    requireAdminSalon: vi.fn(),
    updateSet,
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/googleCalendar', () => ({ listGoogleCalendarsForSalon }));
vi.mock('@/libs/DB', () => ({ db: { select: dbSelect, update: () => ({ set: updateSet }) } }));

import { GET, PATCH } from './route';

describe('Google calendar selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1' }, error: null });
    listGoogleCalendarsForSalon.mockResolvedValue([
      { id: 'owner@example.com', summary: 'Owner', primary: true, accessRole: 'owner' },
      { id: 'busy@example.com', summary: 'Busy', primary: false, accessRole: 'reader' },
    ]);
  });

  it('repairs the legacy primary alias when loading calendars', async () => {
    const response = await GET(new Request('http://localhost/api/integrations/google/calendars?salonSlug=best'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.selection).toEqual({
      destinationCalendarId: 'owner@example.com',
      busyCalendarIds: ['owner@example.com'],
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      destinationCalendarId: 'owner@example.com',
      busyCalendarIds: ['owner@example.com'],
    }));
  });

  it('accepts primary on save and stores canonical calendar IDs', async () => {
    const response = await PATCH(new Request('http://localhost/api/integrations/google/calendars', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'best', destinationCalendarId: 'primary', busyCalendarIds: ['primary', 'busy@example.com'] }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.selection).toEqual({
      destinationCalendarId: 'owner@example.com',
      busyCalendarIds: ['owner@example.com', 'busy@example.com'],
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ inboundSyncedAt: null }));
  });
});
