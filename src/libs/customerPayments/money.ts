export const CUSTOMER_PAYMENT_SNAPSHOT_VERSION = 1;
export const LUSTER_TRANSACTION_FEE_CENTS = 100;

export type CustomerPaymentFeePolicy = {
  payer: 'salon' | 'customer';
  /** Only the salon-paid fee is supported until tax/legal treatment is approved. */
  taxTreatment: 'not_collected_in_test_mode';
  refundPolicy?: 'proportional';
  feeCents: number;
};

export type CustomerPaymentQuoteInput = {
  currency: 'cad';
  servicesCents: number;
  discountCents: number;
  /** Already calculated by the authoritative salon tax engine, not browser input. */
  taxCents: number;
  tipCents: number;
  collection: 'full' | 'deposit' | 'offline';
  /** Deposit excludes optional tip, which is collected in addition. */
  depositCents?: number;
  feePolicy?: CustomerPaymentFeePolicy;
};

export function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INVALID_CENTS:${field}`);
  }
}

export function calculatePaymentSnapshot(input: CustomerPaymentQuoteInput) {
  for (const field of ['servicesCents', 'discountCents', 'taxCents', 'tipCents'] as const) {
    assertCents(input[field], field);
  }
  if (input.currency !== 'cad' || !['full', 'deposit', 'offline'].includes(input.collection)) {
    throw new Error('UNSUPPORTED_PAYMENT_CONFIGURATION');
  }
  if (input.discountCents > input.servicesCents) {
    throw new Error('DISCOUNT_EXCEEDS_SERVICES');
  }
  const feePolicy = input.feePolicy ?? {
    payer: 'salon',
    taxTreatment: 'not_collected_in_test_mode',
    feeCents: LUSTER_TRANSACTION_FEE_CENTS,
  };
  assertCents(feePolicy.feeCents, 'feeCents');
  if (feePolicy.payer !== 'salon' || feePolicy.taxTreatment !== 'not_collected_in_test_mode'
    || feePolicy.feeCents > 10000 || (feePolicy.refundPolicy ?? 'proportional') !== 'proportional') {
    throw new Error('UNSUPPORTED_FEE_POLICY');
  }
  const serviceTotalCents = input.servicesCents - input.discountCents + input.taxCents;
  assertCents(serviceTotalCents, 'serviceTotalCents');
  const totalCents = serviceTotalCents + input.tipCents;
  assertCents(totalCents, 'totalCents');
  let collectionBaseCents = serviceTotalCents;
  if (input.collection === 'deposit') {
    assertCents(input.depositCents ?? Number.NaN, 'depositCents');
    if (!input.depositCents || input.depositCents > serviceTotalCents) {
      throw new Error('INVALID_DEPOSIT_AMOUNT');
    }
    collectionBaseCents = input.depositCents;
  } else if (input.depositCents !== undefined) {
    throw new Error('UNEXPECTED_DEPOSIT_AMOUNT');
  }
  const chargeCents = input.collection === 'offline' ? 0 : collectionBaseCents + input.tipCents;
  assertCents(chargeCents, 'chargeCents');
  // A comped service does not incur the platform fee, even if the customer tips.
  const applicationFeeCents = input.collection !== 'offline' && collectionBaseCents > 0 ? feePolicy.feeCents : 0;
  if (applicationFeeCents > 0 && chargeCents <= applicationFeeCents) {
    throw new Error('CHARGE_MUST_EXCEED_APPLICATION_FEE');
  }
  return Object.freeze({
    version: CUSTOMER_PAYMENT_SNAPSHOT_VERSION,
    currency: input.currency,
    servicesCents: input.servicesCents,
    discountCents: input.discountCents,
    taxCents: input.taxCents,
    tipCents: input.tipCents,
    collection: input.collection,
    depositCents: input.collection === 'deposit' ? input.depositCents! : null,
    serviceTotalCents,
    totalCents,
    chargeCents,
    remainingCents: totalCents - chargeCents,
    applicationFeeCents,
    customerPlatformFeeCents: 0,
    customerFeeTaxCents: 0,
    feePayer: 'salon' as const,
    // Test-only bookkeeping marker, not a determination of taxability.
    feeTaxTreatment: feePolicy.taxTreatment,
    feeRefundPolicy: 'proportional' as const,
    configuredFeeCents: feePolicy.feeCents,
    // Stripe processing fees are the connected account's separate expense.
    stripeProcessingFeePayer: 'account' as const,
  });
}

export type CustomerPaymentSnapshot = ReturnType<typeof calculatePaymentSnapshot>;
