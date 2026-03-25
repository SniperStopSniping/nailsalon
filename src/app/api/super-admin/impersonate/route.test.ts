import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearAdminImpersonationSession,
  db,
  getAdminImpersonationSession,
  getSuperAdminInfo,
  logAuditAction,
  requireSuperAdmin,
  setAdminImpersonationSession,
  setSelectResults,
} = vi.hoisted(() => {
  let selectResults: unknown[][] = [];

  const setSelectResults = (nextResults: unknown[][]) => {
    selectResults = [...nextResults];
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
  };

  return {
    clearAdminImpersonationSession: vi.fn(),
    db,
    getAdminImpersonationSession: vi.fn(),
    getSuperAdminInfo: vi.fn(),
    logAuditAction: vi.fn(),
    requireSuperAdmin: vi.fn(),
    setAdminImpersonationSession: vi.fn(),
    setSelectResults,
  };
});

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/adminImpersonation', () => ({
  clearAdminImpersonationSession,
  getAdminImpersonationSession,
  setAdminImpersonationSession,
}));

vi.mock('@/libs/superAdmin', () => ({
  getSuperAdminInfo,
  logAuditAction,
  requireSuperAdmin,
}));

import { DELETE, GET, POST } from './route';

describe('/api/super-admin/impersonate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectResults([]);
    requireSuperAdmin.mockResolvedValue(null);
  });

  it('only allows a super admin to start impersonation', async () => {
    requireSuperAdmin.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await POST(new Request('http://localhost/api/super-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_1' }),
    }));

    expect(response.status).toBe(403);
    expect(setAdminImpersonationSession).not.toHaveBeenCalled();
  });

  it('starts impersonation and sets the secure impersonation session for the selected salon', async () => {
    setSelectResults([[
      { id: 'salon_1', slug: 'locked-salon', name: 'Locked Salon' },
    ]]);
    getSuperAdminInfo.mockResolvedValue({
      userId: 'admin_1',
      phone: '+15551234567',
      name: 'Sam Super',
    });

    const response = await POST(new Request('http://localhost/api/super-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonId: 'salon_1' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(setAdminImpersonationSession).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
    }));
    expect(logAuditAction).toHaveBeenCalledWith('salon_1', 'updated', {
      details: 'Impersonation started by +15551234567',
    });
    expect(body.salon).toEqual({
      id: 'salon_1',
      name: 'Locked Salon',
      slug: 'locked-salon',
    });
  });

  it('reports active impersonation status for the banner and admin UI', async () => {
    getAdminImpersonationSession.mockResolvedValue({
      salonId: 'salon_1',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isImpersonating).toBe(true);
    expect(body.session.salonSlug).toBe('locked-salon');
  });

  it('ends impersonation and clears the impersonation session', async () => {
    getAdminImpersonationSession.mockResolvedValue({
      salonId: 'salon_1',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });
    getSuperAdminInfo.mockResolvedValue({
      userId: 'admin_1',
      phone: '+15551234567',
      name: 'Sam Super',
    });

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(clearAdminImpersonationSession).toHaveBeenCalledTimes(1);
    expect(logAuditAction).toHaveBeenCalledWith('salon_1', 'updated', {
      details: 'Impersonation ended by +15551234567',
    });
    expect(body.redirectUrl).toBe('/super-admin');
  });
});
