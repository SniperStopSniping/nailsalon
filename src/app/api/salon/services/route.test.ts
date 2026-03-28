import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  getServicesBySalonId,
  selectWhere,
  insertValues,
  db,
} = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    requireAdminSalon: vi.fn(),
    getServicesBySalonId: vi.fn(),
    selectWhere,
    insertValues,
    db: {
      select,
      insert,
    },
  };
});

vi.mock('nanoid', () => ({
  nanoid: () => 'newsvc',
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  getServicesBySalonId,
}));

import { GET, POST } from './route';

describe('salon services route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      salon: { id: 'salon_1', slug: 'isla-nail-studio' },
      error: null,
    });
    getServicesBySalonId.mockResolvedValue([]);
    selectWhere.mockResolvedValue([{ maxOrder: 2 }]);
    insertValues.mockReturnValue({
      returning: vi.fn(async () => [{
        id: 'svc_newsvc',
        name: 'BIAB Short',
        description: 'Builder gel overlay',
        price: 6500,
        durationMinutes: 75,
        category: 'hands',
        imageUrl: null,
        sortOrder: 3,
        isActive: true,
      }]),
    });
  });

  it('creates a new service for the authorized salon admin', async () => {
    const response = await POST(new Request('http://localhost/api/salon/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        name: 'BIAB Short',
        description: 'Builder gel overlay',
        price: 6500,
        durationMinutes: 75,
        category: 'hands',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(requireAdminSalon).toHaveBeenCalledWith('isla-nail-studio');
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 'svc_newsvc',
      salonId: 'salon_1',
      name: 'BIAB Short',
      price: 6500,
      durationMinutes: 75,
      category: 'hands',
      sortOrder: 3,
      isActive: true,
    }));
    expect(body.data.service).toEqual(expect.objectContaining({
      id: 'svc_newsvc',
      name: 'BIAB Short',
      category: 'hands',
    }));
  });

  it('rejects invalid create payloads', async () => {
    const response = await POST(new Request('http://localhost/api/salon/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        name: '',
        price: -100,
        durationMinutes: 0,
        category: 'hands',
      }),
    }));

    expect(response.status).toBe(400);
  });

  it('still fetches services for the authorized salon on GET', async () => {
    getServicesBySalonId.mockResolvedValueOnce([
      {
        id: 'svc_1',
        name: 'Gel Mani',
        description: null,
        price: 5500,
        durationMinutes: 60,
        category: 'hands',
        imageUrl: null,
        sortOrder: 1,
        isActive: true,
      },
    ]);

    const response = await GET(new Request('http://localhost/api/salon/services?salonSlug=isla-nail-studio'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalon).toHaveBeenCalledWith('isla-nail-studio');
    expect(body.data.services).toHaveLength(1);
  });
});
