import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { getSalonBySlug, selectRows, db, checkEndpointRateLimit, nextVisitOffer } = vi.hoisted(() => {
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
    checkEndpointRateLimit: vi.fn(),
    nextVisitOffer: vi.fn(),
  };
});

vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/nextVisitOffer.server', () => ({ resolveNextVisitOfferPreview: nextVisitOffer }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit,
  getClientIp: () => '203.0.113.7',
  rateLimitResponse: (retryAfterMs: number) => Response.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
  ),
}));

const token = 'A'.repeat(43);

describe('GET /api/public/retention-campaigns/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a' });
    checkEndpointRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    nextVisitOffer.mockResolvedValue(null);
  });

  it('rate-limits by IP before doing any database work', async () => {
    checkEndpointRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 30_000 });

    const response = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(429);
    expect(getSalonBySlug).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(checkEndpointRateLimit).toHaveBeenCalledWith('public/retention-campaigns', '203.0.113.7', 'REFERRAL');
  });

  it('binds token lookup to the requested salon tenant', async () => {
    selectRows.push([]);

    const response = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(404);
  });

  it('accepts the plain params object supplied by the production Next runtime', async () => {
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

  it('discovers an available next-visit offer without exposing its client, source visit, or entitlement internals', async () => {
    selectRows.push([{
      id: 'campaign_next_visit',
      salonId: 'salon_1',
      salonClientId: 'secret_client_id',
      tokenHash: 'secret_hash',
      stage: 'next_visit',
      expiresAt: new Date(Date.now() + 86_400_000),
      promotionSnapshot: { enabled: true },
    }]);
    nextVisitOffer.mockResolvedValue({
      status: 'ineligible',
      reason: 'NO_ELIGIBLE_SERVICE',
      deadlineDate: '2031-03-31',
      label: 'Next Visit Offer',
      promotion: { discountType: 'percent', value: 5, eligibleServiceIds: ['service_1'] },
    });

    const response = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.campaign).toMatchObject({
      stage: 'next_visit',
      deadlineDate: '2031-03-31',
      displayOffer: '5% off',
      promotion: { name: 'Next Visit Offer', eligibleServiceIds: ['service_1'], code: null },
    });
    expect(nextVisitOffer).toHaveBeenCalledWith({ salonId: 'salon_1', token, services: [] });
    expect(JSON.stringify(body)).not.toContain('secret_client_id');
    expect(JSON.stringify(body)).not.toContain('secret_hash');
  });

  it.each([
    ['ALREADY_USED', 409, 'CAMPAIGN_REDEEMED'],
    ['EXPIRED', 410, 'CAMPAIGN_EXPIRED'],
    ['SOURCE_INVALID', 410, 'CAMPAIGN_EXPIRED'],
  ])('maps next-visit %s to a safe public availability response', async (reason, status, code) => {
    selectRows.push([{
      id: 'campaign_next_visit',
      salonId: 'salon_1',
      stage: 'next_visit',
      expiresAt: new Date(Date.now() + 86_400_000),
      promotionSnapshot: { enabled: true },
    }]);
    nextVisitOffer.mockResolvedValue({ status: 'ineligible', reason, deadlineDate: '2031-03-31' });

    const response = await GET(
      new Request(`http://localhost/api/public/retention-campaigns/${token}?salonSlug=salon-a`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });
});
