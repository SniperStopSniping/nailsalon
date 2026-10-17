import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { aiCreditPlanEnv, aiCreditPricingPolicy, aiCreditPurchasesEnabled, aiCreditsEnabled, aiCreditStripePrice } from './config.server';

vi.mock('server-only', () => ({}));
const env = vi.hoisted(() => ({ BILLING_PLAN_ENV: 'test' as 'dev' | 'test' | 'prod' }));
vi.mock('@/libs/Env', () => ({ Env: env }));
const packs = { ai_10_cad_v1: 'price_aitest10', ai_20_cad_v1: 'price_aitest20', ai_50_cad_v1: 'price_aitest50' };

beforeEach(() => {
  env.BILLING_PLAN_ENV = 'test';
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('AI_CREDITS_ENABLED', '');
  vi.stubEnv('AI_CREDIT_PURCHASES_ENABLED', '');
  vi.stubEnv('AI_CREDIT_STRIPE_PRICE_IDS', JSON.stringify({ env: 'test', packs }));
  vi.stubEnv('AI_CREDIT_USD_TO_CAD_MILLIONTHS', '1400000');
  vi.stubEnv('AI_CREDIT_PRICING_VERSION', 'cad-policy-v1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it('keeps wallet and checkout dark by default and can stop new purchases separately', () => {
  expect(aiCreditsEnabled()).toBe(false);
  expect(aiCreditPurchasesEnabled()).toBe(false);

  vi.stubEnv('AI_CREDITS_ENABLED', 'true');

  expect(aiCreditsEnabled()).toBe(true);
  expect(aiCreditPurchasesEnabled()).toBe(false);

  vi.stubEnv('AI_CREDIT_PURCHASES_ENABLED', 'true');

  expect(aiCreditPurchasesEnabled()).toBe(true);
});

it('requires the exact billing environment and matching key mode', () => {
  expect(aiCreditPlanEnv()).toBe('test');

  env.BILLING_PLAN_ENV = 'dev';

  expect(aiCreditPlanEnv).toThrow();

  env.BILLING_PLAN_ENV = 'test';
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_fixture');

  expect(aiCreditPlanEnv).toThrow();
});

it('accepts only a complete, distinct price map for this environment', () => {
  expect(aiCreditStripePrice('ai_10_cad_v1', 'test')).toBe(packs.ai_10_cad_v1);
  expect(() => aiCreditStripePrice('ai_10_cad_v1', 'prod')).toThrow();

  vi.stubEnv('AI_CREDIT_STRIPE_PRICE_IDS', JSON.stringify({ env: 'test', packs: { ...packs, ai_50_cad_v1: packs.ai_10_cad_v1 } }));

  expect(() => aiCreditStripePrice('ai_10_cad_v1', 'test')).toThrow();
});

it.each(['', '{}', 'not-json', JSON.stringify({ env: 'test', packs: { ai_10_cad_v1: 'price_placeholder' } })])('fails closed for an invalid price carrier', (value) => {
  vi.stubEnv('AI_CREDIT_STRIPE_PRICE_IDS', value);

  expect(() => aiCreditStripePrice('ai_10_cad_v1', 'test')).toThrow();
});

it('requires an explicit bounded, versioned accounting conversion', () => {
  expect(aiCreditPricingPolicy()).toEqual({ version: 'cad-policy-v1', usdToCadMillionths: 1400000 });

  vi.stubEnv('AI_CREDIT_USD_TO_CAD_MILLIONTHS', '99999999');

  expect(aiCreditPricingPolicy).toThrow();
});
