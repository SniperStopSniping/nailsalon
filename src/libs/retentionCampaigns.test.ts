import { describe, expect, it } from 'vitest';

import type { RetentionPromotionSettings } from '@/types/retention';

import {
  calculateRetentionDiscount,
  createRetentionCampaignToken,
  hashRetentionCampaignToken,
  validateRetentionCampaign,
} from './retentionCampaigns';

const promotion: RetentionPromotionSettings = {
  enabled: true,
  name: 'Welcome back',
  discountType: 'percent',
  value: 20,
  eligibleServiceIds: ['service_1'],
  expiryDays: 14,
  code: null,
  messageTemplate: 'Book here: {bookingLink}',
  singleUse: true,
};

describe('retention campaign security and eligibility', () => {
  it('generates high-entropy opaque tokens and stable non-reversible hashes', () => {
    const first = createRetentionCampaignToken();
    const second = createRetentionCampaignToken();

    expect(first).toMatch(/^[\w-]{40,}$/);
    expect(first).not.toBe(second);
    expect(hashRetentionCampaignToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRetentionCampaignToken(first)).not.toBe(first);
    expect(hashRetentionCampaignToken(first)).toBe(hashRetentionCampaignToken(first));
  });

  it('rejects expired, redeemed, wrong-client, and ineligible-service uses', () => {
    const base = {
      promotion,
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      redeemedAt: null,
      singleUse: true,
      campaignClientId: 'client_1',
      bookingClientId: 'client_1',
      serviceIds: ['service_1'],
      now: new Date('2026-07-17T00:00:00.000Z'),
    };

    expect(validateRetentionCampaign(base)).toEqual({ valid: true });
    expect(validateRetentionCampaign({ ...base, expiresAt: base.now })).toEqual({
      valid: false,
      code: 'CAMPAIGN_EXPIRED',
    });
    expect(validateRetentionCampaign({ ...base, redeemedAt: base.now })).toEqual({
      valid: false,
      code: 'CAMPAIGN_REDEEMED',
    });
    expect(validateRetentionCampaign({ ...base, bookingClientId: 'client_2' })).toEqual({
      valid: false,
      code: 'CLIENT_MISMATCH',
    });
    expect(validateRetentionCampaign({ ...base, serviceIds: ['service_2'] })).toEqual({
      valid: false,
      code: 'NO_ELIGIBLE_SERVICE',
    });
  });

  it('calculates percentage and fixed discounts only against eligible services', () => {
    expect(calculateRetentionDiscount({
      promotion,
      services: [
        { id: 'service_1', priceCents: 6500 },
        { id: 'service_2', priceCents: 3500 },
      ],
    })).toEqual({ eligibleSubtotalCents: 6500, discountAmountCents: 1300 });

    expect(calculateRetentionDiscount({
      promotion: { ...promotion, discountType: 'fixed', value: 8000 },
      services: [{ id: 'service_1', priceCents: 6500 }],
    })).toEqual({ eligibleSubtotalCents: 6500, discountAmountCents: 6500 });
  });
});
