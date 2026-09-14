import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test' as 'dev' | 'test' | 'prod',
  BILLING_STRIPE_PRICE_IDS: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const { isConfiguredStripeId, parseStripePriceCarrier } = await import('./stripePriceCarrier');
const { BILLING_OFFERS } = await import('./billingOffers');
const { TOPUP_OFFERS } = await import('./topupOffers');
const { PROMOTIONS } = await import('./promotions');

const OFFER_KEYS = Object.keys(BILLING_OFFERS);
const TOPUP_KEYS = Object.keys(TOPUP_OFFERS);
const COUPON_KEYS = Object.keys(PROMOTIONS);
const offerKey = OFFER_KEYS[0]!;
const topupKey = TOPUP_KEYS[0]!;
const couponKey = COUPON_KEYS[0]!;

describe('isConfiguredStripeId', () => {
  it('accepts price_/coupon_/promo_ prefixed ids with >= 8 trailing alnum characters', () => {
    expect(isConfiguredStripeId('price_abcd1234')).toBe(true);
    expect(isConfiguredStripeId('coupon_ABCD1234xyz')).toBe(true);
    expect(isConfiguredStripeId('promo_12345678')).toBe(true);
  });

  it('rejects null, undefined, placeholders, empty/whitespace and malformed values', () => {
    expect(isConfiguredStripeId(null)).toBe(false);
    expect(isConfiguredStripeId(undefined)).toBe(false);

    for (const bad of ['price_123', '', '   ', 'PLACEHOLDER', 'not_a_stripe_price_id']) {
      expect(isConfiguredStripeId(bad)).toBe(false);
    }
  });
});

describe('parseStripePriceCarrier', () => {
  it('absent or blank raw is success with a null carrier (the carrier is entirely optional)', () => {
    expect(parseStripePriceCarrier(undefined, 'test')).toEqual({ ok: true, carrier: null });
    expect(parseStripePriceCarrier('', 'test')).toEqual({ ok: true, carrier: null });
    expect(parseStripePriceCarrier('   ', 'test')).toEqual({ ok: true, carrier: null });
  });

  it('resolves a well-formed carrier scoped to the matching env, with every configured id', () => {
    const raw = JSON.stringify({
      env: 'test',
      offers: { [offerKey]: 'price_test12345678' },
      topups: { [topupKey]: 'price_test87654321' },
      coupons: { [couponKey]: 'coupon_test1234abcd' },
    });

    expect(parseStripePriceCarrier(raw, 'test')).toEqual({
      ok: true,
      carrier: {
        env: 'test',
        offers: { [offerKey]: 'price_test12345678' },
        topups: { [topupKey]: 'price_test87654321' },
        coupons: { [couponKey]: 'coupon_test1234abcd' },
      },
    });
  });

  it('defaults absent offers/topups/coupons maps to {}', () => {
    expect(parseStripePriceCarrier(JSON.stringify({ env: 'dev' }), 'dev')).toEqual({
      ok: true,
      carrier: { env: 'dev', offers: {}, topups: {}, coupons: {} },
    });
  });

  it('MALFORMED — invalid JSON', () => {
    expect(parseStripePriceCarrier('{not valid json', 'test')).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('MALFORMED — valid JSON that does not fit the schema', () => {
    expect(parseStripePriceCarrier(JSON.stringify(['array', 'not', 'object']), 'test')).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
    expect(parseStripePriceCarrier(JSON.stringify({ env: 'not-a-real-env' }), 'test')).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
    expect(parseStripePriceCarrier(
      JSON.stringify({ env: 'test', offers: 'not-an-object' }),
      'test',
    )).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('ENV_MISMATCH — env does not equal the expected runtime billing env', () => {
    expect(parseStripePriceCarrier(JSON.stringify({ env: 'prod' }), 'test')).toEqual({
      ok: false,
      reason: 'ENV_MISMATCH',
    });
  });

  it('UNKNOWN_KEY — a key absent from the committed catalogue', () => {
    expect(parseStripePriceCarrier(
      JSON.stringify({
        env: 'test',
        offers: { totally_bogus_offer_key_not_in_catalogue: 'price_abcd12345678' },
      }),
      'test',
    )).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });

    expect(parseStripePriceCarrier(
      JSON.stringify({
        env: 'test',
        topups: { totally_bogus_topup_key: 'price_abcd12345678' },
      }),
      'test',
    )).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });

    expect(parseStripePriceCarrier(
      JSON.stringify({
        env: 'test',
        coupons: { totally_bogus_promotion_key: 'coupon_abcd12345678' },
      }),
      'test',
    )).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
  });

  it('INVALID_ID — a value that does not satisfy isConfiguredStripeId', () => {
    for (const bad of ['price_123', '', '   ', 'PLACEHOLDER', 'not_a_stripe_price_id']) {
      expect(parseStripePriceCarrier(
        JSON.stringify({ env: 'test', offers: { [offerKey]: bad } }),
        'test',
      )).toEqual({ ok: false, reason: 'INVALID_ID' });
    }
  });

  it('DUPLICATE_ID — the same id reused across two different maps', () => {
    expect(parseStripePriceCarrier(
      JSON.stringify({
        env: 'test',
        offers: { [offerKey]: 'price_shared12345678' },
        topups: { [topupKey]: 'price_shared12345678' },
      }),
      'test',
    )).toEqual({ ok: false, reason: 'DUPLICATE_ID' });
  });

  it('DUPLICATE_ID — the same id reused across two keys in the same map', () => {
    expect(OFFER_KEYS.length).toBeGreaterThan(1);
    expect(parseStripePriceCarrier(
      JSON.stringify({
        env: 'test',
        offers: {
          [OFFER_KEYS[0]!]: 'price_shared12345678',
          [OFFER_KEYS[1]!]: 'price_shared12345678',
        },
      }),
      'test',
    )).toEqual({ ok: false, reason: 'DUPLICATE_ID' });
  });
});

describe('getStripePriceCarrier', () => {
  beforeEach(() => {
    vi.resetModules();
    envHolder.BILLING_PLAN_ENV = 'test';
    envHolder.BILLING_STRIPE_PRICE_IDS = undefined;
  });

  it('returns null when BILLING_STRIPE_PRICE_IDS is unset', async () => {
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');

    expect(getStripePriceCarrier()).toBeNull();
  });

  it('returns the parsed carrier when well-formed and env-matched', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'test',
      offers: { [offerKey]: 'price_test12345678' },
    });
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');

    expect(getStripePriceCarrier()).toEqual({
      env: 'test',
      offers: { [offerKey]: 'price_test12345678' },
      topups: {},
      coupons: {},
    });
  });

  it('fails closed (null), never partial, on a malformed carrier', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = '{not valid json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');

    expect(getStripePriceCarrier()).toBeNull();

    warnSpy.mockRestore();
  });

  it('fails closed (null) on an env mismatch', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({ env: 'prod' });
    envHolder.BILLING_PLAN_ENV = 'test';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');

    expect(getStripePriceCarrier()).toBeNull();

    warnSpy.mockRestore();
  });

  it('is memoised — a later env mutation is not observed after the first read', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = JSON.stringify({
      env: 'test',
      offers: { [offerKey]: 'price_test12345678' },
    });
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');
    const first = getStripePriceCarrier();

    envHolder.BILLING_STRIPE_PRICE_IDS = undefined;
    const second = getStripePriceCarrier();

    expect(second).toBe(first);
  });

  it('logs at most one console.warn per process on rejection, and never the raw value', async () => {
    envHolder.BILLING_STRIPE_PRICE_IDS = '{not valid json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');

    getStripePriceCarrier();
    getStripePriceCarrier();
    getStripePriceCarrier();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('{not valid json');

    warnSpy.mockRestore();
  });

  it('never warns when the carrier is simply absent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getStripePriceCarrier } = await import('./stripePriceCarrier');

    getStripePriceCarrier();

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
