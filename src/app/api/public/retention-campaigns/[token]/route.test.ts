import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { getSalonBySlug, selectRows, db } = vi.hoisted(() => {
  const selectRows: unknown[] = [];
  const query = (result: unknown) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => result),
    };
    return chain;
  };
  return {
    getSalonBySlug: vi.fn(),
    selectRows,
    db: { select: vi.fn(() => query(selectRows.shift() ?? [])) },
  };
});

vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/DB', () => ({ db }));

const token = 'A'.repeat(43);

describe('GET /api/public/retention-campaigns/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a' });
  });

  it('binds token lookup to the requested salon tenant', async () => {
    selectRows.push([]);

    const response = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(404);
  });

  it('returns a client-safe offer without exposing the client id or token hash', async () => {
    selectRows.push([{
      id: 'campaign_1',
      salonId: 'salon_1',
      salonClientId: 'secret_client_id',
      tokenHash: 'secret_hash',
      stage: 'promo_6w',
      promotionSnapshot: {
        enabled: true,
        name: 'Welcome back',
        discountType: 'percent',
        value: 15,
        eligibleServiceIds: ['service_1'],
        expiryDays: 14,
        code: 'BACK15',
        messageTemplate: '{bookingLink}',
        singleUse: true,
      },
      expiresAt: new Date(Date.now() + 86_400_000),
      singleUse: true,
      redeemedAt: null,
    }]);

    const response = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.campaign).toMatchObject({
      id: 'campaign_1',
      stage: 'promo_6w',
      salonSlug: 'salon-a',
      displayOffer: '15% off',
    });
    expect(JSON.stringify(body)).not.toContain('secret_client_id');
    expect(JSON.stringify(body)).not.toContain('secret_hash');
  });

  it('returns gone for expired campaigns and conflict for redeemed single-use campaigns', async () => {
    const base = {
      id: 'campaign_1',
      promotionSnapshot: {
        enabled: true,
        name: 'Welcome back',
        discountType: 'fixed' as const,
        value: 1000,
        eligibleServiceIds: [],
        expiryDays: 14,
        code: null,
        messageTemplate: '{bookingLink}',
        singleUse: true,
      },
      stage: 'promo_8w',
      expiresAt: new Date(Date.now() - 1),
      singleUse: true,
      redeemedAt: null,
    };
    selectRows.push([base]);
    const expired = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );

    expect(expired.status).toBe(410);

    selectRows.push([{ ...base, expiresAt: new Date(Date.now() + 86_400_000), redeemedAt: new Date() }]);
    const redeemed = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );

    expect(redeemed.status).toBe(409);
  });
});
