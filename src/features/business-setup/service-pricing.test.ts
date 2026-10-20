import { describe, expect, it } from 'vitest';

import { hydrateSetupServicePricing, setupServicePriceLabel, updateSetupServicePricing } from './service-pricing';

describe('owner-reviewed service price wording', () => {
  it.each(['From $65', 'From $65.00', 'Starting at CAD 65', 'Dès 65 CAD', '$65'])('updates a simple saved amount in %s', (priceDisplayText) => {
    const result = updateSetupServicePricing({ priceCents: 6500, priceDisplayText }, { priceCents: 7500 }, 'CAD');

    expect(result.priceDisplayText).toContain('$75.00');
    expect(result.priceLabelNeedsReview).not.toBe(true);
  });

  it('preserves wording when only the name or appointment length changes', () => {
    expect(updateSetupServicePricing({ priceCents: 6500, priceDisplayText: 'From $65' }, { priceCents: 6500 }, 'CAD')).toEqual({ priceDisplayText: 'From $65' });
  });

  it('flags a newly supplied simple amount that disagrees with the booking price', () => {
    expect(updateSetupServicePricing(undefined, { priceCents: 7500, priceDisplayText: 'From $65.00' }, 'CAD')).toEqual({ priceDisplayText: 'From $65.00', priceLabelNeedsReview: true });
    expect(updateSetupServicePricing(undefined, { priceCents: 6500, priceDisplayText: 'From USD 65' }, 'CAD').priceLabelNeedsReview).toBe(true);
  });

  it('clears a simple mismatch when the owner corrects the booking price to match its wording', () => {
    expect(updateSetupServicePricing({ priceCents: 7500, priceDisplayText: 'From $65.00', priceLabelNeedsReview: true }, { priceCents: 6500 }, 'CAD')).toEqual({ priceDisplayText: 'From $65.00' });
  });

  it.each(['$65–$85', 'From USD 65', '$65 plus $10 removal'])('requires review of ambiguous or other-currency wording: %s', (priceDisplayText) => {
    const price = updateSetupServicePricing({ priceCents: 6500, priceDisplayText }, { priceCents: 7500 }, 'CAD');

    expect(price).toEqual({ priceDisplayText, priceLabelNeedsReview: true });
    expect(setupServicePriceLabel({ ...price, priceCents: 7500 }, 'CAD')).toBe('Price wording needs review');
  });

  it('cannot clear a review warning by resubmitting unchanged wording', () => {
    const price = { priceCents: 7500, priceDisplayText: '$65–$85', priceLabelNeedsReview: true };

    expect(updateSetupServicePricing(price, price, 'CAD').priceLabelNeedsReview).toBe(true);
    expect(updateSetupServicePricing(price, { priceCents: 7500, priceDisplayText: null }, 'CAD')).toEqual({ priceDisplayText: null });
    expect(updateSetupServicePricing(price, { priceCents: 7500, priceDisplayText: 'From $75.00' }, 'CAD')).toEqual({ priceDisplayText: 'From $75.00' });
  });

  it('hydrates old changed-price revisions without mutating stored input or reviving an old amount', () => {
    const saved = { booking: { currency: 'CAD' }, services: [{ id: 'gel', priceCents: 7500 }] };
    const baseline = { booking: { currency: 'CAD' }, services: [{ id: 'gel', priceCents: 6500, priceDisplayText: 'From $65' }] };
    const result = hydrateSetupServicePricing(saved, baseline);

    expect(result.services[0]).toMatchObject({ priceCents: 7500, priceDisplayText: 'From $75.00' });
    expect(result.servicePricingVersion).toBe(1);
    expect(saved).toEqual({ booking: { currency: 'CAD' }, services: [{ id: 'gel', priceCents: 7500 }] });
  });

  it('uses canonical integer cents when there is no custom wording', () => {
    expect(setupServicePriceLabel({ priceCents: 6550 }, 'CAD')).toBe('$65.50');
    expect(setupServicePriceLabel({ priceCents: null }, 'CAD')).toBe('Price needed');
  });
});
