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

it('rechecks the selected service and removal together before offering a time', async () => {
  const early = { time: '09:00', startTime: '2099-07-20T13:00:00Z', availability: 'available' };
  const late = { time: '16:30', startTime: '2099-07-20T20:30:00Z', availability: 'available' };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ slots: [early, late] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        slots: [early, { ...late, availability: 'schedule_conflict' }],
        durationMinutes: 95,
        serviceSubtotalCents: 8000,
        hasUnpricedExtras: false,
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const props = { salonSlug: 'test', date: '2099-07-20', technicianId: 'tech', serviceIds: ['base'], onSelect, onNextDay: vi.fn() };
  const view = render(<AppointmentOpenings {...props} />);
  await screen.findByRole('button', { name: '16:30' });

  view.rerender(<AppointmentOpenings {...props} selectedAddOns={[{ addOnId: 'removal', quantity: 1 }]} />);

  expect(screen.queryByRole('button', { name: '16:30' })).not.toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: '09:00' }));

  const params = new URL(fetchMock.mock.calls[1]![0], 'https://localhost').searchParams;

  expect(params.get('baseServiceId')).toBe('base');
  expect(params.get('includeQuote')).toBe('1');
  expect(JSON.parse(params.get('selectedAddOns')!)).toEqual([{ addOnId: 'removal', quantity: 1 }]);
  expect(params.has('serviceIds')).toBe(false);
  expect(onSelect).toHaveBeenCalledWith(early, { durationMinutes: 95, serviceSubtotalCents: 8000, hasUnpricedExtras: false });
  expect(screen.queryByRole('button', { name: '16:30' })).not.toBeInTheDocument();
});

it('searches past a closed day and selects an opening with its own date and quote', async () => {
  const slot = { time: '11:00', startTime: '2099-07-22T15:00:00.000Z', availability: 'available' };
  const fetchMock = vi.fn(async (url: string) => {
    const date = new URL(url, 'https://localhost').searchParams.get('date');
    const unavailable = date === '2099-07-20' || date === '2099-07-21';
    return {
      ok: true,
      json: async () => ({
        slots: unavailable ? [] : [{ ...slot, startTime: `${date}T15:00:00.000Z` }],
        durationMinutes: 95,
        serviceSubtotalCents: 7500,
        hasUnpricedExtras: false,
      }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  render(
    <AppointmentOpenings
      salonSlug="test"
      date="2099-07-20"
      technicianId="tech"
      serviceIds={['biab']}
      selectedAddOns={[{ addOnId: 'removal', quantity: 1 }]}
      searchAhead
      onNextDay={vi.fn()}
      onSelect={onSelect}
    />,
  );

  await waitFor(() => expect(screen.getAllByRole('heading', { level: 5 })).toHaveLength(3));
  fireEvent.click(screen.getAllByRole('button', { name: '11:00' })[0]!);

  expect(onSelect).toHaveBeenCalledWith(slot, {
    durationMinutes: 95,
    serviceSubtotalCents: 7500,
    hasUnpricedExtras: false,
  }, '2099-07-22');
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(fetchMock.mock.calls.every(([url]) => new URL(url, 'https://localhost').searchParams.get('baseServiceId') === 'biab')).toBe(true);
});
