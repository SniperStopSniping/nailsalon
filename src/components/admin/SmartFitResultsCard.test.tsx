import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmartFitReportResponse } from '@/libs/smartFitReporting';

import { SmartFitResultsCard } from './SmartFitResultsCard';

const fetchMock = vi.fn();

function buildReport(overrides: Partial<SmartFitReportResponse> = {}): SmartFitReportResponse {
  return {
    config: { enabled: true },
    metrics: {
      appointments: 3,
      discountGivenCents: 1800,
      bookedRevenueCents: 16350,
      averageDiscountCents: 600,
      completedCount: 2,
      upcomingCount: 1,
      cancelledCount: 0,
      noShowCount: 0,
    },
    series: [
      { key: '2026-07-12', label: 'Sun', appointments: 0, discountCents: 0, revenueCents: 0 },
      { key: '2026-07-13', label: 'Mon', appointments: 2, discountCents: 1300, revenueCents: 11850 },
      { key: '2026-07-14', label: 'Tue', appointments: 1, discountCents: 500, revenueCents: 4500 },
    ],
    services: [
      { name: 'BIAB Short', appointments: 2, revenueCents: 11850, discountCents: 1300 },
      { name: 'Pedicure', appointments: 1, revenueCents: 4500, discountCents: 500 },
    ],
    technicians: [
      { name: 'Daniela', appointments: 2, revenueCents: 11850, discountCents: 1300 },
      { name: 'Isla', appointments: 1, revenueCents: 4500, discountCents: 500 },
    ],
    recent: [
      {
        startTime: '2026-07-14T14:00:00.000Z',
        clientName: 'Avery Client',
        serviceName: 'Pedicure',
        technicianName: 'Isla',
        subtotalCents: 5000,
        discountCents: 500,
        finalCents: 4500,
        status: 'completed',
      },
    ],
    period: 'weekly',
    anchor: '2026-07-15',
    dateRange: { start: '2026-07-12T04:00:00.000Z', end: '2026-07-19T04:00:00.000Z' },
    timezone: 'America/Toronto',
    currency: 'CAD',
    ...overrides,
  };
}

function mockReport(report: SmartFitReportResponse) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: report }),
  });
}

async function renderCard(props: Partial<Parameters<typeof SmartFitResultsCard>[0]> = {}) {
  render(
    <SmartFitResultsCard
      salonSlug="salon-a"
      period="Weekly"
      anchorDate="2026-07-15"
      {...props}
    />,
  );
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalled();
  });
}

describe('SmartFitResultsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('requests the report for the shared salon/period/anchor range', async () => {
    mockReport(buildReport());
    await renderCard();

    const url = fetchMock.mock.calls[0]![0] as string;

    expect(url).toContain('/api/admin/analytics/smart-fit?');
    expect(url).toContain('salonSlug=salon-a');
    expect(url).toContain('period=weekly');
    expect(url).toContain('anchor=2026-07-15');
  });

  it('renders the four summary metrics with visible definitions', async () => {
    mockReport(buildReport());
    await renderCard();

    await screen.findByText('Smart Fit appointments');

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Discount given')).toBeInTheDocument();
    expect(screen.getByText('$18.00')).toBeInTheDocument();
    expect(screen.getByText('Booked revenue')).toBeInTheDocument();
    expect(screen.getByText('$163.50')).toBeInTheDocument();
    expect(screen.getByText('Average discount')).toBeInTheDocument();
    expect(screen.getByText('$6.00')).toBeInTheDocument();
    // Definitions are visible helper copy, not hidden tooltips.
    expect(screen.getByText(/booked with a Smart Fit discount saved at booking time/i)).toBeInTheDocument();
    expect(screen.getByText(/Not a claim that Smart Fit caused the booking/i)).toBeInTheDocument();
  });

  it('shows the enabled status chip and settings link', async () => {
    const onOpenSettings = vi.fn();
    mockReport(buildReport());
    await renderCard({ onOpenSettings });

    await screen.findByText('Smart Fit is on');

    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('renders breakdowns and the recent list from the API payload', async () => {
    mockReport(buildReport());
    await renderCard();

    await screen.findByText('By service');

    expect(screen.getByText('BIAB Short')).toBeInTheDocument();
    expect(screen.getByText('By technician')).toBeInTheDocument();
    expect(screen.getByText('Daniela')).toBeInTheDocument();
    expect(screen.getByText('Recent Smart Fit appointments')).toBeInTheDocument();
    expect(screen.getByText(/Avery Client/)).toBeInTheDocument();
    // Labeled amounts — not an equation, since finalized checkout totals can
    // legitimately differ from booked-subtotal minus discount.
    expect(screen.getByText(/Booked \$50\.00 · Smart Fit −\$5\.00 · Final \$45\.00/)).toBeInTheDocument();
  });

  it('states amounts without a false equation for checkout-adjusted appointments', async () => {
    mockReport(buildReport({
      recent: [{
        startTime: '2026-07-14T14:00:00.000Z',
        clientName: 'Adjusted Client',
        serviceName: 'Pedicure',
        technicianName: 'Isla',
        subtotalCents: 5000,
        discountCents: 500,
        finalCents: 6350, // finalized checkout raised the price
        status: 'completed',
      }],
    }));
    await renderCard();

    await screen.findByText(/Booked \$50\.00 · Smart Fit −\$5\.00 · Final \$63\.50/);

    expect(screen.queryByText(/=/)).not.toBeInTheDocument();
  });

  it('announces the excluded cancelled/no-show count separately', async () => {
    mockReport(buildReport({
      metrics: {
        ...buildReport().metrics,
        cancelledCount: 2,
        noShowCount: 1,
      },
    }));
    await renderCard();

    await screen.findByText(/3 bookings with a Smart Fit discount were cancelled or marked no-show and excluded/);
  });

  it('shows the truthful empty state when there is no Smart Fit usage', async () => {
    mockReport(buildReport({
      metrics: {
        appointments: 0,
        discountGivenCents: 0,
        bookedRevenueCents: 0,
        averageDiscountCents: 0,
        completedCount: 0,
        upcomingCount: 0,
        cancelledCount: 0,
        noShowCount: 0,
      },
      series: [],
      services: [],
      technicians: [],
      recent: [],
    }));
    await renderCard();

    await screen.findByText('No Smart Fit appointments were found for this period.');

    expect(screen.queryByText('Discount given')).not.toBeInTheDocument();
  });

  it('still reports excluded cancellations when every in-range booking was excluded', async () => {
    mockReport(buildReport({
      metrics: {
        appointments: 0,
        discountGivenCents: 0,
        bookedRevenueCents: 0,
        averageDiscountCents: 0,
        completedCount: 0,
        upcomingCount: 0,
        cancelledCount: 2,
        noShowCount: 0,
      },
      series: [],
      services: [],
      technicians: [],
      recent: [],
    }));
    await renderCard();

    await screen.findByText('No Smart Fit appointments were found for this period.');

    // The empty copy alone would be misleading — the exclusions are stated.
    expect(screen.getByText(/2 bookings with a Smart Fit discount were cancelled and excluded/)).toBeInTheDocument();
  });

  it('states that Smart Fit is off while still showing historical results', async () => {
    mockReport(buildReport({ config: { enabled: false } }));
    await renderCard();

    await screen.findByText('Smart Fit is off');

    expect(screen.getByText(/Smart Fit is currently off/)).toBeInTheDocument();
    expect(screen.getByText(/not changed by turning Smart Fit on or off/)).toBeInTheDocument();
    // Historical numbers still render.
    expect(screen.getByText('$18.00')).toBeInTheDocument();
  });

  it('shows a retryable error — never zeros — when the request fails, and retry keeps the range', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await renderCard();

    await screen.findByRole('alert');

    expect(screen.getByText('Could not load Smart Fit results.')).toBeInTheDocument();
    expect(screen.queryByText('Smart Fit appointments')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();

    mockReport(buildReport());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Smart Fit appointments');

    const retryUrl = fetchMock.mock.calls.at(-1)![0] as string;

    expect(retryUrl).toContain('period=weekly');
    expect(retryUrl).toContain('anchor=2026-07-15');
  });

  it('keeps keyboard focus inside the card when retrying', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await renderCard();

    await screen.findByRole('alert');

    mockReport(buildReport());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // The alert (and its button) unmount; focus must not drop to <body>.
    expect(document.body).not.toHaveFocus();

    await screen.findByText('Smart Fit appointments');
  });

  it('treats a malformed success payload as an error rather than rendering fake zeros', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await renderCard();

    await screen.findByRole('alert');

    expect(screen.queryByText('Smart Fit appointments')).not.toBeInTheDocument();
  });

  it('shows an accessible loading state while fetching', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    await renderCard();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading Smart Fit results…')).toBeInTheDocument();

    resolveFetch({ ok: true, status: 200, json: async () => ({ data: buildReport() }) });
    await screen.findByText('Smart Fit appointments');
  });

  it('provides a screen-reader alternative for every trend bucket', async () => {
    mockReport(buildReport());
    await renderCard();

    await screen.findByText('Smart Fit appointments over time');

    expect(screen.getByText(/Mon: 2 Smart Fit appointments, \$13\.00 discount, \$118\.50 booked revenue/)).toBeInTheDocument();
    expect(screen.getByText(/Sun: 0 Smart Fit appointments/)).toBeInTheDocument();
  });
});
