import { describe, expect, it } from 'vitest';

import { reconcileLoyaltyPointsBalance } from './loyaltyBalance';

describe('reconcileLoyaltyPointsBalance', () => {
  it('preserves bonus adjustments when completed spend increases', () => {
    const nextBalance = reconcileLoyaltyPointsBalance({
      currentBalance: 27500,
      previousCompletedSpendCents: 0,
      nextCompletedSpendCents: 6500,
    });

    expect(nextBalance).toBe(28800);
  });

  it('preserves redeemed-point deductions when completed spend changes', () => {
    const nextBalance = reconcileLoyaltyPointsBalance({
      currentBalance: 24000,
      previousCompletedSpendCents: 5000,
      nextCompletedSpendCents: 7500,
    });

    expect(nextBalance).toBe(24500);
  });
});
