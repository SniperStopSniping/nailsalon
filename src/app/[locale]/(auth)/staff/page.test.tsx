import React from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  StaffBottomNav: () => <div>Staff bottom nav</div>,
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
  FloatingActionBar: () => null,
}));

vi.mock('./components/PhotoModal', () => ({
  PhotoModal: () => null,
}));

vi.mock('./components/SwipeableCard', () => ({
  SwipeableCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./components/StaffAppointmentCard', () => ({
  StaffAppointmentCard: ({ appointment }: { appointment: { id: string } }) => (
    <div>appointment:{appointment.id}</div>
  ),
}));

import StaffDashboardPage from './page';

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
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments?date=today&status=confirmed%2Cin_progress');
    });

    expect(await screen.findByText('View schedule')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('There are no more appointments assigned to you today.')).toBeInTheDocument();
  });
});
