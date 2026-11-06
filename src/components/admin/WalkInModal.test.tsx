import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { WalkInModal } from './WalkInModal';

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: '', bookingTimeZone: 'America/Toronto' }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
});

it('books a walk-in on a chosen date using only server-confirmed times for the selected service', async () => {
  const requests: Array<{ date: string | null; services: string | null; technician: string | null }> = [];
  const bookings: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');

    expect(url.searchParams.get('salonSlug') ?? 'fixture').toBe('fixture');

    if (url.pathname === '/api/admin/technicians') {
      return Response.json({ data: { technicians: [{ id: 'tech', name: 'Daniela' }] } });
    }
    if (url.pathname === '/api/salon/services') {
      return Response.json({ data: { services: [{ id: 'biab', name: 'BIAB French', category: 'manicure', durationMinutes: 90, price: 7500 }] } });
    }
    if (url.pathname === '/api/appointments/availability') {
      const date = url.searchParams.get('date');
      requests.push({ date, services: url.searchParams.get('serviceIds'), technician: url.searchParams.get('technicianId') });
      return Response.json({ slots: [
        { time: '11:00', startTime: `${date}T15:00:00.000Z`, availability: 'available' },
        { time: '11:30', startTime: `${date}T15:30:00.000Z`, availability: 'schedule_conflict' },
      ] });
    }
    if (url.pathname === '/api/appointments' && init?.method === 'POST') {
      bookings.push(JSON.parse(String(init.body)));
      return Response.json({ appointmentId: 'appt_fixture' }, { status: 201 });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }));

  const onSuccess = vi.fn();
  render(<WalkInModal isOpen salonSlug="fixture" onClose={vi.fn()} onSuccess={onSuccess} />);
  const dialog = await screen.findByRole('dialog', { name: 'Quick Walk-in' });
  const service = await within(dialog).findByRole('button', { name: /BIAB French/ });
  const date = within(dialog).getByLabelText('Date', { exact: true });

  expect(service.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(requests).toHaveLength(0);

  fireEvent.click(service);
  fireEvent.change(date, { target: { value: '2099-07-21' } });
  fireEvent.change(within(dialog).getByLabelText('Phone Number *'), { target: { value: '4165550198' } });

  const times = within(dialog).getByRole('region', { name: 'Find a time' });
  const time = await within(times).findByRole('button', { name: '11:00', exact: true });
  const save = within(dialog).getByRole('button', { name: 'Create Appointment' });

  expect(requests.at(-1)).toEqual({ date: '2099-07-21', services: 'biab', technician: 'tech' });
  expect(within(times).queryByRole('button', { name: '11:30', exact: true })).not.toBeInTheDocument();
  expect(save).toBeDisabled();

  fireEvent.click(time);

  expect(within(dialog).getByTestId('new-appointment-summary')).toHaveTextContent('11:00–12:30');

  fireEvent.click(save);
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('2099-07-21'));

  expect(bookings).toEqual([{
    salonSlug: 'fixture',
    serviceIds: ['biab'],
    technicianId: 'tech',
    startTime: '2099-07-21T15:00:00.000Z',
    clientPhone: '4165550198',
  }]);
});
