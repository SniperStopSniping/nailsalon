'use client';

import { Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';
import type { SmartFitReportResponse } from '@/libs/smartFitReporting';

/**
 * Owner-facing Smart Fit results (Analytics app → bottom of the Performance
 * view). Self-contained like SmartFitSettingsCard: fetches its own data from
 * GET /api/admin/analytics/smart-fit and follows the modal's shared
 * period/anchor date range so it always shows the same window as the widgets
 * above it.
 *
 * Truthfulness rules baked into this surface:
 * - Historical results come only from persisted booking snapshots; the current
 *   configuration (Enabled/Disabled chip) is displayed separately and changing
 *   or disabling Smart Fit never alters the numbers.
 * - Booked revenue is labelled exactly that — never "additional revenue"; no
 *   counterfactual or ROI claims.
 * - A failed request shows a retryable error, never zeros.
 */

type TimePeriodLabel = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

const PERIOD_PARAM_MAP: Record<TimePeriodLabel, string> = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Yearly: 'yearly',
};

const EMPTY_COPY = 'No Smart Fit appointments were found for this period.';

type SmartFitResultsCardProps = {
  salonSlug: string;
  period: TimePeriodLabel;
  /** YYYY-MM-DD anchor shared with the surrounding analytics widgets. */
  anchorDate?: string;
  /** Open the Settings app (Smart Fit configuration lives there). */
  onOpenSettings?: () => void;
};

type FetchState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SmartFitReportResponse };

function formatRecentTime(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleString('en-CA', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
};

export function SmartFitResultsCard({
  salonSlug,
  period,
  anchorDate,
  onOpenSettings,
}: SmartFitResultsCardProps) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  const requestIdRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Retrying replaces the alert (and the button inside it) with the loading
  // state; park focus on the card body so keyboard users are not dropped.
  const handleRetry = useCallback(() => {
    setRetryToken(token => token + 1);
    bodyRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;

    const load = async () => {
      setState({ status: 'loading' });
      try {
        const params = new URLSearchParams({
          salonSlug,
          period: PERIOD_PARAM_MAP[period],
        });
        if (anchorDate) {
          params.set('anchor', anchorDate);
        }
        const response = await fetch(`/api/admin/analytics/smart-fit?${params.toString()}`);
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }
        if (!response.ok) {
          setState({ status: 'error' });
          return;
        }
        const parsed = await response.json();
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }
        if (!parsed?.data) {
          setState({ status: 'error' });
          return;
        }
        setState({ status: 'ready', data: parsed.data as SmartFitReportResponse });
      } catch {
        if (!cancelled && requestIdRef.current === requestId) {
          setState({ status: 'error' });
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [salonSlug, period, anchorDate, retryToken]);

  return (
    <section
      aria-labelledby="smart-fit-results-heading"
      className="owner-card overflow-hidden text-[var(--owner-ink)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--owner-line)] p-4 sm:px-5">
        <h2
          id="smart-fit-results-heading"
          className="owner-section-title"
        >
          Smart Fit results
        </h2>
        {state.status === 'ready' && (
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                state.data.config.enabled
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-[var(--owner-blush)] text-[var(--owner-muted)]'
              }`}
            >
              {state.data.config.enabled ? 'Smart Fit is on' : 'Smart Fit is off'}
            </span>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="owner-action motion-reduce:transition-none"
              >
                <Settings2 className="size-4" aria-hidden="true" />
                Settings
              </button>
            )}
          </div>
        )}
      </div>

      <div ref={bodyRef} tabIndex={-1} className="px-4 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--owner-focus)] sm:px-5">
        {state.status === 'loading' && (
          <div role="status" className="flex items-center justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent motion-reduce:animate-none" />
            <span className="sr-only">Loading Smart Fit results…</span>
          </div>
        )}

        {state.status === 'error' && (
          <div
            role="alert"
            className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface-soft)] p-4"
          >
            <p className="text-sm font-medium text-[var(--owner-ink)]">
              Could not load Smart Fit results.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="owner-action mt-3 motion-reduce:transition-none"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <SmartFitResultsBody data={state.data} />
        )}
      </div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface-soft)] p-4">
      <div className="text-sm font-semibold text-[var(--owner-muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-[var(--owner-ink)] [overflow-wrap:anywhere]">
        {value}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--owner-muted)]">{helper}</p>
    </div>
  );
}

function BreakdownList({
  title,
  rows,
  currency,
  emptyCopy,
}: {
  title: string;
  rows: Array<{ name: string; appointments: number; revenueCents: number; discountCents: number }>;
  currency: string;
  emptyCopy: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--owner-ink)]">
        {title}
      </h3>
      {rows.length === 0
        ? (
            <p className="mt-2 text-sm text-[var(--owner-muted)]">{emptyCopy}</p>
          )
        : (
            <ul className="mt-2 divide-y divide-[var(--owner-line)]">
              {rows.map((row, index) => (
                // Index keys: rows are replaced whole per fetch, and display
                // names may legitimately collide (e.g. two staff named Amy).
                // eslint-disable-next-line react/no-array-index-key
                <li key={index} className="py-2">
                  <div className="break-words text-sm font-medium text-[var(--owner-ink)]">
                    {row.name}
                  </div>
                  <div className="mt-0.5 text-sm tabular-nums text-[var(--owner-muted)]">
                    {row.appointments}
                    {' '}
                    {row.appointments === 1 ? 'appointment' : 'appointments'}
                    {' · '}
                    {formatMoney(row.revenueCents, currency)}
                    {' booked revenue · '}
                    {formatMoney(row.discountCents, currency)}
                    {' discount'}
                  </div>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

function TrendBars({
  series,
  period,
  currency,
}: {
  series: SmartFitReportResponse['series'];
  period: string;
  currency: string;
}) {
  const max = Math.max(...series.map(bucket => bucket.appointments), 1);
  // Labels sit below the narrow bars at their own width. Keep all values in
  // the accessible list while thinning month/year labels on small screens.
  const labelStride = period === 'monthly' ? 5 : series.length > 8 ? 2 : 1;

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--owner-ink)]">
        Smart Fit appointments over time
      </h3>
      <ul
        className="mb-7 mt-3 flex h-24 items-end gap-1"
        aria-label="Smart Fit appointments per period"
      >
        {series.map((bucket, index) => (
          <li key={bucket.key} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="sr-only">
              {`${bucket.label}: ${bucket.appointments} Smart Fit ${bucket.appointments === 1 ? 'appointment' : 'appointments'}, ${formatMoney(bucket.discountCents, currency)} discount, ${formatMoney(bucket.revenueCents, currency)} booked revenue`}
            </span>
            <div
              aria-hidden="true"
              className={`w-full rounded-t-sm ${bucket.appointments > 0 ? 'bg-[var(--owner-accent)]' : 'bg-[var(--owner-line-strong)]'}`}
              style={{ height: bucket.appointments > 0 ? `${Math.max(8, (bucket.appointments / max) * 100)}%` : '3px' }}
            />
            {index % labelStride === 0 && (
              <span
                aria-hidden="true"
                className={`absolute top-full mt-1 whitespace-nowrap text-xs leading-5 text-[var(--owner-muted)] ${index === 0 ? 'left-0' : index === series.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
              >
                {bucket.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExcludedNote({ metrics }: { metrics: SmartFitReportResponse['metrics'] }) {
  const excludedCount = metrics.cancelledCount + metrics.noShowCount;
  if (excludedCount === 0) {
    return null;
  }
  return (
    <p className="text-sm text-[var(--owner-muted)]">
      {excludedCount}
      {' '}
      {excludedCount === 1 ? 'booking' : 'bookings'}
      {' '}
      with a Smart Fit discount
      {' '}
      {metrics.noShowCount > 0 && metrics.cancelledCount > 0
        ? 'were cancelled or marked no-show'
        : metrics.noShowCount > 0
          ? (excludedCount === 1 ? 'was marked no-show' : 'were marked no-show')
          : (excludedCount === 1 ? 'was cancelled' : 'were cancelled')}
      {' '}
      and excluded from the totals.
    </p>
  );
}

function SmartFitResultsBody({ data }: { data: SmartFitReportResponse }) {
  const { metrics, currency } = data;
  const hasResults = metrics.appointments > 0;

  return (
    <div className="space-y-5">
      {!data.config.enabled && (
        <p className="rounded-2xl bg-[var(--owner-blush)] p-4 text-sm leading-relaxed text-[var(--owner-muted)]">
          Smart Fit is currently off. Past results are not changed by turning Smart Fit on or off.
        </p>
      )}

      {!hasResults && (
        <>
          <p className="text-sm text-[var(--owner-muted)]">{EMPTY_COPY}</p>
          <ExcludedNote metrics={metrics} />
        </>
      )}

      {hasResults && (
        <>
          {(metrics.unknownCurrencyCount > 0
            || metrics.excludedForeignCurrencyCount > 0
            || metrics.invalidFinancialCount > 0) && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
              Some appointment amounts are unavailable because their frozen currency or tax record needs review.
              {' '}
              Appointment counts remain visible, but those amounts are excluded from money totals.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricTile
              label="Smart Fit appointments"
              value={String(metrics.appointments)}
              helper="Discount saved at booking. Cancelled and no-show bookings are excluded."
            />
            <MetricTile
              label="Discount given"
              value={formatMoney(metrics.discountGivenCents, currency)}
              helper="Total Smart Fit discounts saved on these appointments."
            />
            <MetricTile
              label="Booked revenue"
              value={formatMoney(metrics.bookedRevenueCents, currency)}
              helper="Checkout totals when completed; booked totals otherwise. Not a claim that Smart Fit caused the booking."
            />
            <MetricTile
              label="Average discount"
              value={formatMoney(metrics.averageDiscountCents, currency)}
              helper="Discount given ÷ Smart Fit appointments."
            />
          </div>

          <ExcludedNote metrics={metrics} />

          <TrendBars series={data.series} period={data.period} currency={currency} />

          <BreakdownList
            title="By service"
            rows={data.services}
            currency={currency}
            emptyCopy="No service breakdown for this period."
          />

          <BreakdownList
            title="By technician"
            rows={data.technicians}
            currency={currency}
            emptyCopy="No technician breakdown for this period."
          />

          <div>
            <h3 className="text-sm font-semibold text-[var(--owner-ink)]">
              Recent Smart Fit appointments
            </h3>
            <ul className="mt-2 divide-y divide-[var(--owner-line)]">
              {data.recent.map((appointment, index) => (
                // Index keys: the bounded list is replaced whole on each fetch,
                // and rows carry no ids by design (none exposed by the API).
                // eslint-disable-next-line react/no-array-index-key
                <li key={index} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm font-medium text-[var(--owner-ink)]">
                      {formatRecentTime(appointment.startTime, data.timezone)}
                    </span>
                    <span className="text-sm text-[var(--owner-muted)]">
                      {STATUS_LABELS[appointment.status] ?? appointment.status}
                    </span>
                  </div>
                  <div className="mt-0.5 break-words text-sm text-[var(--owner-ink)]">
                    {appointment.clientName ?? 'Client'}
                    {' · '}
                    {appointment.serviceName}
                    {' · '}
                    {appointment.technicianName}
                  </div>
                  {/* Labeled amounts, not an equation: the final total is the
                      finalized checkout amount when one exists, so it need not
                      equal booked-subtotal minus the Smart Fit discount. */}
                  {appointment.financialState === 'resolved'
                    ? (
                        <div className="mt-0.5 text-sm tabular-nums text-[var(--owner-muted)]">
                          {'Booked '}
                          {formatMoney(appointment.subtotalCents ?? 0, currency)}
                          {' · Smart Fit −'}
                          {formatMoney(appointment.discountCents ?? 0, currency)}
                          {' · Final '}
                          {formatMoney(appointment.finalCents ?? 0, currency)}
                        </div>
                      )
                    : (
                        <p className="mt-0.5 text-sm text-amber-700">
                          Financial amounts unavailable — under review
                        </p>
                      )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
