import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  getSalonBySlug,
  getActiveLocationsBySalonId,
  logAuditEvent,
  insertValues,
  updateSet,
  setInsertResult,
  setUpdateResult,
  db,
} = vi.hoisted(() => {
  let insertResult: unknown[] = [];
  let updateResult: unknown[] = [];

  const setInsertResult = (next: unknown[]) => {
    insertResult = next;
  };
  const setUpdateResult = (next: unknown[]) => {
    updateResult = next;
  };

  const insertReturning = vi.fn(async () => insertResult);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateReturning = vi.fn(async () => updateResult);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    requireAdmin: vi.fn(),
    getSalonBySlug: vi.fn(),
    getActiveLocationsBySalonId: vi.fn(),
    logAuditEvent: vi.fn(),
    insertValues,
    updateSet,
    setInsertResult,
    setUpdateResult,
    db: {
      insert,
      update,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin,
}));

vi.mock('@/libs/auditLog', () => ({
  logAuditEvent,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
  getActiveLocationsBySalonId,
}));

import { GET, PATCH } from './route';

describe('admin location route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInsertResult([]);
    setUpdateResult([]);
    getSalonBySlug.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      name: 'Salon A',
    });
    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'admin_1' },
    });
  });

  it('returns the primary directions location for the authorized salon admin', async () => {
    getActiveLocationsBySalonId.mockResolvedValue([
      {
        id: 'loc_1',
        name: 'Main Studio',
        address: '123 Queen St W',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5H 2M9',
        isPrimary: true,
      },
    ]);

    const response = await GET(
      new Request('http://localhost/api/admin/location?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        salon: {
          id: 'salon_1',
          slug: 'salon-a',
          name: 'Salon A',
          locationCount: 1,
        },
        location: {
          id: 'loc_1',
          name: 'Main Studio',
          address: '123 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2M9',
          isPrimary: true,
        },
        isPrimaryFallback: false,
      },
    });
  });

  it('creates the first primary location when the salon has none yet', async () => {
    getActiveLocationsBySalonId.mockResolvedValue([]);
    setInsertResult([{
      id: 'loc_1',
      name: 'Main Studio',
      address: '123 Queen St W',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
      isPrimary: true,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/location?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Main Studio',
          address: '123 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2M9',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      name: 'Main Studio',
      isPrimary: true,
      isActive: true,
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      actorId: 'admin_1',
      action: 'settings_updated',
    }));
    expect(body.data.created).toBe(true);
  });

  it('updates the existing primary location for the authorized salon admin', async () => {
    getActiveLocationsBySalonId.mockResolvedValue([
      {
        id: 'loc_1',
        name: 'Old Name',
        address: '1 King St W',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5H 1A1',
        isPrimary: true,
      },
    ]);
    setUpdateResult([{
      id: 'loc_1',
      name: 'Queen West',
      address: '123 Queen St W',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
      isPrimary: true,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/location?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Queen West',
          address: '123 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2M9',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Queen West',
      address: '123 Queen St W',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      actorId: 'admin_1',
      action: 'settings_updated',
    }));
    expect(body.data.created).toBe(false);
  });

  it('rejects cross-salon or unauthorized admins', async () => {
    requireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/location?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Main Studio',
        }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
