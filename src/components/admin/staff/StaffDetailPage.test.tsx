import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StaffDetailPage } from './StaffDetailPage';

const { fetchMock, pushMock, state } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  pushMock: vi.fn(),
  state: { query: '' },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(state.query),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('./StaffStatusToggle', () => ({
  StaffStatusToggle: () => <div>Staff status</div>,
}));

vi.mock('./tabs/ClientsTab', () => ({ ClientsTab: () => null }));
vi.mock('./tabs/EarningsTab', () => ({ EarningsTab: () => null }));
vi.mock('./tabs/OverviewTab', () => ({ OverviewTab: () => null }));
vi.mock('./tabs/ServicesTab', () => ({ ServicesTab: () => null }));
vi.mock('./tabs/SettingsTab', () => ({ SettingsTab: () => null }));
vi.mock('./useTechnicianReviews', () => ({
  useTechnicianReviews: () => ({ byTechnician: {} }),
}));

const technician = {
  id: 'tech_9',
  name: 'Maya Chen',
  email: 'maya@example.test',
  phone: null,
  avatarUrl: null,
  bio: null,
  role: 'technician',
  skillLevel: 'standard',
  languages: null,
  specialties: null,
  currentStatus: 'available',
  isActive: true,
  acceptingNewClients: true,
  rating: null,
  reviewCount: 0,
  commissionRate: 0,
  payType: null,
  hourlyRate: null,
  salaryAmount: null,
  displayOrder: null,
  notes: null,
  userId: null,
  hiredAt: null,
  terminatedAt: null,
  returnDate: null,
  onboardingStatus: null,
  weeklySchedule: { monday: { start: '09:00', end: '17:00' } },
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
};

function queryOf(href: string) {
  return new URL(href, 'https://luster.test').searchParams;
}

describe('StaffDetailPage schedule shortcut', () => {
  beforeEach(() => {
    state.query = 'salon=studio&returnTo=calendar&app=team';
    fetchMock.mockReset();
    pushMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { technician, stats: null, services: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows a contextual summary and pushes technician Hours without mounting the schedule editor', async () => {
    render(
      <StaffDetailPage
        staffId="tech_9"
        salonSlug="studio"
        initialTab="schedule"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Working hours' })).toBeInTheDocument();
    expect(screen.getByText(/Maya Chen.*Hours & Availability/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Time Off' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit working hours' }));

    expect(pushMock).toHaveBeenCalledTimes(1);

    const query = queryOf(pushMock.mock.calls[0]![0]);

    expect(query.get('salon')).toBe('studio');
    expect(query.get('returnTo')).toBe('calendar');
    expect(query.get('app')).toBe('hours');
    expect(query.get('view')).toBe('working-hours');
    expect(query.get('technician')).toBe('tech_9');
  });
});
