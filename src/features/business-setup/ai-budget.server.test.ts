import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionAiBudgetMicroCad, SETUP_AI_PRODUCTION_BUDGET_ID, setupAiExpensePolicy, setupAiProviderConfigured } from './ai-budget.server';

vi.mock('server-only', () => ({}));

beforeEach(() => {
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VITEST', 'false');
  vi.stubEnv('GITHUB_ACTIONS', 'false');
  vi.stubEnv('CI', 'false');
  vi.stubEnv('OPENAI_API_KEY_CUSTOM_SITES', 'synthetic-provider-key');
  vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '');
  vi.stubEnv('CUSTOM_SITE_PRODUCTION_FUNDING_MODE', '');
  vi.stubEnv('CUSTOM_SITE_TRIAL_BUDGET_CAD', '80');
});

afterEach(() => vi.unstubAllEnvs());

describe('explicit operator expense configuration', () => {
  it('allows explicitly selected paid-credit funding without inventing an operator allowance', () => {
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_FUNDING_MODE', 'paid_credits');

    expect(setupAiExpensePolicy(true)).toEqual({ id: SETUP_AI_PRODUCTION_BUDGET_ID, capMicroCad: null, production: true, funding: 'paid_credits' });
    expect(setupAiProviderConfigured()).toBe(true);

    vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '50');

    expect(setupAiExpensePolicy(true)).toBeNull();
    expect(setupAiProviderConfigured()).toBe(false);
  });

  it.each(['unlimited', 'prepaid', ' paid_credits '])('rejects unknown production funding modes: %s', (value) => {
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_FUNDING_MODE', value);
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', '50');

    expect(setupAiExpensePolicy(true)).toBeNull();
  });

  it.each(['', '0', '-1', 'Infinity', 'NaN', '1e3', '1.0000001', '2147.483648', '9999', ' 50 '])('rejects an absent/invalid production cap without borrowing trial funds: %s', (value) => {
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', value);

    expect(productionAiBudgetMicroCad()).toBeNull();
    expect(setupAiExpensePolicy(true, true)).toBeNull();
    expect(setupAiProviderConfigured()).toBe(false);
  });

  it.each([['0.000001', 1], ['1.000001', 1_000_001], ['50', 50_000_000], ['2147.483647', 2_147_483_647]])('parses exact micro-CAD without floating point truncation: %s', (value, expected) => {
    vi.stubEnv('CUSTOM_SITE_PRODUCTION_BUDGET_CAD', value);

    expect(productionAiBudgetMicroCad()).toBe(expected);
    expect(setupAiExpensePolicy(true)).toEqual({ id: SETUP_AI_PRODUCTION_BUDGET_ID, production: true, capMicroCad: expected });
    expect(setupAiProviderConfigured()).toBe(true);
  });

  it('keeps the frozen non-production trial separate and requires a provider key', () => {
    vi.stubEnv('APP_ENV', 'preview');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('CUSTOM_SITE_TRIAL_BUDGET_CAD', '11.384406');

    expect(setupAiExpensePolicy(false)).toEqual({ id: 'initial-custom-website-trial', production: false, capMicroCad: 11_384_406 });
    expect(setupAiProviderConfigured()).toBe(true);

    vi.stubEnv('OPENAI_API_KEY_CUSTOM_SITES', '');

    expect(setupAiProviderConfigured()).toBe(false);

    vi.stubEnv('CUSTOM_SITE_TRIAL_BUDGET_CAD', '81');

    expect(setupAiExpensePolicy(false)).toBeNull();
  });
});
