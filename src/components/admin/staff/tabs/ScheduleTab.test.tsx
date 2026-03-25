import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}));

import { ScheduleTab } from './ScheduleTab';

describe('ScheduleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('syncs the editor with updated weeklySchedule props', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { timeOff: [] } }), { status: 200 }));

    const { rerender } = render(
      <ScheduleTab
        salonSlug="salon-a"
        technicianId="tech_1"
        weeklySchedule={null}
        onUpdate={vi.fn()}
      />,
    );

    const mondayStart = await screen.findByLabelText('Monday start time') as HTMLSelectElement;
    expect(mondayStart.value).toBe('09:00');

    rerender(
      <ScheduleTab
        salonSlug="salon-a"
        technicianId="tech_1"
        weeklySchedule={{
          monday: { start: '10:00', end: '19:00' },
        }}
        onUpdate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('Monday start time') as HTMLSelectElement).value).toBe('10:00');
    });
  });

  it('shows the real save failure reason from the API', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/staff/time-off')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { timeOff: [] } }), { status: 200 }));
      }

      if (url.includes('/api/admin/technicians/tech_1') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({
          error: {
            message: 'Unable to save this schedule right now.',
          },
        }), { status: 409 }));
      }

      return Promise.resolve(new Response(JSON.stringify({ data: { timeOff: [] } }), { status: 200 }));
    });

    render(
      <ScheduleTab
        salonSlug="salon-a"
        technicianId="tech_1"
        weeklySchedule={{
          monday: { start: '09:00', end: '18:00' },
        }}
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Save Schedule' }));

    expect(await screen.findByText('Unable to save this schedule right now.')).toBeInTheDocument();
  });
});
