'use client';

import { DollarSign, Users, Calendar, TrendingUp, RefreshCw, UserCheck, XCircle } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface TechnicianDetail {
  id: string;
  name: string;
  bio: string | null;
  languages: string[] | null;
  specialties: string[] | null;
}

interface PerformanceMetrics {
  rebookingRate: number;  // 0-1 decimal
  avgTicket: number;      // in cents
  noShowRate: number;     // 0-1 decimal
  cancelRate: number;     // 0-1 decimal
}

interface TechnicianStats {
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
}

interface OverviewTabProps {
  technician: TechnicianDetail;
  stats: TechnicianStats | null;
  onRefresh: () => void;
}

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
  if (rate === undefined || rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

// =============================================================================
// Component
// =============================================================================

export function OverviewTab({ technician, stats, onRefresh }: OverviewTabProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Today's Stats */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Today
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Revenue"
            value={formatCurrency(stats?.today.revenue ?? 0)}
            color="#34C759"
          />
          <StatCard
            icon={<Calendar className="w-5 h-5" />}
            label="Appointments"
            value={String(stats?.today.appointments ?? 0)}
            sublabel={`${stats?.today.completed ?? 0} completed`}
            color="#007AFF"
          />
        </div>
      </div>

      {/* This Month Stats */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          This Month
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Total Revenue"
            value={formatCurrency(stats?.thisMonth.revenue ?? 0)}
            color="#FF9500"
          />
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Total Clients"
            value={String(stats?.totalClients ?? 0)}
            color="#AF52DE"
          />
        </div>
      </div>

      {/* Performance Metrics */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Performance
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<RefreshCw className="w-5 h-5" />}
            label="Rebooking Rate"
            value={formatPercent(stats?.performance?.rebookingRate)}
            sublabel="clients who return"
            color="#34C759"
          />
          <StatCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Avg Ticket"
            value={formatCurrency(stats?.performance?.avgTicket ?? 0)}
            sublabel="per appointment"
            color="#007AFF"
          />
          <StatCard
            icon={<UserCheck className="w-5 h-5" />}
            label="No-Show Rate"
            value={formatPercent(stats?.performance?.noShowRate)}
            sublabel="missed appointments"
            color={stats?.performance?.noShowRate && stats.performance.noShowRate > 0.1 ? '#FF3B30' : '#8E8E93'}
          />
          <StatCard
            icon={<XCircle className="w-5 h-5" />}
            label="Cancel Rate"
            value={formatPercent(stats?.performance?.cancelRate)}
            sublabel="cancelled bookings"
            color={stats?.performance?.cancelRate && stats.performance.cancelRate > 0.15 ? '#FF9500' : '#8E8E93'}
          />
        </div>
      </div>

      {/* Earnings Breakdown */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Earnings (This Month)
        </h3>
        <div className="bg-white rounded-[12px] overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="flex justify-between items-center">
              <span className="text-[15px] text-[#1C1C1E]">They Earned</span>
              <span className="text-[17px] font-semibold text-[#34C759]">
                {formatCurrency(stats?.thisMonth.techEarned ?? 0)}
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="flex justify-between items-center">
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
          <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
            About
          </h3>
          <div className="bg-white rounded-[12px] p-4">
            <p className="text-[15px] text-[#1C1C1E] leading-relaxed">
              {technician.bio}
            </p>
          </div>
        </div>
      )}

      {/* Languages */}
      {technician.languages && technician.languages.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
            Languages
          </h3>
          <div className="bg-white rounded-[12px] p-4">
            <div className="flex flex-wrap gap-2">
              {technician.languages.map((lang) => (
                <span
                  key={lang}
                  className="px-3 py-1 bg-[#F2F2F7] rounded-full text-[13px] text-[#1C1C1E]"
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
          <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
            Specialties
          </h3>
          <div className="bg-white rounded-[12px] p-4">
            <div className="flex flex-wrap gap-2">
              {technician.specialties.map((specialty) => (
                <span
                  key={specialty}
                  className="px-3 py-1 bg-[#E8F5E9] text-[#2E7D32] rounded-full text-[13px] font-medium"
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
      <div className="text-[24px] font-bold text-[#1C1C1E]">{value}</div>
      {sublabel && (
        <div className="text-[12px] text-[#8E8E93] mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}
