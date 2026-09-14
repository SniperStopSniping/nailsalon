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
 * Every identifier in this file is a null placeholder in Gate A. Creating
 * real Stripe Products/Prices/Coupons is a separately authorized production
 * configuration step (contract §20); committing a live identifier here is
 * forbidden. Resolution of a placeholder throws PRICE_UNCONFIGURED, so no
 * checkout path can silently proceed against unconfigured commerce.
 *
 * P6b (owner decision D19a, ratified 2026-09-14): real Stripe Price/Coupon
 * identifiers live ONLY in the per-environment env carrier
 * (`BILLING_STRIPE_PRICE_IDS`, see stripePriceCarrier.ts and contract §4,
 * §12). Every resolver below consults that carrier FIRST and falls back to
 * the committed (forever-null) tables below when it has no entry — those
 * tables are NOT edited by this change and never will carry a live id.
 */

import 'server-only';

import { Env } from '@/libs/Env';

import type { BillingOfferKey } from './billingOffers';
import type { PromotionKey } from './promotions';
import { getStripePriceCarrier, isConfiguredStripeId } from './stripePriceCarrier';
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

const PROMOTION_COUPON_IDS: Record<PromotionKey, StripeIdByEnv> = Object.freeze({
  founding_annual_2026: unconfigured(),
});

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
  const carrier = getStripePriceCarrier();
  if (carrier && Object.prototype.hasOwnProperty.call(carrier.offers, key)) {
    return carrier.offers[key]!;
  }
  return resolveStripeIdFromTable(OFFER_PRICE_IDS, billingEnv(), key);
}

export function resolveStripePriceIdForTopup(key: TopupOfferKey): string {
  const carrier = getStripePriceCarrier();
  if (carrier && Object.prototype.hasOwnProperty.call(carrier.topups, key)) {
    return carrier.topups[key]!;
  }
  return resolveStripeIdFromTable(TOPUP_PRICE_IDS, billingEnv(), key);
}

export function resolveStripeCouponIdForPromotion(key: PromotionKey): string {
  const carrier = getStripePriceCarrier();
  if (carrier && Object.prototype.hasOwnProperty.call(carrier.coupons, key)) {
    return carrier.coupons[key]!;
  }
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

function reverseLookupCarrier<K extends string>(
  carrierMap: Record<string, string>,
  priceId: string,
): K | null {
  for (const [key, id] of Object.entries(carrierMap)) {
    if (id === priceId) {
      return key as K;
    }
  }
  return null;
}

export function resolveBillingOfferFromStripePriceId(priceId: string): BillingOfferKey | null {
  const carrier = getStripePriceCarrier();
  if (carrier) {
    const fromCarrier = reverseLookupCarrier<BillingOfferKey>(carrier.offers, priceId);
    if (fromCarrier !== null) {
      return fromCarrier;
    }
  }
  return reverseLookup(OFFER_PRICE_IDS, priceId);
}

export function resolveTopupOfferFromStripePriceId(priceId: string): TopupOfferKey | null {
  const carrier = getStripePriceCarrier();
  if (carrier) {
    const fromCarrier = reverseLookupCarrier<TopupOfferKey>(carrier.topups, priceId);
    if (fromCarrier !== null) {
      return fromCarrier;
    }
  }
  return reverseLookup(TOPUP_PRICE_IDS, priceId);
}
