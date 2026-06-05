import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffSchedulePage from './page';

const {
  fetchMock,
  routerReplace,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routerReplace,
  }),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('@/hooks/useStaffCapabilities', () => ({
  useStaffCapabilities: () => ({
    modules: { scheduleOverrides: false },
    loading: false,
  }),
}));

vi.mock('@/components/staff', () => ({
  ModuleSkeleton: () => <div>Module skeleton</div>,
  StaffBottomNav: () => <div>Staff nav</div>,
  StaffHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  ),
  UpgradeRequiredState: () => <div>Upgrade required</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('StaffSchedulePage', () => {
  it('bootstraps profile, availability, and time-off data without query-param waterfall requests', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/staff/me') {
        return new Response(JSON.stringify({
          data: {
            technician: { id: 'tech_1', name: 'Taylor Artist' },
            salon: { id: 'sal_1', slug: 'salon-a', name: 'Salon A' },
          },
        }), { status: 200 });
      }

      if (url === '/api/staff/availability') {
        return new Response(JSON.stringify({
          data: {
            weeklySchedule: {
              monday: { start: '09:00', end: '21:00' },
            },
          },
        }), { status: 200 });
      }

      if (url === '/api/staff/time-off-requests') {
        return new Response(JSON.stringify({
          data: {
            requests: [],
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StaffSchedulePage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/staff/me');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/staff/availability');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/staff/time-off-requests');
    });

    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(requestedUrls).not.toContain('/api/staff/availability?technicianId=tech_1&salonSlug=salon-a');
    expect(routerReplace).not.toHaveBeenCalled();

    await screen.findByDisplayValue('9:00 AM');
    await screen.findByDisplayValue('9:00 PM');
  });
});
