/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  getAdminSession,
  guardModuleOr403,
  selectResults,
  updateResults,
  db,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updateResults: unknown[][] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        return {
          limit: vi.fn(async () => result),
        };
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => updateResults.shift() ?? []),
      })),
    })),
  }));

  return {
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    guardModuleOr403: vi.fn(),
    selectResults,
    updateResults,
    db: {
      select,
      update,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
  getAdminSession,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET, PUT } from './route';

const clientVersion = '2026-07-24T12:00:00.000Z';
const nextClientVersion = '2026-07-24T12:00:01.000Z';

describe('/api/admin/clients/[id]/flag auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    updateResults.length = 0;
    guardModuleOr403.mockResolvedValue(null);
  });

  it('rejects unauthenticated admins from reading client flags', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(401);
  });

  it('allows authorized admins to read client flags for their salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    selectResults.push([{
      id: 'client_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: { isProblemClient: true },
      isBlocked: true,
      blockedReason: 'Repeated no-shows',
      noShowCount: 2,
      lateCancelCount: 1,
      updatedAt: new Date(clientVersion),
    }]);

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        client: {
          id: 'client_1',
          phone: '1111111111',
          fullName: 'Ava',
          adminFlags: { isProblemClient: true },
          isBlocked: true,
          blockedReason: 'Repeated no-shows',
          noShowCount: 2,
          lateCancelCount: 1,
          updatedAt: clientVersion,
        },
      },
    });
  });

  it('records admin-backed flag updates with the authenticated admin id', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    selectResults.push([{
      id: 'client_1',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
      mergedIntoClientId: null,
      updatedAt: new Date(clientVersion),
    }]);
    updateResults.push([{
      id: 'client_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {
        isProblemClient: true,
        flagReason: 'Abusive behavior',
        flaggedBy: 'admin_1',
      },
      isBlocked: true,
      blockedReason: 'Abusive behavior',
      noShowCount: 0,
      lateCancelCount: 0,
      updatedAt: new Date(nextClientVersion),
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: clientVersion,
          isProblemClient: true,
          flagReason: 'Abusive behavior',
          isBlocked: true,
          blockedReason: 'Abusive behavior',
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(guardModuleOr403).toHaveBeenNthCalledWith(1, { salonId: 'salon_1', module: 'clientFlags' });
    expect(guardModuleOr403).toHaveBeenNthCalledWith(2, { salonId: 'salon_1', module: 'clientBlocking' });
    expect(body.data.client.adminFlags.flaggedBy).toBe('admin_1');
    expect(body.data.client.isBlocked).toBe(true);
    expect(body.data.client.updatedAt).toBe(nextClientVersion);
  });

  it('uses the clientBlocking module gate for booking blocks without requiring clientFlags', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    guardModuleOr403.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'MODULE_DISABLED', message: 'Module disabled' },
    }), { status: 403 }));

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: clientVersion,
          isBlocked: true,
          blockedReason: 'Repeated no-shows',
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(403);
    expect(guardModuleOr403).toHaveBeenCalledTimes(1);
    expect(guardModuleOr403).toHaveBeenCalledWith({ salonId: 'salon_1', module: 'clientBlocking' });
  });

  it('uses the clientFlags module gate for problem flags without requiring clientBlocking', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    guardModuleOr403.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'MODULE_DISABLED', message: 'Module disabled' },
    }), { status: 403 }));

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: clientVersion,
          isProblemClient: true,
          flagReason: 'Aggressive behavior',
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(403);
    expect(guardModuleOr403).toHaveBeenCalledTimes(1);
    expect(guardModuleOr403).toHaveBeenCalledWith({ salonId: 'salon_1', module: 'clientFlags' });
  });

  it('requires an expected client version for flag mutations', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          isBlocked: true,
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(400);
    expect(requireAdminSalon).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects a stale version without disclosing current client data', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    selectResults.push([{
      id: 'client_1',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
      mergedIntoClientId: null,
      updatedAt: new Date(nextClientVersion),
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: clientVersion,
          isBlocked: true,
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'STALE_CLIENT',
        message: 'This client changed since it was loaded. Refresh and try again.',
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/phone|fullName|adminFlags|isBlocked/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns STALE_CLIENT when the compare-and-set update loses a race', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    selectResults.push([{
      id: 'client_1',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
      mergedIntoClientId: null,
      updatedAt: new Date(clientVersion),
    }]);
    updateResults.push([]);

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: clientVersion,
          isProblemClient: true,
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'STALE_CLIENT',
        message: 'This client changed since it was loaded. Refresh and try again.',
      },
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('rejects mutations against a preserved merged source profile', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    selectResults.push([{
      id: 'client_duplicate',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
      mergedIntoClientId: 'client_primary',
      updatedAt: new Date(clientVersion),
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_duplicate/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: clientVersion,
          isBlocked: true,
        }),
      }),
      { params: Promise.resolve({ id: 'client_duplicate' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INVALID_CLIENT_STATE',
        message: 'This client can no longer be updated directly.',
      },
    });
    expect(db.update).not.toHaveBeenCalled();
  });
});
