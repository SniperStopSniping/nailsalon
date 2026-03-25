import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireActiveAdminSalon, buildTimeOffDecisionNotification, createStaffNotification, db } = vi.hoisted(() => {
  const limitExisting = vi.fn(async () => [{
    id: 'req_1',
    salonId: 'salon_other',
    technicianId: 'tech_1',
    startDate: new Date('2026-03-14T00:00:00.000Z'),
    endDate: new Date('2026-03-15T00:00:00.000Z'),
    note: null,
    status: 'PENDING',
    decidedAt: null,
    decidedByAdminId: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
  }]);
  const whereExisting = vi.fn(() => ({ limit: limitExisting }));
  const fromExisting = vi.fn(() => ({ where: whereExisting }));
  const select = vi.fn(() => ({ from: fromExisting }));

  return {
    requireActiveAdminSalon: vi.fn(),
    buildTimeOffDecisionNotification: vi.fn(() => ({ title: 'Decision', body: 'Body' })),
    createStaffNotification: vi.fn(),
    db: { select },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon,
}));

vi.mock('@/libs/notifications', () => ({
  buildTimeOffDecisionNotification,
  createStaffNotification,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET, PATCH } from './route';

describe('/api/admin/time-off-requests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1', name: 'Admin' },
    });
  });

  it('hides requests outside the active salon on GET', async () => {
    const response = await GET(
      new Request('http://localhost/api/admin/time-off-requests/req_1'),
      { params: Promise.resolve({ id: 'req_1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('hides requests outside the active salon on PATCH', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/admin/time-off-requests/req_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED' }),
      }),
      { params: Promise.resolve({ id: 'req_1' }) },
    );

    expect(response.status).toBe(404);
    expect(createStaffNotification).not.toHaveBeenCalled();
  });
});
