import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  getSalonClientById,
  normalizePhone,
  updateSalonClient,
  selectQueue,
  db,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];

  const createQuery = (result: unknown) => {
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
      catch: (reject: (reason: unknown) => void) => Promise.resolve(result).catch(reject),
      finally: (onFinally: () => void) => Promise.resolve(result).finally(onFinally),
    };

    return query;
  };

  const select = vi.fn(() => createQuery(selectQueue.shift() ?? []));

  return {
    requireAdminSalon: vi.fn(),
    getSalonClientById: vi.fn(),
    normalizePhone: vi.fn((phone: string) => phone.replace(/\D/g, '')),
    updateSalonClient: vi.fn(),
    selectQueue,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/queries', () => ({
  getSalonClientById,
  normalizePhone,
  updateSalonClient,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/admin/clients/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('rejects wrong-tenant admins', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(403);
  });

  it('returns upcoming appointments separately from completed history and recent issues', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getSalonClientById.mockResolvedValue({
      id: 'client_1',
      phone: '1111111111',
      fullName: 'Ava Thompson',
      email: 'ava@example.com',
      preferredTechnicianId: 'tech_1',
      notes: 'VIP client',
      lastVisitAt: new Date('2026-03-10T14:00:00.000Z'),
      totalVisits: 4,
      totalSpent: 32000,
      noShowCount: 1,
      loyaltyPoints: 150,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    selectQueue.push(
      [{ id: 'tech_1', name: 'Daniela', avatarUrl: null }],
      [{
        id: 'appt_upcoming',
        startTime: new Date('2026-04-04T15:00:00.000Z'),
        endTime: new Date('2026-04-04T16:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 9500,
        technicianId: 'tech_1',
        notes: 'French finish',
      }],
      [{
        id: 'appt_completed',
        startTime: new Date('2026-03-10T14:00:00.000Z'),
        endTime: new Date('2026-03-10T15:00:00.000Z'),
        status: 'completed',
        totalPrice: 8200,
        technicianId: 'tech_2',
        notes: null,
      }],
      [{
        id: 'appt_issue',
        startTime: new Date('2026-03-02T14:00:00.000Z'),
        endTime: new Date('2026-03-02T15:00:00.000Z'),
        status: 'no_show',
        totalPrice: 0,
        technicianId: 'tech_1',
        notes: 'Did not arrive',
      }],
      [
        { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        { id: 'tech_2', name: 'Mila', avatarUrl: null },
      ],
      [
        { appointmentId: 'appt_upcoming', serviceName: 'Gel Fill', priceAtBooking: 9500 },
        { appointmentId: 'appt_completed', serviceName: 'Classic Pedicure', priceAtBooking: 8200 },
        { appointmentId: 'appt_issue', serviceName: 'Builder Gel Fill', priceAtBooking: 9900 },
      ],
    );

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(normalizePhone).toHaveBeenCalledWith('1111111111');
    expect(body.data.client.preferredTechnician).toEqual({
      id: 'tech_1',
      name: 'Daniela',
      avatarUrl: null,
    });
    expect(body.data.upcomingAppointments).toHaveLength(1);
    expect(body.data.upcomingAppointments[0]).toMatchObject({
      id: 'appt_upcoming',
      status: 'confirmed',
      services: [{ name: 'Gel Fill', price: 9500 }],
    });
    expect(body.data.pastAppointments).toEqual([
      expect.objectContaining({
        id: 'appt_completed',
        status: 'completed',
        services: [{ name: 'Classic Pedicure', price: 8200 }],
      }),
    ]);
    expect(body.data.recentIssues).toEqual([
      expect.objectContaining({
        id: 'appt_issue',
        status: 'no_show',
        services: [{ name: 'Builder Gel Fill', price: 9900 }],
      }),
    ]);
  });
});
