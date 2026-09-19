import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnerScheduleEditor } from './OwnerScheduleEditor';

const fetchMock = vi.fn();
const person = { id: 'tech_1', name: 'Isla', isActive: true, weeklySchedule: { monday: { start: '09:00', end: '18:00' } } };
const detailPerson = { ...person, weeklySchedule: { sunday: null, monday: { start: '09:00', end: '18:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null } };
vi.mock('framer-motion', () => {
  const MotionDiv = (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, { get: () => MotionDiv }),
  };
});

describe('OwnerScheduleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/admin/technicians?')) {
        return new Response(JSON.stringify({ data: { technicians: [person], pagination: { totalPages: 1 } } }));
      }
      if (String(input).startsWith('/api/admin/technicians/tech_1?')) {
        return new Response(JSON.stringify({ data: { technician: detailPerson } }));
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
    const user = userEvent.setup();
    render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" />);
    await screen.findByLabelText('Monday start time');
    await user.selectOptions(screen.getByLabelText('Monday start time'), '10:00');

    expect(screen.queryByLabelText('Whose schedule?')).not.toBeInTheDocument();
    expect(screen.queryByText('Time Off')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/staff/time-off'))).toBe(false);

    expect(screen.getByLabelText('Monday start time')).toHaveValue('10:00');

    await user.click(screen.getByRole('button', { name: 'Save Schedule' }));
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

  it('uses the resolved detail schedule when a legacy list row has no weekly schedule', async () => {
    const legacyPerson = { ...person, weeklySchedule: null };
    const resolvedDetail = {
      ...detailPerson,
      weeklySchedule: {
        sunday: { start: '12:00', end: '20:30' },
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: { start: '11:00', end: '21:00' },
      },
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/admin/technicians?')) {
        return new Response(JSON.stringify({ data: { technicians: [legacyPerson], pagination: { totalPages: 1 } } }));
      }
      if (String(input).startsWith('/api/admin/technicians/tech_1?')) {
        return new Response(JSON.stringify({ data: { technician: resolvedDetail } }));
      }
      throw new Error(`Unexpected request ${input}`);
    });

    render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" />);

    expect(await screen.findByLabelText('Saturday start time')).toHaveValue('11:00');
    expect(screen.getByLabelText('Sunday end time')).toHaveValue('20:30');
    expect(screen.queryByLabelText('Monday start time')).not.toBeInTheDocument();
  });

  it('keeps the editor hidden when a selected technician detail request fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/admin/technicians?')) {
        return new Response(JSON.stringify({ data: { technicians: [person], pagination: { totalPages: 1 } } }));
      }
      if (String(input).startsWith('/api/admin/technicians/tech_1?')) {
        return new Response(JSON.stringify({ error: { message: 'Could not load this working schedule.' } }), { status: 500 });
      }
      throw new Error(`Unexpected request ${input}`);
    });

    render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this working schedule.');
    expect(screen.queryByLabelText('Monday start time')).not.toBeInTheDocument();
  });

  it('ignores a stale detail response after the salon changes', async () => {
    let resolveOldDetail: ((response: Response) => void) | undefined;
    const oldDetail = { ...detailPerson, weeklySchedule: { ...detailPerson.weeklySchedule, monday: { start: '09:00', end: '18:00' } } };
    const newDetail = { ...detailPerson, weeklySchedule: { ...detailPerson.weeklySchedule, monday: { start: '12:00', end: '20:00' } } };
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/technicians?')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { technicians: [person], pagination: { totalPages: 1 } } })));
      }
      if (url.startsWith('/api/admin/technicians/tech_1?salonSlug=salon-a')) {
        return new Promise<Response>((resolve) => {
          resolveOldDetail = resolve;
        });
      }
      if (url.startsWith('/api/admin/technicians/tech_1?salonSlug=salon-b')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { technician: newDetail } })));
      }
      throw new Error(`Unexpected request ${input}`);
    });

    const rendered = render(<OwnerScheduleEditor salonSlug="salon-a" section="hours" />);
    await waitFor(() => expect(resolveOldDetail).toBeDefined());

    rendered.rerender(<OwnerScheduleEditor salonSlug="salon-b" section="hours" />);

    expect(await screen.findByLabelText('Monday start time')).toHaveValue('12:00');

    resolveOldDetail!(new Response(JSON.stringify({ data: { technician: oldDetail } })));
    await waitFor(() => expect(screen.getByLabelText('Monday start time')).toHaveValue('12:00'));
  });

  it('keeps unsaved hours when the owner cancels a person switch', async () => {
    const secondPerson = { ...person, id: 'tech_2', name: 'Alex' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/admin/technicians?')) {
        return new Response(JSON.stringify({ data: { technicians: [person, secondPerson], pagination: { totalPages: 1 } } }));
      }
      if (String(input).startsWith('/api/admin/technicians/tech_1?')) {
        return new Response(JSON.stringify({ data: { technician: detailPerson } }));
      }
      if (String(input).startsWith('/api/admin/technicians/tech_2?')) {
        return new Response(JSON.stringify({ data: { technician: { ...detailPerson, ...secondPerson } } }));
      }
      throw new Error(`Unexpected request ${input}`);
    });
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
