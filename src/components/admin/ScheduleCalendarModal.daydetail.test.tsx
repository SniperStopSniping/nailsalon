import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduleCalendarModal } from './ScheduleCalendarModal';

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'test-salon' }),
}));

vi.mock('./NewAppointmentModal', () => ({
  NewAppointmentModal: ({ isOpen, clientPrefill }: { isOpen: boolean; clientPrefill?: unknown }) => (
    isOpen
      ? <div data-testid="new-appointment-modal">{JSON.stringify(clientPrefill ?? null)}</div>
      : null
  ),
}));

const fetchMock = vi.fn();

function todayAt(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const MANAGE_DETAIL = {
  appointment: {
    id: 'appt_1',
    salonId: 'salon_1',
    salonSlug: 'test-salon',
    clientName: 'Avery Client',
    clientPhone: '4165551234',
    clientEmail: null,
    technicianId: 'tech_1',
    locationId: null,
    locationName: null,
    status: 'confirmed',
    startTime: todayAt(14),
    endTime: todayAt(15),
    totalPrice: 4500,
    totalDurationMinutes: 60,
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    isLocked: false,
    lockedAt: null,
    paymentStatus: 'pending',
    baseServiceId: 'svc_1',
    baseServiceName: 'Gel Manicure',
    discountType: null,
    discountAmountCents: 0,
    notes: null,
    techNotes: null,
  },
  services: [],
  addOns: [],
  serviceOptions: [{ id: 'svc_1', name: 'Gel Manicure', category: 'manicure', priceCents: 4500, durationMinutes: 60 }],
  technicianOptions: [{ id: 'tech_1', name: 'Taylor' }],
  permissions: {
    canMove: true,
    canChangeService: true,
    canCancel: true,
    canMarkCompleted: true,
    canStart: false,
    canConfirm: false,
    canMarkNoShow: false,
    canReassignTechnician: true,
  },
  warnings: [],
  communications: [],
};

// Per-test status for the seeded day appointment (reset in beforeEach).
let dayAppointmentStatus = 'confirmed';
// Per-test Google Calendar readiness, as /api/admin/today reports it.
let googleReadiness = 'ready';
let googleStatus = 'connected';

function routeFetch(url: string) {
  if (url.startsWith('/api/admin/appointments')) {
    return {
      data: {
        appointments: [{
          id: 'appt_1',
          clientName: 'Avery Client',
          startTime: todayAt(14),
          endTime: todayAt(15),
          status: dayAppointmentStatus,
          services: [{ name: 'Gel Manicure' }],
          technician: { id: 'tech_1', name: 'Taylor' },
        }],
      },
      meta: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
  }
  if (url.startsWith('/api/integrations/google/events')) {
    return {
      data: {
        events: [{
          id: 'gcal_1',
          googleEventId: 'gev_1',
          title: 'External block',
          startTime: todayAt(10),
          endTime: todayAt(11),
          transparency: 'busy',
          reviewStatus: 'needs_review',
          appointmentId: null,
          sourceAccessRole: 'reader',
        }],
      },
    };
  }
  if (url.startsWith('/api/admin/today')) {
    return {
      data: {
        integrationHealth: {
          google: { status: googleStatus, readiness: googleReadiness },
          calendarOutbox: { pending: 0, failed: 0 },
        },
      },
    };
  }
  if (url.includes('/manage')) {
    return { data: MANAGE_DETAIL };
  }
  throw new Error(`Unrouted fetch: ${url}`);
}

beforeEach(() => {
  dayAppointmentStatus = 'confirmed';
  googleReadiness = 'ready';
  googleStatus = 'connected';
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => routeFetch(url),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openTodayPanel() {
  render(<ScheduleCalendarModal onClose={vi.fn()} />);

  // The day cell shows the CRM appointment count once loading completes.
  const dayCell = await screen.findByText(/1 appt/);
  fireEvent.click(dayCell.closest('button')!);

  await screen.findByLabelText('Close day details');
}

describe('ScheduleCalendarModal day detail', () => {
  it('opens the shared manage sheet when a CRM appointment is tapped', async () => {
    await openTodayPanel();

    const crmCard = await screen.findByTestId('day-detail-appointment-appt_1');

    expect(crmCard).toHaveAttribute('role', 'button');

    fireEvent.click(crmCard);

    await screen.findByTestId('appointment-quick-edit-sheet');
    await waitFor(() => {
      // The surface's salon rides along as a server-verified scoping hint.
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_1/manage?salonSlug=test-salon');
    });

    // The day panel hides while the sheet is open (AnimatePresence exits async).
    await waitFor(() => {
      expect(screen.queryByTestId('day-detail-appointment-appt_1')).not.toBeInTheDocument();
    });
  });

  it('renders an awaiting_payment hold in the distinct hold palette, never confirmed-blue', async () => {
    dayAppointmentStatus = 'awaiting_payment';
    await openTodayPanel();

    const holdCard = await screen.findByTestId('day-detail-appointment-appt_1');

    // Colors pair with the explicit label — status is never color-alone.
    expect(screen.getByText('Awaiting deposit')).toBeInTheDocument();
    expect(holdCard).toHaveClass('bg-fuchsia-50');
    // Never the confirmed plum, and never the iOS blue it replaced.
    expect(holdCard).not.toHaveClass('bg-[var(--owner-blush,#f6e7ec)]');
    expect(holdCard).not.toHaveClass('bg-blue-50');
  });

  it('paints a confirmed booking from the owner token layer, never the iOS blue', async () => {
    await openTodayPanel();

    const card = await screen.findByTestId('day-detail-appointment-appt_1');

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    // r27 cohesion sweep: confirmed moved off `bg-blue-50` (the iOS system
    // family) onto the owner blush/accent tokens shared with Today, the day
    // view and the appointment sheet. It stays distinct from the fuchsia hold.
    expect(card).toHaveClass('bg-[var(--owner-blush,#f6e7ec)]');
    expect(card).toHaveClass('border-[var(--owner-accent,#8f3155)]');
    expect(card).not.toHaveClass('bg-blue-50');
    expect(card).not.toHaveClass('bg-fuchsia-50');
  });

  it('hides the Google source filters and legend when Google is not connected', async () => {
    // AG-today-calendar-06 (calendar half): a salon that has never connected
    // Google Calendar was still offered "Google Busy" / "Free Events" /
    // "Needs Review" chips and a "Google busy" legend swatch — vocabulary for
    // an integration it does not have.
    googleReadiness = 'not_connected';
    googleStatus = 'disconnected';

    render(<ScheduleCalendarModal onClose={vi.fn()} />);

    await screen.findByTestId('calendar-filter-row');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Google Busy' })).not.toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Free Events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Needs Review' })).not.toBeInTheDocument();
    expect(screen.queryByText('Google busy')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appointments' })).toBeInTheDocument();
  });

  it('keeps the Google source filters for a connected salon', async () => {
    render(<ScheduleCalendarModal onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Google Busy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Free Events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs Review' })).toBeInTheDocument();
  });

  it('keeps Google events non-tappable with only the convert action', async () => {
    await openTodayPanel();

    const googleCard = await screen.findByTestId(/day-detail-google-/);

    expect(googleCard).not.toHaveAttribute('role', 'button');
    expect(screen.getByRole('button', { name: /convert to appointment/i })).toBeInTheDocument();

    fireEvent.click(googleCard);

    expect(screen.queryByTestId('appointment-quick-edit-sheet')).not.toBeInTheDocument();
  });
});
