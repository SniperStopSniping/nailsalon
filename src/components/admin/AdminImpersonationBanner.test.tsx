import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, pushMock, refreshMock, useParamsMock, useRouterMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  useParamsMock: vi.fn(),
  useRouterMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
  useRouter: useRouterMock,
}));

import { AdminImpersonationBanner } from './AdminImpersonationBanner';

describe('AdminImpersonationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useParamsMock.mockReturnValue({ locale: 'en' });
    useRouterMock.mockReturnValue({
      push: pushMock,
      refresh: refreshMock,
    });
  });

  it('renders the active impersonation state for the locked salon', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      isImpersonating: true,
      session: {
        salonId: 'salon_1',
        salonSlug: 'locked-salon',
        salonName: 'Locked Salon',
        adminUserId: 'admin_1',
        adminPhone: '+15551234567',
        startedAt: '2026-03-14T15:00:00.000Z',
      },
    }), { status: 200 }));

    render(<AdminImpersonationBanner />);

    await waitFor(() => {
      expect(screen.getByText('Impersonating: Locked Salon')).toBeInTheDocument();
    });

    expect(screen.getByText(/Salon scope is locked to `locked-salon`\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End impersonation' })).toBeInTheDocument();
  });

  it('ends impersonation once and returns to the super-admin area', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        isImpersonating: true,
        session: {
          salonId: 'salon_1',
          salonSlug: 'locked-salon',
          salonName: 'Locked Salon',
          adminUserId: 'admin_1',
          adminPhone: '+15551234567',
          startedAt: '2026-03-14T15:00:00.000Z',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
      }), { status: 200 }));

    render(<AdminImpersonationBanner />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'End impersonation' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'End impersonation' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/super-admin/impersonate', {
        method: 'DELETE',
      });
      expect(pushMock).toHaveBeenCalledWith('/en/super-admin');
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });
});
