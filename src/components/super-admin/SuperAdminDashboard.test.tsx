import React from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, useParamsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  useParamsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
}));

vi.mock('./CreateSalonModal', () => ({
  CreateSalonModal: () => null,
}));

vi.mock('./InvitesModal', () => ({
  InvitesModal: () => null,
}));

vi.mock('./SalonDetailPanel', () => ({
  SalonDetailPanel: () => null,
}));

import { SuperAdminDashboard } from './SuperAdminDashboard';

describe('SuperAdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useParamsMock.mockReturnValue({ locale: 'en' });
  });

  it('does not send blank plan/status filters on the initial salons fetch', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    }), { status: 200 }));

    render(<SuperAdminDashboard />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/super-admin/organizations?page=1&pageSize=20');
    expect(screen.getByText('No salons found')).toBeInTheDocument();
  });

  it('shows the API error message instead of masking it behind a generic salons failure', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'Invalid query parameters',
    }), { status: 400 }));

    render(<SuperAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Invalid query parameters')).toBeInTheDocument();
    });
  });
});
