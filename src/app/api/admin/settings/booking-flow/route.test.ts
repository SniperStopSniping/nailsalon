import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon, set, db } = vi.hoisted(() => {
  const returning = vi.fn(async () => [{
    bookingFlowCustomizationEnabled: true,
    bookingFlow: ['service', 'time', 'confirm'],
  }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  return {
    requireAdminSalon: vi.fn(),
    returning,
    set,
    db: {
      update,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET, PUT } from './route';

describe('admin booking flow auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects wrong-tenant admins', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await PUT(
      new Request('http://localhost/api/admin/settings/booking-flow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          bookingFlow: ['service', 'time', 'confirm'],
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('allows authorized admins to read booking flow settings', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: 'salon_1',
        bookingFlowCustomizationEnabled: true,
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/settings/booking-flow?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        bookingFlowCustomizationEnabled: true,
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
      },
    });
  });

  it('allows authorized admins to update booking flow settings', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: 'salon_1',
        bookingFlowCustomizationEnabled: true,
      },
    });

    const response = await PUT(
      new Request('http://localhost/api/admin/settings/booking-flow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          bookingFlow: ['service', 'time', 'confirm'],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith({
      bookingFlow: ['service', 'time', 'confirm'],
    });
    expect(body).toEqual({
      data: {
        bookingFlowCustomizationEnabled: true,
        bookingFlow: ['service', 'time', 'confirm'],
      },
    });
  });
});
