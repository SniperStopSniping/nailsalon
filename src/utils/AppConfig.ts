import type { LocalePrefix } from 'node_modules/next-intl/dist/types/src/routing/types';

import { BILLING_INTERVAL, type PricingPlan } from '@/types/Subscription';

const localePrefix: LocalePrefix = 'as-needed';

// FIXME: Update this configuration file based on your project information
export const AppConfig = {
  name: 'SaaS Template',
  locales: [
    {
      id: 'en',
      name: 'English',
    },
    { id: 'fr', name: 'Français' },
  ],
  defaultLocale: 'en',
  localePrefix,
};

export const AllLocales = AppConfig.locales.map(locale => locale.id);

export const PLAN_ID = {
  FREE: 'free',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise',
} as const;

// =============================================================================
// LOYALTY POINTS CONFIGURATION
// =============================================================================

export const LOYALTY_POINTS = {
  /** Welcome bonus for new clients (matches free gel manicure tier) */
  WELCOME_BONUS: 25_000,
  /** Bonus for completing profile (name + email) */
  PROFILE_COMPLETION: 2_500,
  /** Points earned per dollar spent */
  PER_DOLLAR_SPENT: 20,
  /** Referee gets this immediately when claiming referral link */
  REFERRAL_REFEREE_BONUS: 2_500,
  /** Referrer gets this after referee completes first paid appointment */
  REFERRAL_REFERRER_BONUS: 25_000,
} as const;

// =============================================================================
// FRAUD DETECTION CONFIGURATION (v1)
// =============================================================================

export const FRAUD_DETECTION = {
  /** Flag if client has 3+ completed appointments in 7 days */
  APPT_FREQ_7D: 3,
  /** Flag if client has 5+ completed appointments in 14 days (HIGH severity) */
  APPT_FREQ_14D: 5,
  /** Flag if client earns >= 5000 points in 7 days (MEDIUM severity) */
  POINTS_7D_CAP: 5000,
  /** HIGH severity threshold for points velocity */
  POINTS_7D_HIGH: 8000,
  /** Throttle window for frequency signals (days) - don't create new signal if unresolved exists */
  THROTTLE_FREQUENCY_DAYS: 14,
  /** Throttle window for velocity signals (days) */
  THROTTLE_VELOCITY_DAYS: 7,
} as const;

export const PricingPlanList: Record<string, PricingPlan> = {
  [PLAN_ID.FREE]: {
    id: PLAN_ID.FREE,
    price: 0,
    interval: BILLING_INTERVAL.MONTH,
    testPriceId: '',
    devPriceId: '',
    prodPriceId: '',
    features: {
      teamMember: 2,
      website: 2,
      storage: 2,
      transfer: 2,
    },
  },
  [PLAN_ID.PREMIUM]: {
    id: PLAN_ID.PREMIUM,
    price: 79,
    interval: BILLING_INTERVAL.MONTH,
    testPriceId: 'price_premium_test', // Use for testing
    // FIXME: Update the price ID, you can create it after running `npm run stripe:setup-price`
    devPriceId: 'price_1PNksvKOp3DEwzQlGOXO7YBK',
    prodPriceId: '',
    features: {
      teamMember: 5,
      website: 5,
      storage: 5,
      transfer: 5,
    },
  },
  [PLAN_ID.ENTERPRISE]: {
    id: PLAN_ID.ENTERPRISE,
    price: 199,
    interval: BILLING_INTERVAL.MONTH,
    testPriceId: 'price_enterprise_test', // Use for testing
    // FIXME: Update the price ID, you can create it after running `npm run stripe:setup-price`
    devPriceId: 'price_1PNksvKOp3DEwzQli9IvXzgb',
    prodPriceId: 'price_123',
    features: {
      teamMember: 100,
      website: 100,
      storage: 100,
      transfer: 100,
    },
  },
};
