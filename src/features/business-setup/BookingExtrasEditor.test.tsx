import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { BookingExtrasEditor } from './BookingExtrasEditor';
import { BookingExtrasSummary } from './BookingExtrasSummary';
import type { SetupDocument } from './contracts';

const document = { deposit: { enabled: false, amountCents: 2500 }, depositEditedFields: ['amountCents'], reminders: { rules: [{ id: 'crule_default_24h', offsetMinutes: 1440, channels: 'both', enabled: true }], quietHours: { enabled: true, start: '21:00', end: '09:00' } }, remindersEditedFields: ['rules'] } as SetupDocument;

it('saves a deposit amount without turning collection on or changing reminder settings', () => {
  const onDeposit = vi.fn();
  const onReminders = vi.fn();
  render(<BookingExtrasEditor document={document} disabled={false} onDeposit={onDeposit} onReminders={onReminders} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Deposit amount (CAD)' }), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save deposit proposal' }));

  expect(onDeposit).toHaveBeenCalledWith({ enabled: false, amountCents: 3000 });
  expect(onReminders).not.toHaveBeenCalled();
  expect(screen.getByText(/Collection needs a connected, charge-ready payment account/)).toBeVisible();
});

it('edits reminder timing in hours while retaining canonical IDs and quiet hours', () => {
  const onReminders = vi.fn();
  render(<BookingExtrasEditor document={document} disabled={false} onDeposit={vi.fn()} onReminders={onReminders} />);

  expect(screen.getByRole('spinbutton', { name: 'Hours before appointment' })).toHaveValue(24);

  fireEvent.change(screen.getByRole('spinbutton', { name: 'Hours before appointment' }), { target: { value: '48' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder proposal' }));

  expect(onReminders).toHaveBeenCalledWith({ ...document.reminders, rules: [{ ...document.reminders!.rules[0], offsetMinutes: 2880 }] });
});

it('prevents duplicate enabled reminders and protects controls during a save', () => {
  const onReminders = vi.fn();
  const { rerender } = render(<BookingExtrasEditor document={document} disabled={false} onDeposit={vi.fn()} onReminders={onReminders} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));
  fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Hours before appointment' })[1]!, { target: { value: '24' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder proposal' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Duplicate enabled reminder offset');
  expect(onReminders).not.toHaveBeenCalled();

  rerender(<BookingExtrasEditor document={document} disabled onDeposit={vi.fn()} onReminders={onReminders} />);

  expect(screen.getByRole('button', { name: 'Save reminder proposal' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save deposit proposal' })).toBeDisabled();
});

it('shows truthful proposed amounts and reminders without rule IDs or a delivery claim', () => {
  render(<BookingExtrasSummary document={document} />);
  fireEvent.click(screen.getByText('Proposed deposits and reminders'));

  expect(screen.getByText(/Deposit amount:.*25.*Regular collection off/)).toBeVisible();
  expect(screen.getByText(/24 hours before.*Nothing is sent in preview/)).toBeVisible();
  expect(screen.queryByText('crule_default_24h')).not.toBeInTheDocument();
});
