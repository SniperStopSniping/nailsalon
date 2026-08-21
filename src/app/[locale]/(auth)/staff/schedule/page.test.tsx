import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffSchedulePage from './page';

const {
  fetchMock,
  routerReplace,
  routerMock,
  capabilitiesState,
} = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    fetchMock: vi.fn(),
    routerReplace: replace,
    routerMock: { replace },
    capabilitiesState: { scheduleOverrides: false },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('@/hooks/useStaffCapabilities', () => ({
  useStaffCapabilities: () => ({
    modules: { scheduleOverrides: capabilitiesState.scheduleOverrides },
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
  capabilitiesState.scheduleOverrides = false;
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

  it('requires confirmation before removing a persisted schedule change', async () => {
    const user = userEvent.setup();
    capabilitiesState.scheduleOverrides = true;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/staff/me') {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            technician: { id: 'tech_1', name: 'Taylor Artist' },
            salon: { id: 'sal_1', slug: 'salon-a', name: 'Salon A' },
          },
        }), { status: 200 }));
      }
      if (url === '/api/staff/availability') {
        return Promise.resolve(new Response(JSON.stringify({ data: { weeklySchedule: {} } }), { status: 200 }));
      }
      if (url === '/api/staff/time-off-requests') {
        return Promise.resolve(new Response(JSON.stringify({ data: { requests: [] } }), { status: 200 }));
      }
      if (url === '/api/staff/overrides' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            overrides: [{
              id: 'override-1',
              date: '2026-08-25',
              type: 'off',
              startTime: null,
              endTime: null,
              note: 'Training day',
            }],
          },
        }), { status: 200 }));
      }
      if (url === '/api/staff/overrides/override-1' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<StaffSchedulePage />);
    const removeButton = await screen.findByRole('button', { name: 'Remove' });
    await user.click(removeButton);

    expect(screen.getByText('Remove this schedule change?')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    expect(removeButton).toHaveFocus();

    await user.click(removeButton);
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/staff/overrides/override-1', { method: 'DELETE' });
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
});
