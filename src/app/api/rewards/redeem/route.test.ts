import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireClientApiSession,
  requireClientSalonFromBody,
  db,
} = vi.hoisted(() => ({
  requireClientApiSession: vi.fn(),
  requireClientSalonFromBody: vi.fn(),
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { POST } from './route';

function makeLimitSelect(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => result),
      })),
    })),
  };
}

describe('POST /api/rewards/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects reward redemption when the appointment already has a first-visit discount', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: {
        phone: '+14165551234',
      },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
    });

    db.select
      .mockReturnValueOnce(makeLimitSelect([{
        id: 'reward_1',
        salonId: 'salon_1',
        clientPhone: '4165551234',
        status: 'active',
        expiresAt: null,
      }]))
      .mockReturnValueOnce(makeLimitSelect([{
        id: 'appt_1',
        salonId: 'salon_1',
        clientPhone: '+14165551234',
        status: 'pending',
        totalPrice: 5000,
        discountType: 'first_visit_25',
      }]));

    const response = await POST(new Request('http://localhost/api/rewards/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardId: 'reward_1',
        appointmentId: 'appt_1',
        salonSlug: 'salon-a',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('FIRST_VISIT_DISCOUNT_ALREADY_APPLIED');
  });
});
