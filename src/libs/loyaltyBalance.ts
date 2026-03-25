import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';

type ReconcileLoyaltyPointsParams = {
  currentBalance: number | null | undefined;
  previousCompletedSpendCents: number | null | undefined;
  nextCompletedSpendCents: number | null | undefined;
};

/**
 * Preserve non-spend adjustments (welcome/profile/referral bonuses, redemptions, refunds)
 * while refreshing spend-based points from completed appointment totals.
 */
export function reconcileLoyaltyPointsBalance({
  currentBalance,
  previousCompletedSpendCents,
  nextCompletedSpendCents,
}: ReconcileLoyaltyPointsParams): number {
  const safeCurrentBalance = Number.isFinite(currentBalance) ? Math.max(0, Number(currentBalance)) : 0;
  const previousSpendPoints = computeEarnedPointsFromCents(previousCompletedSpendCents ?? 0);
  const nextSpendPoints = computeEarnedPointsFromCents(nextCompletedSpendCents ?? 0);
  const nonSpendAdjustment = safeCurrentBalance - previousSpendPoints;

  return Math.max(0, nextSpendPoints + nonSpendAdjustment);
}
