import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  BillingCatalogError,
  resolveBillingOfferFromStripePriceId,
  resolveStripeCouponIdForPromotion,
  resolveStripeIdFromTable,
  resolveStripePriceIdForOffer,
  resolveStripePriceIdForTopup,
  resolveTopupOfferFromStripePriceId,
} = await import('./stripePriceMap');
const { BILLING_OFFERS } = await import('./billingOffers');
const { TOPUP_OFFERS } = await import('./topupOffers');
const { PROMOTIONS } = await import('./promotions');

describe('stripePriceMap', () => {
  it('throws PRICE_UNCONFIGURED for every catalogue key while identifiers are placeholders', () => {
    for (const key of Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>) {
      expect(() => resolveStripePriceIdForOffer(key)).toThrow(BillingCatalogError);
      expect(() => resolveStripePriceIdForOffer(key)).toThrow(/PRICE_UNCONFIGURED/);
    }
    for (const key of Object.keys(TOPUP_OFFERS) as Array<keyof typeof TOPUP_OFFERS>) {
      expect(() => resolveStripePriceIdForTopup(key)).toThrow(/PRICE_UNCONFIGURED/);
    }
    for (const key of Object.keys(PROMOTIONS) as Array<keyof typeof PROMOTIONS>) {
      expect(() => resolveStripeCouponIdForPromotion(key)).toThrow(/PRICE_UNCONFIGURED/);
    }
  });

  it('cannot observe another environment column — a prod-only value is invisible to dev/test', () => {
    const table = {
      starter_2026_08_annual: { dev: null, test: null, prod: 'price_live1234567890' },
    };

    expect(() => resolveStripeIdFromTable(table, 'dev', 'starter_2026_08_annual')).toThrow(/PRICE_UNCONFIGURED/);
    expect(() => resolveStripeIdFromTable(table, 'test', 'starter_2026_08_annual')).toThrow(/PRICE_UNCONFIGURED/);
    expect(resolveStripeIdFromTable(table, 'prod', 'starter_2026_08_annual')).toBe('price_live1234567890');
  });

  it('treats boilerplate placeholders, empty strings and malformed values as unconfigured', () => {
    for (const bad of ['price_123', '', '   ', 'PLACEHOLDER', 'not_a_stripe_price_id']) {
      const table = { some_key: { dev: bad, test: null, prod: null } };

      expect(() => resolveStripeIdFromTable(table, 'dev', 'some_key')).toThrow(/PRICE_UNCONFIGURED/);
    }
  });

  it('rejects unknown catalogue keys explicitly', () => {
    expect(() => resolveStripeIdFromTable({}, 'dev', 'nope')).toThrow(/UNKNOWN_CATALOG_KEY/);
  });

  it('reverse lookups return null over placeholder tables — never a guessed key', () => {
    expect(resolveBillingOfferFromStripePriceId('price_abcdefgh12345678')).toBeNull();
    expect(resolveTopupOfferFromStripePriceId('price_abcdefgh12345678')).toBeNull();
  });
});
