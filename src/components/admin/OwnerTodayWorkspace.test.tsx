import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APPOINTMENT_DATA_CHANGED_EVENT,
  RETENTION_DATA_CHANGED_EVENT,
} from '@/libs/dashboardEvents';
import type { ReportingProvenance } from '@/libs/financialReporting';
import type { OwnerFinancialSummary } from '@/types/ownerFinancialSummary';

import { OwnerTodayWorkspace } from './OwnerTodayWorkspace';

vi.mock('./GoogleEventReviewQueue', () => ({
  GoogleEventReviewQueue: () => null,
}));

vi.mock('./QuickActionsWidget', () => ({
  QuickActionsWidget: () => null,
}));

const fetchMock = vi.fn();

const todayPayload = {
  data: {
    date: '2026-07-17',
    timeZone: 'America/Toronto',
    appointments: [],
    dueClients: [],
    failedConfirmations: [],
    googleEventsNeedingReview: 0,
    integrationHealth: {
      google: { status: 'connected' },
      calendarOutbox: { pending: 0, failed: 0 },
    },
    links: {
      publicUrl: '/isla-nail-studio',
      bookingUrl: '/isla-nail-studio/book',
      findBookingUrl: '/isla-nail-studio/find-booking',
    },
  },
};

function renderWorkspace(overrides?: {
  onOpenAppointment?: (appointmentId: string) => void;
  onOpenClient?: (clientId: string) => void;
}) {
  return render(
    <OwnerTodayWorkspace
      salonSlug="isla-nail-studio"
      appointments={{ total: 0, completed: 0, noShows: 0, upcoming: 0 }}
      onQuickAction={vi.fn()}
      onOpenBookings={vi.fn()}
      onOpenCalendar={vi.fn()}
      onOpenIntegrations={vi.fn()}
      onOpenAppointment={overrides?.onOpenAppointment ?? vi.fn()}
      onOpenClient={overrides?.onOpenClient ?? vi.fn()}
    />,
  );
}

const EMPTY_PROVENANCE: ReportingProvenance = {
  mode: 'empty',
  finalizedAppointmentCount: 0,
  legacyAppointmentCount: 0,
  unresolvedAppointmentCount: 0,
  finalizedAmountCents: 0,
  legacyFallbackAmountCents: 0,
  isEstimated: false,
};

function buildFinancialSummary(options?: {
  todayRevenueCents?: number;
  weekRevenueCents?: number;
  monthRevenueCents?: number;
  cashCollectedCents?: number;
  completedOutstandingCents?: number;
  tipsCents?: number;
  taxCents?: number;
  discountsCents?: number;
  periodProvenance?: ReportingProvenance;
  balanceProvenance?: ReportingProvenance;
}): OwnerFinancialSummary {
  const provenance = options?.periodProvenance ?? EMPTY_PROVENANCE;
  const period = (
    completedAppointmentRevenueCents: number,
    includeTodayDetails = false,
  ) => ({
    completedAppointmentRevenueCents,
    cashCollectedCents: includeTodayDetails
      ? (options?.cashCollectedCents ?? 0)
      : 0,
    discountsCents: includeTodayDetails ? (options?.discountsCents ?? 0) : 0,
    taxCents: includeTodayDetails ? (options?.taxCents ?? 0) : 0,
    tipsCents: includeTodayDetails ? (options?.tipsCents ?? 0) : 0,
    completedAppointmentCount: completedAppointmentRevenueCents > 0 ? 1 : 0,
    provenance,
    dateRange: {
      start: '2026-07-17T04:00:00.000Z',
      end: '2026-07-17T18:00:00.000Z',
      timezone: 'America/Toronto',
      isToDate: true,
    },
  });

  return {
    currency: 'CAD',
    timeZone: 'America/Toronto',
    asOf: '2026-07-17T18:00:00.000Z',
    currentPeriods: {
      today: period(options?.todayRevenueCents ?? 0, true),
      weekToDate: period(options?.weekRevenueCents ?? 0),
      monthToDate: period(options?.monthRevenueCents ?? 0),
    },
    balances: {
      completedOutstandingCents: options?.completedOutstandingCents ?? 0,
      completed: options?.balanceProvenance ?? provenance,
      settledByLegacyPaymentStatusCount: 0,
      asOf: '2026-07-17T18:00:00.000Z',
    },
  };
}

function financialSummaryResponse(
  summary: OwnerFinancialSummary = buildFinancialSummary(),
): Response {
  return new Response(JSON.stringify({ data: summary }), { status: 200 });
}

function supportingWorkspaceResponse(url: string): Response | null {
  if (url.startsWith('/api/admin/today?')) {
    return new Response(JSON.stringify(todayPayload), { status: 200 });
  }
  if (url.startsWith('/api/admin/retention?')) {
    return new Response(JSON.stringify({
      data: {
        retention: [],
        appointmentReminders: [],
        history: [],
      },
    }), { status: 200 });
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('OwnerTodayWorkspace client follow-ups', () => {
  it('shows the eight ordered figures with the exact estimated-history explanation', async () => {
    const estimatedProvenance: ReportingProvenance = {
      mode: 'mixed',
      finalizedAppointmentCount: 1,
      legacyAppointmentCount: 1,
      unresolvedAppointmentCount: 0,
      finalizedAmountCents: 10000,
      legacyFallbackAmountCents: 0,
      isEstimated: true,
    };
    const financialSummary = buildFinancialSummary({
      todayRevenueCents: 10000,
      weekRevenueCents: 25000,
      monthRevenueCents: 80000,
      cashCollectedCents: 6000,
      completedOutstandingCents: 5800,
      tipsCents: 500,
      taxCents: 1300,
      discountsCents: 1000,
      periodProvenance: estimatedProvenance,
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        return new Response(JSON.stringify({
          data: {
            retention: [],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse(financialSummary);
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');
    await screen.findByText('$100.00');

    expect(revenue).toHaveTextContent('Revenue today');
    expect(revenue).toHaveTextContent('Revenue this week');
    expect(revenue).toHaveTextContent('Revenue this month');
    expect(revenue).toHaveTextContent('Completed appointment revenue');
    expect(revenue).toHaveTextContent('$100.00');
    expect(revenue).toHaveTextContent('$250.00');
    expect(revenue).toHaveTextContent('$800.00');
    expect(revenue).toHaveTextContent('Completed outstanding');
    expect(revenue).toHaveTextContent('$58.00');
    expect(revenue).not.toHaveTextContent(/profit|deposit|refund/i);

    const secondaryLabels = [
      'Collected today',
      'Completed outstanding',
      'Tips today',
      'Tax today',
      'Discounts today',
    ].map(label => screen.getByText(label));
    for (let index = 1; index < secondaryLabels.length; index++) {
      expect(
        secondaryLabels[index - 1]!.compareDocumentPosition(
          secondaryLabels[index]!,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    expect(revenue).toHaveTextContent('Estimated history');
    expect(revenue).toHaveTextContent(
      'Some historical totals use booked values because finalized checkout details are unavailable.',
    );
    expect(revenue).not.toHaveTextContent('Incomplete history');
  });

  it('shows a dedicated revenue skeleton while its endpoint is loading', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return new Promise<Response>(() => {});
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    expect(
      await screen.findByTestId('owner-revenue-summary-loading'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Revenue today')).not.toBeInTheDocument();
  });

  it('shows the overall empty state only when all eight figures are zero', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse();
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const emptyState = await screen.findByTestId(
      'owner-revenue-summary-empty',
    );
    const revenue = screen.getByTestId('owner-revenue-summary');

    expect(emptyState).toHaveTextContent(
      'No completed financial activity yet.',
    );
    expect(within(revenue).getAllByText('$0.00')).toHaveLength(8);
    expect(revenue).not.toHaveTextContent(/Estimated history|Incomplete history/);
  });

  it('does not show the overall empty state when collection is positive but completed revenue is zero', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse(buildFinancialSummary({
          // Collection can belong to a future appointment even when no
          // completed appointment has earned revenue today.
          cashCollectedCents: 100,
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    expect(await screen.findByText('$1.00')).toBeInTheDocument();
    expect(
      screen.queryByTestId('owner-revenue-summary-empty'),
    ).not.toBeInTheDocument();
  });

  it('gives incomplete history precedence and uses the exact explanation', async () => {
    const legacyProvenance: ReportingProvenance = {
      mode: 'legacy',
      finalizedAppointmentCount: 0,
      legacyAppointmentCount: 1,
      unresolvedAppointmentCount: 0,
      finalizedAmountCents: 0,
      legacyFallbackAmountCents: 5000,
      isEstimated: true,
    };
    const unresolvedProvenance: ReportingProvenance = {
      ...legacyProvenance,
      unresolvedAppointmentCount: 1,
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse(buildFinancialSummary({
          todayRevenueCents: 5000,
          periodProvenance: legacyProvenance,
          balanceProvenance: unresolvedProvenance,
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');

    await waitFor(() => expect(revenue).toHaveTextContent('Incomplete history'));

    expect(revenue).toHaveTextContent(
      'Some historical appointments could not be included because their financial details are unavailable.',
    );
    expect(revenue).not.toHaveTextContent('Estimated history');
    expect(revenue).not.toHaveTextContent(
      'Some historical totals use booked values because finalized checkout details are unavailable.',
    );
  });

  it('shows a retryable first-load error and recovers', async () => {
    let financialSummaryAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        financialSummaryAttempts += 1;
        if (financialSummaryAttempts === 1) {
          return new Response(JSON.stringify({
            error: { message: 'Revenue is temporarily unavailable.' },
          }), { status: 503 });
        }
        return financialSummaryResponse(buildFinancialSummary({
          todayRevenueCents: 4200,
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    expect(
      await screen.findByText(
        'Revenue summary is temporarily unavailable.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('$42.00')).toBeInTheDocument();
    expect(financialSummaryAttempts).toBe(2);
  });

  it('keeps the last good summary on refresh failure and retries in place', async () => {
    let financialSummaryAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        financialSummaryAttempts += 1;
        if (financialSummaryAttempts === 1) {
          return financialSummaryResponse(buildFinancialSummary({
            todayRevenueCents: 12300,
          }));
        }
        if (financialSummaryAttempts === 2) {
          return new Response(JSON.stringify({
            error: { message: 'Refresh failed.' },
          }), { status: 503 });
        }
        return financialSummaryResponse(buildFinancialSummary({
          todayRevenueCents: 22200,
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    expect(await screen.findByText('$123.00')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh revenue summary' }),
    );

    expect(
      await screen.findByText(/Showing the last available revenue summary/),
    ).toHaveTextContent('Try again in a moment.');
    expect(screen.getByText('$123.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('$222.00')).toBeInTheDocument();
    expect(
      screen.queryByText(/Showing the last available revenue summary/),
    ).not.toBeInTheDocument();
  });

  it('shows only the strongest retention stage per client and opens that exact client', async () => {
    const onOpenClient = vi.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        return new Response(JSON.stringify({
          data: {
            retention: [
              {
                clientId: 'client_bob',
                clientName: 'Bob',
                phone: '+12025550101',
                stage: 'rebook',
                dueAt: '2026-06-01T12:00:00.000Z',
                lastVisitAt: '2026-05-10T12:00:00.000Z',
                rebookIntervalDays: 21,
              },
              {
                clientId: 'client_bob',
                clientName: 'Bob',
                phone: '+12025550101',
                stage: 'promo_8w',
                dueAt: '2026-07-05T12:00:00.000Z',
                lastVisitAt: '2026-05-10T12:00:00.000Z',
                rebookIntervalDays: 21,
              },
            ],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse();
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace({ onOpenClient });

    const winBack = await screen.findByRole('button', { name: 'Win back Bob' });

    expect(screen.queryByRole('button', { name: 'Rebook Bob' })).not.toBeInTheDocument();

    expect(screen.getByText('8-week win-back')).toBeInTheDocument();

    await userEvent.click(winBack);

    expect(onOpenClient).toHaveBeenCalledWith('client_bob');
  });

  it('opens the exact client profile from a due reminder', async () => {
    const onOpenClient = vi.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        return new Response(JSON.stringify({
          data: {
            retention: [],
            appointmentReminders: [{
              appointmentId: 'appt_123',
              clientId: 'client_ada',
              clientName: 'Ada',
              phone: '+12025550102',
              startTime: '2026-07-18T14:00:00.000Z',
              endTime: '2026-07-18T15:00:00.000Z',
              dueAt: '2026-07-17T14:00:00.000Z',
            }],
            history: [],
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse();
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace({ onOpenClient });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Send reminder to Ada' }),
    );

    expect(onOpenClient).toHaveBeenCalledWith('client_ada');
  });

  it('shows an actionable error and retries the retention queue', async () => {
    let retentionAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        retentionAttempts += 1;
        if (retentionAttempts === 1) {
          return new Response(JSON.stringify({
            error: { message: 'Follow-ups are temporarily unavailable.' },
          }), { status: 503 });
        }
        return new Response(JSON.stringify({
          data: {
            retention: [{
              clientId: 'client_ada',
              clientName: 'Ada',
              phone: '+12025550102',
              stage: 'rebook',
              dueAt: '2026-07-17T12:00:00.000Z',
              lastVisitAt: '2026-06-20T12:00:00.000Z',
              rebookIntervalDays: 21,
            }],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse();
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    expect(
      await screen.findByText('Follow-ups are temporarily unavailable.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Rebook Ada' })).toBeInTheDocument();

    await waitFor(() => expect(retentionAttempts).toBe(2));
  });

  it('refreshes the matching queue immediately after dashboard mutations', async () => {
    let todayRequests = 0;
    let retentionRequests = 0;
    let financialSummaryRequests = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        todayRequests += 1;
        return new Response(JSON.stringify(todayPayload), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        retentionRequests += 1;
        return new Response(JSON.stringify({
          data: {
            retention: [],
            appointmentReminders: [],
            history: [],
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        financialSummaryRequests += 1;
        return financialSummaryResponse();
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    await waitFor(() => {
      expect(todayRequests).toBe(1);
      expect(retentionRequests).toBe(1);
      expect(financialSummaryRequests).toBe(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event(RETENTION_DATA_CHANGED_EVENT));
    });

    await waitFor(() => expect(retentionRequests).toBe(2));

    expect(todayRequests).toBe(1);
    expect(financialSummaryRequests).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event(APPOINTMENT_DATA_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(todayRequests).toBe(2);
      expect(financialSummaryRequests).toBe(2);
    });
  });
});
