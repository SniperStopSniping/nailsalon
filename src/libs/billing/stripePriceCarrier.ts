/**
 * Env-keyed Stripe Price/Coupon id carrier — P6b (owner decision D19a).
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §4, §12.
 * Plan: docs/luster-billing-remaining-work-plan.md §3 G40, §5 "P6"/"P6b".
 * Ratification: docs/billing-gate-c-record.md §4 row (a), RATIFIED 2026-09-14.
 *
 * §4 forbids committing live Stripe Price/Coupon identifiers, so the
 * committed tables in stripePriceMap.ts stay null placeholders forever.
 * Real identifiers instead live ONLY in this optional, server-only,
 * per-environment env var (`Env.BILLING_STRIPE_PRICE_IDS`), provisioned per
 * Vercel environment at activation (contract §20) — it stays unset in every
 * environment while billing is dark.
 *
 * This module never logs a parsed carrier value (id, key, or the raw JSON).
 * `getStripePriceCarrier()` fails CLOSED on any parse error: a malformed,
 * env-mismatched, or otherwise invalid carrier resolves to `null`, never a
 * partial result — see stripePriceMap.ts, which falls back to the committed
 * (all-null) placeholder tables whenever this returns `null`.
 */

import 'server-only';

import { z } from 'zod';

import { Env } from '@/libs/Env';

import { BILLING_OFFERS } from './billingOffers';
import { PROMOTIONS } from './promotions';
import { TOPUP_OFFERS } from './topupOffers';

export type BillingPlanEnv = 'dev' | 'test' | 'prod';

/**
 * A configured identifier must look like a real Stripe id. Empty strings,
 * whitespace and boilerplate placeholders (e.g. 'price_123') are treated as
 * unconfigured so a copy-paste placeholder can never reach checkout. This is
 * the SAME shape check stripePriceMap.ts applies to the committed tables —
 * exported from here so there is exactly one definition.
 */
export function isConfiguredStripeId(value: string | null | undefined): value is string {
  if (value === null || value === undefined) {
    return false;
  }
  return /^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$/.test(value);
}

const stripeIdMapSchema = z.record(z.string().min(1), z.string()).default({});

const stripePriceCarrierSchema = z.object({
  env: z.enum(['dev', 'test', 'prod']),
  offers: stripeIdMapSchema,
  topups: stripeIdMapSchema,
  coupons: stripeIdMapSchema,
});

export type StripePriceCarrier = z.infer<typeof stripePriceCarrierSchema>;

export type StripePriceCarrierRejectionReason =
  | 'MALFORMED'
  | 'ENV_MISMATCH'
  | 'UNKNOWN_KEY'
  | 'INVALID_ID'
  | 'DUPLICATE_ID';

export type StripePriceCarrierParseResult =
  | { ok: true; carrier: StripePriceCarrier | null }
  | { ok: false; reason: StripePriceCarrierRejectionReason };

/**
 * Pure parser. `raw` is the literal env var value; `expectedEnv` is always
 * `Env.BILLING_PLAN_ENV` in application code (see `getStripePriceCarrier`)
 * — callers cannot supply an arbitrary environment, which is what keeps
 * "preview/local cannot resolve production mappings" structural. Absent or
 * blank `raw` is success with a `null` carrier: the carrier is entirely
 * optional and its absence is today's shape.
 */
export function parseStripePriceCarrier(
  raw: string | undefined,
  expectedEnv: BillingPlanEnv,
): StripePriceCarrierParseResult {
  if (raw === undefined || raw.trim() === '') {
    return { ok: true, carrier: null };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }

  const parsed = stripePriceCarrierSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const carrier = parsed.data;

  if (carrier.env !== expectedEnv) {
    return { ok: false, reason: 'ENV_MISMATCH' };
  }

  const knownKeysBySection = {
    offers: new Set<string>(Object.keys(BILLING_OFFERS)),
    topups: new Set<string>(Object.keys(TOPUP_OFFERS)),
    coupons: new Set<string>(Object.keys(PROMOTIONS)),
  } as const;
  const sections = ['offers', 'topups', 'coupons'] as const;

  for (const section of sections) {
    for (const key of Object.keys(carrier[section])) {
      if (!knownKeysBySection[section].has(key)) {
        return { ok: false, reason: 'UNKNOWN_KEY' };
      }
    }
  }

  const seenIds = new Set<string>();
  for (const section of sections) {
    for (const value of Object.values(carrier[section])) {
      if (!isConfiguredStripeId(value)) {
        return { ok: false, reason: 'INVALID_ID' };
      }
      if (seenIds.has(value)) {
        return { ok: false, reason: 'DUPLICATE_ID' };
      }
      seenIds.add(value);
    }
  }

  return { ok: true, carrier };
}

let cachedCarrier: { value: StripePriceCarrier | null } | undefined;
let warnedOnce = false;

/**
 * Memoised, Env-bound resolution: reads `Env.BILLING_STRIPE_PRICE_IDS`
 * against `Env.BILLING_PLAN_ENV` exactly once per process. Fails CLOSED —
 * any rejection reason (including a bare env mismatch) resolves to `null`,
 * never a partial carrier, so a caller can never observe some keys from the
 * carrier and others from a different, unintended source. Logs at most one
 * warning per process on rejection, and never the raw value or any id.
 */
export function getStripePriceCarrier(): StripePriceCarrier | null {
  if (cachedCarrier === undefined) {
    const result = parseStripePriceCarrier(Env.BILLING_STRIPE_PRICE_IDS, Env.BILLING_PLAN_ENV);
    if (result.ok) {
      cachedCarrier = { value: result.carrier };
    } else {
      if (!warnedOnce) {
        warnedOnce = true;
        // Deliberate, single, value-free diagnostic — never the raw carrier
        // or any id. Not a user-facing incident, so console.warn only.
        console.warn(`[billing] BILLING_STRIPE_PRICE_IDS rejected (${result.reason}); falling back to the committed placeholder tables.`);
      }
      cachedCarrier = { value: null };
    }
  }
  return cachedCarrier.value;
}
