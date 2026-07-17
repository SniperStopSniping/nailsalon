import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APPOINTMENT_DATA_CHANGED_EVENT,
  RETENTION_DATA_CHANGED_EVENT,
} from '@/libs/dashboardEvents';

import { OwnerTodayWorkspace } from './OwnerTodayWorkspace';

vi.mock('./GoogleEventReviewQueue', () => ({
  GoogleEventReviewQueue: () => null,
}));

vi.mock('./QuickActionsWidget', () => ({
  QuickActionsWidget: () => null,
}));

const fetchMock = vi.fn();

const todayPayload = {
  data: {
    date: '2026-07-17',
    timeZone: 'America/Toronto',
    appointments: [],
    dueClients: [],
    failedConfirmations: [],
    googleEventsNeedingReview: 0,
    integrationHealth: {
      google: { status: 'connected' },
      calendarOutbox: { pending: 0, failed: 0 },
    },
    links: {
      publicUrl: '/isla-nail-studio',
      bookingUrl: '/isla-nail-studio/book',
      findBookingUrl: '/isla-nail-studio/find-booking',
    },
  },
};

function renderWorkspace(overrides?: {
  onOpenAppointment?: (appointmentId: string) => void;
  onOpenClient?: (clientId: string) => void;
}) {
  return render(
    <OwnerTodayWorkspace
      salonSlug="isla-nail-studio"
      appointments={{ total: 0, completed: 0, noShows: 0, upcoming: 0 }}
      onQuickAction={vi.fn()}
      onOpenBookings={vi.fn()}
      onOpenCalendar={vi.fn()}
      onOpenIntegrations={vi.fn()}
      onOpenAppointment={overrides?.onOpenAppointment ?? vi.fn()}
      onOpenClient={overrides?.onOpenClient ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('OwnerTodayWorkspace client follow-ups', () => {
  it('shows only the strongest retention stage per client and opens that exact client', async () => {
    const onOpenClient = vi.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        return new Response(JSON.stringify({
          data: {
            retention: [
              {
                clientId: 'client_bob',
                clientName: 'Bob',
                phone: '+12025550101',
                stage: 'rebook',
                dueAt: '2026-06-01T12:00:00.000Z',
                lastVisitAt: '2026-05-10T12:00:00.000Z',
                rebookIntervalDays: 21,
              },
              {
                clientId: 'client_bob',
                clientName: 'Bob',
                phone: '+12025550101',
                stage: 'promo_8w',
                dueAt: '2026-07-05T12:00:00.000Z',
                lastVisitAt: '2026-05-10T12:00:00.000Z',
                rebookIntervalDays: 21,
              },
            ],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace({ onOpenClient });

    const winBack = await screen.findByRole('button', { name: 'Win back Bob' });

    expect(screen.queryByRole('button', { name: 'Rebook Bob' })).not.toBeInTheDocument();

    expect(screen.getByText('8-week win-back')).toBeInTheDocument();

    await userEvent.click(winBack);

    expect(onOpenClient).toHaveBeenCalledWith('client_bob');
  });

  it('opens the exact client profile from a due reminder', async () => {
    const onOpenClient = vi.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        return new Response(JSON.stringify({
          data: {
            retention: [],
            appointmentReminders: [{
              appointmentId: 'appt_123',
              clientId: 'client_ada',
              clientName: 'Ada',
              phone: '+12025550102',
              startTime: '2026-07-18T14:00:00.000Z',
              endTime: '2026-07-18T15:00:00.000Z',
              dueAt: '2026-07-17T14:00:00.000Z',
            }],
            history: [],
          },
        }), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace({ onOpenClient });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Send reminder to Ada' }),
    );

    expect(onOpenClient).toHaveBeenCalledWith('client_ada');
  });

  it('shows an actionable error and retries the retention queue', async () => {
    let retentionAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        retentionAttempts += 1;
        if (retentionAttempts === 1) {
          return new Response(JSON.stringify({
            error: { message: 'Follow-ups are temporarily unavailable.' },
          }), { status: 503 });
        }
        return new Response(JSON.stringify({
          data: {
            retention: [{
              clientId: 'client_ada',
              clientName: 'Ada',
              phone: '+12025550102',
              stage: 'rebook',
              dueAt: '2026-07-17T12:00:00.000Z',
              lastVisitAt: '2026-06-20T12:00:00.000Z',
              rebookIntervalDays: 21,
            }],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    expect(
      await screen.findByText('Follow-ups are temporarily unavailable.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Rebook Ada' })).toBeInTheDocument();

    await waitFor(() => expect(retentionAttempts).toBe(2));
  });

  it('refreshes the matching queue immediately after dashboard mutations', async () => {
    let todayRequests = 0;
    let retentionRequests = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        todayRequests += 1;
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        retentionRequests += 1;
        return new Response(JSON.stringify({
          data: {
            retention: [],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    await waitFor(() => {
      expect(todayRequests).toBe(1);
      expect(retentionRequests).toBe(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event(RETENTION_DATA_CHANGED_EVENT));
    });

    await waitFor(() => expect(retentionRequests).toBe(2));

    expect(todayRequests).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event(APPOINTMENT_DATA_CHANGED_EVENT));
    });

    await waitFor(() => expect(todayRequests).toBe(2));
  });
});
