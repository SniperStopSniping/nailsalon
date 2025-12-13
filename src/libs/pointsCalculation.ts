/**
 * Points Calculation Utility
 *
 * Single source of truth for computing earned loyalty points.
 * Used by both UI (preview) and backend (actual awarding).
 */

import { LOYALTY_POINTS } from '@/utils/AppConfig';

/**
 * Compute earned points from amount in cents.
 * PER_DOLLAR_SPENT=20 means 20 points per $1.
 *
 * @param amountCents - Amount in cents (e.g., 7500 for $75.00)
 * @returns Points earned (integer, always >= 0)
 *
 * @example
 * computeEarnedPointsFromCents(7500) // $75.00 → 1500 points (at 20 pts/$1)
 * computeEarnedPointsFromCents(7499) // $74.99 → 1499 points
 */
export function computeEarnedPointsFromCents(amountCents: number): number {
  // Sanitize input: ensure finite, non-negative integer
  const safe = Number.isFinite(amountCents) ? Math.max(0, Math.floor(amountCents)) : 0;
  // Convert cents to dollars, multiply by points per dollar
  return Math.floor((safe / 100) * LOYALTY_POINTS.PER_DOLLAR_SPENT);
}
