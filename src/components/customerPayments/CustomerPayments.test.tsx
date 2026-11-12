import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CustomerPaymentChooserProps } from './CustomerPaymentChooser';
import { CustomerPaymentChooser } from './CustomerPaymentChooser';
import { CustomerPaymentSettings } from './CustomerPaymentSettings';
import { DEFAULT_CUSTOMER_PAYMENT_SETTINGS } from './types';

function props(overrides: Partial<CustomerPaymentChooserProps> = {}): CustomerPaymentChooserProps {
  return {
    choice: 'in_person',
    tipCents: 0,
    cancellationPolicy: 'Cancel 24 hours before your appointment. Contact the salon for refund requests.',
    quote: {
      choice: 'in_person',
      currency: 'CAD',
      tipCents: 0,
      lines: [
        { id: 'service', label: 'Services', amountCents: 5000, recipient: 'Salon' },
        { id: 'tax', label: 'HST', amountCents: 650, recipient: 'Salon, for tax authority' },
      ],
      totalCents: 5650,
      dueNowCents: 0,
      remainingCents: 5650,
    },
    onChoiceChange: vi.fn(),
    onTipChange: vi.fn(),
    onContinue: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

describe('customer payment chooser', () => {
  it('defaults to disabled online payments and a no-tip choice without live claims', () => {
    render(<CustomerPaymentChooser {...props()} />);

    expect(screen.getByRole('radio', { name: 'Pay online' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No tip' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Test mode/)).toBeVisible();
    expect(screen.getByText(/Apple Pay appears in Stripe checkout only/)).toBeVisible();
  });

  it('discloses line recipients inside a native accessible expansion', () => {
    render(<CustomerPaymentChooser {...props()} />);
    const expansion = screen.getByText('ⓘ Tax and fee breakdown');

    expect(expansion.closest('details')).not.toHaveAttribute('open');

    fireEvent.click(expansion);

    expect(expansion.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Recipient: Salon, for tax authority')).toBeVisible();
    expect(screen.getByText('Due now: $0.00')).toBeVisible();
  });

  it('requires online selection for deposit and full-payment policies', () => {
    const { rerender } = render(<CustomerPaymentChooser {...props({ onlineEnabled: true, policy: 'required_deposit' })} />);

    expect(screen.getByRole('radio', { name: 'Pay in person' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with pay in person' })).toBeDisabled();

    rerender(<CustomerPaymentChooser {...props({ onlineEnabled: true, policy: 'full_online_required' })} />);

    expect(screen.getByText('Full online payment is required to secure this booking.')).toBeVisible();
  });

  it('blocks stale tip quotes and invalid totals', () => {
    const initial = props();
    const { rerender } = render(<CustomerPaymentChooser {...initial} tipCents={100} />);

    expect(screen.getByRole('button', { name: 'Continue with pay in person' })).toBeDisabled();

    rerender(<CustomerPaymentChooser {...initial} quote={{ ...initial.quote!, totalCents: 1 }} />);

    expect(screen.getByRole('button', { name: 'Continue with pay in person' })).toBeDisabled();
  });

  it('handles tip removal and back without attempting payment', () => {
    const input = props({ tipCents: 500 });
    render(<CustomerPaymentChooser {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'No tip' }));

    expect(input.onTipChange).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(input.onBack).toHaveBeenCalledOnce();
    expect(input.onContinue).not.toHaveBeenCalled();
  });

  it('suppresses repeated clicks while awaiting checkout', async () => {
    let resolve!: () => void;
    const onContinue = vi.fn(() => new Promise<void>((done) => {
      resolve = done;
    }));
    render(<CustomerPaymentChooser {...props({ onContinue })} />);
    const button = screen.getByRole('button', { name: 'Continue with pay in person' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onContinue).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();

    await act(async () => resolve());

    expect(screen.getByRole('button', { name: 'Continue with pay in person' })).toBeEnabled();
  });

  it('provides recoverable error feedback without success claims', async () => {
    render(<CustomerPaymentChooser {...props({ onContinue: vi.fn().mockRejectedValue(new Error('failed')) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with pay in person' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not continue'));

    expect(screen.getByRole('button', { name: 'Continue with pay in person' })).toBeEnabled();
  });
});

describe('owner payment settings', () => {
  it('starts off, keeps customer fees unavailable and emits only controlled changes', () => {
    const onChange = vi.fn();
    render(<CustomerPaymentSettings value={DEFAULT_CUSTOMER_PAYMENT_SETTINGS} onChange={onChange} />);
    const enabled = screen.getByRole('checkbox');

    expect(enabled).not.toBeChecked();
    expect(screen.getByRole('option', { name: 'Customer pays (review required)' })).toBeDisabled();

    fireEvent.click(enabled);

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CUSTOMER_PAYMENT_SETTINGS, enabled: true });
    expect(screen.getByText(/CAD 1.00 is a preview placeholder/)).toBeVisible();
  });
});
