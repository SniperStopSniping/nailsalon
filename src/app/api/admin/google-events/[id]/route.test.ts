/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbSelect, requireAdminSalon } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/DB', () => ({
  db: {
    select: dbSelect,
    update: vi.fn(),
  },
}));
vi.mock('@/libs/googleEventReview', () => ({ recordGoogleEventReviewDecision: vi.fn() }));

import { GET } from './route';

function selectResult(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: vi.fn(async () => rows),
      }),
    }),
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'google_event_1',
    salonId: 'salon_1',
    title: 'Controlled fake event',
    description: null,
    location: null,
    startTime: new Date('2099-07-20T14:00:00.000Z'),
    endTime: new Date('2099-07-20T15:00:00.000Z'),
    durationMinutes: 60,
    transparency: 'busy',
    sourceAccessRole: 'owner',
    googleStatus: 'confirmed',
    googleUpdatedAt: new Date('2099-07-01T00:00:00.000Z'),
    updatedAt: new Date('2099-07-01T00:00:00.000Z'),
    deletedAt: null,
    appointmentId: null,
    reviewStatus: 'needs_review',
    ...overrides,
  };
}

describe('Google event editing-session detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1' }, error: null });
    dbSelect.mockReturnValue(selectResult([eventRow()]));
  });

  it('returns a tenant-authorized source snapshot for change detection', async () => {
    const response = await GET(
      new Request('http://localhost/api/admin/google-events/google_event_1?salonSlug=test-salon'),
      { params: { id: 'google_event_1' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalon).toHaveBeenCalledWith('test-salon');
    expect(body.data.event).toEqual(expect.objectContaining({
      id: 'google_event_1',
      startTime: '2099-07-20T14:00:00.000Z',
      endTime: '2099-07-20T15:00:00.000Z',
      durationMinutes: 60,
      isReadOnly: false,
      sourceVersion: '2099-07-01T00:00:00.000Z',
    }));
  });

  it('distinguishes a conclusively deleted source without closing client state', async () => {
    dbSelect.mockReturnValue(selectResult([eventRow({ deletedAt: new Date('2099-07-02T00:00:00.000Z') })]));
    const response = await GET(
      new Request('http://localhost/api/admin/google-events/google_event_1?salonSlug=test-salon'),
      { params: { id: 'google_event_1' } },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'GOOGLE_EVENT_DELETED', message: 'Google event was deleted' },
    });
  });

  it('does not query event data when tenant authorization fails', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const response = await GET(
      new Request('http://localhost/api/admin/google-events/google_event_1?salonSlug=other-salon'),
      { params: { id: 'google_event_1' } },
    );

    expect(response.status).toBe(403);
    expect(dbSelect).not.toHaveBeenCalled();
  });
});
