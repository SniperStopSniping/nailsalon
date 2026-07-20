/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  getServicesBySalonIdIncludingInactive,
  selectWhere,
  insertValues,
  updateSet,
  updateReturning,
  ensureServiceAssignments,
  db,
} = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const selectFrom = vi.fn(() => ({
    where: selectWhere,
    innerJoin: vi.fn(() => ({ where: selectWhere })),
  }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateReturning = vi.fn(async (): Promise<unknown[]> => []);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    requireAdminSalon: vi.fn(),
    getServicesBySalonIdIncludingInactive: vi.fn(),
    selectWhere,
    insertValues,
    updateSet,
    updateReturning,
    ensureServiceAssignments: vi.fn(),
    db: {
      select,
      insert,
      update,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ select, insert })),
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
  getServicesBySalonIdIncludingInactive,
}));

vi.mock('@/libs/serviceAssignments', () => ({
  ensureServiceAssignments,
  InvalidTechnicianAssignmentError: class InvalidTechnicianAssignmentError extends Error {},
}));

import { GET, POST } from './route';

describe('salon services route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      salon: { id: 'salon_1', slug: 'isla-nail-studio' },
      error: null,
    });
    getServicesBySalonIdIncludingInactive.mockResolvedValue([]);
    ensureServiceAssignments.mockResolvedValue({
      assignedTechnicianIds: ['tech_1'],
      assignmentRequired: false,
    });
    selectWhere.mockResolvedValue([{ maxOrder: 2 }]);
    insertValues.mockReturnValue({
      returning: vi.fn(async () => [{
        id: 'svc_newsvc',
        name: 'BIAB + Classic Pedicure',
        description: 'Builder gel overlay paired with a classic pedicure',
        price: 8500,
        durationMinutes: 110,
        category: 'combo',
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
        name: 'BIAB + Classic Pedicure',
        description: 'Builder gel overlay paired with a classic pedicure',
        price: 8500,
        durationMinutes: 110,
        category: 'combo',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(requireAdminSalon).toHaveBeenCalledWith('isla-nail-studio');
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 'svc_newsvc',
      salonId: 'salon_1',
      name: 'BIAB + Classic Pedicure',
      price: 8500,
      durationMinutes: 110,
      category: 'combo',
      // Derived from the legacy category when the client omits it.
      bookingCategory: 'combo',
      templateKey: null,
      featuredOrder: null,
      sortOrder: 3,
      isActive: true,
    }));
    expect(body.data.service).toEqual(expect.objectContaining({
      id: 'svc_newsvc',
      name: 'BIAB + Classic Pedicure',
      category: 'combo',
    }));
    expect(ensureServiceAssignments).toHaveBeenCalledWith(expect.anything(), {
      salonId: 'salon_1',
      serviceId: 'svc_newsvc',
      technicianIds: undefined,
    });
  });

  it('accepts an explicit booking category, featured position, and Luster template key', async () => {
    // First select: no existing templated service; second: sortOrder max.
    selectWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxOrder: 2 }]);

    const response = await POST(new Request('http://localhost/api/salon/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        name: 'Luster Manicure',
        price: 4500,
        durationMinutes: 60,
        category: 'manicure',
        bookingCategory: 'manicure',
        featuredOrder: 1,
        templateKey: 'luster_manicure',
      }),
    }));

    expect(response.status).toBe(201);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      bookingCategory: 'manicure',
      featuredOrder: 1,
      templateKey: 'luster_manicure',
    }));
  });

  it('rejects unknown template keys', async () => {
    const response = await POST(new Request('http://localhost/api/salon/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        name: 'Mystery Service',
        price: 4500,
        durationMinutes: 60,
        category: 'manicure',
        templateKey: 'mystery_service',
      }),
    }));

    expect(response.status).toBe(400);
  });

  it('returns 409 when an active Luster template already exists for the salon', async () => {
    selectWhere.mockResolvedValueOnce([
      { id: 'svc_existing', isActive: true, templateKey: 'luster_manicure' },
    ]);

    const response = await POST(new Request('http://localhost/api/salon/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        name: 'Luster Manicure',
        price: 4500,
        durationMinutes: 60,
        category: 'manicure',
        templateKey: 'luster_manicure',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('TEMPLATE_ALREADY_ADDED');
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('revives a deactivated Luster template instead of failing on the unique index', async () => {
    selectWhere.mockResolvedValueOnce([
      { id: 'svc_dormant', isActive: false, templateKey: 'luster_manicure' },
    ]);
    updateReturning.mockResolvedValueOnce([{
      id: 'svc_dormant',
      name: 'Luster Manicure',
      description: null,
      price: 4500,
      durationMinutes: 60,
      category: 'manicure',
      bookingCategory: 'manicure',
      templateKey: 'luster_manicure',
      imageUrl: null,
      sortOrder: 5,
      isActive: true,
    }]);

    const response = await POST(new Request('http://localhost/api/salon/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        name: 'Luster Manicure',
        price: 4500,
        durationMinutes: 60,
        category: 'manicure',
        templateKey: 'luster_manicure',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      isActive: true,
      price: 4500,
      bookingCategory: 'manicure',
    }));
    expect(body.data.service).toEqual(expect.objectContaining({
      id: 'svc_dormant',
      isActive: true,
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
        category: 'combo',
      }),
    }));

    expect(response.status).toBe(400);
  });

  it('fetches services for the authorized salon on GET, including deactivated ones', async () => {
    // GET runs two extra selects: active technicians, then assignment rows.
    selectWhere.mockResolvedValueOnce([{ id: 'tech_1' }]);
    selectWhere.mockResolvedValueOnce([
      { serviceId: 'svc_1', technicianId: 'tech_1', enabled: true },
    ]);
    getServicesBySalonIdIncludingInactive.mockResolvedValueOnce([
      {
        id: 'svc_1',
        name: 'BIAB + Classic Pedicure',
        description: null,
        price: 8500,
        durationMinutes: 110,
        category: 'combo',
        imageUrl: null,
        sortOrder: 1,
        isActive: true,
      },
      {
        // Deactivated services stay visible to the owner for reactivation.
        id: 'svc_2',
        name: 'Luster Manicure',
        description: null,
        price: 5500,
        durationMinutes: 60,
        category: 'manicure',
        imageUrl: null,
        sortOrder: 2,
        isActive: false,
      },
    ]);

    const response = await GET(new Request('http://localhost/api/salon/services?salonSlug=isla-nail-studio'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalon).toHaveBeenCalledWith('isla-nail-studio');
    expect(body.data.services).toHaveLength(2);
    expect(body.data.services[1]).toMatchObject({ id: 'svc_2', isActive: false });
    // Truthful public-visibility signal: assigned count per service.
    expect(body.data.services[0].assignedTechnicianCount).toBe(1);
    expect(body.data.services[1].assignedTechnicianCount).toBe(0);
    expect(body.data.activeTechnicianCount).toBe(1);
  });
});
