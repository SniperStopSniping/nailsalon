import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildDepositCardNotices,
  buildDepositDisclosure,
  buildDepositDisclosureFingerprint,
  DEPOSIT_CURRENCY,
  DEPOSIT_FINGERPRINT_NONE,
  DEPOSIT_ISO_CURRENCY,
  DEPOSIT_RECOMMENDED_MAX_CENTS,
  type DepositAccountSnapshot,
  type DepositCharge,
  type DepositPolicyInactiveReason,
  formatDepositCentsForInput,
  isDepositGovernedBySystem,
  MAX_DEPOSIT_CENTS_ABSURDITY,
  MIN_DEPOSIT_CENTS,
  parseDepositDisclosureFingerprint,
  parseDepositDollarsToCents,
  type ResolvedDepositPolicy,
  resolveDepositChargeForTotal,
  resolveDepositPolicy,
  resolveDisclosureTotalCents,
  salonDepositSettingsSchema,
  storedDepositSettingsSchema,
} from '@/libs/depositPolicy';
import { formatMoney } from '@/libs/formatMoney';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

const DEPOSIT_POLICY_SOURCE = readFileSync(
  path.join(process.cwd(), 'src/libs/depositPolicy.ts'),
  'utf8',
);
const SETTINGS_MODAL_SOURCE = readFileSync(
  path.join(process.cwd(), 'src/components/admin/SettingsModal.tsx'),
  'utf8',
);

const ENTITLED: SalonFeatures = { money: { deposits: true } };

function goodAccount(overrides: Partial<NonNullable<DepositAccountSnapshot>> = {}) {
  return {
    chargesEnabled: true,
    revokedAt: null,
    lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
    livemode: false,
    ...overrides,
  };
}

function settingsWith(deposit: unknown, extra: Record<string, unknown> = {}): SalonSettings {
  return { payments: { deposit }, ...extra } as unknown as SalonSettings;
}

/** A salon whose every conjunct holds — the fixture every negative case perturbs. */
function perfect(overrides: {
  settings?: SalonSettings;
  features?: SalonFeatures | null;
  stripeAccount?: DepositAccountSnapshot;
  expectedLivemode?: boolean | null;
  collectionLive?: boolean;
  entitled?: boolean;
} = {}) {
  return resolveDepositPolicy({
    settings: overrides.settings ?? settingsWith({ enabled: true, amountCents: 2500 }),
    features: overrides.features === undefined ? ENTITLED : overrides.features,
    stripeAccount: overrides.stripeAccount === undefined ? goodAccount() : overrides.stripeAccount,
    expectedLivemode: overrides.expectedLivemode === undefined ? false : overrides.expectedLivemode,
    collectionLive: overrides.collectionLive ?? true,
    ...(overrides.entitled === undefined ? {} : { entitled: overrides.entitled }),
  });
}

const ACTIVE_POLICY: ResolvedDepositPolicy = {
  active: true,
  amountCents: 2500,
  currency: DEPOSIT_CURRENCY,
};

function inactivePolicy(reason: DepositPolicyInactiveReason): ResolvedDepositPolicy {
  return { active: false, reason, amountCents: null };
}

// =============================================================================
// 1 / 1b / 1d — the two schemas and the read-time ceiling
// =============================================================================

describe('test 1 — write schema bounds, stored schema permissiveness', () => {
  it('rejects every out-of-window write value and accepts the boundaries', () => {
    for (const value of [-1, 0, 49, 1_000_001, 25.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(salonDepositSettingsSchema.safeParse({ amountCents: value }).success).toBe(false);
    }
    expect(salonDepositSettingsSchema.safeParse({ amountCents: '50' }).success).toBe(false);
    expect(salonDepositSettingsSchema.safeParse({ amountCents: 50 }).success).toBe(true);
    expect(salonDepositSettingsSchema.safeParse({ amountCents: 1_000_000 }).success).toBe(true);
  });

  it('lets the STORED schema read an out-of-window value without collapsing', () => {
    const parsed = storedDepositSettingsSchema.safeParse({ enabled: true, amountCents: 80_000 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.amountCents).toBe(80_000);
  });
});

describe('test 1b — the ceiling is re-checked at READ time', () => {
  it('refuses a planted amount above the ceiling on an otherwise perfect salon', () => {
    // The ONLY test that fails if the ceiling exists solely in the write
    // validator: two privileged whole-column writers never run that validator.
    expect(perfect({ settings: settingsWith({ enabled: true, amountCents: 5_000_000 }) }))
      .toEqual({ active: false, reason: 'not_configured', amountCents: 5_000_000 });
  });

  it('pins both ceiling boundaries', () => {
    expect(perfect({ settings: settingsWith({ enabled: true, amountCents: 1_000_000 }) }).active)
      .toBe(true);
    expect(perfect({ settings: settingsWith({ enabled: true, amountCents: 1_000_001 }) }))
      .toMatchObject({ active: false, reason: 'not_configured' });
  });
});

describe('test 1d — what the ceiling does NOT close', () => {
  it('still clamps a ceiling-valued deposit to the whole of a small booking', () => {
    const policy = perfect({
      settings: settingsWith({ enabled: true, amountCents: MAX_DEPOSIT_CENTS_ABSURDITY }),
    });

    expect(policy.active).toBe(true);

    const charge = resolveDepositChargeForTotal(policy, 6000, { mode: 'disclosure' });

    expect(charge).toEqual({ required: true, amountCents: 6000, currency: DEPOSIT_CURRENCY });
  });
});

// =============================================================================
// 2 / 2b / 2c — the resolve matrix
// =============================================================================

describe('test 2 — one case per row of the effective-policy table', () => {
  it('resolves active when every conjunct holds', () => {
    expect(perfect()).toEqual({ active: true, amountCents: 2500, currency: DEPOSIT_CURRENCY });
  });

  it('reports collection_not_live', () => {
    expect(perfect({ collectionLive: false })).toMatchObject({ reason: 'collection_not_live' });
  });

  it('reports not_entitled', () => {
    expect(perfect({ features: null })).toMatchObject({ reason: 'not_entitled' });
    expect(perfect({ features: { money: { deposits: false } } }))
      .toMatchObject({ reason: 'not_entitled' });
  });

  it('reports not_configured when nothing is stored', () => {
    expect(perfect({ settings: {} as SalonSettings })).toMatchObject({ reason: 'not_configured' });
  });

  it('reports disabled when a valid amount is stored but switched off', () => {
    expect(perfect({ settings: settingsWith({ enabled: false, amountCents: 2500 }) }))
      .toMatchObject({ reason: 'disabled' });
  });

  it('reports account_not_connected for a missing and for a revoked binding', () => {
    expect(perfect({ stripeAccount: null })).toMatchObject({ reason: 'account_not_connected' });
    expect(perfect({ stripeAccount: goodAccount({ revokedAt: new Date() }) }))
      .toMatchObject({ reason: 'account_not_connected' });
  });

  it('reports account_not_charge_ready', () => {
    expect(perfect({ stripeAccount: goodAccount({ chargesEnabled: false }) }))
      .toMatchObject({ reason: 'account_not_charge_ready' });
  });

  it('reports readiness_never_synced', () => {
    expect(perfect({ stripeAccount: goodAccount({ lastSyncedAt: null }) }))
      .toMatchObject({ reason: 'readiness_never_synced' });
  });

  it('reports undetermined when the expected mode is indeterminate', () => {
    expect(perfect({ expectedLivemode: null })).toMatchObject({ reason: 'undetermined' });
  });

  it('collapses malformed stored settings to not_configured', () => {
    expect(perfect({ settings: settingsWith('legacy-string') }))
      .toMatchObject({ reason: 'not_configured' });
  });

  it('never disables on AGE — there is no TTL condition', () => {
    const now = Date.now();

    expect(perfect({
      stripeAccount: goodAccount({ lastSyncedAt: new Date(now - 25 * 60 * 60 * 1000) }),
    }).active).toBe(true);
    expect(perfect({
      stripeAccount: goodAccount({ lastSyncedAt: new Date(now - 60 * 60 * 1000) }),
    }).active).toBe(true);
    expect(perfect({ stripeAccount: goodAccount({ lastSyncedAt: null }) }))
      .toMatchObject({ active: false, reason: 'readiness_never_synced' });
  });
});

describe('test 2b — livemode', () => {
  it('refuses a stored mode that disagrees with the expected one', () => {
    expect(perfect({ expectedLivemode: true, stripeAccount: goodAccount({ livemode: false }) }))
      .toMatchObject({ active: false, reason: 'account_not_charge_ready' });
    expect(perfect({ expectedLivemode: true, stripeAccount: goodAccount({ livemode: true }) }).active)
      .toBe(true);
  });
});

describe('test 2c — currency provenance', () => {
  it('reads the RAW STORED currency, not the fail-open resolver', () => {
    // `slotIntervalMinutes: 7` makes `bookingConfigSchema.safeParse` fail, so
    // `resolveBookingConfigFromSettings` would hand back CAD defaults.
    const settings = settingsWith(
      { enabled: true, amountCents: 2500 },
      { booking: { currency: 'USD', slotIntervalMinutes: 7 } },
    );

    expect(perfect({ settings })).toMatchObject({
      active: false,
      reason: 'currency_unsupported',
    });
  });

  it('treats an absent booking block as supported', () => {
    expect(perfect({ settings: settingsWith({ enabled: true, amountCents: 2500 }) }).active)
      .toBe(true);
  });
});

// =============================================================================
// 3 — the build flag, in one file, with no module mock
// =============================================================================

describe('test 3 — the collection gate', () => {
  it('is inactive with collectionLive false and active with it true, same fixture', () => {
    expect(perfect({ collectionLive: false }))
      .toMatchObject({ active: false, reason: 'collection_not_live' });
    expect(perfect({ collectionLive: true }).active).toBe(true);
  });
});

// =============================================================================
// 4 / 4b — clamping and the disclosure comparand
// =============================================================================

describe('test 4 — the clamp', () => {
  it('never exceeds the total and never charges below the minimum', () => {
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 10000, { mode: 'disclosure' }))
      .toEqual({ required: true, amountCents: 2500, currency: DEPOSIT_CURRENCY });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 1200, { mode: 'disclosure' }))
      .toEqual({ required: true, amountCents: 1200, currency: DEPOSIT_CURRENCY });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 30, { mode: 'disclosure' }))
      .toEqual({ required: false, reason: 'below_minimum_charge' });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 0, { mode: 'disclosure' }))
      .toEqual({ required: false, reason: 'below_minimum_charge' });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 10000, {
      mode: 'disclosure',
      isReschedule: true,
    })).toEqual({ required: false, reason: 'reschedule' });
  });
});

describe('test 4b — resolveDisclosureTotalCents', () => {
  const base = { serverTotalCents: 6000, subtotalBeforeDiscountCents: 6000 };

  it('(a) returns the server total with no Smart Fit params', () => {
    expect(resolveDisclosureTotalCents({
      ...base,
      smartFitDiscountCentsParam: null,
      smartFitTotalCentsParam: null,
    })).toBe(6000);
  });

  it('(b) takes a reconciling pair below the server total', () => {
    expect(resolveDisclosureTotalCents({
      ...base,
      smartFitDiscountCentsParam: '1000',
      smartFitTotalCentsParam: '5000',
    })).toBe(5000);
  });

  it('(c) never rises above the server total', () => {
    expect(resolveDisclosureTotalCents({
      serverTotalCents: 4000,
      subtotalBeforeDiscountCents: 6000,
      smartFitDiscountCentsParam: '1000',
      smartFitTotalCentsParam: '5000',
    })).toBe(4000);
  });

  it('(d) ignores a non-reconciling pair', () => {
    expect(resolveDisclosureTotalCents({
      ...base,
      smartFitDiscountCentsParam: '1000',
      smartFitTotalCentsParam: '4444',
    })).toBe(6000);
  });

  it('(e) honours a crafted pair that drives the offer to zero', () => {
    expect(resolveDisclosureTotalCents({
      ...base,
      smartFitDiscountCentsParam: '6000',
      smartFitTotalCentsParam: '0',
    })).toBe(0);
  });
});

// =============================================================================
// 5 / 5b / 5c — check order, forwarding, and the two modes
// =============================================================================

describe('test 5 — mode discipline', () => {
  it('never throws in disclosure mode and reports invalid totals', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(resolveDepositChargeForTotal(inactivePolicy('disabled'), 12.5, { mode: 'disclosure' }))
      .toEqual({ required: false, reason: 'policy_inactive' });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 12.5, { mode: 'disclosure' }))
      .toEqual({ required: false, reason: 'invalid_total' });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, -1, { mode: 'disclosure' }))
      .toEqual({ required: false, reason: 'invalid_total' });

    expect(() => resolveDepositChargeForTotal(ACTIVE_POLICY, 12.5, { mode: 'authoritative' }))
      .toThrow(TypeError);
    expect(() => resolveDepositChargeForTotal(ACTIVE_POLICY, -1, { mode: 'authoritative' }))
      .toThrow(TypeError);

    consoleError.mockRestore();
  });
});

describe('test 5b — undetermined is FORWARDED, not flattened', () => {
  it('distinguishes undetermined from every other inactive reason', () => {
    expect(resolveDepositChargeForTotal(inactivePolicy('undetermined'), 5000, {
      mode: 'authoritative',
    })).toEqual({ required: false, reason: 'undetermined' });
    expect(resolveDepositChargeForTotal(inactivePolicy('disabled'), 5000, {
      mode: 'authoritative',
    })).toEqual({ required: false, reason: 'policy_inactive' });
  });

  it('forwards it in disclosure mode too, and discloses nothing', () => {
    const charge = resolveDepositChargeForTotal(inactivePolicy('undetermined'), 5000, {
      mode: 'disclosure',
    });

    expect(charge).toEqual({ required: false, reason: 'undetermined' });
    expect(buildDepositDisclosure(charge)).toBeNull();
  });

  it('collapses every OTHER inactive reason to policy_inactive in both modes', () => {
    const others: DepositPolicyInactiveReason[] = [
      'collection_not_live',
      'not_entitled',
      'not_configured',
      'disabled',
      'account_not_connected',
      'account_not_charge_ready',
      'readiness_never_synced',
      'currency_unsupported',
    ];

    for (const reason of others) {
      for (const mode of ['disclosure', 'authoritative'] as const) {
        expect(resolveDepositChargeForTotal(inactivePolicy(reason), 5000, { mode }))
          .toEqual({ required: false, reason: 'policy_inactive' });
      }
    }
  });

  it('CHECK ORDER: reschedule is decided BEFORE the policy is consulted', () => {
    // A reschedule owes no deposit under any policy state, and the booking PR
    // turns a forwarded `undetermined` into a hard refusal — so checking the
    // policy first would reject every reschedule during a transient DB failure.
    expect(resolveDepositChargeForTotal(inactivePolicy('undetermined'), 5000, {
      mode: 'authoritative',
      isReschedule: true,
    })).toEqual({ required: false, reason: 'reschedule' });
    expect(resolveDepositChargeForTotal(ACTIVE_POLICY, 5000, {
      mode: 'authoritative',
      isReschedule: true,
    })).toEqual({ required: false, reason: 'reschedule' });
  });
});

describe('test 5c — a corrupt total in authoritative mode throws', () => {
  it('throws a TypeError rather than pricing it', () => {
    expect(() => resolveDepositChargeForTotal(ACTIVE_POLICY, 25.5, { mode: 'authoritative' }))
      .toThrow(TypeError);
  });
});

// =============================================================================
// 6 — the pinned label and the currency-literal source counts
// =============================================================================

describe('test 6 — the disclosure label and the single currency source', () => {
  it('pins the label exactly', () => {
    const disclosure = buildDepositDisclosure({
      required: true,
      amountCents: 2500,
      currency: DEPOSIT_CURRENCY,
    });

    // Owner decision OD-4 was signed as option (A): the deposit IS credited
    // against the final bill, so the credit clause is part of the pinned label.
    expect(disclosure!.label).toBe(
      `${formatMoney(2500, DEPOSIT_ISO_CURRENCY)} deposit required to book — applied to your service total.`,
    );
    expect(disclosure!.label).toContain('applied to your service total');
    expect(disclosure!.amountCents).toBe(2500);
  });

  it('renders en-CA money without hand-concatenation', () => {
    expect(formatMoney(2500, DEPOSIT_ISO_CURRENCY, 'en-CA')).toBe('$25.00');
  });

  it('derives the uppercase code and holds exactly one quoted currency literal', () => {
    expect(DEPOSIT_ISO_CURRENCY).toBe(DEPOSIT_CURRENCY.toUpperCase());
    expect(DEPOSIT_POLICY_SOURCE.match(/['"]cad['"]/g)?.length ?? 0).toBe(1);
    expect(DEPOSIT_POLICY_SOURCE.match(/['"]CAD['"]/g)?.length ?? 0).toBe(0);
  });

  it('keeps money copy out of the admin component', () => {
    expect(SETTINGS_MODAL_SOURCE).not.toMatch(/CA\$\d/);
  });
});

// =============================================================================
// 7 / 7b / 7c — the fingerprint
// =============================================================================

describe('test 7 / 7b — the fingerprint round-trips and rejects every boundary', () => {
  it('is stable and distinguishes amounts', () => {
    const at = (amountCents: number): DepositCharge => ({
      required: true,
      amountCents,
      currency: DEPOSIT_CURRENCY,
    });

    expect(buildDepositDisclosureFingerprint(at(2500)))
      .toBe(buildDepositDisclosureFingerprint(at(2500)));
    expect(buildDepositDisclosureFingerprint(at(2500)))
      .not.toBe(buildDepositDisclosureFingerprint(at(2400)));

    for (const amountCents of [50, 2500, 1_000_000]) {
      expect(parseDepositDisclosureFingerprint(
        buildDepositDisclosureFingerprint(at(amountCents)),
      )).toBe(amountCents);
    }

    expect(parseDepositDisclosureFingerprint(DEPOSIT_FINGERPRINT_NONE)).toBe(0);
  });

  it('returns null for every malformed token — each is a security boundary', () => {
    for (const token of [
      undefined,
      '',
      'deposit-v1:',
      'deposit-v1:usd:2500',
      'deposit-v2:cad:2500',
      'deposit-v1:cad:-1',
      'deposit-v1:cad:2.5',
      'deposit-v1:cad:',
    ]) {
      expect(parseDepositDisclosureFingerprint(token as string | undefined)).toBeNull();
    }
  });
});

describe('test 7c — the sentinel is a SYMBOL, and the wire value is pinned', () => {
  it('(a) pins the wire value', () => {
    // A change here silently flips every account-side-inactive booking onto the
    // wrong entry leg downstream.
    expect(DEPOSIT_FINGERPRINT_NONE).toBe('deposit-v1:none');
  });

  it('(b) every required:false reason builds the SYMBOL, not a re-typed literal', () => {
    const reasons = [
      'policy_inactive',
      'below_minimum_charge',
      'reschedule',
      'undetermined',
    ] as const;

    for (const reason of reasons) {
      expect(buildDepositDisclosureFingerprint({ required: false, reason }))
        .toBe(DEPOSIT_FINGERPRINT_NONE);
    }
  });

  it('(c) the literal occurs exactly once in the module', () => {
    expect(DEPOSIT_POLICY_SOURCE.match(/deposit-v1:none/g)?.length ?? 0).toBe(1);
  });

  it('has no mode flag on the parser', () => {
    expect(parseDepositDisclosureFingerprint.length).toBe(1);
  });
});

// =============================================================================
// 8 / 8b — dollars and cents, in one place
// =============================================================================

describe('test 8 / 8b — cents conversion lives here and only here', () => {
  it('parses dollars to integer cents', () => {
    expect(parseDepositDollarsToCents('20.15')).toBe(2015);
    expect(parseDepositDollarsToCents('29.99')).toBe(2999);
    expect(parseDepositDollarsToCents('0.49')).toBe(49);
    expect(parseDepositDollarsToCents('   ')).toBeNull();
    expect(parseDepositDollarsToCents('abc')).toBeNull();
  });

  it('round-trips through the input formatter', () => {
    for (const cents of [50, 2015, 2500, 100_000]) {
      expect(parseDepositDollarsToCents(formatDepositCentsForInput(cents))).toBe(cents);
    }
  });

  it('keeps cents arithmetic out of the admin component', () => {
    const conversions = SETTINGS_MODAL_SOURCE.match(/\/ 100|\* 100/g)?.length ?? 0;

    // Exactly the two pre-existing tax basis-point helpers.
    expect(conversions).toBe(2);
  });

  it('composes both card sentences from this module', () => {
    const notices = buildDepositCardNotices();

    expect(notices.clampNotice).toContain(formatMoney(MIN_DEPOSIT_CENTS, DEPOSIT_ISO_CURRENCY));
    expect(notices.recommendedMaxNotice)
      .toContain(formatMoney(DEPOSIT_RECOMMENDED_MAX_CENTS, DEPOSIT_ISO_CURRENCY));
  });
});

// =============================================================================
// 9 / 9b — layering and the display predicate
// =============================================================================

describe('test 9 — layering', () => {
  it('imports neither the database handle nor server-only', () => {
    // Asserted against module SPECIFIERS, not prose: the docblock explains why
    // these two imports are forbidden and must be allowed to say their names.
    expect(DEPOSIT_POLICY_SOURCE).not.toMatch(/from\s+'@\/libs\/DB'/);
    expect(DEPOSIT_POLICY_SOURCE).not.toMatch(/import\s*\(\s*'@\/libs\/DB'\s*\)/);
    expect(DEPOSIT_POLICY_SOURCE).not.toMatch(/import\s+'server-only'/);
  });

  it('never reads the Stripe secret key or tests for a live-key prefix', () => {
    expect(DEPOSIT_POLICY_SOURCE).not.toMatch(/STRIPE_SECRET_KEY|sk_live_|Env\.STRIPE/);
  });

  it('ships exactly the nine specified inactive reasons', () => {
    const union = DEPOSIT_POLICY_SOURCE
      .split('export type DepositPolicyInactiveReason')[1]!
      .split(';')[0]!;
    const members = union.match(/'[a-z_]+'/g) ?? [];

    expect(new Set(members).size).toBe(9);
  });
});

describe('test 9b — isDepositGovernedBySystem is narrow by design', () => {
  it('is true ONLY for an active policy', () => {
    expect(isDepositGovernedBySystem(ACTIVE_POLICY)).toBe(true);

    const reasons: DepositPolicyInactiveReason[] = [
      'collection_not_live',
      'not_entitled',
      'not_configured',
      'disabled',
      'account_not_connected',
      'account_not_charge_ready',
      'readiness_never_synced',
      'currency_unsupported',
      'undetermined',
    ];

    for (const reason of reasons) {
      expect(isDepositGovernedBySystem(inactivePolicy(reason))).toBe(false);
    }
  });
});
