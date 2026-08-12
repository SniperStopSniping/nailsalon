import { z } from 'zod';

import { resolveEntitlement } from '@/libs/featureEntitlements';
import { formatMoney } from '@/libs/formatMoney';
import { parseSmartFitCentsParam, resolveSmartFitReviewOffer } from '@/libs/smartFitCustomer';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

/**
 * Salon deposits — the ONE module that answers "is a deposit required for this
 * booking total, and for exactly how many cents?".
 *
 * PURE and client-safe. It must never import `@/libs/DB` and never import
 * `server-only`: the public confirm page's jsdom test does not mock
 * `server-only`, and `SettingsModal.tsx` is a `'use client'` component.
 *
 * Deposit amount math, the currency literal, deposit money formatting,
 * cents/dollars conversion in both directions, every money-bearing owner- or
 * client-facing deposit string, the disclosure fingerprint's sentinel literal
 * and the disclosure-comparand combiner live HERE and nowhere else. The only
 * database-reading deposit function is `getDepositPolicyForSalon` in
 * `depositPolicy.server.ts`.
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Stripe's lowercase ISO code, as used by `price_data.currency`. */
export const DEPOSIT_CURRENCY = 'cad' as const;

/**
 * The uppercase form, DERIVED rather than independently declared so the two can
 * never drift. An uppercase constant compared against a lowercase one is the
 * exact failure mode migration 0065's currency CHECK was written to avoid.
 */
export const DEPOSIT_ISO_CURRENCY
  = DEPOSIT_CURRENCY.toUpperCase() as Uppercase<typeof DEPOSIT_CURRENCY>;

/** Stripe's minimum chargeable amount in this currency. */
export const MIN_DEPOSIT_CENTS = 50;

/** Absurdity ceiling. Re-checked at READ time, not only in the write validator. */
export const MAX_DEPOSIT_CENTS_ABSURDITY = 1_000_000;

/** Soft advisory threshold for the owner-facing card. Gates nothing. */
export const DEPOSIT_RECOMMENDED_MAX_CENTS = 100_000;

/**
 * ADVISORY DISPLAY ONLY. This value must never appear in `resolveDepositPolicy`:
 * there is no age/TTL condition on the read-time gate, by design.
 */
export const DEPOSIT_READINESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The build-time collection gate. Typed `boolean` rather than `as const` so the
 * downstream payment-confirmation PR can flip it without a type error. That PR
 * is the sanctioned second writer of this file; nothing else may flip it.
 *
 * FLIPPED BY THE PAYMENT-CONFIRMATION PR — the sanctioned second writer, and
 * the only line it changes in this file.
 *
 * THIS TAKES NOBODY LIVE. It is gate 1 of two. Gate 2 is the per-salon
 * `features.money.deposits` entitlement, which is an owner action, so a salon
 * without it still resolves inactive with this constant `true`.
 *
 * ITS DEPLOY POSITION IS FIXED: after the post-deploy verification of the
 * Connect endpoint, never in the same deploy as that endpoint's FIRST
 * registration, and before any salon is entitled. The reason it ships in this
 * PR at all is that leaving it `false` would let the whole ladder merge with
 * deposits silently dead — nothing else in the programme flips it.
 */
export const DEPOSIT_COLLECTION_LIVE: boolean = true;

/**
 * The "nothing was disclosed" sentinel, and a MONEY-PATH WIRE CONSTANT rather
 * than a display comparand: the downstream booking PR decides refuse-vs-book-free
 * from the submitted `expectedDepositFingerprint`, and "nothing disclosed" is the
 * book-free leg. The literal is written ONCE, here; every other site — including
 * this file's own builder and parser — references the constant.
 */
export const DEPOSIT_FINGERPRINT_NONE = 'deposit-v1:none' as const;

/** Free-text `salon_audit_log.action` for the super-admin entitlement route. */
export const DEPOSITS_ENTITLEMENT_AUDIT_ACTION = 'deposits_entitlement_changed';

const FINGERPRINT_VERSION = 'deposit-v1';

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * WRITE schema. Bounded on both sides so the admin PATCH cannot store an amount
 * the read-time gate would then have to reject.
 */
export const salonDepositSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  amountCents: z
    .number()
    .int()
    .min(MIN_DEPOSIT_CENTS)
    .max(MAX_DEPOSIT_CENTS_ABSURDITY)
    .optional(),
});

/**
 * STORED-READ schema, deliberately permissive: privileged whole-column writers
 * never run the write validator, so an out-of-window value must be READABLE
 * (and then rejected by the read-time gate) rather than collapsing the object.
 */
export const storedDepositSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  amountCents: z.number().int().nonnegative().optional(),
});

export type SalonDepositSettings = z.infer<typeof salonDepositSettingsSchema>;
export type StoredDepositSettings = z.infer<typeof storedDepositSettingsSchema>;

// =============================================================================
// TYPES
// =============================================================================

/**
 * The cached Connect binding, reduced to exactly what the gate reads.
 * `stripe_account_id` is deliberately NOT carried — it must never reach a browser.
 */
export type DepositAccountSnapshot = {
  chargesEnabled: boolean;
  revokedAt: Date | null;
  lastSyncedAt: Date | null;
  livemode: boolean;
} | null;

/**
 * CROSS-PACKET CONTRACT. Exactly these nine members. The downstream booking PR
 * partitions this union to decide branch entry and halts on an unclassified
 * reason, so adding, renaming or removing a member cannot be done on one side.
 */
export type DepositPolicyInactiveReason
  = | 'collection_not_live'
  | 'not_entitled'
  | 'not_configured'
  | 'disabled'
  | 'account_not_connected'
  | 'account_not_charge_ready'
  | 'readiness_never_synced'
  | 'currency_unsupported'
  | 'undetermined';

export type ResolvedDepositPolicy
  = | { active: false; reason: DepositPolicyInactiveReason; amountCents: number | null }
  | { active: true; amountCents: number; currency: typeof DEPOSIT_CURRENCY };

export type DepositCharge
  = | {
    required: false;
    reason:
      | 'policy_inactive'
      | 'below_minimum_charge'
      | 'invalid_total'
      | 'reschedule'
      | 'undetermined';
  }
  | { required: true; amountCents: number; currency: typeof DEPOSIT_CURRENCY };

export type DepositDisclosure = { label: string; amountCents: number };

export type ResolveDepositPolicyArgs = {
  settings: SalonSettings | null | undefined;
  features: SalonFeatures | null | undefined;
  stripeAccount: DepositAccountSnapshot;
  /**
   * REQUIRED, and `boolean | null`. `null` resolves `undetermined` WITHOUT
   * evaluating the livemode conjunct. It is never computed here — this file is
   * pure and client-safe — it is passed in from `depositPolicy.server.ts`.
   */
  expectedLivemode: boolean | null;
  /**
   * Accepted for callers that already hold a request clock. It gates NOTHING:
   * there is no age/TTL condition anywhere in this function.
   */
  now?: Date;
  collectionLive?: boolean;
  /**
   * Exists ONLY so the admin settings GET can ask "what would still be wrong if
   * both launch gates were on?". No other caller passes it.
   */
  entitled?: boolean;
};

// =============================================================================
// STORED SETTINGS
// =============================================================================

/** Read the stored deposit block, collapsing a malformed value to `{}`. */
export function readStoredDepositSettings(
  settings: SalonSettings | null | undefined,
): StoredDepositSettings {
  const parsed = storedDepositSettingsSchema.safeParse(
    (settings as { payments?: { deposit?: unknown } } | null | undefined)?.payments?.deposit ?? {},
  );
  return parsed.success ? parsed.data : {};
}

/** Per-salon entitlement. Default false. */
export function resolveDepositEntitlement(
  features: SalonFeatures | null | undefined,
): boolean {
  return resolveEntitlement(features, 'money', 'deposits');
}

// =============================================================================
// THE READ-TIME GATE
// =============================================================================

/**
 * The invariant. Returns `active:false` unless EVERY conjunct holds. A stored
 * `enabled:true` on a broken account is INERT — never an error, never a charge —
 * and there is NO age/TTL condition, so a salon is never silently disabled by
 * staleness.
 *
 * Conjunct order is load-bearing for `getDepositPolicyForSalon`'s local-first
 * short-circuit: every salon-local answer must be reachable with
 * `stripeAccount: null`, and `account_not_connected` must be returned exactly
 * when the account is the one remaining question.
 *
 * `not_configured` before `disabled` is deliberate and mirrors the state
 * machine's own names: `unconfigured` is the initial state (no readable amount),
 * `configured+disabled` is the later one (a valid amount the owner switched off).
 */
export function resolveDepositPolicy(
  args: ResolveDepositPolicyArgs,
): ResolvedDepositPolicy {
  const {
    settings,
    features,
    stripeAccount,
    expectedLivemode,
    collectionLive = DEPOSIT_COLLECTION_LIVE,
  } = args;
  const entitled = args.entitled ?? resolveDepositEntitlement(features);
  const stored = readStoredDepositSettings(settings);
  const amountCents = typeof stored.amountCents === 'number' ? stored.amountCents : null;

  const inactive = (reason: DepositPolicyInactiveReason): ResolvedDepositPolicy => ({
    active: false,
    reason,
    amountCents,
  });

  if (!collectionLive) {
    return inactive('collection_not_live');
  }
  if (!entitled) {
    return inactive('not_entitled');
  }

  // BOTH bounds are re-checked here, not only in the write validator: two
  // privileged whole-column `settings` writers never run that validator, so a
  // planted 99_999_999 would otherwise resolve active and clamp to 100% of
  // every booking total.
  if (
    amountCents === null
    || amountCents < MIN_DEPOSIT_CENTS
    || amountCents > MAX_DEPOSIT_CENTS_ABSURDITY
  ) {
    return inactive('not_configured');
  }
  if (stored.enabled !== true) {
    return inactive('disabled');
  }

  // The RAW STORED currency. Never read through `resolveBookingConfigFromSettings`,
  // which returns CAD defaults on a failed safeParse and would therefore let a
  // salon with a corrupt booking block pass this conjunct.
  const rawStoredCurrency = (
    settings as { booking?: { currency?: unknown } } | null | undefined
  )?.booking?.currency;
  if (rawStoredCurrency !== undefined && rawStoredCurrency !== DEPOSIT_ISO_CURRENCY) {
    return inactive('currency_unsupported');
  }

  // Decided before the binding conjuncts so it stays reachable without I/O.
  if (expectedLivemode === null) {
    return inactive('undetermined');
  }

  if (!stripeAccount || stripeAccount.revokedAt !== null) {
    return inactive('account_not_connected');
  }
  if (!stripeAccount.chargesEnabled) {
    return inactive('account_not_charge_ready');
  }
  if (stripeAccount.livemode !== expectedLivemode) {
    return inactive('account_not_charge_ready');
  }
  if (stripeAccount.lastSyncedAt === null) {
    return inactive('readiness_never_synced');
  }

  return { active: true, amountCents, currency: DEPOSIT_CURRENCY };
}

// =============================================================================
// PER-BOOKING CHARGE
// =============================================================================

/**
 * The check order is CONTRACTUAL.
 *
 * 1 before 2 is deliberate: a reschedule owes no deposit under any policy state,
 * and the booking PR turns a forwarded `undetermined` into a hard refusal, so
 * checking the policy first would reject every reschedule on a live deposits
 * salon during any transient database failure.
 *
 * Never throws in `'disclosure'` mode.
 */
export function resolveDepositChargeForTotal(
  policy: ResolvedDepositPolicy,
  postDiscountTotalCents: number,
  options: { mode: 'disclosure' | 'authoritative'; isReschedule?: boolean },
): DepositCharge {
  if (options.isReschedule) {
    return { required: false, reason: 'reschedule' };
  }

  if (!policy.active) {
    // FORWARD `undetermined`; do not flatten it. The money path needs to tell
    // "we could not price this" apart from "there is nothing to charge".
    return {
      required: false,
      reason: policy.reason === 'undetermined' ? 'undetermined' : 'policy_inactive',
    };
  }

  if (
    !Number.isInteger(postDiscountTotalCents)
    || postDiscountTotalCents < 0
  ) {
    if (options.mode === 'authoritative') {
      throw new TypeError(
        `[deposits] refusing to price a booking whose total is not a non-negative integer: ${String(postDiscountTotalCents)}`,
      );
    }
    console.error(
      '[deposits] disclosure skipped: total is not a non-negative integer',
      postDiscountTotalCents,
    );
    return { required: false, reason: 'invalid_total' };
  }

  const amountCents = Math.min(policy.amountCents, postDiscountTotalCents);
  if (amountCents < MIN_DEPOSIT_CENTS) {
    return { required: false, reason: 'below_minimum_charge' };
  }

  return { required: true, amountCents, currency: DEPOSIT_CURRENCY };
}

// =============================================================================
// DISCLOSURE
// =============================================================================

/**
 * The client-facing line. Owner decision OD-4 was signed as option (A) — the
 * deposit IS credited against the final bill — so the credit clause is part of
 * the pinned label. Shipping the applier is a downstream requirement and a
 * go-live stop: the label must not go live before the credit does.
 */
export function buildDepositDisclosure(
  charge: DepositCharge,
  options?: { locale?: string },
): DepositDisclosure | null {
  if (!charge.required) {
    return null;
  }
  return {
    label: `${formatMoney(charge.amountCents, DEPOSIT_ISO_CURRENCY, options?.locale)} deposit required to book — applied to your service total.`,
    amountCents: charge.amountCents,
  };
}

/** The token the confirm page echoes on every booking POST. */
export function buildDepositDisclosureFingerprint(charge: DepositCharge): string {
  if (!charge.required) {
    return DEPOSIT_FINGERPRINT_NONE;
  }
  return `${FINGERPRINT_VERSION}:${charge.currency}:${charge.amountCents}`;
}

/**
 * The inverse. `DEPOSIT_FINGERPRINT_NONE` parses to 0; a well-formed token in
 * this currency parses to its cents; EVERYTHING else — absent, malformed, wrong
 * currency, wrong version, negative, fractional — parses to `null`.
 *
 * NOTE FOR THE DOWNSTREAM BOOKING PR, not a licence to change this function: it
 * calls this at two sites with deliberately OPPOSITE `null` semantics. The
 * pre-transaction site asks only "was a deposit disclosed at all?", where `null`
 * means NO; the in-transaction site asks the magnitude question, where `null` is
 * a hard mismatch. Both are correct against the values documented here. Do not
 * add a mode flag and do not "harmonise" the asymmetry.
 */
export function parseDepositDisclosureFingerprint(
  token: string | null | undefined,
): number | null {
  if (typeof token !== 'string') {
    return null;
  }
  if (token === DEPOSIT_FINGERPRINT_NONE) {
    return 0;
  }

  const parts = token.split(':');
  if (parts.length !== 3) {
    return null;
  }
  const [version, currency, cents] = parts;
  if (version !== FINGERPRINT_VERSION || currency !== DEPOSIT_CURRENCY) {
    return null;
  }
  if (typeof cents !== 'string' || !/^\d+$/.test(cents)) {
    return null;
  }
  const parsed = Number.parseInt(cents, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * TRUE if and only if the system is actually publishing a deposit statement on
 * this page. This is what suppresses the owner's freeform chip, so it must NOT
 * be widened to the account-side inactive reasons: in those states the system
 * publishes nothing, and deleting the owner's own out-of-band statement would
 * leave the client with no deposit information at all.
 */
export function isDepositGovernedBySystem(policy: ResolvedDepositPolicy): boolean {
  return policy.active === true;
}

/**
 * The single disclosure-comparand combiner. The confirm page calls THIS and
 * performs no cents arithmetic of its own.
 */
export function resolveDisclosureTotalCents(args: {
  serverTotalCents: number;
  subtotalBeforeDiscountCents: number;
  smartFitDiscountCentsParam: string | null;
  smartFitTotalCentsParam: string | null;
}): number {
  const offer = resolveSmartFitReviewOffer({
    subtotalCents: args.subtotalBeforeDiscountCents,
    discountCentsParam: parseSmartFitCentsParam(args.smartFitDiscountCentsParam),
    totalCentsParam: parseSmartFitCentsParam(args.smartFitTotalCentsParam),
    hasOtherDiscount: false,
  });

  return Math.min(args.serverTotalCents, offer?.discountedPriceCents ?? args.serverTotalCents);
}

// =============================================================================
// OWNER-FACING HELPERS
// =============================================================================

/** Dollars string to integer cents. `null` when the input is not a number. */
export function parseDepositDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed * 100);
}

/** Integer cents to the dollars string the admin input renders. */
export function formatDepositCentsForInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * BOTH money-bearing sentences the Deposits card renders, composed from this
 * module's own constants and formatter, so the component holds no money literal
 * of any kind.
 */
export function buildDepositCardNotices(options?: { locale?: string }): {
  clampNotice: string;
  recommendedMaxNotice: string;
} {
  const minimum = formatMoney(MIN_DEPOSIT_CENTS, DEPOSIT_ISO_CURRENCY, options?.locale);
  const recommendedMax = formatMoney(
    DEPOSIT_RECOMMENDED_MAX_CENTS,
    DEPOSIT_ISO_CURRENCY,
    options?.locale,
  );

  return {
    clampNotice: `Clients are charged this amount, or the full booking total if it is lower. Bookings under ${minimum} are not charged.`,
    recommendedMaxNotice: `Deposits above ${recommendedMax} are unusually large for a single booking. Clients are more likely to abandon the booking.`,
  };
}
