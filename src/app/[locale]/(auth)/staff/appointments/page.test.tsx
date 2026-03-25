import React from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/components/staff/appointments/StaffAppointmentsList', () => ({
  StaffAppointmentsList: ({ appointments }: { appointments: Array<{ id: string }> }) => (
    <div>appointments:{appointments.length}</div>
  ),
}));

vi.mock('@/components/staff/appointments/AppointmentWorkflowDialogs', () => ({
  AppointmentWorkflowDialogs: () => <div>workflow dialogs</div>,
}));

import StaffAppointmentsPage from './page';

describe('StaffAppointmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
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
          status: 'confirmed',
        }],
      },
    }), { status: 200 }));

    render(<StaffAppointmentsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments?date=today&status=confirmed,in_progress');
    });

    expect(await screen.findByText('appointments:1')).toBeInTheDocument();
    expect(screen.getByText('Photo Upload')).toBeInTheDocument();
    expect(screen.getByText("Today’s Appointments (1)")).toBeInTheDocument();
  });
});
