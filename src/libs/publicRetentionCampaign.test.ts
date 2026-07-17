import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePublicRetentionCampaignPreview } from './publicRetentionCampaign';

const { db } = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db }));

const token = 'campaign_token_123456789012345678901234';
const campaign = {
  id: 'campaign_1',
  salonId: 'salon_1',
  salonClientId: 'client_1',
  stage: 'promo_6w',
  promotionSnapshot: {
    enabled: true,
    name: 'Welcome back',
    discountType: 'percent' as const,
    value: 20,
    eligibleServiceIds: ['service_1'],
    expiryDays: 14,
    code: 'BACK20',
    messageTemplate: '{bookingLink}',
    singleUse: true,
  },
  expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  singleUse: true,
  redeemedAt: null,
};

function mockCampaignRows(rows: unknown[]) {
  db.select.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => rows),
      })),
    })),
  });
}

describe('resolvePublicRetentionCampaignPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query campaign storage when no link token is present', async () => {
    await expect(resolvePublicRetentionCampaignPreview({
      salonId: 'salon_1',
      services: [{ id: 'service_1', priceCents: 6500 }],
    })).resolves.toEqual({ status: 'none', preview: null, message: null });

    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns a tenant-scoped, service-eligible discount preview', async () => {
    mockCampaignRows([campaign]);

    await expect(resolvePublicRetentionCampaignPreview({
      token,
      salonId: 'salon_1',
      services: [
        { id: 'service_1', priceCents: 6500 },
        { id: 'service_2', priceCents: 3500 },
      ],
      now: new Date('2026-07-17T00:00:00.000Z'),
    })).resolves.toEqual({
      status: 'valid',
      preview: {
        id: 'campaign_1',
        stage: 'promo_6w',
        name: 'Welcome back',
        displayOffer: '20% off',
        code: 'BACK20',
        expiresAt: '2026-08-01T00:00:00.000Z',
        discountAmountCents: 1300,
      },
      message: null,
    });
  });

  it('does not expose an offer when the token is absent from the selected salon', async () => {
    mockCampaignRows([]);

    await expect(resolvePublicRetentionCampaignPreview({
      token,
      salonId: 'salon_other',
      services: [{ id: 'service_1', priceCents: 6500 }],
    })).resolves.toEqual({
      status: 'invalid',
      preview: null,
      message: 'This promotion link was not found for this salon.',
    });
  });

  it('rejects a redeemed single-use campaign before showing discounted pricing', async () => {
    mockCampaignRows([{ ...campaign, redeemedAt: new Date('2026-07-16T00:00:00.000Z') }]);

    await expect(resolvePublicRetentionCampaignPreview({
      token,
      salonId: 'salon_1',
      services: [{ id: 'service_1', priceCents: 6500 }],
      now: new Date('2026-07-17T00:00:00.000Z'),
    })).resolves.toEqual({
      status: 'invalid',
      preview: null,
      message: 'This promotion has already been used.',
    });
  });
});
