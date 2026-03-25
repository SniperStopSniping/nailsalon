import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cookieSet,
  db,
  getAdminImpersonationForAdmin,
  getAdminSession,
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
    cookieSet: vi.fn(),
    db,
    getAdminImpersonationForAdmin: vi.fn(),
    getAdminSession: vi.fn(),
    setSelectResults,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
  })),
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminImpersonationForAdmin,
  getAdminSession,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { DELETE, POST } from './route';

describe('/api/admin/auth/set-active-salon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectResults([]);
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      isSuperAdmin: true,
      salons: [],
    });
    getAdminImpersonationForAdmin.mockResolvedValue(null);
  });

  it('blocks switching to another salon while impersonating', async () => {
    setSelectResults([[
      { id: 'salon_other', slug: 'other-salon' },
    ]]);
    getAdminImpersonationForAdmin.mockResolvedValue({
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const response = await POST(new Request('http://localhost/api/admin/auth/set-active-salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'other-salon' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Cannot switch salons while impersonating');
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('allows reaffirming the locked impersonated salon', async () => {
    setSelectResults([[
      { id: 'salon_locked', slug: 'locked-salon' },
    ]]);
    getAdminImpersonationForAdmin.mockResolvedValue({
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const response = await POST(new Request('http://localhost/api/admin/auth/set-active-salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'locked-salon' }),
    }));

    expect(response.status).toBe(200);
    expect(cookieSet).toHaveBeenCalledWith(
      '__active_salon_slug',
      'locked-salon',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
      }),
    );
  });

  it('blocks clearing the active salon while impersonating', async () => {
    getAdminImpersonationForAdmin.mockResolvedValue({
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const response = await DELETE(new Request('http://localhost/api/admin/auth/set-active-salon', {
      method: 'DELETE',
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Cannot clear the active salon while impersonating');
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
