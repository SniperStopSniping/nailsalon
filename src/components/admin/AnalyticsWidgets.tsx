'use client';

/** Owner reports: the existing metrics and actions in the shared owner theme. */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';

import { ChartLabels, RevenueChart } from './charts/RevenueChart';
import { ServiceBars } from './charts/ServiceBars';
import { QuickActionsWidget } from './QuickActionsWidget';
import { SmartFitResultsCard } from './SmartFitResultsCard';

// Animation variants
const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const SPRING_ITEM = {
  hidden: { y: 20, opacity: 0, scale: 0.98 },
  visible: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 280, damping: 26 },
  },
};

// Time period type
export type TimePeriod = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

// Types
type StaffMember = {
  id: number;
  name: string;
  role: string;
  revenue: string;
  avatarColor: string;
};

type AppointmentGlance = {
  total: number;
  completed: number;
  noShows: number;
  upcoming: number;
};

export type AnalyticsWidgetsProps = {
  /** Return to the workspace that opened this report. */
  onBack?: () => void;
  /** Today's appointment counts — shown in the "Today" glance strip */
  appointments?: AppointmentGlance;
  /** Total revenue amount */
  revenue?: number;
  /** Total tips for the period (cents) */
  tips?: number;
  /** Salon-configured ISO currency code */
  currency?: string;
  /** Revenue trend percentage */
  revenueTrend?: number;
  /** Whether the previous period supports a meaningful percentage comparison */
  revenueTrendAvailable?: boolean;
  /** Revenue per bucket across the period (cents) — drives the sparkline */
  revenueSeries?: number[];
  /** Staff performance data */
  staffData?: StaffMember[];
  /** Utilization percentages for each staff member */
  utilization?: Array<{ name: string; percent: number; color: string }>;
  /** Service mix data */
  services?: Array<{ label: string; percent: number; color: string }>;
  /** Date range from API (ISO strings) - used instead of computed range */
  dateRange?: { start: string; end: string } | null;
  /** Current anchor date (YYYY-MM-DD) for computing range when API doesn't provide one */
  anchorDate?: string;
  /** Callback for quick actions */
  onQuickAction?: (actionId: string) => void;
  /** Callback when time period changes */
  onTimePeriodChange?: (period: TimePeriod) => void;
  /** Current time period */
  timePeriod?: TimePeriod;
  /** Navigation callbacks */
  onPrev?: () => void;
  onNext?: () => void;
  onToday?: () => void;
  /** Callback when anchor date changes (from date picker) */
  onAnchorChange?: (date: string) => void;
  /** When set, render the Smart Fit results card scoped to this salon */
  salonSlug?: string | null;
  /** Open the Settings app from the Smart Fit results card */
  onOpenSmartFitSettings?: () => void;
};

/**
 * Compute date range from anchor date and period (when API doesn't provide one)
 */
function computeDateRangeFromAnchor(anchorYmd: string, period: TimePeriod): { start: Date; end: Date } {
  const anchor = new Date(`${anchorYmd}T12:00:00`);

  switch (period) {
    case 'Daily':
      return { start: anchor, end: anchor };
    case 'Weekly': {
      const dayOfWeek = anchor.getDay();
      const start = new Date(anchor);
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      start.setDate(anchor.getDate() - daysSinceMonday);
      const end = new Date(start);
      end.setDate(start.getDate() + 6); // End of week (inclusive)
      return { start, end };
    }
    case 'Monthly': {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12, 0, 0); // Last day of month
      return { start, end };
    }
    case 'Yearly': {
      const start = new Date(anchor.getFullYear(), 0, 1, 12, 0, 0);
      const end = new Date(anchor.getFullYear(), 11, 31, 12, 0, 0);
      return { start, end };
    }
    default:
      return { start: anchor, end: anchor };
  }
}

/**
 * Format date range into a human-readable label
 */
function formatDateRangeLabel(start: Date, end: Date, period: TimePeriod): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  switch (period) {
    case 'Daily':
      return start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    case 'Weekly':
      return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}, ${start.getFullYear()}`;
    case 'Monthly':
      return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'Yearly':
      return `${start.getFullYear()}`;
    default:
      return '';
  }
}

/**
 * Format API date range (ISO strings) or compute from anchor
 */
function formatApiDateRange(
  dateRange: { start: string; end: string } | null | undefined,
  period: TimePeriod,
  anchorDate?: string,
): string {
  // If API provided a date range, use it
  if (dateRange?.start && dateRange?.end) {
    const startStr = dateRange.start.slice(0, 10);
    const endStr = dateRange.end.slice(0, 10);
    const start = new Date(`${startStr}T12:00:00`);
    const end = new Date(`${endStr}T12:00:00`);
    // API returns exclusive end, so subtract 1 day for display
    end.setDate(end.getDate() - 1);
    return formatDateRangeLabel(start, end, period);
  }

  // Otherwise compute from anchor date
  if (anchorDate) {
    const { start, end } = computeDateRangeFromAnchor(anchorDate, period);
    return formatDateRangeLabel(start, end, period);
  }

  // Last resort: use today
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { start, end } = computeDateRangeFromAnchor(todayYmd, period);
  return formatDateRangeLabel(start, end, period);
}

// Get chart labels based on time period
function getChartLabels(period: TimePeriod): string[] {
  switch (period) {
    case 'Daily':
      return ['9AM', '11AM', '1PM', '3PM', '5PM', '7PM', '9PM'];
    case 'Weekly':
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    case 'Monthly':
      return ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    case 'Yearly':
      return ['Jan', 'Mar', 'May', 'Jul', 'Sep', 'Nov'];
    default:
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  }
}

/**
 * iOS-style Segmented Control for time filtering
 */
function TimeFilter({
  active,
  onChange,
}: {
  active: TimePeriod;
  onChange: (period: TimePeriod) => void;
}) {
  const options: TimePeriod[] = ['Daily', 'Weekly', 'Monthly', 'Yearly'];

  return (
    <div role="group" aria-label="Report period" className="mb-5 grid grid-cols-4 gap-1 rounded-2xl bg-[var(--owner-blush)] p-1">
      {options.map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          aria-pressed={active === tab}
          className={`
            min-h-11 min-w-0 rounded-xl px-1 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]
            ${active === tab
          ? 'bg-[var(--owner-accent)] text-white shadow-sm'
          : 'text-[var(--owner-ink)] hover:bg-[var(--owner-surface)]'
        }
          `}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

// Stable empty array defaults (avoid recreating on every render)
const EMPTY_STAFF: StaffMember[] = [];
const EMPTY_UTILIZATION: Array<{ name: string; percent: number; color: string }> = [];
const EMPTY_SERVICES: Array<{ label: string; percent: number; color: string }> = [];
const EMPTY_SERIES: number[] = [];

export function AnalyticsWidgets({
  onBack,
  appointments,
  revenue = 0,
  tips = 0,
  currency = 'CAD',
  revenueTrend = 0,
  revenueTrendAvailable = true,
  revenueSeries = EMPTY_SERIES,
  staffData = EMPTY_STAFF,
  utilization = EMPTY_UTILIZATION,
  services = EMPTY_SERVICES,
  dateRange,
  anchorDate,
  onQuickAction,
  onTimePeriodChange,
  timePeriod: externalTimePeriod,
  onPrev,
  onNext,
  onToday,
  onAnchorChange,
  salonSlug = null,
  onOpenSmartFitSettings,
}: AnalyticsWidgetsProps) {
  // Use internal state if no external control
  const [internalPeriod, setInternalPeriod] = useState<TimePeriod>('Weekly');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerId = useId();
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const activePeriod = externalTimePeriod ?? internalPeriod;

  // Animated values for revenue display
  const [displayRevenue, setDisplayRevenue] = useState(revenue);
  const [displayTrend, setDisplayTrend] = useState(revenueTrend);
  const [displayTrendAvailable, setDisplayTrendAvailable]
    = useState(revenueTrendAvailable);

  // Animate revenue changes
  useEffect(() => {
    setDisplayRevenue(revenue);
    setDisplayTrend(revenueTrend);
    setDisplayTrendAvailable(revenueTrendAvailable);
  }, [revenue, revenueTrend, revenueTrendAvailable]);

  const handlePeriodChange = (period: TimePeriod) => {
    if (onTimePeriodChange) {
      onTimePeriodChange(period);
    } else {
      setInternalPeriod(period);
    }
  };

  // Use API-provided dateRange or compute from anchor
  const computedDateRange = formatApiDateRange(dateRange, activePeriod, anchorDate);
  const chartLabels = getChartLabels(activePeriod);
  const isTrendPositive = displayTrend >= 0;

  // Determine if we can navigate forward (don't go past today)
  const canGoNext = (() => {
    if (!anchorDate) {
      return false;
    }
    const anchorD = new Date(`${anchorDate}T12:00:00`);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return anchorD < today;
  })();

  // Handle date picker change
  const handleDatePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    if (newDate && onAnchorChange) {
      onAnchorChange(newDate);
    }
    setShowDatePicker(false);
    dateButtonRef.current?.focus();
  };

  // Appointment glance title follows the selected period so it never mislabels
  const glanceTitle = (() => {
    switch (activePeriod) {
      case 'Daily':
        return canGoNext ? 'Appointments that day' : 'Today’s appointments';
      case 'Weekly':
        return 'Appointments this week';
      case 'Monthly':
        return 'Appointments this month';
      case 'Yearly':
        return 'Appointments this year';
      default:
        return 'Appointments';
    }
  })();

  return (
    <div className="owner-theme-scope min-h-full w-full bg-[var(--owner-ground)] pb-10 text-[var(--owner-ink)]">
      <header className="sticky top-0 z-10 border-b border-[var(--owner-line)] bg-[var(--owner-surface)] px-5 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className="owner-action shrink-0 gap-1 px-3">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back
            </button>
          )}
          <h1 className="owner-title text-3xl">Reports</h1>
        </div>
      </header>
      <motion.div
        variants={STAGGER_CONTAINER}
        initial={false}
        animate="visible"
        className="mx-auto max-w-2xl space-y-5 px-4 pt-5 sm:px-5"
      >
        {/* Header & Date with Navigation */}
        <motion.div variants={SPRING_ITEM}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--owner-muted)]">Your salon at a glance</h2>
            <div className="flex items-center gap-2">
              {onToday && <button type="button" onClick={onToday} className="owner-action px-4">Today</button>}
              {onPrev && (
                <button type="button" onClick={onPrev} className="owner-action size-11 p-0" aria-label="Previous period">
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </button>
              )}
              {onNext && (
                <button type="button" onClick={onNext} disabled={!canGoNext} className="owner-action size-11 p-0 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Next period">
                  <ChevronRight aria-hidden="true" className="size-5" />
                </button>
              )}
            </div>
          </div>
          {/* Clickable Date Range with Date Picker */}
          <div className="relative mt-2">
            <button
              type="button"
              onClick={() => setShowDatePicker(!showDatePicker)}
              ref={dateButtonRef}
              disabled={!onAnchorChange}
              aria-expanded={showDatePicker}
              aria-controls={showDatePicker ? datePickerId : undefined}
              className="owner-action w-full justify-between gap-2 px-4 text-left text-sm"
            >
              <Calendar aria-hidden="true" className="size-4 shrink-0" />
              {computedDateRange}
              <ChevronRight aria-hidden="true" className={`size-4 shrink-0 transition-transform ${showDatePicker ? 'rotate-90' : ''}`} />
            </button>
            {/* Date Picker Dropdown */}
            <AnimatePresence>
              {showDatePicker && onAnchorChange && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.15 }}
                  id={datePickerId}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      setShowDatePicker(false);
                      dateButtonRef.current?.focus();
                    }
                  }}
                  className="owner-card mt-3 p-4"
                >
                  <label htmlFor={`${datePickerId}-input`} className="mb-2 block text-sm font-semibold text-[var(--owner-ink)]">Jump to date</label>
                  <input
                    type="date"
                    id={`${datePickerId}-input`}
                    value={anchorDate || ''}
                    onChange={handleDatePickerChange}
                    max={new Date().toISOString().slice(0, 10)}
                    className="owner-form-field"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowDatePicker(false);
                      dateButtonRef.current?.focus();
                    }}
                    className="owner-action mt-3 w-full"
                  >
                    Cancel
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <TimeFilter active={activePeriod} onChange={handlePeriodChange} />

        {/* Today at a glance */}
        {appointments && (
          <motion.div variants={SPRING_ITEM}>
            <button
              type="button"
              onClick={() => onQuickAction?.('view-bookings')}
              className="owner-card w-full p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                  {glanceTitle}
                </span>
                <ChevronRight className="size-4 text-[var(--owner-accent)]" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="min-w-0">
                  <div className="text-[26px] font-semibold tabular-nums tracking-tight text-[var(--owner-ink)]">
                    {appointments.upcoming}
                  </div>
                  <div className="text-sm font-medium text-[var(--owner-muted)]">Upcoming</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[26px] font-semibold tabular-nums tracking-tight text-[#246547]">
                    {appointments.completed}
                  </div>
                  <div className="text-sm font-medium text-[var(--owner-muted)]">Completed</div>
                </div>
                <div className="min-w-0">
                  <div className={`text-[26px] font-semibold tabular-nums tracking-tight ${appointments.noShows > 0 ? 'text-[#a02040]' : 'text-[var(--owner-ink)]'}`}>
                    {appointments.noShows}
                  </div>
                  <div className="text-sm font-medium text-[var(--owner-muted)]">No-shows</div>
                </div>
              </div>
            </button>
          </motion.div>
        )}

        {/* Revenue Card */}
        <motion.div
          variants={SPRING_ITEM}
          className="owner-card min-w-0 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
                Completed appointment revenue
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={displayRevenue}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                  className="owner-title mt-2 break-words text-4xl tabular-nums"
                >
                  {formatMoney(displayRevenue, currency)}
                </motion.div>
              </AnimatePresence>
              {tips > 0 && (
                <div className="mt-1 text-sm font-medium text-[var(--owner-muted)]">
                  {formatMoney(tips, currency)}
                  {' '}
                  in tips
                </div>
              )}
            </div>
            <AnimatePresence mode="wait">
              {displayTrendAvailable
                ? (
                    <motion.div
                      key={`${displayTrend}-${isTrendPositive}`}
                      initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2 }}
                      className={`${isTrendPositive ? 'bg-[#e8f3ed] text-[#246547]' : 'bg-[#fbe9ed] text-[#a02040]'} flex items-center rounded-full px-2 py-1 text-sm font-bold`}
                    >
                      {isTrendPositive
                        ? (
                            <ArrowUpRight aria-hidden="true" className="mr-1 size-3" />
                          )
                        : (
                            <ArrowDownRight aria-hidden="true" className="mr-1 size-3" />
                          )}
                      <span className="sr-only">{isTrendPositive ? 'Increase of ' : 'Decrease of '}</span>
                      {Math.abs(displayTrend)}
                      %
                    </motion.div>
                  )
                : (
                    <motion.div
                      key="trend-unavailable"
                      initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2 }}
                      className="rounded-full bg-[var(--owner-blush)] px-2 py-1 text-sm font-semibold text-[var(--owner-muted)]"
                    >
                      No prior data
                    </motion.div>
                  )}
            </AnimatePresence>
          </div>
          <RevenueChart data={revenueSeries} strokeColor="var(--owner-accent)" gradientStart="var(--owner-accent)" gradientEnd="var(--owner-surface)" />
          <ChartLabels labels={chartLabels} />
        </motion.div>

        <motion.div variants={SPRING_ITEM} className="grid gap-5 sm:grid-cols-2">
          <section className="owner-card min-w-0 p-5" aria-label="Utilization">
            <h2 className="owner-title mb-4 text-2xl">Utilization</h2>
            {utilization.length > 0
              ? <ServiceBars items={utilization.map(u => ({ label: u.name, percent: u.percent, color: u.color }))} />
              : <p className="text-sm text-[var(--owner-muted)]">No utilization data yet</p>}
          </section>
          <section className="owner-card min-w-0 p-5" aria-label="Top services">
            <h2 className="owner-title mb-4 text-2xl">Top services</h2>
            {services.length > 0
              ? <ServiceBars items={services} />
              : <p className="text-sm text-[var(--owner-muted)]">No services data available</p>}
          </section>
        </motion.div>

        {/* Staff Leaderboard */}
        <motion.div
          variants={SPRING_ITEM}
          className="owner-card overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-[var(--owner-line)] px-5 py-4">
            <h2 className="owner-title text-2xl">Top performers</h2>
          </div>
          <div className="divide-y divide-[var(--owner-line)]">
            {staffData.length > 0
              ? (
                  staffData.map((staff, index) => (
                    <div
                      key={staff.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="w-3 shrink-0 text-sm font-bold text-[var(--owner-muted)]">
                          {index + 1}
                        </span>
                        <div
                          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--owner-blush)] text-sm font-semibold text-[var(--owner-accent)]"
                        >
                          {staff.name.substring(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="break-words text-base font-semibold text-[var(--owner-ink)]">
                            {staff.name}
                          </div>
                          <div className="text-sm text-[var(--owner-muted)]">{staff.role}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-semibold tabular-nums text-[var(--owner-ink)]">
                          {staff.revenue}
                        </div>
                      </div>
                    </div>
                  ))
                )
              : (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm text-[var(--owner-muted)]">No staff data available</p>
                  </div>
                )}
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div variants={SPRING_ITEM}>
          <QuickActionsWidget onAction={onQuickAction} />
        </motion.div>

        {/* Smart Fit results (P7.5) — follows the same period/anchor range */}
        {salonSlug && (
          <motion.div variants={SPRING_ITEM}>
            <SmartFitResultsCard
              salonSlug={salonSlug}
              period={activePeriod}
              anchorDate={anchorDate}
              onOpenSettings={onOpenSmartFitSettings}
            />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
