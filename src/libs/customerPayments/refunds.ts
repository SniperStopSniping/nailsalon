import { assertCents } from './money';

/**
 * Compute against locked, persisted cumulative successful refund totals.
 * Persist a unique provider refund ID and fee-refund operation alongside this delta.
 * Replaying the same cumulative state after persisting the delta returns zero.
 * This is a calculation, not an exactly-once ledger or a Stripe refund call.
 */
export function calculateApplicationFeeRefund(input: {
  originalChargeCents: number;
  originalApplicationFeeCents: number;
  cumulativeChargeRefundedCents: number;
  applicationFeeAlreadyRefundedCents: number;
}) {
  for (const [field, value] of Object.entries(input)) {
    assertCents(value, field);
  }
  const { originalChargeCents: charge, originalApplicationFeeCents: fee, cumulativeChargeRefundedCents: refunded, applicationFeeAlreadyRefundedCents: reversed } = input;
  if (charge <= 0 || fee >= charge || refunded > charge || reversed > fee) {
    throw new Error('INVALID_REFUND_TOTALS');
  }
  // Floor cumulative proportions rather than rounding each partial independently.
  // BigInt keeps multiplication exact even at the safe-integer boundary.
  const targetFeeRefundCents = Number(BigInt(fee) * BigInt(refunded) / BigInt(charge));
  if (reversed > targetFeeRefundCents) {
    throw new Error('FEE_REFUND_EXCEEDS_CUMULATIVE_TARGET');
  }
  return {
    targetFeeRefundCents,
    additionalFeeRefundCents: targetFeeRefundCents - reversed,
  };
}
