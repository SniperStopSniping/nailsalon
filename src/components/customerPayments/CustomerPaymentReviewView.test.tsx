import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CustomerPaymentReviewViewProps } from './CustomerPaymentReviewView';
import { CustomerPaymentReviewView } from './CustomerPaymentReviewView';

function props(extra: Partial<CustomerPaymentReviewViewProps> = {}): CustomerPaymentReviewViewProps {
  return {
    preview: {
      evidenceRevision: 'revision-1',
      currency: 'CAD',
      originalInvoiceCents: 12000,
      originalTaxCents: 0,
      originalTipCents: 2000,
      creditNoteCents: 3000,
      customerRefundedCents: 3000,
      retainedCashCents: 9000,
      adjustedBalanceCents: 0,
      allocations: [{ refundId: 'synthetic-refund', principalCents: 2500, tipCents: 500 }],
    },
    reason: '',
    acknowledged: false,
    onReasonChange: vi.fn(),
    onAcknowledgedChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...extra,
  };
}

describe('test payment review presentation', () => {
  it('distinguishes invoice, credit and money returned without offering invoice editing', () => {
    render(<CustomerPaymentReviewView {...props()} />);

    expect(screen.getByText('Original invoice total').nextElementSibling).toHaveTextContent('$120.00');
    expect(screen.getByText('Proposed credit-note adjustment').nextElementSibling).toHaveTextContent('$30.00');
    expect(screen.getByText('Successful customer refunds already recorded').nextElementSibling).toHaveTextContent('$30.00');
    expect(screen.getByText('Retained customer cash').nextElementSibling).toHaveTextContent('$90.00');
    expect(screen.getByText('Proposed adjusted balance').nextElementSibling).toHaveTextContent('$0.00');
    expect(screen.getByRole('button', { name: 'Record test credit note and review' })).toBeDisabled();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveTextContent('principal');
    expect(screen.getByRole('listitem')).toHaveTextContent('$25.00');
    expect(screen.getByRole('listitem')).toHaveTextContent('$5.00');
  });

  it('requires a reason and explicit acknowledgment then delegates confirmation', () => {
    const callbacks = props({ reason: 'Approved test adjustment', acknowledged: true });
    render(<CustomerPaymentReviewView {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record test credit note and review' }));

    expect(callbacks.onConfirm).toHaveBeenCalledOnce();
  });

  it('freezes uncertain payload fields and only offers same-review retry', () => {
    const callbacks = props({ reason: 'Reviewed', acknowledged: true, uncertain: true });
    render(<CustomerPaymentReviewView {...callbacks} />);

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close review' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry same test review' }));

    expect(callbacks.onConfirm).toHaveBeenCalledOnce();
  });

  it('blocks busy, recorded and inconsistent previews', () => {
    const data = props({ reason: 'Reviewed', acknowledged: true, busy: true });
    const { rerender } = render(<CustomerPaymentReviewView {...data} />);

    expect(screen.getByRole('button', { name: 'Recording test review…' })).toBeDisabled();

    rerender(<CustomerPaymentReviewView {...data} busy={false} recorded />);

    expect(screen.getByText(/Test review recorded/)).toHaveTextContent('No money was returned by this action');
    expect(screen.getByRole('button', { name: 'Record test credit note and review' })).toBeDisabled();

    rerender(<CustomerPaymentReviewView {...data} busy={false} preview={{ ...data.preview, adjustedBalanceCents: 100 }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('cannot be recorded');
    expect(screen.getByRole('button', { name: 'Record test credit note and review' })).toBeDisabled();
  });
});
