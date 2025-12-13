'use client';

import { Calendar, DollarSign, RefreshCw, TrendingUp, UserCheck, Users, XCircle } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

type TechnicianDetail = {
  id: string;
  name: string;
  bio: string | null;
  languages: string[] | null;
  specialties: string[] | null;
};

type PerformanceMetrics = {
  rebookingRate: number; // 0-1 decimal
  avgTicket: number; // in cents
  noShowRate: number; // 0-1 decimal
  cancelRate: number; // 0-1 decimal
};

type TechnicianStats = {
  today: {
    appointments: number;
    completed: number;
    revenue: number;
    techEarned: number;
    salonEarned: number;
  };
  thisWeek: {
    appointments: number;
    revenue: number;
    techEarned: number;
    salonEarned: number;
  };
  thisMonth: {
    appointments: number;
    revenue: number;
    techEarned: number;
    salonEarned: number;
  };
  totalClients: number;
  performance?: PerformanceMetrics;
};

type OverviewTabProps = {
  technician: TechnicianDetail;
  stats: TechnicianStats | null;
  onRefresh: () => void;
};

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

function formatPercent(rate: number | undefined | null): string {
  if (rate === undefined || rate === null) {
    return '—';
  }
  return `${Math.round(rate * 100)}%`;
}

// =============================================================================
// Component
// =============================================================================

export function OverviewTab({ technician, stats, onRefresh: _onRefresh }: OverviewTabProps) {
  return (
    <div className="space-y-4 p-4">
      {/* Today's Stats */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Today
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<DollarSign className="size-5" />}
            label="Revenue"
            value={formatCurrency(stats?.today.revenue ?? 0)}
            color="#34C759"
          />
          <StatCard
            icon={<Calendar className="size-5" />}
            label="Appointments"
            value={String(stats?.today.appointments ?? 0)}
            sublabel={`${stats?.today.completed ?? 0} completed`}
            color="#007AFF"
          />
        </div>
      </div>

      {/* This Month Stats */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          This Month
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<TrendingUp className="size-5" />}
            label="Total Revenue"
            value={formatCurrency(stats?.thisMonth.revenue ?? 0)}
            color="#FF9500"
          />
          <StatCard
            icon={<Users className="size-5" />}
            label="Total Clients"
            value={String(stats?.totalClients ?? 0)}
            color="#AF52DE"
          />
        </div>
      </div>

      {/* Performance Metrics */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Performance
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<RefreshCw className="size-5" />}
            label="Rebooking Rate"
            value={formatPercent(stats?.performance?.rebookingRate)}
            sublabel="clients who return"
            color="#34C759"
          />
          <StatCard
            icon={<DollarSign className="size-5" />}
            label="Avg Ticket"
            value={formatCurrency(stats?.performance?.avgTicket ?? 0)}
            sublabel="per appointment"
            color="#007AFF"
          />
          <StatCard
            icon={<UserCheck className="size-5" />}
            label="No-Show Rate"
            value={formatPercent(stats?.performance?.noShowRate)}
            sublabel="missed appointments"
            color={stats?.performance?.noShowRate && stats.performance.noShowRate > 0.1 ? '#FF3B30' : '#8E8E93'}
          />
          <StatCard
            icon={<XCircle className="size-5" />}
            label="Cancel Rate"
            value={formatPercent(stats?.performance?.cancelRate)}
            sublabel="cancelled bookings"
            color={stats?.performance?.cancelRate && stats.performance.cancelRate > 0.15 ? '#FF9500' : '#8E8E93'}
          />
        </div>
      </div>

      {/* Earnings Breakdown */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Earnings (This Month)
        </h3>
        <div className="overflow-hidden rounded-[12px] bg-white">
          <div className="border-b border-gray-100 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-[#1C1C1E]">They Earned</span>
              <span className="text-[17px] font-semibold text-[#34C759]">
                {formatCurrency(stats?.thisMonth.techEarned ?? 0)}
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-[#1C1C1E]">They Made Us</span>
              <span className="text-[17px] font-semibold text-[#007AFF]">
                {formatCurrency(stats?.thisMonth.salonEarned ?? 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bio */}
      {technician.bio && (
        <div>
          <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
            About
          </h3>
          <div className="rounded-[12px] bg-white p-4">
            <p className="text-[15px] leading-relaxed text-[#1C1C1E]">
              {technician.bio}
            </p>
          </div>
        </div>
      )}

      {/* Languages */}
      {technician.languages && technician.languages.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
            Languages
          </h3>
          <div className="rounded-[12px] bg-white p-4">
            <div className="flex flex-wrap gap-2">
              {technician.languages.map(lang => (
                <span
                  key={lang}
                  className="rounded-full bg-[#F2F2F7] px-3 py-1 text-[13px] text-[#1C1C1E]"
                >
                  {lang}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Specialties */}
      {technician.specialties && technician.specialties.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
            Specialties
          </h3>
          <div className="rounded-[12px] bg-white p-4">
            <div className="flex flex-wrap gap-2">
              {technician.specialties.map(specialty => (
                <span
                  key={specialty}
                  className="rounded-full bg-[#E8F5E9] px-3 py-1 text-[13px] font-medium text-[#2E7D32]"
                >
                  {specialty}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Stat Card
// =============================================================================

function StatCard({
  icon,
  label,
  value,
  sublabel,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
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
      <div className="text-[24px] font-bold text-[#1C1C1E]">{value}</div>
      {sublabel && (
        <div className="mt-0.5 text-[12px] text-[#8E8E93]">{sublabel}</div>
      )}
    </div>
  );
}
