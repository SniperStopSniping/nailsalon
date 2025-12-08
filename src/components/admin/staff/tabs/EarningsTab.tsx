'use client';

import { useState, useEffect, useCallback } from 'react';
import { DollarSign, TrendingUp, Building2 } from 'lucide-react';

import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

interface EarningsSummary {
  appointmentCount: number;
  totalRevenue: number;
  techEarned: number;
  salonEarned: number;
}

interface EarningsSeries {
  date: string | null;
  appointments: number;
  totalRevenue: number;
  techEarned: number;
  salonEarned: number;
}

interface EarningsTabProps {
  technicianId: string;
  commissionRate: number;
}

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
    if (!salonSlug) return;

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
        `/api/admin/technicians/${technicianId}/earnings?${params}`
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
  const maxRevenue = Math.max(...series.map((s) => s.totalRevenue), 1);

  return (
    <div className="p-4 space-y-4">
      {/* Date Range Selector */}
      <div className="flex gap-2">
        {(['today', 'week', 'month'] as DateRange[]).map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => setDateRange(range)}
            className={`
              flex-1 py-2 rounded-lg text-[13px] font-medium
              transition-colors capitalize
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
              icon={<DollarSign className="w-5 h-5" />}
              label="They Earned"
              value={formatCurrency(summary?.techEarned ?? 0)}
              sublabel={`${Math.round(commissionRate * 100)}% commission`}
              color="#34C759"
            />
            <EarningsCard
              icon={<Building2 className="w-5 h-5" />}
              label="They Made Us"
              value={formatCurrency(summary?.salonEarned ?? 0)}
              sublabel={`${Math.round((1 - commissionRate) * 100)}% salon`}
              color="#007AFF"
            />
          </div>

          {/* Total Revenue */}
          <div className="bg-white rounded-[12px] p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[#FF950015] flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-[#FF9500]" />
              </div>
              <span className="text-[13px] text-[#8E8E93]">Total Revenue</span>
            </div>
            <div className="text-[28px] font-bold text-[#1C1C1E]">
              {formatCurrency(summary?.totalRevenue ?? 0)}
            </div>
            <div className="text-[13px] text-[#8E8E93]">
              from {summary?.appointmentCount ?? 0} appointment{(summary?.appointmentCount ?? 0) !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Chart */}
          {series.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
                Revenue Trend
              </h3>
              <div className="bg-white rounded-[12px] p-4">
                <div className="flex items-end gap-1 h-32">
                  {series.slice(-14).map((item, index) => {
                    const height = (item.totalRevenue / maxRevenue) * 100;
                    const date = item.date ? new Date(item.date) : null;
                    const dayLabel = date
                      ? date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
                      : '';

                    return (
                      <div
                        key={index}
                        className="flex-1 flex flex-col items-center"
                      >
                        <div
                          className="w-full bg-[#007AFF] rounded-t-sm min-h-[4px]"
                          style={{ height: `${Math.max(height, 4)}%` }}
                        />
                        <span className="text-[9px] text-[#8E8E93] mt-1">
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
    <div className="bg-white rounded-[12px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        <span className="text-[13px] text-[#8E8E93]">{label}</span>
      </div>
      <div className="text-[24px] font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-[#8E8E93] mt-0.5">{sublabel}</div>
    </div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-[12px] p-4 h-28" />
        <div className="bg-white rounded-[12px] p-4 h-28" />
      </div>
      <div className="bg-white rounded-[12px] p-4 h-32" />
    </div>
  );
}
