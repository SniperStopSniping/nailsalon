import 'server-only';

import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';

import { APPROVED_TRIAL_CAP_CAD } from './ai-models';

export const SETUP_AI_TRIAL_BUDGET_ID = 'initial-custom-website-trial';
export const SETUP_AI_PRODUCTION_BUDGET_ID = 'production-custom-websites-v1';

/** Fixed operator ledger, never a browser-selected or per-salon allowance. */
export function productionAiBudgetMicroCad() {
  const value = process.env.CUSTOM_SITE_PRODUCTION_BUDGET_CAD ?? '';
  if (!/^\d{1,4}(?:\.\d{1,6})?$/u.test(value)) {
    return null;
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const amount = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  // The existing operator-budget column is PostgreSQL int4. Reject rather
  // than truncate/overflow; increasing this ceiling needs a reviewed migration.
  return amount > 0 && amount <= 2_147_483_647 ? amount : null;
}

export function setupAiExpensePolicy(production: boolean, testOverride = false) {
  if (production) {
    const funding = process.env.CUSTOM_SITE_PRODUCTION_FUNDING_MODE ?? '';
    if (funding === 'paid_credits') {
      // This explicitly chosen mode uses verified payments, never trial funds
      // or recovery grants. Do not silently discard an existing fixed ceiling.
      return process.env.CUSTOM_SITE_PRODUCTION_BUDGET_CAD
        ? null
        : { id: SETUP_AI_PRODUCTION_BUDGET_ID, capMicroCad: null, production: true as const, funding: 'paid_credits' as const };
    }
    if (funding && funding !== 'fixed') {
      return null;
    }
    const capMicroCad = productionAiBudgetMicroCad();
    return capMicroCad === null ? null : { id: SETUP_AI_PRODUCTION_BUDGET_ID, capMicroCad, production: true };
  }
  const cap = testOverride ? APPROVED_TRIAL_CAP_CAD : Number(process.env.CUSTOM_SITE_TRIAL_BUDGET_CAD ?? 0);
  return Number.isFinite(cap) && cap > 0 && cap <= APPROVED_TRIAL_CAP_CAD
    ? { id: SETUP_AI_TRIAL_BUDGET_ID, capMicroCad: Math.floor(cap * 1_000_000), production: false }
    : null;
}

export function setupAiProviderConfigured() {
  try {
    const environment = resolveRuntimeEnvironment(process.env);
    return ['development', 'preview', 'production', 'test', 'ci'].includes(environment)
      && Boolean(process.env.OPENAI_API_KEY_CUSTOM_SITES)
      && Boolean(setupAiExpensePolicy(environment === 'production'));
  } catch {
    return false;
  }
}
