import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CLOSED_HOURS, type SetupService, type SetupStaff } from './contracts';
import { TeamBookingSummary } from './TeamBookingSummary';
import { TeamEditor } from './TeamEditor';

const hours = { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } };
const services: SetupService[] = [{ id: 'gel', name: 'Gel', description: null, category: 'manicure', bookingCategory: 'manicure', priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, confirmed: true, origin: 'existing' }];
const person: SetupStaff = { id: 'alex', name: 'Alex', isActive: true, assignmentMode: 'explicit', serviceIds: ['gel'], hours };

it('saves team name and service choices without resetting an existing draft schedule', () => {
  const onSave = vi.fn();
  render(<TeamEditor staff={[person]} services={services} hours={hours} revision={2} disabled={false} onSave={onSave} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Booking name' }), { target: { value: 'Alex Smith' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save team member' }));

  expect(onSave).toHaveBeenCalledWith({ ...person, name: 'Alex Smith', hours: null });
});

it('enables schedule edits explicitly and submits the seven-day schedule', () => {
  const onSave = vi.fn();
  render(<TeamEditor staff={[person]} services={services} hours={hours} revision={2} disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByText('Working hours', { exact: true }));
  const start = screen.getByLabelText('Alex monday starts');

  expect(start).toBeDisabled();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep this draft’s schedule' }));
  fireEvent.change(start, { target: { value: '11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save team member' }));

  expect(onSave).toHaveBeenCalledWith({ ...person, hours: { ...hours, monday: { open: '11:00', close: '17:00' } } });
});

it('requires service selection for new profiles and disables changes while saving', () => {
  const onSave = vi.fn();
  const { rerender } = render(<TeamEditor staff={[]} services={services} hours={hours} revision={2} disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a team member' }));

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^draft_/), assignmentMode: 'explicit', serviceIds: [], hours }));

  rerender(<TeamEditor staff={[person]} services={services} hours={hours} revision={3} disabled onSave={onSave} />);

  expect(screen.getByRole('button', { name: 'Save team member' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Booking name' })).toBeDisabled();
});

it('shows readable proposed services, schedules and simulation limits in preview', () => {
  render(<TeamBookingSummary document={{ staff: [person], services } as never} />);
  fireEvent.click(screen.getByText('Proposed team and service choices'));

  expect(screen.getByText(/Alex: accepting bookings; Gel; monday: 09:00–17:00/)).toBeVisible();
  expect(screen.getByText(/Availability examples exclude existing appointments/)).toBeVisible();
  expect(screen.queryByText('gel', { exact: true })).not.toBeInTheDocument();
});
