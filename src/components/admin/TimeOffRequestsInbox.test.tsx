import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeOffRequestsInbox } from './TimeOffRequestsInbox';

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

const REQUEST = {
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
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** list → detail → decision → refreshed list, the order the inbox fetches in. */
function mockHappyPath({
  conflicts = 0,
  decisionStatus = 200,
  decisionBody = { data: { success: true } } as unknown,
}: { conflicts?: number; decisionStatus?: number; decisionBody?: unknown } = {}) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ data: { requests: [REQUEST] } }))
    .mockResolvedValueOnce(jsonResponse({
      data: {
        request: REQUEST,
        conflicts: {
          appointmentCount: conflicts,
          range: { from: '2030-03-20T09:00:00.000Z', to: '2030-03-21T18:00:00.000Z' },
        },
      },
    }))
    .mockResolvedValueOnce(jsonResponse(decisionBody, decisionStatus))
    .mockResolvedValueOnce(jsonResponse({ data: { requests: [] } }));
}

async function openTaylorsRequest() {
  await screen.findByText('Taylor');
  fireEvent.click(screen.getByText('Taylor'));
  await screen.findByText('Request Details');
}

function patchCalls() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
  );
}

describe('TimeOffRequestsInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued mockResolvedValueOnce entries; a test that
    // does not consume its whole queue would poison the next one.
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('alert', alertMock);
  });

  it('loads requests, opens a detail panel, and approves a pending request', async () => {
    mockHappyPath();

    render(<TimeOffRequestsInbox />);

    await openTaylorsRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    // Deliberate update: approving now goes through a confirmation. The old
    // assertion (Approve → PATCH straight away) encoded a decision that could
    // not be reconsidered, on an action that writes to a technician's calendar.
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/time-off-requests/req_1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    await screen.findByText('No pending time-off requests');
  });

  it('lists a request as a row button, not as a dialog', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { requests: [REQUEST] } }));

    render(<TimeOffRequestsInbox />);

    // Every row used to carry role="dialog" aria-modal="true".
    const row = await screen.findByRole('button', { name: /Taylor/ });

    expect(within(row).getByText('Mar 20 – Mar 21')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('writes nothing until the owner confirms, then says what changed on the calendar', async () => {
    mockHappyPath();

    render(<TimeOffRequestsInbox />);
    await openTaylorsRequest();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByTestId('confirm-dialog');

    expect(within(confirm).getByText('Approve this time off?')).toBeInTheDocument();
    expect(patchCalls()).toHaveLength(0);

    fireEvent.click(within(confirm).getByTestId('confirm-dialog-confirm'));

    const notice = await screen.findByTestId('time-off-notice');

    expect(notice).toHaveTextContent('Approved.');
    expect(notice).toHaveTextContent('Mar 20 – Mar 21 is now blocked on Taylor’s calendar');
    expect(patchCalls()).toHaveLength(1);
  });

  it('warns that booked appointments survive an approval', async () => {
    mockHappyPath({ conflicts: 2 });

    render(<TimeOffRequestsInbox />);
    await openTaylorsRequest();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByTestId('confirm-dialog');

    expect(confirm).toHaveTextContent('already booked in that range');
    expect(confirm).toHaveTextContent('does not cancel');
  });

  it('confirms a denial separately and reports the calendar is untouched', async () => {
    mockHappyPath();

    render(<TimeOffRequestsInbox />);
    await openTaylorsRequest();

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    const confirm = await screen.findByTestId('confirm-dialog');

    expect(within(confirm).getByText('Deny this time-off request?')).toBeInTheDocument();

    fireEvent.click(within(confirm).getByTestId('confirm-dialog-confirm'));

    expect(await screen.findByTestId('time-off-notice')).toHaveTextContent(
      'Denied. Taylor has been notified. Nothing changed on the calendar.',
    );
  });

  it('keeps a refused decision beside the buttons instead of an alert()', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockHappyPath({
      decisionStatus: 400,
      decisionBody: {
        error: { code: 'INVALID_STATE', message: 'Cannot update request - already approved' },
      },
    });

    render(<TimeOffRequestsInbox />);
    await openTaylorsRequest();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    const failure = await screen.findByTestId('time-off-decision-error');

    expect(failure).toHaveTextContent('Cannot update request - already approved');
    expect(alertMock).not.toHaveBeenCalled();
    // The request stays open, so the reason sits where the owner acted.
    expect(screen.getByText('Request Details')).toBeInTheDocument();
  });

  it('tells an owner with an empty inbox where requests come from', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { requests: [] } }));

    render(<TimeOffRequestsInbox />);

    await screen.findByText('No pending time-off requests');

    expect(
      screen.getByText(/Requests land here when a technician asks for time off/),
    ).toBeInTheDocument();
  });

  it('says a failed load in the owner’s terms', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({}, 500));

    render(<TimeOffRequestsInbox />);

    expect(
      await screen.findByText(/We couldn’t load your team’s time-off requests/),
    ).toBeInTheDocument();
  });
});
