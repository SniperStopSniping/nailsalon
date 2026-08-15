type ManageDepositCheckoutFinancialSummary = {
  currency: string;
  balanceCents: number;
  depositBlockedCode: string | null;
  depositPresentationState: string;
};

type ManageDepositCheckoutRow = {
  amountCents: number;
  currency: string;
  checkoutUrl: string | null;
};

function normalizeCurrency(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

/**
 * A stored Stripe URL is only a routing hint. Expose it to a manage-link
 * holder when the live hold amount still agrees with the immutable invoice
 * currency and the canonical collectible balance.
 */
export function resolveManageDepositCheckout(input: {
  invoiceCurrency: string | null;
  financialSummary: ManageDepositCheckoutFinancialSummary | null;
  deposit: ManageDepositCheckoutRow | null;
}): { amountCents: number; checkoutUrl: string } | null {
  const { deposit, financialSummary } = input;
  if (
    deposit === null
    || financialSummary === null
    || financialSummary.depositBlockedCode !== null
    || financialSummary.depositPresentationState === 'blocked'
    || !Number.isSafeInteger(deposit.amountCents)
    || deposit.amountCents <= 0
    || !Number.isSafeInteger(financialSummary.balanceCents)
    || financialSummary.balanceCents < deposit.amountCents
    || typeof deposit.checkoutUrl !== 'string'
    || deposit.checkoutUrl.trim().length === 0
  ) {
    return null;
  }

  const invoiceCurrency = normalizeCurrency(input.invoiceCurrency);
  const summaryCurrency = normalizeCurrency(financialSummary.currency);
  const depositCurrency = normalizeCurrency(deposit.currency);
  if (
    invoiceCurrency === null
    || summaryCurrency !== invoiceCurrency
    || depositCurrency !== invoiceCurrency
  ) {
    return null;
  }

  return {
    amountCents: deposit.amountCents,
    checkoutUrl: deposit.checkoutUrl.trim(),
  };
}
