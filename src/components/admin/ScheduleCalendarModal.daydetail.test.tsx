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

function routeFetch(url: string) {
  if (url.startsWith('/api/admin/appointments')) {
    return {
      data: {
        appointments: [{
          id: 'appt_1',
          clientName: 'Avery Client',
          startTime: todayAt(14),
          endTime: todayAt(15),
          status: 'confirmed',
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
  if (url.includes('/manage')) {
    return { data: MANAGE_DETAIL };
  }
  throw new Error(`Unrouted fetch: ${url}`);
}

beforeEach(() => {
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

  it('keeps Google events non-tappable with only the convert action', async () => {
    await openTodayPanel();

    const googleCard = await screen.findByTestId(/day-detail-google-/);

    expect(googleCard).not.toHaveAttribute('role', 'button');
    expect(screen.getByRole('button', { name: /convert to appointment/i })).toBeInTheDocument();

    fireEvent.click(googleCard);

    expect(screen.queryByTestId('appointment-quick-edit-sheet')).not.toBeInTheDocument();
  });
});
