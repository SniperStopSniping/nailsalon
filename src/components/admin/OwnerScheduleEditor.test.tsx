import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnerScheduleEditor } from './OwnerScheduleEditor';

const fetchMock = vi.fn();
const person = { id: 'tech_1', name: 'Isla', isActive: true, weeklySchedule: { monday: { start: '09:00', end: '18:00' } } };
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, { get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} /> }),
}));

describe('OwnerScheduleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/admin/technicians?')) {
        return new Response(JSON.stringify({ data: { technicians: [person], pagination: { totalPages: 1 } } }));
      }
      if (String(input).includes('/api/staff/time-off?')) {
        return new Response(JSON.stringify({ data: { timeOff: [] } }));
      }
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ data: { technician: { weeklySchedule: JSON.parse(String(init.body)).weeklySchedule } } }));
      }
      throw new Error(`Unexpected request ${input}`);
    });
  });

  it('opens a solo schedule directly and preserves the existing save contract', async () => {
    render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" />);
    fireEvent.change(await screen.findByLabelText('Monday start time'), { target: { value: '10:00' } });

    expect(screen.queryByLabelText('Whose schedule?')).not.toBeInTheDocument();
    expect(screen.queryByText('Time Off')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/staff/time-off'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await screen.findByRole('button', { name: 'Saved' });

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/technicians/tech_1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ salonSlug: 'salon-a', weeklySchedule: { sunday: null, monday: { start: '10:00', end: '18:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null } }),
    }));
  });

  it('opens time off without a competing recurring-hours form', async () => {
    render(<OwnerScheduleEditor salonSlug="salon-a" section="time-off" />);
    await screen.findByText('No upcoming time off');

    expect(screen.queryByRole('button', { name: 'Save Schedule' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/time-off?technicianId=tech_1&salonSlug=salon-a');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('dialog', { name: 'Add Time Off' })).toBeInTheDocument();
  });

  it('never substitutes another person for an invalid record-specific deep link', async () => {
    render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" technicianId="other-salon-tech" />);
    await screen.findByRole('alert');

    expect(screen.queryByLabelText('Monday start time')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('keeps unsaved hours when the owner cancels a person switch', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {
      technicians: [person, { ...person, id: 'tech_2', name: 'Alex' }],
      pagination: { totalPages: 1 },
    } })));
    render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" />);
    fireEvent.change(await screen.findByLabelText('Monday start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Whose schedule?'), { target: { value: 'tech_2' } });
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(screen.getByLabelText('Whose schedule?')).toHaveValue('tech_1');
    expect(screen.getByLabelText('Monday start time')).toHaveValue('10:00');

    fireEvent.change(screen.getByLabelText('Whose schedule?'), { target: { value: 'tech_2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.getByLabelText('Whose schedule?')).toHaveValue('tech_2'));
  });
});
