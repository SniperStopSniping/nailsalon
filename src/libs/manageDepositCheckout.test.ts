import { describe, expect, it } from 'vitest';

import { resolveManageDepositCheckout } from './manageDepositCheckout';

const summary = {
  currency: 'CAD',
  balanceCents: 4500,
  depositBlockedCode: null,
  depositPresentationState: 'none',
};

const deposit = {
  amountCents: 2500,
  currency: 'cad',
  checkoutUrl: 'https://checkout.example/live',
};

describe('resolveManageDepositCheckout', () => {
  it('returns only the canonical positive hold within the remaining balance', () => {
    expect(resolveManageDepositCheckout({
      invoiceCurrency: 'CAD',
      financialSummary: summary,
      deposit,
    })).toEqual({
      amountCents: 2500,
      checkoutUrl: 'https://checkout.example/live',
    });
  });

  const blockedCases: Array<{
    name: string;
    input: Partial<Parameters<typeof resolveManageDepositCheckout>[0]>;
  }> = [
    {
      name: 'canonical summary is missing',
      input: { financialSummary: null },
    },
    {
      name: 'deposit resolution is blocked',
      input: {
        financialSummary: {
          ...summary,
          depositBlockedCode: 'DEPOSIT_REFUND_UNRESOLVED',
          depositPresentationState: 'blocked',
        },
      },
    },
    {
      name: 'hold amount is not positive',
      input: { deposit: { ...deposit, amountCents: 0 } },
    },
    {
      name: 'hold amount is not a safe integer',
      input: { deposit: { ...deposit, amountCents: Number.MAX_SAFE_INTEGER + 1 } },
    },
    {
      name: 'hold exceeds the canonical balance',
      input: { deposit: { ...deposit, amountCents: 4501 } },
    },
    {
      name: 'deposit currency differs from the frozen invoice',
      input: { deposit: { ...deposit, currency: 'usd' } },
    },
    {
      name: 'summary currency differs from the frozen invoice',
      input: { financialSummary: { ...summary, currency: 'USD' } },
    },
    {
      name: 'frozen invoice currency is missing',
      input: { invoiceCurrency: null },
    },
    {
      name: 'stored checkout URL is empty',
      input: { deposit: { ...deposit, checkoutUrl: '  ' } },
    },
  ];

  it.each(blockedCases)('fails closed when $name', ({ input }) => {
    expect(resolveManageDepositCheckout({
      invoiceCurrency: input.invoiceCurrency === undefined ? 'CAD' : input.invoiceCurrency,
      financialSummary: input.financialSummary === undefined ? summary : input.financialSummary,
      deposit: input.deposit === undefined ? deposit : input.deposit,
    })).toBeNull();
  });
});
