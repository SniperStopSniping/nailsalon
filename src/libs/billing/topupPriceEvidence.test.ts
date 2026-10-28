import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const env = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test' as 'dev' | 'test' | 'prod',
  BILLING_STRIPE_PRICE_IDS: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: env }));

const { classifyTopupPriceEvidence } = await import('./stripePriceMap');
const { TOPUP_OFFERS } = await import('./topupOffers');

const currentOffer = 'topup_100_2026_10';
const otherOffer = 'topup_200_2026_10';
const historicalOffer = 'topup_100_paid_2026_08';
const currentPrice = 'price_synthetic100fixture';
const otherPrice = 'price_synthetic200fixture';
const unknownPrice = 'price_syntheticunknownfixture';

function configure(topups: Record<string, string>, planEnv = 'test') {
  env.BILLING_STRIPE_PRICE_IDS = JSON.stringify({ env: planEnv, offers: {}, topups, coupons: {} });
}

beforeEach(() => {
  env.BILLING_PLAN_ENV = 'test';
  env.BILLING_STRIPE_PRICE_IDS = undefined;
});

describe('top-up price evidence against the actual environment carrier', () => {
  it('accepts the exact price configured for the persisted offer', () => {
    configure({ [currentOffer]: currentPrice, [otherOffer]: otherPrice });

    expect(classifyTopupPriceEvidence(currentOffer, currentPrice)).toBe('matched');
  });

  it.each([null, '', unknownPrice, otherPrice])('rejects nonmatching evidence %s when this offer is configured', (price) => {
    configure({ [currentOffer]: currentPrice, [otherOffer]: otherPrice });

    expect(classifyTopupPriceEvidence(currentOffer, price)).toBe('mismatch');
  });

  it.each(['{broken', 'null', '[]', JSON.stringify({ env: 'test', topups: { [currentOffer]: 'price_123' } }), JSON.stringify({ env: 'test', topups: { [currentOffer]: currentPrice, [otherOffer]: currentPrice } })])('rejects malformed or invalid configuration independently of incoming evidence: %s', (raw) => {
    env.BILLING_STRIPE_PRICE_IDS = raw;

    expect(classifyTopupPriceEvidence(currentOffer, currentPrice)).toBe('invalid_configuration');
    expect(classifyTopupPriceEvidence(currentOffer, null)).toBe('invalid_configuration');
  });

  it.each(['dev', 'prod'])('never accepts a %s carrier in the test environment', (planEnv) => {
    configure({ [currentOffer]: currentPrice }, planEnv);

    expect(classifyTopupPriceEvidence(currentOffer, currentPrice)).toBe('invalid_configuration');
  });

  it.each(['unknown_offer', '__proto__', 'constructor'])('rejects unknown catalogue key %s even without a carrier', (offer) => {
    expect(classifyTopupPriceEvidence(offer, null)).toBe('invalid_configuration');

    configure({ [currentOffer]: currentPrice });

    expect(classifyTopupPriceEvidence(offer, currentPrice)).toBe('invalid_configuration');
  });

  it.each([undefined, '', '   '])('preserves the explicit unconfigured result for absent carrier %s', (raw) => {
    env.BILLING_STRIPE_PRICE_IDS = raw;

    expect(classifyTopupPriceEvidence(currentOffer, null)).toBe('unconfigured');
    expect(classifyTopupPriceEvidence(currentOffer, unknownPrice)).toBe('unconfigured');
  });

  it('distinguishes an omitted offer from another offer known in a partial carrier', () => {
    configure({ [otherOffer]: otherPrice });

    expect(classifyTopupPriceEvidence(currentOffer, null)).toBe('unconfigured');
    expect(classifyTopupPriceEvidence(currentOffer, unknownPrice)).toBe('unconfigured');
    expect(classifyTopupPriceEvidence(currentOffer, otherPrice)).toBe('mismatch');
    expect(classifyTopupPriceEvidence(otherOffer, otherPrice)).toBe('matched');
  });

  it('treats a valid empty carrier as unconfigured rather than malformed', () => {
    configure({});

    expect(classifyTopupPriceEvidence(currentOffer, null)).toBe('unconfigured');
  });

  it('validates historical purchases against their own retained configured price', () => {
    expect(TOPUP_OFFERS[historicalOffer].active).toBe(false);

    const historicalPrice = 'price_synthetichistoricalfixture';
    configure({ [historicalOffer]: historicalPrice, [currentOffer]: currentPrice });

    expect(classifyTopupPriceEvidence(historicalOffer, historicalPrice)).toBe('matched');
    expect(classifyTopupPriceEvidence(historicalOffer, null)).toBe('mismatch');
    expect(classifyTopupPriceEvidence(historicalOffer, currentPrice)).toBe('mismatch');
  });

  it('retains unconfigured historical evidence without allowing a known current-offer price', () => {
    configure({ [currentOffer]: currentPrice });

    expect(classifyTopupPriceEvidence(historicalOffer, null)).toBe('unconfigured');
    expect(classifyTopupPriceEvidence(historicalOffer, currentPrice)).toBe('mismatch');
  });
});
