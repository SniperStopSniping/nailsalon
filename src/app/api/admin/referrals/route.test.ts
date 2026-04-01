import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon, db } = vi.hoisted(() => {
  return {
    requireAdminSalon: vi.fn(),
    db: { select: vi.fn() },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/admin/referrals', () => {
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

    const response = await GET(new Request('http://localhost/api/admin/referrals?salonSlug=salon-a'));
    expect(response.status).toBe(401);
  });

  it('returns referral history for the salon', async () => {
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
                id: 'ref_1',
                salonId: 'salon_1',
                referrerPhone: '4165551111',
                referrerName: 'Ava',
                refereePhone: '4165552222',
                refereeName: 'Bea',
                status: 'claimed',
                claimedAt: null,
                expiresAt: null,
                createdAt: new Date('2026-03-30T00:00:00.000Z'),
                updatedAt: new Date('2026-03-30T00:00:00.000Z'),
              }]),
            })),
          })),
        })),
      })),
    });

    const response = await GET(new Request('http://localhost/api/admin/referrals?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.referrals).toHaveLength(1);
    expect(body.data.referrals[0]).toEqual(expect.objectContaining({
      id: 'ref_1',
      status: 'claimed',
      referrerName: 'Ava',
      refereeName: 'Bea',
    }));
  });
});
