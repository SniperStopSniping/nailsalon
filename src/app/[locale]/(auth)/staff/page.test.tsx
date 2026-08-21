import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffDashboardPage from './page';

const {
  fetchMock,
  routerPush,
  routerRefresh,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('@/hooks/useStaffCapabilities', () => ({
  useStaffCapabilities: () => ({
    modules: {},
  }),
}));

vi.mock('@/components/staff', () => ({
  StaffBottomNav: ({ action }: { action?: React.ReactNode }) => (
    <div data-testid="staff-bottom-region-mock">
      Staff bottom nav
      {action}
    </div>
  ),
  StaffHeader: ({
    title,
    subtitle,
    rightContent,
  }: {
    title: string;
    subtitle?: string;
    rightContent?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      <div>{rightContent}</div>
    </div>
  ),
}));

vi.mock('./components/ActionBar', () => ({
  ActionBar: () => null,
}));

vi.mock('./components/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./components/FloatingActionBar', () => ({
  FloatingActionBar: ({ appointment }: { appointment: { id: string } | null }) => appointment
    ? (
        <div data-testid="floating-action-mock">
          Floating action for
          {appointment.id}
        </div>
      )
    : null,
}));

vi.mock('./components/PhotoModal', () => ({
  PhotoModal: () => null,
}));

vi.mock('./components/SwipeableCard', () => ({
  SwipeableCard: ({ children, onSwipeRight }: { children: React.ReactNode; onSwipeRight: () => void }) => (
    <div>
      {children}
      <button type="button" onClick={onSwipeRight}>Trigger start gesture</button>
    </div>
  ),
}));

vi.mock('./components/StaffAppointmentCard', () => ({
  StaffAppointmentCard: ({ appointment }: { appointment: { id: string } }) => (
    <div>
      appointment:
      {appointment.id}
    </div>
  ),
}));

describe('StaffDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
  });

  it('renders the simplified staff shell and empty-state copy for authenticated staff', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          technician: { id: 'tech_1', name: 'Taylor Artist' },
          salon: { id: 'sal_1', name: 'Salon A', slug: 'salon-a' },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointments: [],
        },
      }), { status: 200 }));

    render(<StaffDashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/staff/me');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(
        /^\/api\/appointments\?status=pending%2Cconfirmed%2Cin_progress&startDate=.+&endDate=.+$/,
      ));
    });

    expect(await screen.findByText('View schedule')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('There are no more appointments assigned to you today.')).toBeInTheDocument();
  });

  it('mounts the contextual action inside the one staff bottom region', async () => {
    const appointment = {
      id: 'appt_1',
      clientPhone: '+14165551234',
      status: 'confirmed',
      canvasState: 'waiting',
      technicianId: 'tech_1',
      clientName: 'Ava',
      startTime: '2026-08-21T14:00:00.000Z',
      endTime: '2026-08-21T15:00:00.000Z',
      totalPrice: 6500,
      services: [{ name: 'BIAB Short' }],
      photos: [],
    };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/staff/me') {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            technician: { id: 'tech_1', name: 'Taylor Artist' },
            salon: { id: 'sal_1', name: 'Salon A', slug: 'salon-a' },
          },
        }), { status: 200 }));
      }
      if (url.startsWith('/api/appointments?')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { appointments: [appointment] } }), { status: 200 }));
      }
      if (url === '/api/appointments/appt_1/transition' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StaffDashboardPage />);
    const gesture = await screen.findByRole('button', { name: 'Trigger start gesture' });
    fireEvent.click(gesture);

    const region = screen.getByTestId('staff-bottom-region-mock');
    await waitFor(() => {
      expect(region).toContainElement(screen.getByTestId('floating-action-mock'));
    });

    expect(screen.getAllByTestId('staff-bottom-region-mock')).toHaveLength(1);
  });
});
