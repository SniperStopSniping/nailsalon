import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  guardModuleOr403,
  insertValues,
  db,
} = vi.hoisted(() => {
  const insertValues = vi.fn(async () => undefined);

  return {
    requireAdminSalon: vi.fn(),
    guardModuleOr403: vi.fn(),
    insertValues,
    db: {
      select: vi.fn(),
      insert: vi.fn(() => ({
        values: insertValues,
      })),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { POST } from './route';

describe('POST /api/admin/reviews/[reviewId]/reward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardModuleOr403.mockResolvedValue(null);
  });

  it('grants a one-time $15 Google review reward', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: 'salon_1',
        rewardsEnabled: true,
        reviewsEnabled: true,
      },
    });

    db.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [{
                id: 'review_1',
                salonId: 'salon_1',
                salonClientId: 'sc_1',
                clientNameSnapshot: 'Ava',
                clientPhone: '4165551111',
                clientName: 'Ava',
              }]),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      });

    const response = await POST(
      new Request('http://localhost/api/admin/reviews/review_1/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a' }),
      }),
      { params: Promise.resolve({ reviewId: 'review_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      clientPhone: '4165551111',
      type: 'google_review',
      discountType: 'fixed_amount',
      discountAmountCents: 1500,
      points: 0,
    }));
    expect(body.data.reward.valueLabel).toBe('$15 off');
  });

  it('rejects duplicate review rewards for the same client and salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: 'salon_1',
        rewardsEnabled: true,
        reviewsEnabled: true,
      },
    });

    db.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [{
                id: 'review_1',
                salonId: 'salon_1',
                salonClientId: 'sc_1',
                clientNameSnapshot: 'Ava',
                clientPhone: '4165551111',
                clientName: 'Ava',
              }]),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ id: 'reward_1' }]),
          })),
        })),
      });

    const response = await POST(
      new Request('http://localhost/api/admin/reviews/review_1/reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a' }),
      }),
      { params: Promise.resolve({ reviewId: 'review_1' }) },
    );

    expect(response.status).toBe(409);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
