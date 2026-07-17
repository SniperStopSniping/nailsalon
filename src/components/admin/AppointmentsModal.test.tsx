import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentsModal } from './AppointmentsModal';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}));

vi.mock('./NewAppointmentModal', () => ({
  NewAppointmentModal: () => null,
}));

describe('AppointmentsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: {
        appointments: [],
      },
    }), { status: 200 }));
  });

  it('removes the inert search action and shows the polished empty state for today', async () => {
    render(<AppointmentsModal onClose={vi.fn()} />);

    await waitFor(() => {
      // The empty note renders inline above the (still visible) time grid.
      expect(screen.getByText(/No appointments scheduled/)).toBeInTheDocument();
    });

    expect(screen.getByText(/You are clear for the selected day/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/search appointments/i)).not.toBeInTheDocument();
  });
});
