import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContactDetailsForm } from './ContactDetailsForm';

const contact = { name: 'Alex Test', email: 'alex@example.test', phone: '+1 (416) 555-0100' };

describe('ContactDetailsForm', () => {
  it('requires valid phone and email without passing details to a chat callback', () => {
    const onReview = vi.fn();
    const { rerender } = render(<ContactDetailsForm locale="en" contact={{ ...contact, phone: '123' }} disabled={false} onChange={vi.fn()} onReview={onReview} />);
    fireEvent.submit(screen.getByRole('form'));

    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('10-digit phone');

    rerender(<ContactDetailsForm locale="en" contact={contact} disabled={false} onChange={vi.fn()} onReview={onReview} />);
    fireEvent.submit(screen.getByRole('form'));

    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledWith();
  });

  it('offers French labels, required accessible inputs and preserves entered contact on failure', () => {
    const onChange = vi.fn();
    render(<ContactDetailsForm locale="fr" contact={contact} disabled={false} onChange={onChange} onReview={vi.fn()} />);

    expect(screen.getByLabelText('Numéro de téléphone')).toBeRequired();
    expect(screen.getByLabelText('Adresse courriel')).toHaveAttribute('type', 'email');

    fireEvent.change(screen.getByLabelText('Nom complet'), { target: { value: 'Alex Updated' } });

    expect(onChange).toHaveBeenCalledWith({ ...contact, name: 'Alex Updated' });
    expect(screen.getByLabelText('Numéro de téléphone')).toHaveValue(contact.phone);
  });

  it('shows the expanded text choice checked by default and records an explicit uncheck', () => {
    const onSmsChange = vi.fn();
    render(<ContactDetailsForm locale="en" contact={contact} disabled={false} onChange={vi.fn()} onReview={vi.fn()} onSmsChange={onSmsChange} />);

    const updates = screen.getByRole('checkbox', { name: 'Text updates' });

    expect(updates).toBeChecked();
    expect(screen.getByText('Text me appointment confirmations, reminders, review requests, and salon promotions')).toBeInTheDocument();

    fireEvent.click(updates);

    expect(onSmsChange).toHaveBeenCalledWith({ granted: false, selection: 'explicit_off', wordingVersion: 'booking-sms-all-v2' });
  });
});
