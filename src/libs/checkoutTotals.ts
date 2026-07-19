/**
 * Checkout money pipeline — the ONE place totals are computed.
 *
 * Pipeline order (fixed by spec):
 *   services → add-ons → custom items → discount (prorated across
 *   taxable/non-taxable) → taxable subtotal → tax → tip → payments → balance.
 *
 * Pinned invariants (reporting depends on these):
 * - `finalPriceCents` is ALWAYS net-of-tax, post-discount service revenue,
 *   in BOTH tax modes. Inclusive mode decomposes the included tax out of the
 *   displayed prices; exclusive ("added at checkout") mode never adds it in.
 * - `totalDueCents = finalPriceCents + taxAmountCents + tipCents` (both modes).
 * - Tips are never taxed. Payments/deposits reduce the balance after tax and
 *   are never taxed again.
 * - All arithmetic is exact integer math (cents / basis points); tax rounding
 *   is half-up. No floats anywhere.
 *
 * Revenue policy (documented once, applied by every consumer):
 * - Revenue reports count completed appointments regardless of collection
 *   state ('comp' counts 0). Client spending / loyalty count only
 *   status='completed' AND payment_status='paid' rows.
 */

export type CheckoutItemInput = {
  /** Displayed line total in cents (gross when prices include tax). */
  lineTotalCents: number;
  taxable: boolean;
};

export type ResolvedTaxConfig = {
  enabled: boolean;
  name: string | null;
  /** Basis points: 13% = 1300. */
  rateBps: number;
  /** true = displayed prices include tax; false = tax added at checkout. */
  pricesIncludeTax: boolean;
  taxServicesByDefault: boolean;
  taxAddOnsByDefault: boolean;
  taxCustomByDefault: boolean;
};

export type CheckoutTotalsInput = {
  items: CheckoutItemInput[];
  /** Checkout-time discount on displayed prices; clamped to [0, subtotal]. */
  discountCents?: number;
  taxConfig: ResolvedTaxConfig;
  /** Appointment-level exemption (admin-only upstream). */
  taxExempt?: boolean;
  tipCents?: number;
};

export type CheckoutTotals = {
  /** Sum of displayed line totals, pre-discount. */
  finalSubtotalCents: number;
  /** Discount actually applied (clamped). */
  finalDiscountCents: number;
  /** Post-discount taxable base (displayed prices). 0 when tax is off/exempt. */
  taxableSubtotalCents: number;
  taxAmountCents: number;
  /** Net-of-tax, post-discount revenue. */
  finalPriceCents: number;
  tipCents: number;
  totalDueCents: number;
  taxApplied: boolean;
};

/** Exact integer division with half-up rounding. Inputs must be non-negative. */
function divideHalfUp(numerator: number, denominator: number): number {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/**
 * Split `discount` across the taxable and non-taxable pools proportionally,
 * assigning the leftover cent to the larger fractional share (largest
 * remainder). Returns the taxable share.
 */
function prorateDiscountToTaxable(
  discountCents: number,
  taxableSubtotal: number,
  totalSubtotal: number,
): number {
  if (discountCents <= 0 || taxableSubtotal <= 0) {
    return 0;
  }
  if (taxableSubtotal >= totalSubtotal) {
    return Math.min(discountCents, taxableSubtotal);
  }
  const exactNumerator = discountCents * taxableSubtotal;
  const floorShare = Math.floor(exactNumerator / totalSubtotal);
  const remainderTaxable = exactNumerator - floorShare * totalSubtotal;
  // Non-taxable share's remainder is (totalSubtotal - remainderTaxable) % totalSubtotal;
  // give the leftover cent to the pool with the larger remainder (ties → taxable).
  const share = remainderTaxable * 2 >= totalSubtotal ? floorShare + 1 : floorShare;
  return Math.min(share, taxableSubtotal);
}

export function computeCheckoutTotals(input: CheckoutTotalsInput): CheckoutTotals {
  const tipCents = Math.max(0, Math.trunc(input.tipCents ?? 0));
  const items = input.items.map(item => ({
    lineTotalCents: Math.max(0, Math.trunc(item.lineTotalCents)),
    taxable: item.taxable,
  }));

  const finalSubtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const finalDiscountCents = Math.min(
    Math.max(0, Math.trunc(input.discountCents ?? 0)),
    finalSubtotalCents,
  );

  const taxApplied = input.taxConfig.enabled
    && !input.taxExempt
    && input.taxConfig.rateBps > 0;

  const grossTaxablePool = items
    .filter(item => item.taxable)
    .reduce((sum, item) => sum + item.lineTotalCents, 0);

  const discountedSubtotal = finalSubtotalCents - finalDiscountCents;

  let taxableSubtotalCents = 0;
  let taxAmountCents = 0;
  let finalPriceCents = discountedSubtotal;

  if (taxApplied) {
    const discountToTaxable = prorateDiscountToTaxable(
      finalDiscountCents,
      grossTaxablePool,
      finalSubtotalCents,
    );
    taxableSubtotalCents = Math.max(0, grossTaxablePool - discountToTaxable);
    const { rateBps } = input.taxConfig;

    if (input.taxConfig.pricesIncludeTax) {
      // Decompose the included tax out of the displayed taxable base.
      taxAmountCents = divideHalfUp(taxableSubtotalCents * rateBps, 10000 + rateBps);
      finalPriceCents = discountedSubtotal - taxAmountCents;
    } else {
      taxAmountCents = divideHalfUp(taxableSubtotalCents * rateBps, 10000);
      finalPriceCents = discountedSubtotal;
    }
  }

  return {
    finalSubtotalCents,
    finalDiscountCents,
    taxableSubtotalCents,
    taxAmountCents,
    finalPriceCents,
    tipCents,
    totalDueCents: finalPriceCents + taxAmountCents + tipCents,
    taxApplied,
  };
}

export type BalanceInput = {
  finalPriceCents: number | null;
  taxAmountCents: number | null;
  tipCents: number | null;
  amountPaidCents: number | null;
  paymentStatus?: string | null;
};

/**
 * Balance for a completed appointment, from stored snapshots only.
 * Complimentary appointments owe nothing.
 */
export function computeBalance(input: BalanceInput): {
  totalDueCents: number;
  amountPaidCents: number;
  balanceCents: number;
} {
  const totalDueCents
    = (input.finalPriceCents ?? 0)
    + (input.taxAmountCents ?? 0)
    + (input.tipCents ?? 0);
  const amountPaidCents = input.amountPaidCents ?? 0;
  const balanceCents = input.paymentStatus === 'comp'
    ? 0
    : Math.max(0, totalDueCents - amountPaidCents);
  return { totalDueCents, amountPaidCents, balanceCents };
}

/**
 * Payment status derived from money facts. A zero-due appointment (e.g. 100%
 * discount) is 'paid' with no payments. 'comp' is never derived — it is an
 * explicit admin action.
 */
export function derivePaymentStatus(totalDueCents: number, amountPaidCents: number): 'pending' | 'partially_paid' | 'paid' {
  if (amountPaidCents >= totalDueCents) {
    return 'paid';
  }
  return amountPaidCents > 0 ? 'partially_paid' : 'pending';
}

/**
 * Deterministic human-readable payment reference for an appointment — shown in
 * e-Transfer instructions, the QR page, and receipts. No PII, no storage.
 */
export function buildPaymentReference(appointmentId: string): string {
  const tail = appointmentId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return `LSTR-${tail || 'APPT'}`;
}
