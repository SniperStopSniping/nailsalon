import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StaffAppointmentsPage from './page';

const { fetchMock, useUserMock, routerPush } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  useUserMock: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({
  useUser: useUserMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/staff', () => ({
  StaffBottomNav: () => <div>Staff bottom nav</div>,
  StaffHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
}));

vi.mock('@/components/staff/appointments/AppointmentWorkflowDialogs', () => ({
  AppointmentWorkflowDialogs: () => <div>workflow dialogs</div>,
}));

vi.mock('@/components/admin/LusterClientSms', () => ({ LusterClientSms: () => null }));
vi.mock('@/components/appointments/ReviewRequestAction', () => ({ ReviewRequestAction: () => null }));

describe('StaffAppointmentsPage', () => {
  const getLocalDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the access-required state when the staff user is signed out', async () => {
    useUserMock.mockReturnValue({
      user: null,
      isLoaded: true,
    });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: {
        appointments: [],
      },
    }), { status: 200 }));

    render(<StaffAppointmentsPage />);

    expect(await screen.findByText('Staff Access Required')).toBeInTheDocument();
    expect(screen.getByText('Please sign in to access this page.')).toBeInTheDocument();
  });

  it('loads the cleaned-up appointments surface for authenticated staff', async () => {
    useUserMock.mockReturnValue({
      user: { id: 'user_1' },
      isLoaded: true,
    });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: {
        appointments: [{
          id: 'appt_1',
          clientName: 'Ava',
          startTime: '2026-05-28T14:00:00.000Z',
          endTime: '2026-05-28T15:00:00.000Z',
          status: 'confirmed',
          technicianId: 'tech_1',
          services: [{ id: 'srv_1', name: 'Gel Manicure' }],
          totalPrice: 6500,
          totalDurationMinutes: 60,
        }],
      },
    }), { status: 200 }));

    render(<StaffAppointmentsPage />);

    const expectedDate = getLocalDateKey(new Date());

    await waitFor(() => {
      // 'awaiting_payment' (a deposit hold) is included deliberately: the slot
      // really is occupied, so a staff member looking at the day must see it.
      expect(fetchMock).toHaveBeenCalledWith(`/api/appointments?date=${expectedDate}&status=pending,confirmed,in_progress,awaiting_payment,completed`);
    });

    expect(await screen.findByText('Day view (1)')).toBeInTheDocument();
    expect(screen.getByText('My calendar')).toBeInTheDocument();
  });

  it('lets staff confirm an early report and keeps the sharing acknowledgement visible', async () => {
    // A rolling +30-minute fixture leaves today's calendar after 23:30 UTC.
    // Freeze only Date at a daytime instant; async UI timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T16:00:00.000Z'));
    useUserMock.mockReturnValue({ user: { id: 'user_1' }, isLoaded: true });
    const startTime = new Date(Date.now() + 30 * 60_000).toISOString();
    const appointment = {
      id: 'appt_1',
      salonId: 'salon_1',
      salonSlug: 'salon-a',
      salonName: 'Salon A',
      timeZone: 'America/Toronto',
      clientName: 'Ava',
      clientPhone: '4165551234',
      technicianId: 'tech_1',
      locationId: null,
      locationName: null,
      status: 'confirmed',
      startTime,
      endTime: new Date(Date.now() + 90 * 60_000).toISOString(),
      totalPrice: 6500,
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      slotIntervalMinutes: 15,
      isLocked: false,
      lockedAt: null,
      paymentStatus: 'pending',
      baseServiceId: 'srv_1',
      baseServiceName: 'Gel Manicure',
      discountType: null,
      discountAmountCents: 0,
      notes: null,
      techNotes: null,
      services: [{ id: 'srv_1', name: 'Gel Manicure' }],
      photos: [],
    };
    const detail = {
      appointment,
      client: null,
      location: null,
      services: [{ id: 'srv_1', name: 'Gel Manicure', category: 'manicure', priceAtBooking: 6500, durationAtBooking: 60, isBaseService: true }],
      addOns: [],
      serviceOptions: [],
      technicianOptions: [{ id: 'tech_1', name: 'Taylor' }],
      financial: { state: 'under_review' },
      permissions: { canMove: false, canChangeService: false, canCancel: true, canMarkCompleted: false, canStart: true, canConfirm: false, canDecline: false, canMarkNoShow: true, canReassignTechnician: false },
      warnings: [],
      communications: [],
    };
    let report: unknown;
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/cancel')) {
        report = JSON.parse(String(options?.body));
        appointment.status = 'no_show';
        return Response.json({ data: { appointment, noShowSharing: 'shared' } });
      }
      if (url.endsWith('/manage')) {
        return Response.json({ data: detail });
      }
      return Response.json({ data: { appointments: [appointment] } });
    });
    render(<StaffAppointmentsPage />);
    fireEvent.click(await screen.findByTestId('appointment-block-appt_1'));
    fireEvent.click(await screen.findByRole('button', { name: /^Details Show$/ }));
    fireEvent.click(await screen.findByTestId('appointment-sheet-no-show'));

    expect(screen.getByRole('radio', { name: /Customer did not attend/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /Customer confirmed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm no-show' }));

    expect(await screen.findByText(/now shared with participating/)).toBeVisible();
    expect(report).toEqual({ cancelReason: 'no_show', noShowReport: { reason: 'confirmed_nonattendance' } });
  });
});
