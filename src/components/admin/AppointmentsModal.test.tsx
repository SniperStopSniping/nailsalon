import React from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { AppointmentsModal } from './AppointmentsModal';

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
      expect(screen.getByText('No appointments scheduled')).toBeInTheDocument();
    });

    expect(screen.getByText('You are clear for the rest of today.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/search appointments/i)).not.toBeInTheDocument();
  });
});
