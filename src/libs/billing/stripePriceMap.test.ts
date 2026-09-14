import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test' as 'dev' | 'test' | 'prod',
  BILLING_STRIPE_PRICE_IDS: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

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

// =============================================================================
// P6b (D19a) — resolution order now consults the env-keyed carrier
// (stripePriceCarrier.ts) FIRST, falling back to the committed (all-null)
// placeholder tables above. getStripePriceCarrier() is memoised per module
// instance, so each scenario below resets the module registry and imports a
// fresh instance after configuring the mocked Env.
// =============================================================================

describe('stripePriceMap — env carrier resolution order (P6b, D19a)', () => {
  beforeEach(() => {
    vi.resetModules();
    envHolder.BILLING_PLAN_ENV = 'test';
    envHolder.BILLING_STRIPE_PRICE_IDS = undefined;
  });

  it('a carrier entry for one offer resolves that offer; every other offer still throws PRICE_UNCONFIGURED', async () => {
    const offerKeys = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;
    const configuredKey = offerKeys[0]!;
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'test',
      offers: { [configuredKey]: 'price_carrier12345678' },
    });
    const mod = await import('./stripePriceMap');

    expect(mod.resolveStripePriceIdForOffer(configuredKey)).toBe('price_carrier12345678');

    for (const key of offerKeys) {
      if (key === configuredKey) {
        continue;
      }

      expect(() => mod.resolveStripePriceIdForOffer(key)).toThrow(/PRICE_UNCONFIGURED/);
    }
  });

  it('carrier entries for a top-up and a coupon resolve independently of the offers map', async () => {
    const topupKey = (Object.keys(TOPUP_OFFERS) as Array<keyof typeof TOPUP_OFFERS>)[0]!;
    const promotionKey = (Object.keys(PROMOTIONS) as Array<keyof typeof PROMOTIONS>)[0]!;
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'test',
      topups: { [topupKey]: 'price_topupcarrier1234' },
      coupons: { [promotionKey]: 'coupon_carrier12345678' },
    });
    const mod = await import('./stripePriceMap');

    expect(mod.resolveStripePriceIdForTopup(topupKey)).toBe('price_topupcarrier1234');
    expect(mod.resolveStripeCouponIdForPromotion(promotionKey)).toBe('coupon_carrier12345678');
  });

  it('a carrier whose env does not equal BILLING_PLAN_ENV is ignored entirely — every key still throws', async () => {
    const offerKeys = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;
    envHolder.BILLING_PLAN_ENV = 'test';
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'prod',
      offers: { [offerKeys[0]!]: 'price_carrier12345678' },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('./stripePriceMap');

    for (const key of offerKeys) {
      expect(() => mod.resolveStripePriceIdForOffer(key)).toThrow(/PRICE_UNCONFIGURED/);
    }
    warnSpy.mockRestore();
  });

  it('reverse lookup finds a carrier-configured offer id ahead of the (all-null) committed table', async () => {
    const offerKeys = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;
    const configuredKey = offerKeys[0]!;
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'test',
      offers: { [configuredKey]: 'price_carrier12345678' },
    });
    const mod = await import('./stripePriceMap');

    expect(mod.resolveBillingOfferFromStripePriceId('price_carrier12345678')).toBe(configuredKey);
    expect(mod.resolveBillingOfferFromStripePriceId('price_unknown12345678')).toBeNull();
  });

  it('reverse lookup finds a carrier-configured top-up id', async () => {
    const configuredKey = (Object.keys(TOPUP_OFFERS) as Array<keyof typeof TOPUP_OFFERS>)[0]!;
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'test',
      topups: { [configuredKey]: 'price_topupcarrier1234' },
    });
    const mod = await import('./stripePriceMap');

    expect(mod.resolveTopupOfferFromStripePriceId('price_topupcarrier1234')).toBe(configuredKey);
  });

  it('a malformed carrier is ignored (fails closed): resolution falls back to the placeholder table and warns at most once', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = '{not valid json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('./stripePriceMap');
    const offerKeys = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;

    for (const key of offerKeys) {
      expect(() => mod.resolveStripePriceIdForOffer(key)).toThrow(/PRICE_UNCONFIGURED/);
    }

    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('unknown catalogue keys still throw UNKNOWN_CATALOG_KEY even with a carrier configured', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({ env: 'test' });
    const mod = await import('./stripePriceMap');

    expect(() => mod.resolveStripeIdFromTable({}, 'test', 'nope')).toThrow(/UNKNOWN_CATALOG_KEY/);
  });
});
