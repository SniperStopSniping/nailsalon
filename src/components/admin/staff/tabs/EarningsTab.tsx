'use client';

import { Building2, DollarSign, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

type EarningsSummary = {
  appointmentCount: number;
  totalRevenue: number;
  techEarned: number;
  salonEarned: number;
};

type EarningsSeries = {
  date: string | null;
  appointments: number;
  totalRevenue: number;
  techEarned: number;
  salonEarned: number;
};

type EarningsTabProps = {
  technicianId: string;
  commissionRate: number;
};

type DateRange = 'today' | 'week' | 'month' | 'custom';

// =============================================================================
// Helpers
// =============================================================================

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function getDateRange(range: DateRange): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().split('T')[0]!;

  let from: string;
  switch (range) {
    case 'today':
      from = to;
      break;
    case 'week': {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      from = weekAgo.toISOString().split('T')[0]!;
      break;
    }
    case 'month':
    default: {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      from = monthAgo.toISOString().split('T')[0]!;
      break;
    }
  }

  return { from, to };
}

// =============================================================================
// Component
// =============================================================================

export function EarningsTab({ technicianId, commissionRate }: EarningsTabProps) {
  const { salonSlug } = useSalon();
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [series, setSeries] = useState<EarningsSeries[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEarnings = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setLoading(true);
      const { from, to } = getDateRange(dateRange);
      const params = new URLSearchParams({
        salonSlug,
        from,
        to,
        groupBy: dateRange === 'today' ? 'day' : 'day',
      });

      const response = await fetch(
        `/api/admin/technicians/${technicianId}/earnings?${params}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch earnings');
      }

      const result = await response.json();
      setSummary(result.data?.summary ?? null);
      setSeries(result.data?.series ?? []);
    } catch (err) {
      console.error('Error fetching earnings:', err);
    } finally {
      setLoading(false);
    }
  }, [salonSlug, technicianId, dateRange]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  // Find max revenue for chart scaling
  const maxRevenue = Math.max(...series.map(s => s.totalRevenue), 1);

  return (
    <div className="space-y-4 p-4">
      {/* Date Range Selector */}
      <div className="flex gap-2">
        {(['today', 'week', 'month'] as DateRange[]).map(range => (
          <button
            key={range}
            type="button"
            onClick={() => setDateRange(range)}
            className={`
              flex-1 rounded-lg py-2 text-[13px] font-medium
              capitalize transition-colors
              ${
          dateRange === range
            ? 'bg-[#007AFF] text-white'
            : 'bg-[#E5E5EA] text-[#1C1C1E]'
          }
            `}
          >
            {range === 'today' ? 'Today' : range === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            <EarningsCard
              icon={<DollarSign className="size-5" />}
              label="They Earned"
              value={formatCurrency(summary?.techEarned ?? 0)}
              sublabel={`${Math.round(commissionRate * 100)}% commission`}
              color="#34C759"
            />
            <EarningsCard
              icon={<Building2 className="size-5" />}
              label="They Made Us"
              value={formatCurrency(summary?.salonEarned ?? 0)}
              sublabel={`${Math.round((1 - commissionRate) * 100)}% salon`}
              color="#007AFF"
            />
          </div>

          {/* Total Revenue */}
          <div className="rounded-[12px] bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#FF950015]">
                <TrendingUp className="size-5 text-[#FF9500]" />
              </div>
              <span className="text-[13px] text-[#8E8E93]">Total Revenue</span>
            </div>
            <div className="text-[28px] font-bold text-[#1C1C1E]">
              {formatCurrency(summary?.totalRevenue ?? 0)}
            </div>
            <div className="text-[13px] text-[#8E8E93]">
              from
              {' '}
              {summary?.appointmentCount ?? 0}
              {' '}
              appointment
              {(summary?.appointmentCount ?? 0) !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Chart */}
          {series.length > 0 && (
            <div>
              <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
                Revenue Trend
              </h3>
              <div className="rounded-[12px] bg-white p-4">
                <div className="flex h-32 items-end gap-1">
                  {series.slice(-14).map((item, index) => {
                    const height = (item.totalRevenue / maxRevenue) * 100;
                    const date = item.date ? new Date(item.date) : null;
                    const dayLabel = date
                      ? date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
                      : '';

                    return (
                      <div
                        key={index}
                        className="flex flex-1 flex-col items-center"
                      >
                        <div
                          className="min-h-[4px] w-full rounded-t-sm bg-[#007AFF]"
                          style={{ height: `${Math.max(height, 4)}%` }}
                        />
                        <span className="mt-1 text-[9px] text-[#8E8E93]">
                          {dayLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Earnings Card
// =============================================================================

function EarningsCard({
  icon,
  label,
  value,
  sublabel,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  color: string;
}) {
  return (
    <div className="rounded-[12px] bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <div
          className="flex size-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        <span className="text-[13px] text-[#8E8E93]">{label}</span>
      </div>
      <div className="text-[24px] font-bold" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[#8E8E93]">{sublabel}</div>
    </div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="h-28 rounded-[12px] bg-white p-4" />
        <div className="h-28 rounded-[12px] bg-white p-4" />
      </div>
      <div className="h-32 rounded-[12px] bg-white p-4" />
    </div>
  );
}
