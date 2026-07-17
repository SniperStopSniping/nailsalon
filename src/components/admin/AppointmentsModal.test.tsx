import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentsModal } from './AppointmentsModal';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}));

vi.mock('./NewAppointmentModal', () => ({
  NewAppointmentModal: () => null,
}));

vi.mock('@/components/appointments/AppointmentsDayView', () => ({
  AppointmentsDayView: ({
    emptyTitle,
    emptyDescription,
    onAppointmentSelect,
  }: {
    emptyTitle: string;
    emptyDescription: string;
    onAppointmentSelect: (appointmentId: string) => void;
  }) => (
    <div>
      <p>{emptyTitle}</p>
      <p>{emptyDescription}</p>
      <button type="button" onClick={() => onAppointmentSelect('appt_calendar')}>
        Open calendar appointment
      </button>
    </div>
  ),
}));

vi.mock('@/components/appointments/AppointmentQuickEditSheet', () => ({
  AppointmentQuickEditSheet: ({
    isOpen,
    detail,
    actionError,
    onRetryLoad,
    onCancelAppointment,
  }: {
    isOpen: boolean;
    detail: unknown;
    actionError: string | null;
    onRetryLoad: () => void;
    onCancelAppointment: (args: { reason: 'client_request' }) => void;
  }) => isOpen
    ? (
        <div>
          {detail ? <p>Appointment ready</p> : null}
          {actionError ? <p>{actionError}</p> : null}
          <button type="button" onClick={onRetryLoad}>Try again</button>
          <button
            type="button"
            onClick={() => onCancelAppointment({ reason: 'client_request' })}
          >
            Cancel loaded appointment
          </button>
        </div>
      )
    : null,
}));

const appointmentDetail = {
  appointment: {
    id: 'appt_1',
    notes: null,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AppointmentsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/appointments')) {
        return Promise.resolve(jsonResponse({ data: { appointments: [] } }));
      }
      if (url.includes('/manage')) {
        return Promise.resolve(jsonResponse({ data: appointmentDetail }));
      }
      return Promise.resolve(jsonResponse({ data: { ok: true } }));
    });
  });

  it('removes the inert search action and shows the polished empty state for today', async () => {
    render(<AppointmentsModal onClose={vi.fn()} />);

    await waitFor(() => {
      // The empty note renders inline above the (still visible) time grid.
      expect(screen.getByText(/No appointments scheduled/)).toBeInTheDocument();
    });

    expect(screen.getByText(/You are clear for the selected day/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/search appointments/i)).not.toBeInTheDocument();
  });

  it('opens a Today appointment with the selected salon and cancels it in that salon', async () => {
    render(
      <AppointmentsModal
        onClose={vi.fn()}
        initialAppointmentId="appt_today"
        salonSlug="isla-nail-studio"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/appointments/appt_today/manage?salonSlug=isla-nail-studio',
      );
      expect(screen.getByText('Appointment ready')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel loaded appointment' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/appointments/appt_today/cancel?salonSlug=isla-nail-studio',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('opens a calendar appointment with the selected salon', async () => {
    render(<AppointmentsModal onClose={vi.fn()} salonSlug="second-salon" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open calendar appointment' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/appointments/appt_calendar/manage?salonSlug=second-salon',
      );
    });
  });

  it('retries a failed detail request with the same selected salon', async () => {
    let manageAttempts = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/appointments')) {
        return Promise.resolve(jsonResponse({ data: { appointments: [] } }));
      }
      if (url.includes('/manage')) {
        manageAttempts += 1;
        return Promise.resolve(manageAttempts === 1
          ? jsonResponse({ error: { message: 'Appointment details are temporarily unavailable' } }, 503)
          : jsonResponse({ data: appointmentDetail }));
      }
      return Promise.resolve(jsonResponse({ data: { ok: true } }));
    });

    render(
      <AppointmentsModal
        onClose={vi.fn()}
        initialAppointmentId="appt_retry"
        salonSlug="isla-nail-studio"
      />,
    );

    await screen.findByText('Appointment details are temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Appointment ready');

    expect(fetchMock.mock.calls.filter(([url]) => (
      url === '/api/appointments/appt_retry/manage?salonSlug=isla-nail-studio'
    ))).toHaveLength(2);
  });
});
