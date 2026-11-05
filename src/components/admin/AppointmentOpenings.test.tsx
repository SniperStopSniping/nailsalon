import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { AppointmentOpenings } from './AppointmentOpenings';

afterEach(() => vi.unstubAllGlobals());

it('offers only authoritative available slots and preserves the server timestamp', async () => {
  const available = { time: '10:00', startTime: '2099-07-20T14:00:00.000Z', availability: 'available' };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ slots: [available, { time: '10:30', availability: 'schedule_conflict' }] }) });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  render(<AppointmentOpenings salonSlug="test" date="2099-07-20" technicianId="tech" serviceIds={['base', 'removal']} onNextDay={vi.fn()} onSelect={onSelect} />);
  fireEvent.click(await screen.findByRole('button', { name: '10:00' }));

  expect(onSelect).toHaveBeenCalledWith(available);
  expect(screen.queryByRole('button', { name: '10:30' })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[0]![0]).toContain('serviceIds=base%2Cremoval');
});

it('removes old openings immediately when services change and distinguishes failed checks', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ slots: [{ time: '10:00', startTime: '2099-07-20T14:00:00Z', availability: 'available' }] }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Calendar unavailable' } }) });
  vi.stubGlobal('fetch', fetchMock);
  const props = { salonSlug: 'test', date: '2099-07-20', technicianId: null, onNextDay: vi.fn(), onSelect: vi.fn() };
  const view = render(<AppointmentOpenings {...props} serviceIds={['base']} />);
  await screen.findByRole('button', { name: '10:00' });
  view.rerender(<AppointmentOpenings {...props} serviceIds={['base', 'removal']} />);

  expect(screen.queryByRole('button', { name: '10:00' })).not.toBeInTheDocument();

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Calendar unavailable/));

  expect(screen.queryByText(/No times fit/)).not.toBeInTheDocument();
});
