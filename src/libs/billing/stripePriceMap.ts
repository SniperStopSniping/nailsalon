/**
 * Environment-scoped Stripe identifier mapping — Founding Plans v1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §4, §12.
 *
 * This is the ONLY module allowed to know Stripe Price/Coupon identifiers.
 * Public projections (planDefinitions/billingOffers/topupOffers) carry no
 * Stripe IDs by construction and never import this module.
 *
 * The environment column is selected EXCLUSIVELY from Env.BILLING_PLAN_ENV —
 * callers cannot supply an environment, which is what makes "preview/local
 * cannot resolve production mappings" structural rather than procedural.
 *
 * Committed identifiers stay null. Top-up prices may be provisioned through
 * server-only BILLING_TOPUP_PRICE_IDS, scoped by environment. Creating live
 * Stripe resources is a production configuration step (contract §20), and
 * live identifiers must never be committed. Unconfigured resolution fails
 * closed with PRICE_UNCONFIGURED.
 */

import 'server-only';

import { z } from 'zod';

import { Env } from '@/libs/Env';

import type { BillingOfferKey } from './billingOffers';
import type { PromotionKey } from './promotions';
import type { TopupOfferKey } from './topupOffers';

export type BillingCatalogErrorCode = 'PRICE_UNCONFIGURED' | 'UNKNOWN_CATALOG_KEY';

export class BillingCatalogError extends Error {
  constructor(
    public readonly code: BillingCatalogErrorCode,
    public readonly catalogKey: string,
  ) {
    super(`${code}: ${catalogKey}`);
    this.name = 'BillingCatalogError';
  }
}

type StripeIdByEnv = {
  dev: string | null;
  test: string | null;
  prod: string | null;
};

const unconfigured = (): StripeIdByEnv =>
  Object.freeze({ dev: null, test: null, prod: null });

const OFFER_PRICE_IDS: Record<BillingOfferKey, StripeIdByEnv> = Object.freeze({
  starter_2026_08_monthly: unconfigured(),
  starter_2026_08_annual: unconfigured(),
  pro_2026_08_monthly: unconfigured(),
  pro_2026_08_annual: unconfigured(),
  elite_2026_08_monthly: unconfigured(),
  elite_2026_08_annual: unconfigured(),
});

const TOPUP_PRICE_IDS: Record<TopupOfferKey, StripeIdByEnv> = Object.freeze({
  topup_100_free_2026_08: unconfigured(),
  topup_250_free_2026_08: unconfigured(),
  topup_500_free_2026_08: unconfigured(),
  topup_100_paid_2026_08: unconfigured(),
  topup_250_paid_2026_08: unconfigured(),
  topup_500_paid_2026_08: unconfigured(),
  topup_1000_paid_2026_08: unconfigured(),
});

const topupPriceConfiguration = z.object({
  dev: z.record(z.string()).optional(),
  test: z.record(z.string()).optional(),
  prod: z.record(z.string()).optional(),
}).strict();

/** Environment values are provisioned outside Git, and never sent to clients. */
function topupPriceTable(): Record<TopupOfferKey, StripeIdByEnv> {
  const raw = Env.BILLING_TOPUP_PRICE_IDS;
  if (!raw) {
    return TOPUP_PRICE_IDS;
  }
  try {
    const configuration = topupPriceConfiguration.parse(JSON.parse(raw));
    const table = Object.fromEntries(Object.keys(TOPUP_PRICE_IDS)
      .map(key => [key, { dev: null, test: null, prod: null }])) as Record<TopupOfferKey, StripeIdByEnv>;
    for (const env of ['dev', 'test', 'prod'] as const) {
      const seen = new Set<string>();
      for (const [key, id] of Object.entries(configuration[env] ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(table, key)
          || !/^price_[A-Za-z0-9]{8,}$/.test(id) || seen.has(id)) {
          throw new Error('Invalid top-up mapping');
        }
        seen.add(id);
        table[key as TopupOfferKey][env] = id;
      }
    }
    return table;
  } catch {
    // Invalid configuration fails closed without logging its contents.
    throw new BillingCatalogError('PRICE_UNCONFIGURED', 'topup_catalog');
  }
}

const PROMOTION_COUPON_IDS: Record<PromotionKey, StripeIdByEnv> = Object.freeze({
  founding_annual_2026: unconfigured(),
});

/**
 * A configured identifier must look like a real Stripe ID. Empty strings,
 * whitespace and boilerplate placeholders (e.g. 'price_123') are treated as
 * unconfigured so a copy-paste placeholder can never reach checkout.
 */
function isConfiguredStripeId(value: string | null): value is string {
  if (value === null) {
    return false;
  }
  return /^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$/.test(value);
}

/**
 * Pure resolution over an explicit table + environment column. Exported for
 * tests, which prove column isolation with fixture tables (a dev resolution
 * can never observe a prod value). Application code uses the Env-bound
 * wrappers below and cannot choose the environment.
 */
export function resolveStripeIdFromTable(
  table: Record<string, StripeIdByEnv>,
  env: 'dev' | 'test' | 'prod',
  key: string,
): string {
  const row = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  if (row === undefined) {
    throw new BillingCatalogError('UNKNOWN_CATALOG_KEY', key);
  }
  const id = row[env];
  if (!isConfiguredStripeId(id)) {
    throw new BillingCatalogError('PRICE_UNCONFIGURED', key);
  }
  return id;
}

function billingEnv(): 'dev' | 'test' | 'prod' {
  return Env.BILLING_PLAN_ENV;
}

export function resolveStripePriceIdForOffer(key: BillingOfferKey): string {
  return resolveStripeIdFromTable(OFFER_PRICE_IDS, billingEnv(), key);
}

export function resolveStripePriceIdForTopup(key: TopupOfferKey): string {
  return resolveStripeIdFromTable(topupPriceTable(), billingEnv(), key);
}

export function resolveStripeCouponIdForPromotion(key: PromotionKey): string {
  return resolveStripeIdFromTable(PROMOTION_COUPON_IDS, billingEnv(), key);
}

/**
 * Reverse lookups for the future Gate C billing webhook: map an incoming
 * Stripe Price ID back to the catalogue key it was configured for in the
 * CURRENT environment only. Over the all-placeholder Gate A tables these
 * always return null; the webhook must treat null as a foreign/unknown
 * price (held anomaly), never as a default.
 */
function reverseLookup<K extends string>(
  table: Record<K, StripeIdByEnv>,
  priceId: string,
): K | null {
  const env = billingEnv();
  for (const key of Object.keys(table) as K[]) {
    const id = table[key][env];
    if (isConfiguredStripeId(id) && id === priceId) {
      return key;
    }
  }
  return null;
}

export function resolveBillingOfferFromStripePriceId(priceId: string): BillingOfferKey | null {
  return reverseLookup(OFFER_PRICE_IDS, priceId);
}

export function resolveTopupOfferFromStripePriceId(priceId: string): TopupOfferKey | null {
  return reverseLookup(topupPriceTable(), priceId);
}
