import { describe, expect, it } from 'vitest';

import { resolveDepositChargeForTotal, resolveDepositPolicy, salonDepositSettingsSchema } from './depositPolicy';

const base = {
  settings: { payments: { deposit: { enabled: false, amountCents: 2500 } } },
  features: { money: { deposits: true } },
  stripeAccount: { chargesEnabled: true, revokedAt: null, lastSyncedAt: new Date(), livemode: false },
  expectedLivemode: false,
};

describe('network risk extends deposit applicability only', () => {
  it('keeps an ordinary disabled deposit off without a server-derived match', () => {
    expect(resolveDepositPolicy(base)).toMatchObject({ active: false, reason: 'disabled' });
    expect(resolveDepositPolicy({ ...base, networkRiskRequired: true })).toEqual({ active: true, amountCents: 2500, currency: 'cad' });
  });

  it('does not narrow the ordinary everyone policy when risk does not apply', () => {
    expect(resolveDepositPolicy({ ...base, settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } }, networkRiskRequired: false }).active).toBe(true);
  });

  it('never bypasses entitlement or payment readiness', () => {
    expect(resolveDepositPolicy({ ...base, networkRiskRequired: true, features: {} })).toMatchObject({ active: false, reason: 'not_entitled' });
    expect(resolveDepositPolicy({ ...base, networkRiskRequired: true, stripeAccount: null })).toMatchObject({ active: false, reason: 'account_not_connected' });
  });

  it('preserves promotions, minimum charge and reschedule semantics', () => {
    const policy = resolveDepositPolicy({ ...base, networkRiskRequired: true });

    expect(resolveDepositChargeForTotal(policy, 1500, { mode: 'authoritative' })).toMatchObject({ required: true, amountCents: 1500 });
    expect(resolveDepositChargeForTotal(policy, 0, { mode: 'authoritative' })).toMatchObject({ required: false });
    expect(resolveDepositChargeForTotal(policy, 5000, { mode: 'authoritative', isReschedule: true })).toEqual({ required: false, reason: 'reschedule' });
  });

  it('accepts only the three consequences, never an owner warning-off option', () => {
    expect(salonDepositSettingsSchema.safeParse({ noShowProtection: 'off' }).success).toBe(false);

    for (const noShowProtection of ['warn_only', 'deposit_1', 'deposit_2']) {
      expect(salonDepositSettingsSchema.safeParse({ noShowProtection }).success).toBe(true);
    }
  });
});
