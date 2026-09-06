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

/**
 * Revenue detail is a disclosure now (OP-009 / AG-cohesion-05): the card opens
 * on the headline figures and the owner asks for the rest. Every assertion
 * about a detail row therefore opens it first — the assertions themselves are
 * unchanged.
 */
async function openRevenueBreakdown() {
  await userEvent.click(
    await screen.findByTestId('owner-revenue-breakdown-toggle'),
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
  depositCollectedCents?: number;
  depositRefundedCents?: number;
  depositForfeitedCents?: number;
  depositForfeitureEstimatedTaxCents?: number;
  depositForfeitureEstimatedNetCents?: number;
  depositForfeitureRefundReversalCents?: number;
  depositForfeitureTaxReversalCents?: number;
  depositForfeitureNetReversalCents?: number;
  forfeitureTaxIdentityBuckets?: NonNullable<
    OwnerFinancialSummary['currentPeriods']['today']['forfeitureTaxIdentityBuckets']
  >;
  depositAppliedCents?: number;
  unresolvedDepositApplicationCount?: number;
  unattributedPaymentEventCount?: number;
  unattributedDepositEventCount?: number;
  unresolvedDepositEventCount?: number;
  unknownCurrencyAppointmentCount?: number;
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
    appointmentPaymentsCollectedCents: includeTodayDetails
      ? Math.max(
        0,
        (options?.cashCollectedCents ?? 0)
        - (options?.depositCollectedCents ?? 0),
      )
      : 0,
    depositCollectedCents: includeTodayDetails
      ? (options?.depositCollectedCents ?? 0)
      : 0,
    depositRefundedCents: includeTodayDetails
      ? (options?.depositRefundedCents ?? 0)
      : 0,
    depositForfeitedCents: includeTodayDetails
      ? (options?.depositForfeitedCents ?? 0)
      : 0,
    depositForfeitureEstimatedTaxCents: includeTodayDetails
      ? (options?.depositForfeitureEstimatedTaxCents ?? 0)
      : 0,
    depositForfeitureEstimatedNetCents: includeTodayDetails
      ? (options?.depositForfeitureEstimatedNetCents ?? 0)
      : 0,
    depositForfeitureRefundReversalCents: includeTodayDetails
      ? (options?.depositForfeitureRefundReversalCents ?? 0)
      : 0,
    depositForfeitureTaxReversalCents: includeTodayDetails
      ? (options?.depositForfeitureTaxReversalCents ?? 0)
      : 0,
    depositForfeitureNetReversalCents: includeTodayDetails
      ? (options?.depositForfeitureNetReversalCents ?? 0)
      : 0,
    forfeitureTaxIdentityBuckets: includeTodayDetails
      ? (options?.forfeitureTaxIdentityBuckets ?? [])
      : [],
    depositAppliedCents: includeTodayDetails
      ? (options?.depositAppliedCents ?? 0)
      : 0,
    unresolvedDepositApplicationCount: includeTodayDetails
      ? (options?.unresolvedDepositApplicationCount ?? 0)
      : 0,
    unattributedPaymentEventCount: includeTodayDetails
      ? (options?.unattributedPaymentEventCount ?? 0)
      : 0,
    unattributedDepositEventCount: includeTodayDetails
      ? (options?.unattributedDepositEventCount ?? 0)
      : 0,
    unresolvedDepositEventCount: includeTodayDetails
      ? (options?.unresolvedDepositEventCount ?? 0)
      : 0,
    unknownCurrencyAppointmentCount: includeTodayDetails
      ? (options?.unknownCurrencyAppointmentCount ?? 0)
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
  it('shows the ordered financial figures with the exact estimated-history explanation', async () => {
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
      depositForfeitedCents: 300,
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
    await openRevenueBreakdown();

    expect(revenue).toHaveTextContent('Revenue today');
    expect(revenue).toHaveTextContent('Revenue this week');
    expect(revenue).toHaveTextContent('Revenue this month');
    expect(revenue).toHaveTextContent('Completed appointment revenue');
    expect(revenue).toHaveTextContent('$100.00');
    expect(revenue).toHaveTextContent('$250.00');
    expect(revenue).toHaveTextContent('$800.00');
    expect(revenue).toHaveTextContent('Completed outstanding');
    expect(revenue).toHaveTextContent('$58.00');
    expect(revenue).not.toHaveTextContent(/profit/i);

    const secondaryLabels = [
      'Collected today',
      'Remaining-balance payments',
      'Deposits collected',
      'Deposit refunds',
      'Deposits applied',
      'Deposits forfeited (gross)',
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

  it('shows the overall empty state only when every displayed figure is zero', async () => {
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
    // DELIBERATE CHANGE (OP-009 / AG-cohesion-05): the card used to paint 13
    // $0.00 tiles on arrival. It now opens on the three headline figures and
    // the rest is a disclosure.
    expect(within(revenue).getAllByText('$0.00')).toHaveLength(3);
    expect(revenue).not.toHaveTextContent('Collected today');

    await openRevenueBreakdown();

    // Opened, the breakdown still omits the deposit and tax families: this
    // salon takes no deposits and charges no tax, so those rows are not facts
    // about today.
    expect(revenue).toHaveTextContent('Collected today');
    expect(revenue).toHaveTextContent('Completed outstanding');
    expect(revenue).not.toHaveTextContent('Deposits collected');
    expect(revenue).not.toHaveTextContent('Tax today');
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

    await screen.findByTestId('owner-revenue-summary');
    await openRevenueBreakdown();

    expect(await screen.findAllByText('$1.00')).toHaveLength(2);
    expect(
      screen.queryByTestId('owner-revenue-summary-empty'),
    ).not.toBeInTheDocument();
  });

  it('shows dated deposit flows separately and discloses unresolved history', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse(buildFinancialSummary({
          cashCollectedCents: 6500,
          depositCollectedCents: 2500,
          depositRefundedCents: 500,
          depositAppliedCents: 2000,
          depositForfeitedCents: 300,
          unattributedPaymentEventCount: 1,
          unattributedDepositEventCount: 1,
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');

    // Same timing contract as the forfeiture test below: the card mounts
    // before the financial summary's state update renders the deposit lines.
    await openRevenueBreakdown();
    await waitFor(() => expect(revenue).toHaveTextContent('Deposits collected$25.00'));

    expect(revenue).toHaveTextContent('Deposit refunds$5.00');
    expect(revenue).toHaveTextContent('Deposits applied$20.00');
    expect(revenue).toHaveTextContent('Deposits forfeited (gross)$3.00');
    expect(screen.getByTestId('owner-deposit-reporting-incomplete')).toHaveTextContent(
      'event date, currency, or resolution is unknown',
    );
  });

  it('shows frozen forfeiture tax identity, stored estimates, reversals, and currency exclusions', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse(buildFinancialSummary({
          depositForfeitedCents: 2500,
          depositForfeitureEstimatedTaxCents: 288,
          depositForfeitureEstimatedNetCents: 2212,
          depositForfeitureRefundReversalCents: 2500,
          depositForfeitureTaxReversalCents: 288,
          depositForfeitureNetReversalCents: 2212,
          unknownCurrencyAppointmentCount: 1,
          forfeitureTaxIdentityBuckets: [{
            schemaVersion: 1,
            classification: 'estimate',
            label: 'HST',
            rateBps: 1300,
            mode: 'added',
            configurationEffectiveFrom: null,
            configurationSource: 'base',
            taxEstimateApplied: true,
            forfeitureCount: 1,
            grossForfeitedCents: 2500,
            estimatedTaxIncludedCents: 288,
            estimatedNetCents: 2212,
            refundReversalCount: 1,
            refundReversalCents: 2500,
            estimatedTaxReversalCents: 288,
            estimatedNetReversalCents: 2212,
          }],
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');

    // The card mounts before the financial summary's later state update
    // renders the forfeiture lines; wait for that content like the
    // 'Incomplete history' test below does.
    await openRevenueBreakdown();
    await waitFor(() => expect(revenue).toHaveTextContent('Forfeiture tax estimate$2.88'));

    expect(revenue).toHaveTextContent('Forfeiture net estimate$22.12');
    expect(revenue).toHaveTextContent('Forfeiture refund reversals$25.00');
    expect(screen.getByTestId('owner-forfeiture-tax-identities')).toHaveTextContent(
      'HST · 13.00% · added',
    );
    expect(screen.getByTestId('owner-forfeiture-tax-identities')).toHaveTextContent(
      'Schema 1 · estimate · base',
    );
    expect(screen.getByTestId('owner-currency-reporting-incomplete')).toHaveTextContent(
      'unknown or non-CAD currency',
    );
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
        // Both caveats are true of the REVENUE periods here, and the
        // unresolved one must win. (The balance projection is deliberately
        // the quiet one — it has its own test below.)
        return financialSummaryResponse(buildFinancialSummary({
          todayRevenueCents: 5000,
          periodProvenance: unresolvedProvenance,
          balanceProvenance: legacyProvenance,
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
    expect(screen.getByTestId('owner-revenue-under-review-chip')).toBeInTheDocument();
  });

  /**
   * AG-w2-appointments-02: exact revenue must never be described as
   * incomplete. Salon B's five completed appointments are finalized revenue
   * ($90.00 in the current week) while their balances stay unresolved for want
   * of a payment record; the card answered that with "Incomplete history —
   * Some historical appointments could not be included", over figures that
   * were complete.
   */
  it('does not call exact revenue incomplete when only the balances are unresolved', async () => {
    const finalizedProvenance: ReportingProvenance = {
      mode: 'finalized',
      finalizedAppointmentCount: 1,
      legacyAppointmentCount: 0,
      unresolvedAppointmentCount: 0,
      finalizedAmountCents: 9000,
      legacyFallbackAmountCents: 0,
      isEstimated: false,
    };
    const unresolvedBalanceProvenance: ReportingProvenance = {
      mode: 'empty',
      finalizedAppointmentCount: 0,
      legacyAppointmentCount: 0,
      unresolvedAppointmentCount: 5,
      finalizedAmountCents: 0,
      legacyFallbackAmountCents: 0,
      isEstimated: true,
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supportingResponse = supportingWorkspaceResponse(url);
      if (supportingResponse) {
        return supportingResponse;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse(buildFinancialSummary({
          todayRevenueCents: 0,
          weekRevenueCents: 9000,
          monthRevenueCents: 9000,
          periodProvenance: finalizedProvenance,
          balanceProvenance: unresolvedBalanceProvenance,
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');

    await waitFor(() => expect(revenue).toHaveTextContent('Balances under review'));

    expect(revenue).toHaveTextContent(
      '5 completed appointments could not be reconciled against their payment records, so they are left out of Completed outstanding.',
    );
    expect(revenue).toHaveTextContent(
      'Every completed appointment is counted in the revenue totals.',
    );
    expect(revenue).not.toHaveTextContent('Incomplete history');
    expect(revenue).not.toHaveTextContent(
      'Some historical appointments could not be included because their financial details are unavailable.',
    );
    // The Revenue headline is exact, so it carries no "Under review" chip.
    expect(
      screen.queryByTestId('owner-revenue-under-review-chip'),
    ).not.toBeInTheDocument();
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

// AG-security-tenancy-02: revenue is owner-only on the server. A collaborator
// is not looking at a broken card, and must not be told to "Try again".
describe('OwnerTodayWorkspace revenue for a collaborator', () => {
  it('says Owner only instead of an error, and stops polling revenue', async () => {
    let financialSummaryRequests = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const supporting = supportingWorkspaceResponse(url);
      if (supporting) {
        return supporting;
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        financialSummaryRequests += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: 'OWNER_REQUIRED',
              message: 'Only the salon owner can see revenue.',
            },
          }),
          { status: 403 },
        );
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');
    await screen.findByTestId('owner-revenue-summary-owner-only');

    expect(revenue).toHaveTextContent('Owner only');
    expect(revenue).toHaveTextContent(
      'Revenue is visible to the salon owner. Your appointments, clients and services are unchanged.',
    );
    expect(revenue).not.toHaveTextContent('Revenue summary is temporarily unavailable.');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh revenue summary' })).not.toBeInTheDocument();
    expect(revenue).not.toHaveTextContent('$');

    // A refused card must not become a per-minute retry loop.
    await act(async () => {
      window.dispatchEvent(new Event(APPOINTMENT_DATA_CHANGED_EVENT));
    });
    await waitFor(() => {
      expect(financialSummaryRequests).toBe(1);
    });
  });
});

describe('OwnerTodayWorkspace first fold', () => {
  // Relative to the real clock: "still to come" is a fact about now, and a
  // hard-coded date would quietly stop testing it.
  const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString();
  const IN_TWO_HOURS = new Date(Date.now() + 7_200_000).toISOString();

  function todayWith(
    appointmentOverrides: Array<Partial<{
      id: string;
      clientName: string | null;
      startTime: string;
      endTime: string;
      status: string;
    }>>,
    integrationOverrides?: Record<string, unknown>,
  ) {
    return {
      data: {
        ...todayPayload.data,
        appointments: appointmentOverrides.map((appointment, index) => ({
          id: appointment.id ?? `appt_${index}`,
          clientName: appointment.clientName ?? `Client ${index}`,
          startTime: appointment.startTime ?? IN_AN_HOUR,
          endTime: appointment.endTime ?? IN_TWO_HOURS,
          status: appointment.status ?? 'confirmed',
          totalPrice: 8000,
          totalDurationMinutes: 60,
          technicianName: 'Daniela',
          services: ['Gel manicure'],
          clientSensitivities: null,
        })),
        integrationHealth: {
          ...todayPayload.data.integrationHealth,
          ...(integrationOverrides ?? {}),
        },
      },
    };
  }

  function mockWorkspace(today: ReturnType<typeof todayWith>) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/today?')) {
        return new Response(JSON.stringify(today), { status: 200 });
      }
      if (url.startsWith('/api/admin/retention?')) {
        return new Response(JSON.stringify({
          data: { retention: [], appointmentReminders: [], history: [] },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/financial-summary?')) {
        return financialSummaryResponse();
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  }

  it('surfaces a booking still waiting for an answer, and confirming it opens that appointment', async () => {
    mockWorkspace(todayWith([
      { id: 'appt_confirmed', status: 'confirmed' },
      {
        id: 'appt_audit_a11',
        clientName: 'AUDIT Client Dev',
        status: 'pending',
      },
    ]));
    const onOpenAppointment = vi.fn();

    renderWorkspace({ onOpenAppointment });

    const attention = await screen.findByTestId('owner-needs-attention');

    expect(
      screen.getByTestId('owner-needs-attention-pending-count'),
    ).toHaveTextContent('1 booking needs confirming');
    expect(attention).toHaveTextContent('AUDIT Client Dev');

    await userEvent.click(
      within(attention).getByRole('button', { name: /^Confirm AUDIT Client Dev at/ }),
    );

    expect(onOpenAppointment).toHaveBeenCalledWith('appt_audit_a11');
  });

  it('puts what needs attention above the schedule', async () => {
    mockWorkspace(todayWith([{ id: 'appt_pending', status: 'pending' }]));

    renderWorkspace();

    const attention = await screen.findByTestId('owner-needs-attention');
    const agenda = screen.getByTestId('owner-today-agenda');

    expect(
      attention.compareDocumentPosition(agenda)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says nothing about attention when every booking today is settled', async () => {
    mockWorkspace(todayWith([
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'completed' },
    ]));

    renderWorkspace();

    await screen.findByTestId('owner-today-agenda');

    expect(screen.queryByTestId('owner-needs-attention')).not.toBeInTheDocument();
  });

  it('states the day once, as a total and what is left of it', async () => {
    mockWorkspace(todayWith([
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'confirmed' },
      { id: 'c', status: 'confirmed' },
      { id: 'd', status: 'pending' },
    ]));

    renderWorkspace();

    const tile = await screen.findByTestId('owner-today-count-tile');

    await waitFor(() => expect(tile).toHaveTextContent('4 appointments today'));

    expect(tile).toHaveTextContent('4 still to come');
    // The redundant second tile is gone (AG-today-calendar-07).
    expect(screen.queryByText('Upcoming today')).not.toBeInTheDocument();
    expect(screen.queryByText('Appointments today')).not.toBeInTheDocument();
  });

  it('opens the revenue card on its headline figures, with the detail behind a disclosure', async () => {
    mockWorkspace(todayWith([]));

    renderWorkspace();

    const revenue = await screen.findByTestId('owner-revenue-summary');
    const toggle = await screen.findByTestId('owner-revenue-breakdown-toggle');

    expect(toggle).toHaveTextContent('View breakdown');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(revenue).not.toHaveTextContent('Collected today');
    // One line about the money, never a "nothing yet" that argues with an
    // "incomplete history" banner (AG-today-calendar-08).
    expect(
      within(revenue).getAllByTestId(/owner-revenue-summary-empty|owner-revenue-history-notice/),
    ).toHaveLength(1);

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide breakdown');
    expect(revenue).toHaveTextContent('Collected today');
  });

  it('offers to connect Google Calendar instead of describing a sync that does not exist', async () => {
    mockWorkspace(todayWith([], {
      google: { status: 'disconnected', readiness: 'not_connected' },
    }));

    renderWorkspace();

    const card = await screen.findByTestId('owner-google-calendar-card');

    await waitFor(() =>
      expect(card).toHaveTextContent('Connect Google Calendar'));

    expect(card).not.toHaveTextContent('two-way sync');
    expect(card).toHaveTextContent('Not connected yet.');
  });

  it('keeps the connected calendar copy when the integration is ready', async () => {
    mockWorkspace(todayWith([], {
      google: { status: 'connected', readiness: 'ready' },
    }));

    renderWorkspace();

    const card = await screen.findByTestId('owner-google-calendar-card');

    await waitFor(() => expect(card).toHaveTextContent('two-way sync'));

    expect(card).toHaveTextContent('Google Calendar & reminders');
  });

  it('gives every schedule row the same background', async () => {
    mockWorkspace(todayWith([
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'confirmed' },
      { id: 'c', status: 'pending' },
    ]));

    renderWorkspace();

    const agenda = await screen.findByTestId('owner-today-agenda');

    await waitFor(() =>
      expect(within(agenda).getAllByText(/Client [012]/)).toHaveLength(3));

    const rows = within(agenda)
      .getAllByRole('button')
      .filter(button => button.className.includes('py-4'));

    expect(rows).toHaveLength(3);

    // r27 cohesion sweep: the shared ground moved from the literal `bg-white`
    // onto the owner surface token, so Today, the calendar and the sheets all
    // paint from one layer. The rule under test is unchanged — every row has
    // the SAME ground, and "next" is never carried by an amber wash.
    const grounds = new Set(
      rows.map(row =>
        (row.className.match(/bg-\[var\(--owner-surface[^\]]*\]|bg-white/) ?? [''])[0]),
    );

    expect(grounds).toEqual(new Set(['bg-[var(--owner-surface,#fffdfb)]']));

    for (const row of rows) {
      expect(row.className).not.toContain('bg-amber-50');
    }
  });
});
