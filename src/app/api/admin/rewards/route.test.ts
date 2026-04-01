import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon, db } = vi.hoisted(() => {
  const offset = vi.fn(async () => []);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAdminSalon: vi.fn(),
    db: { select },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/admin/rewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized admins', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(new Request('http://localhost/api/admin/rewards?salonSlug=salon-a'));
    expect(response.status).toBe(401);
  });

  it('returns display-ready reward data for the salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });

    db.select.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(async () => [{
                id: 'reward_1',
                salonId: 'salon_1',
                clientPhone: '4165551111',
                clientName: 'Ava',
                type: 'google_review',
                points: 0,
                discountType: 'fixed_amount',
                discountAmountCents: 1500,
                discountPercent: null,
                eligibleServiceName: null,
                status: 'active',
                expiresAt: null,
                usedAt: null,
                usedInAppointmentId: null,
                createdAt: new Date('2026-03-30T00:00:00.000Z'),
                updatedAt: new Date('2026-03-30T00:00:00.000Z'),
                referralId: null,
              }]),
            })),
          })),
        })),
      })),
    });

    const response = await GET(new Request('http://localhost/api/admin/rewards?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.rewards).toHaveLength(1);
    expect(body.data.rewards[0]).toEqual(expect.objectContaining({
      id: 'reward_1',
      displayTitle: '$15 Off Any Appointment',
      valueLabel: '$15 off',
    }));
  });
});
