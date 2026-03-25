import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, alertMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  alertMock: vi.fn(),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
  };
});

import { TimeOffRequestsInbox } from './TimeOffRequestsInbox';

describe('TimeOffRequestsInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('alert', alertMock);
  });

  it('loads requests, opens a detail panel, and approves a pending request', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          requests: [{
            id: 'req_1',
            salonId: 'salon_a',
            technicianId: 'tech_1',
            technicianName: 'Taylor',
            startDate: '2030-03-20',
            endDate: '2030-03-21',
            note: 'Family event',
            status: 'PENDING',
            decidedAt: null,
            createdAt: '2030-03-10T10:00:00.000Z',
          }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          request: {
            id: 'req_1',
            salonId: 'salon_a',
            technicianId: 'tech_1',
            technicianName: 'Taylor',
            startDate: '2030-03-20',
            endDate: '2030-03-21',
            note: 'Family event',
            status: 'PENDING',
            decidedAt: null,
            createdAt: '2030-03-10T10:00:00.000Z',
          },
          conflicts: {
            appointmentCount: 0,
            range: {
              from: '2030-03-20T09:00:00.000Z',
              to: '2030-03-21T18:00:00.000Z',
            },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          success: true,
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          requests: [],
        },
      }), { status: 200 }));

    render(<TimeOffRequestsInbox />);

    await screen.findByText('Taylor');
    fireEvent.click(screen.getByText('Taylor'));

    await screen.findByText('Request Details');
    const approveButtons = screen.getAllByRole('button', { name: /approve/i });
    fireEvent.click(approveButtons[approveButtons.length - 1]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/time-off-requests/req_1',
        expect.objectContaining({
          method: 'PATCH',
        }),
      );
    });

    await screen.findByText('No pending time-off requests');
  });
});
