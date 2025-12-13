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
import { ArrowDownRight, ArrowUpRight, Calendar, MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { NestedRings, RingLegend } from './charts/ActivityRing';
import { ChartLabels, RevenueChart } from './charts/RevenueChart';
import { ServiceBars } from './charts/ServiceBars';
import { QuickActionsWidget } from './QuickActionsWidget';

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

type AnalyticsWidgetsProps = {
  /** Total revenue amount */
  revenue?: number;
  /** Revenue trend percentage */
  revenueTrend?: number;
  /** Staff performance data */
  staffData?: StaffMember[];
  /** Utilization percentages for each staff member */
  utilization?: Array<{ name: string; percent: number; color: string }>;
  /** Service mix data */
  services?: Array<{ label: string; percent: number; color: string }>;
  /** Date range label */
  dateRange?: string;
  /** Callback for quick actions */
  onQuickAction?: (actionId: string) => void;
  /** Callback when time period changes */
  onTimePeriodChange?: (period: TimePeriod) => void;
  /** Current time period */
  timePeriod?: TimePeriod;
};

// Default data
const DEFAULT_STAFF: StaffMember[] = [
  { id: 1, name: 'Sarah J.', role: 'Senior Stylist', revenue: '$2,400', avatarColor: 'bg-blue-100 text-blue-600' },
  { id: 2, name: 'Michael B.', role: 'Colorist', revenue: '$1,850', avatarColor: 'bg-purple-100 text-purple-600' },
  { id: 3, name: 'Emily R.', role: 'Nail Tech', revenue: '$1,200', avatarColor: 'bg-pink-100 text-pink-600' },
];

const DEFAULT_UTILIZATION = [
  { name: 'Sar', percent: 92, color: '#fa709a' },
  { name: 'Mik', percent: 65, color: '#43e97b' },
  { name: 'Em', percent: 45, color: '#66a6ff' },
];

const DEFAULT_SERVICES = [
  { label: 'BIAB Gel', percent: 45, color: '#F97316' },
  { label: 'Pedicure', percent: 30, color: '#3B82F6' },
  { label: 'Removal', percent: 15, color: '#9CA3AF' },
];

// Get date range label based on time period
function getDateRangeLabel(period: TimePeriod): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  switch (period) {
    case 'Daily':
      return now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    case 'Weekly': {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return `${startOfWeek.toLocaleDateString('en-US', options)} - ${endOfWeek.toLocaleDateString('en-US', options)}, ${now.getFullYear()}`;
    }
    case 'Monthly':
      return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'Yearly':
      return `${now.getFullYear()}`;
    default:
      return '';
  }
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

/**
 * Format currency from cents
 */
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export function AnalyticsWidgets({
  revenue = 1248000,
  revenueTrend = 12,
  staffData = DEFAULT_STAFF,
  utilization = DEFAULT_UTILIZATION,
  services = DEFAULT_SERVICES,
  dateRange,
  onQuickAction,
  onTimePeriodChange,
  timePeriod: externalTimePeriod,
}: AnalyticsWidgetsProps) {
  // Use internal state if no external control
  const [internalPeriod, setInternalPeriod] = useState<TimePeriod>('Weekly');
  const activePeriod = externalTimePeriod ?? internalPeriod;

  // Animated values for revenue display
  const [displayRevenue, setDisplayRevenue] = useState(revenue);
  const [displayTrend, setDisplayTrend] = useState(revenueTrend);

  // Animate revenue changes
  useEffect(() => {
    setDisplayRevenue(revenue);
    setDisplayTrend(revenueTrend);
  }, [revenue, revenueTrend]);

  const handlePeriodChange = (period: TimePeriod) => {
    if (onTimePeriodChange) {
      onTimePeriodChange(period);
    } else {
      setInternalPeriod(period);
    }
  };

  const computedDateRange = dateRange || getDateRangeLabel(activePeriod);
  const chartLabels = getChartLabels(activePeriod);
  const isTrendPositive = displayTrend >= 0;

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] pb-10 font-sans text-black">
      <motion.div
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-md space-y-6 px-5 pt-6"
      >
        {/* Header & Date */}
        <motion.div variants={SPRING_ITEM}>
          <h1 className="text-[34px] font-bold tracking-tight text-[#1C1C1E]">
            Performance
          </h1>
          <div className="mt-1 flex items-center gap-1 text-[15px] font-medium text-[#8E8E93]">
            <Calendar className="size-4" />
            {computedDateRange}
          </div>
        </motion.div>

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
                Total Revenue
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
                  {formatCurrency(displayRevenue)}
                </motion.div>
              </AnimatePresence>
            </div>
            <AnimatePresence mode="wait">
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
            </AnimatePresence>
          </div>
          <RevenueChart />
          <ChartLabels labels={chartLabels} />
        </motion.div>

        {/* Utilization & Service Mix Grid */}
        <motion.div variants={SPRING_ITEM} className="grid grid-cols-2 gap-4">
          {/* Utilization Rings */}
          <div className="flex aspect-square flex-col items-center justify-between rounded-[22px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="w-full text-left text-[13px] font-semibold uppercase text-[#8E8E93]">
              Utilization
            </div>
            <NestedRings
              rings={utilization.map(u => ({ percent: u.percent, color: u.color }))}
              baseSize={100}
              stroke={8}
              gap={4}
            />
            <RingLegend
              items={utilization.map(u => ({ color: u.color, label: u.name }))}
            />
          </div>

          {/* Service Mix */}
          <div className="flex aspect-square flex-col rounded-[22px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="mb-4 text-[13px] font-semibold uppercase text-[#8E8E93]">
              Top Services
            </div>
            <div className="flex-1">
              <ServiceBars items={services} />
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
            {staffData.map((staff, index) => (
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
            ))}
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
      </motion.div>
    </div>
  );
}
