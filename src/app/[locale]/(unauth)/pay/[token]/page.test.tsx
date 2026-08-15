import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PayPage from './page';

const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'public-token' }),
}));

function payData(overrides: Record<string, unknown> = {}) {
  return {
    salonName: 'Luster Studio',
    amountDueCents: 2585,
    totalCents: 5085,
    depositCreditCents: 2000,
    depositRefundedCents: 500,
    appointmentPaymentsCents: 500,
    amountAlreadyPaidCents: 2500,
    currency: 'CAD',
    isFinalized: true,
    reference: 'LSTR-APPT01',
    recipient: 'pay@salon.ca',
    recipientName: 'Luster Studio',
    autodepositEnabled: true,
    requireReference: true,
    instructions: 'Include the reference.',
    ...overrides,
  };
}

describe('public payment page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows the same deposit, refund, payment, paid, and balance breakdown as checkout', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: payData() }), { status: 200 }));

    render(<PayPage />);

    expect(await screen.findByTestId('pay-page-deposit-paid')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('pay-page-deposit-refunded')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('pay-page-other-payments')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('pay-page-already-paid')).toHaveTextContent('$25.00');
    expect(screen.getByTestId('pay-page-balance')).toHaveTextContent('$25.85');
    expect(screen.getByRole('button', { name: 'Copy amount' })).toBeEnabled();
  });

  it('offers no transfer or copy action when the canonical balance is zero', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: payData({
        amountDueCents: 0,
        totalCents: 2500,
        depositCreditCents: 2500,
        depositRefundedCents: 0,
        appointmentPaymentsCents: 0,
        amountAlreadyPaidCents: 2500,
      }),
    }), { status: 200 }));

    render(<PayPage />);

    expect(await screen.findByTestId('pay-page-settled')).toHaveTextContent('no remaining balance');
    expect(screen.queryByRole('button', { name: 'Copy amount' })).not.toBeInTheDocument();
    expect(screen.queryByText('Pay by Interac e-Transfer')).not.toBeInTheDocument();
  });

  it('shows reconciliation guidance without any transfer action for a blocked amount', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED',
        message: 'This payment amount is under review because collected money exceeds the invoice.',
      },
    }), { status: 409 }));

    render(<PayPage />);

    expect(await screen.findByTestId('pay-page-financial-review')).toHaveTextContent(
      'collected money exceeds the invoice',
    );
    expect(screen.getByTestId('pay-page-financial-review')).toHaveTextContent(
      'Do not send a transfer',
    );
    expect(screen.queryByTestId('pay-page-invalid')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy/i })).not.toBeInTheDocument();
  });
});
