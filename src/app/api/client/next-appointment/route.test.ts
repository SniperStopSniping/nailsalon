import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  db,
  setSelectResponses,
  requireClientApiSession,
  requireClientSalonFromQuery,
  getLocationById,
  getPrimaryLocation,
} = vi.hoisted(() => {
  let responses: unknown[] = [];

  const setSelectResponses = (nextResponses: unknown[]) => {
    responses = [...nextResponses];
  };

  const db = {
    select: vi.fn(() => {
      const result = responses.shift() ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => result),
            })),
            limit: vi.fn(async () => result),
            then: (resolve: (value: unknown) => void) => resolve(result),
          })),
        })),
      };
    }),
  };

  return {
    db,
    setSelectResponses,
    requireClientApiSession: vi.fn(),
    requireClientSalonFromQuery: vi.fn(),
    getLocationById: vi.fn(),
    getPrimaryLocation: vi.fn(),
  };
});

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromQuery,
}));

vi.mock('@/libs/queries', () => ({
  getLocationById,
  getPrimaryLocation,
}));

import { GET } from './route';

describe('GET /api/client/next-appointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111', '+11111111111'],
      session: {
        phone: '+11111111111',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
    });
    requireClientSalonFromQuery.mockResolvedValue({
      ok: true,
      salon: {
        id: 'salon_1',
        name: 'Salon A',
        address: '123 Beauty Lane',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90001',
      },
    });
    getLocationById.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue(null);
  });

  it('returns the actual next-appointment payload needed by the profile reschedule flow', async () => {
    getLocationById.mockResolvedValue({
      id: 'loc_1',
      name: 'Queen West',
      address: '123 Queen St W',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
    });

    setSelectResponses([
      [{
        id: 'appt_1',
        startTime: new Date('2099-03-20T15:30:00.000Z'),
        endTime: new Date('2099-03-20T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 6500,
        totalDurationMinutes: 90,
        technicianId: 'tech_1',
        locationId: 'loc_1',
      }],
      [{
        serviceId: 'srv_1',
        priceAtBooking: 6500,
        durationAtBooking: 90,
      }],
      [{
        id: 'srv_1',
        name: 'BIAB',
        price: 6500,
        durationMinutes: 90,
        imageUrl: null,
      }],
      [{
        id: 'tech_1',
        name: 'Taylor',
        avatarUrl: '/tech.jpg',
      }],
    ]);

    const response = await GET(
      new Request('http://localhost/api/client/next-appointment?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        appointment: {
          id: 'appt_1',
          startTime: '2099-03-20T15:30:00.000Z',
          endTime: '2099-03-20T17:00:00.000Z',
          status: 'confirmed',
          totalPrice: 6500,
          totalDurationMinutes: 90,
          locationId: 'loc_1',
        },
        services: [{
          id: 'srv_1',
          name: 'BIAB',
          price: 6500,
          duration: 90,
          imageUrl: null,
        }],
        technician: {
          id: 'tech_1',
          name: 'Taylor',
          avatarUrl: '/tech.jpg',
        },
        location: {
          id: 'loc_1',
          name: 'Queen West',
          address: '123 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2M9',
        },
      },
      meta: {
        timestamp: expect.any(String),
      },
    });
    expect(JSON.stringify(body)).not.toContain('clientPhone');
  });

  it('prefers the primary active location over the stale salon root address when no appointment location is set', async () => {
    getPrimaryLocation.mockResolvedValue({
      id: 'loc_primary',
      name: 'Isla Nail Salon',
      address: '32 Clareville Crescent',
      city: 'North York',
      state: 'ON',
      zipCode: 'M2J 2C1',
    });

    setSelectResponses([
      [{
        id: 'appt_2',
        startTime: new Date('2099-03-21T15:30:00.000Z'),
        endTime: new Date('2099-03-21T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 6500,
        totalDurationMinutes: 90,
        technicianId: null,
        locationId: null,
      }],
      [{
        serviceId: 'srv_1',
        priceAtBooking: 6500,
        durationAtBooking: 90,
      }],
      [{
        id: 'srv_1',
        name: 'BIAB',
        price: 6500,
        durationMinutes: 90,
        imageUrl: null,
      }],
    ]);

    const response = await GET(
      new Request('http://localhost/api/client/next-appointment?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.location).toEqual({
      id: 'loc_primary',
      name: 'Isla Nail Salon',
      address: '32 Clareville Crescent',
      city: 'North York',
      state: 'ON',
      zipCode: 'M2J 2C1',
    });
  });

  it('falls back to the salon root address only when no usable location record exists', async () => {
    setSelectResponses([
      [{
        id: 'appt_3',
        startTime: new Date('2099-03-22T15:30:00.000Z'),
        endTime: new Date('2099-03-22T17:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 6500,
        totalDurationMinutes: 90,
        technicianId: null,
        locationId: null,
      }],
      [{
        serviceId: 'srv_1',
        priceAtBooking: 6500,
        durationAtBooking: 90,
      }],
      [{
        id: 'srv_1',
        name: 'BIAB',
        price: 6500,
        durationMinutes: 90,
        imageUrl: null,
      }],
    ]);

    const response = await GET(
      new Request('http://localhost/api/client/next-appointment?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.location).toEqual({
      id: 'salon_salon_1',
      name: 'Salon A',
      address: '123 Beauty Lane',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90001',
    });
  });
});
