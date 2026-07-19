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
      className="overflow-hidden rounded-[22px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <h2
          id="smart-fit-results-heading"
          className="text-[15px] font-semibold text-[#1C1C1E]"
        >
          Smart Fit results
        </h2>
        {state.status === 'ready' && (
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                state.data.config.enabled
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {state.data.config.enabled ? 'Smart Fit is on' : 'Smart Fit is off'}
            </span>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex items-center gap-1 rounded-lg bg-[#007AFF]/10 px-2 py-1 text-[12px] font-semibold text-[#007AFF] transition-colors hover:bg-[#007AFF]/20"
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
                Settings
              </button>
            )}
          </div>
        )}
      </div>

      <div ref={bodyRef} tabIndex={-1} className="px-5 py-4 outline-none">
        {state.status === 'loading' && (
          <div role="status" className="flex items-center justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-rose-800 border-t-transparent motion-reduce:animate-none" />
            <span className="sr-only">Loading Smart Fit results…</span>
          </div>
        )}

        {state.status === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3"
          >
            <p className="text-[13px] font-medium text-red-700">
              Could not load Smart Fit results.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-2 rounded-lg bg-red-100 px-3 py-1.5 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-200"
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
    <div className="rounded-xl bg-[#F2F2F7] p-3">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
        {label}
      </div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight text-[#1C1C1E]">
        {value}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#8E8E93]">{helper}</p>
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
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
        {title}
      </h3>
      {rows.length === 0
        ? (
            <p className="mt-2 text-[13px] text-[#8E8E93]">{emptyCopy}</p>
          )
        : (
            <ul className="mt-2 divide-y divide-gray-100">
              {rows.map((row, index) => (
                // Index keys: rows are replaced whole per fetch, and display
                // names may legitimately collide (e.g. two staff named Amy).
                // eslint-disable-next-line react/no-array-index-key
                <li key={index} className="py-2">
                  <div className="break-words text-[14px] font-medium text-[#1C1C1E]">
                    {row.name}
                  </div>
                  <div className="mt-0.5 text-[12px] tabular-nums text-[#8E8E93]">
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
  // Monthly has up to 31 buckets — thin the visible labels so they stay legible.
  const labelStride = period === 'monthly' ? 5 : 1;

  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
        Smart Fit appointments over time
      </h3>
      <ul
        className="mt-2 flex h-24 items-end gap-px"
        aria-label="Smart Fit appointments per period"
      >
        {series.map((bucket, index) => (
          <li key={bucket.key} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="sr-only">
              {`${bucket.label}: ${bucket.appointments} Smart Fit ${bucket.appointments === 1 ? 'appointment' : 'appointments'}, ${formatMoney(bucket.discountCents, currency)} discount, ${formatMoney(bucket.revenueCents, currency)} booked revenue`}
            </span>
            <div
              aria-hidden="true"
              className={`w-full rounded-t-sm ${bucket.appointments > 0 ? 'bg-rose-800' : 'bg-[#E5E5EA]'}`}
              style={{ height: bucket.appointments > 0 ? `${Math.max(8, (bucket.appointments / max) * 100)}%` : '3px' }}
            />
            <div aria-hidden="true" className="mt-1 h-4 overflow-hidden text-center text-[10px] leading-4 text-[#8E8E93]">
              {index % labelStride === 0 ? bucket.label : ''}
            </div>
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
    <p className="text-[12px] text-[#8E8E93]">
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
        <p className="rounded-lg bg-[#F2F2F7] p-3 text-[13px] text-[#3C3C43]">
          Smart Fit is currently off, so no new offers are shown. The results
          below are historical and are not changed by turning Smart Fit on or
          off.
        </p>
      )}

      {!hasResults && (
        <>
          <p className="text-[13px] text-[#8E8E93]">{EMPTY_COPY}</p>
          <ExcludedNote metrics={metrics} />
        </>
      )}

      {hasResults && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricTile
              label="Smart Fit appointments"
              value={String(metrics.appointments)}
              helper="Appointments booked with a Smart Fit discount saved at booking time. Cancelled and no-show bookings are not counted."
            />
            <MetricTile
              label="Discount given"
              value={formatMoney(metrics.discountGivenCents, currency)}
              helper="Sum of the Smart Fit discounts saved on those appointments."
            />
            <MetricTile
              label="Booked revenue"
              value={formatMoney(metrics.bookedRevenueCents, currency)}
              helper="Totals of those appointments: the checkout amount once completed, otherwise the booked total. Not a claim that Smart Fit caused the booking."
            />
            <MetricTile
              label="Average discount"
              value={formatMoney(metrics.averageDiscountCents, currency)}
              helper="Discount given divided by Smart Fit appointments."
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
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
              Recent Smart Fit appointments
            </h3>
            <ul className="mt-2 divide-y divide-gray-100">
              {data.recent.map((appointment, index) => (
                // Index keys: the bounded list is replaced whole on each fetch,
                // and rows carry no ids by design (none exposed by the API).
                // eslint-disable-next-line react/no-array-index-key
                <li key={index} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[14px] font-medium text-[#1C1C1E]">
                      {formatRecentTime(appointment.startTime, data.timezone)}
                    </span>
                    <span className="text-[12px] text-[#8E8E93]">
                      {STATUS_LABELS[appointment.status] ?? appointment.status}
                    </span>
                  </div>
                  <div className="mt-0.5 break-words text-[13px] text-[#3C3C43]">
                    {appointment.clientName ?? 'Client'}
                    {' · '}
                    {appointment.serviceName}
                    {' · '}
                    {appointment.technicianName}
                  </div>
                  {/* Labeled amounts, not an equation: the final total is the
                      finalized checkout amount when one exists, so it need not
                      equal booked-subtotal minus the Smart Fit discount. */}
                  <div className="mt-0.5 text-[12px] tabular-nums text-[#8E8E93]">
                    {'Booked '}
                    {formatMoney(appointment.subtotalCents, currency)}
                    {' · Smart Fit −'}
                    {formatMoney(appointment.discountCents, currency)}
                    {' · Final '}
                    {formatMoney(appointment.finalCents, currency)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
