'use client';

/**
 * AnalyticsWidgets Component
 *
 * Page 1 of the swipeable admin dashboard.
 * Features:
 * - iOS-style segmented time filter
 * - Revenue card with sparkline chart
 * - Utilization rings (Apple Fitness style)
 * - Service mix progress bars
 * - Staff leaderboard
 * - Quick actions widget
 * - Staggered entrance animations
 */

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Calendar, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';

import { NestedRings, RingLegend } from './charts/ActivityRing';
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
    <div className="mb-6 flex rounded-lg bg-[#767680]/10 p-0.5">
      {options.map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`
            flex-1 rounded-[6px] py-1.5 text-[13px] font-medium transition-all
            ${active === tab
          ? 'bg-white text-black shadow-sm'
          : 'bg-transparent text-gray-500 shadow-none'
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
    <div className="min-h-full w-full bg-[#F2F2F7] pb-10 font-sans text-black">
      <motion.div
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-md space-y-6 px-5 pt-6"
      >
        {/* Header & Date with Navigation */}
        <motion.div variants={SPRING_ITEM}>
          <div className="flex items-center justify-between">
            <h1 className="text-[34px] font-bold tracking-tight text-[#1C1C1E]">
              Performance
            </h1>
            {/* Navigation Controls */}
            <div className="flex items-center gap-1.5">
              {onToday && (
                <button
                  type="button"
                  onClick={onToday}
                  className="rounded-lg bg-[#007AFF]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[#007AFF] transition-colors hover:bg-[#007AFF]/20 active:bg-[#007AFF]/30"
                >
                  Today
                </button>
              )}
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  className="flex size-8 items-center justify-center rounded-lg bg-black/5 transition-colors hover:bg-black/10 active:bg-black/20"
                  aria-label="Previous period"
                >
                  <ChevronLeft className="size-5 text-[#3C3C43]" />
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!canGoNext}
                  className="flex size-8 items-center justify-center rounded-lg bg-black/5 transition-colors hover:bg-black/10 active:bg-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next period"
                >
                  <ChevronRight className="size-5 text-[#3C3C43]" />
                </button>
              )}
            </div>
          </div>
          {/* Clickable Date Range with Date Picker */}
          <div className="relative mt-2">
            <button
              type="button"
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="flex items-center gap-1.5 rounded-lg bg-[#007AFF]/5 px-3 py-1.5 text-[15px] font-medium text-[#007AFF] transition-colors hover:bg-[#007AFF]/10 active:bg-[#007AFF]/15"
            >
              <Calendar className="size-4" />
              {computedDateRange}
              <ChevronRight className={`size-4 transition-transform ${showDatePicker ? 'rotate-90' : ''}`} />
            </button>
            {/* Date Picker Dropdown */}
            <AnimatePresence>
              {showDatePicker && onAnchorChange && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full z-50 mt-2 rounded-xl bg-white p-4 shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
                >
                  <p className="mb-2 text-[13px] font-medium text-[#8E8E93]">Jump to date</p>
                  <input
                    type="date"
                    value={anchorDate || ''}
                    onChange={handleDatePickerChange}
                    max={new Date().toISOString().slice(0, 10)}
                    className="w-full rounded-lg border border-[#E5E5EA] bg-[#F2F2F7] px-3 py-2 text-[15px] text-[#1C1C1E] outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDatePicker(false)}
                    className="mt-3 w-full rounded-lg bg-[#F2F2F7] py-2 text-[13px] font-medium text-[#8E8E93] transition-colors hover:bg-[#E5E5EA]"
                  >
                    Cancel
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Today at a glance */}
        {appointments && (
          <motion.div variants={SPRING_ITEM}>
            <button
              type="button"
              onClick={() => onQuickAction?.('view-bookings')}
              className="w-full rounded-[22px] bg-white p-4 text-left shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-transform active:scale-[0.99]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                  {glanceTitle}
                </span>
                <ChevronRight className="size-4 text-[#C7C7CC]" />
              </div>
              <div className="grid grid-cols-3 divide-x divide-[#F2F2F7]">
                <div className="pr-3">
                  <div className="text-[26px] font-semibold tabular-nums tracking-tight text-[#1C1C1E]">
                    {appointments.upcoming}
                  </div>
                  <div className="text-[12px] font-medium text-[#8E8E93]">Upcoming</div>
                </div>
                <div className="px-3">
                  <div className="text-[26px] font-semibold tabular-nums tracking-tight text-[#34C759]">
                    {appointments.completed}
                  </div>
                  <div className="text-[12px] font-medium text-[#8E8E93]">Completed</div>
                </div>
                <div className="pl-3">
                  <div className={`text-[26px] font-semibold tabular-nums tracking-tight ${appointments.noShows > 0 ? 'text-[#FF3B30]' : 'text-[#1C1C1E]'}`}>
                    {appointments.noShows}
                  </div>
                  <div className="text-[12px] font-medium text-[#8E8E93]">No-shows</div>
                </div>
              </div>
            </button>
          </motion.div>
        )}

        {/* Quick Actions */}
        <motion.div variants={SPRING_ITEM}>
          <QuickActionsWidget onAction={onQuickAction} />
        </motion.div>

        {/* Revenue Card */}
        <motion.div
          variants={SPRING_ITEM}
          className="rounded-[22px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
        >
          <TimeFilter active={activePeriod} onChange={handlePeriodChange} />
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                Completed appointment revenue
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={displayRevenue}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="mt-1 text-[34px] font-semibold tracking-tight text-[#1C1C1E]"
                >
                  {formatMoney(displayRevenue, currency)}
                </motion.div>
              </AnimatePresence>
              {tips > 0 && (
                <div className="mt-1 text-[13px] font-medium text-[#8E8E93]">
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
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2 }}
                      className={`${isTrendPositive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'} flex items-center rounded-full px-2 py-1 text-[12px] font-bold`}
                    >
                      {isTrendPositive
                        ? (
                            <ArrowUpRight className="mr-1 size-3" />
                          )
                        : (
                            <ArrowDownRight className="mr-1 size-3" />
                          )}
                      {Math.abs(displayTrend)}
                      %
                    </motion.div>
                  )
                : (
                    <motion.div
                      key="trend-unavailable"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-full bg-stone-100 px-2 py-1 text-[12px] font-semibold text-stone-500"
                    >
                      No prior data
                    </motion.div>
                  )}
            </AnimatePresence>
          </div>
          <RevenueChart data={revenueSeries} />
          <ChartLabels labels={chartLabels} />
        </motion.div>

        {/* Utilization & Service Mix Grid */}
        <motion.div variants={SPRING_ITEM} className="grid grid-cols-2 gap-4">
          {/* Utilization Rings */}
          <div className="flex aspect-square flex-col items-center justify-between rounded-[22px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="w-full text-left text-[13px] font-semibold uppercase text-[#8E8E93]">
              Utilization
            </div>
            {utilization.length > 0
              ? (
                  <>
                    <NestedRings
                      rings={utilization.map(u => ({ percent: u.percent, color: u.color }))}
                      baseSize={100}
                      stroke={8}
                      gap={4}
                    />
                    <RingLegend
                      items={utilization.map(u => ({ color: u.color, label: u.name }))}
                    />
                  </>
                )
              : (
                  <div className="flex flex-1 items-center justify-center text-center">
                    <p className="text-[13px] text-[#8E8E93]">No utilization data yet</p>
                  </div>
                )}
          </div>

          {/* Service Mix */}
          <div className="flex aspect-square flex-col rounded-[22px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="mb-4 text-[13px] font-semibold uppercase text-[#8E8E93]">
              Top Services
            </div>
            <div className="flex-1">
              {services.length > 0
                ? (
                    <ServiceBars items={services} />
                  )
                : (
                    <div className="flex h-full items-center justify-center text-center">
                      <p className="text-[13px] text-[#8E8E93]">No services data available</p>
                    </div>
                  )}
            </div>
          </div>
        </motion.div>

        {/* Staff Leaderboard */}
        <motion.div
          variants={SPRING_ITEM}
          className="overflow-hidden rounded-[22px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <span className="text-[15px] font-semibold">Top Performers</span>
            <MoreHorizontal className="size-5 text-gray-400" />
          </div>
          <div className="divide-y divide-gray-100">
            {staffData.length > 0
              ? (
                  staffData.map((staff, index) => (
                    <div
                      key={staff.id}
                      className="flex cursor-pointer items-center justify-between px-5 py-3 transition-colors active:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-3 text-[13px] font-bold text-gray-400">
                          {index + 1}
                        </span>
                        <div
                          className={`flex size-10 items-center justify-center rounded-full text-[13px] font-bold ${staff.avatarColor}`}
                        >
                          {staff.name.substring(0, 2)}
                        </div>
                        <div>
                          <div className="text-[15px] font-semibold text-[#1C1C1E]">
                            {staff.name}
                          </div>
                          <div className="text-[12px] text-[#8E8E93]">{staff.role}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[15px] font-medium text-[#1C1C1E]">
                          {staff.revenue}
                        </div>
                      </div>
                    </div>
                  ))
                )
              : (
                  <div className="px-5 py-8 text-center">
                    <p className="text-[13px] text-[#8E8E93]">No staff data available</p>
                  </div>
                )}
          </div>
          <div className="border-t border-gray-100 p-3 text-center">
            <button
              type="button"
              className="text-[13px] font-semibold text-[#007AFF]"
            >
              View All Staff
            </button>
          </div>
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
