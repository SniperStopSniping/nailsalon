import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { BookingLinkEditor } from './BookingLinkEditor';

afterEach(cleanup);

it('lets an owner use and save a readable suggestion with no billable AI request', () => {
  const onSave = vi.fn();
  render(<BookingLinkEditor slug="studio-123" businessName="Élégance Nails" locale="en" disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use elegance-nails' }));

  expect(screen.getByRole('textbox', { name: 'Booking link name' })).toHaveValue('elegance-nails');
  expect(screen.getByText('/en/elegance-nails/book')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Save booking link' }));

  expect(onSave).toHaveBeenCalledWith('elegance-nails');
});

it('explains an invalid name beside its field instead of submitting it', () => {
  const onSave = vi.fn();
  render(<BookingLinkEditor slug="studio-123" businessName="Studio" locale="en" disabled={false} onSave={onSave} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Booking link name' }), { target: { value: 'admin' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save booking link' }));

  expect(screen.getByRole('textbox', { name: 'Booking link name' })).toHaveAttribute('aria-invalid', 'true');
  expect(onSave).not.toHaveBeenCalled();
});

it('disables suggestions, editing and saving during a request', () => {
  render(<BookingLinkEditor slug="studio-123" businessName="Studio" locale="en" disabled onSave={vi.fn()} />);

  expect(screen.getByRole('textbox', { name: 'Booking link name' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use studio' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save booking link' })).toBeDisabled();
});
