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

  it('resolves a configured id for the current env only, using resolveStripeIdFromTable directly (G31 — will not break when real IDs land)', () => {
    // A fake table shaped exactly like OFFER_PRICE_IDS/TOPUP_PRICE_IDS but
    // with a real-looking configured id (>= 8 alnum chars after the
    // `price_`/`coupon_`/`promo_` prefix) for ONE environment at a time.
    const table = {
      pro_2026_08_monthly: { dev: 'price_dev12345678', test: null, prod: null },
      topup_100_paid_2026_08: { dev: null, test: 'price_test87654321', prod: null },
      founding_annual_2026: { dev: null, test: null, prod: 'coupon_prodABCDEFGH' },
    };

    expect(resolveStripeIdFromTable(table, 'dev', 'pro_2026_08_monthly')).toBe('price_dev12345678');
    expect(resolveStripeIdFromTable(table, 'test', 'topup_100_paid_2026_08')).toBe('price_test87654321');
    expect(resolveStripeIdFromTable(table, 'prod', 'founding_annual_2026')).toBe('coupon_prodABCDEFGH');

    // Cross-env invisibility holds for every configured row, not just the
    // single-key fixture in the neighbouring test.
    expect(() => resolveStripeIdFromTable(table, 'test', 'pro_2026_08_monthly')).toThrow(/PRICE_UNCONFIGURED/);
    expect(() => resolveStripeIdFromTable(table, 'prod', 'pro_2026_08_monthly')).toThrow(/PRICE_UNCONFIGURED/);
    expect(() => resolveStripeIdFromTable(table, 'dev', 'topup_100_paid_2026_08')).toThrow(/PRICE_UNCONFIGURED/);
    expect(() => resolveStripeIdFromTable(table, 'prod', 'topup_100_paid_2026_08')).toThrow(/PRICE_UNCONFIGURED/);
    expect(() => resolveStripeIdFromTable(table, 'dev', 'founding_annual_2026')).toThrow(/PRICE_UNCONFIGURED/);
    expect(() => resolveStripeIdFromTable(table, 'test', 'founding_annual_2026')).toThrow(/PRICE_UNCONFIGURED/);
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
