'use client';

/**
 * Staff Earnings Page
 *
 * Displays earnings data for the logged-in staff member.
 * Module-gated: shows ModuleDisabledState if staffEarnings module is disabled.
 */

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ModuleDisabledState, ModuleSkeleton, StaffHeader, StaffBottomNav } from '@/components/staff';
import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';
import { themeVars } from '@/theme';

// =============================================================================
// TYPES
// =============================================================================

interface EarningsData {
  range: {
    from: string;
    to: string;
  };
  totals: {
    grossSales: number;
    tips: number;
    earnings: number;
    appointmentCount: number;
  };
  daily: Array<{
    date: string;
    grossSales: number;
    tips: number;
    earnings: number;
    appointmentCount: number;
  }>;
}

type DateRange = 'this_month' | 'last_month';

// =============================================================================
// HELPERS
// =============================================================================

function getMonthRange(offset: number): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);

  const monthName = from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return {
    from: from.toISOString().split('T')[0] ?? '',
    to: to.toISOString().split('T')[0] ?? '',
    label: monthName,
  };
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function StaffEarningsPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  // Module capabilities check
  const { modules, loading: capabilitiesLoading, isUnauthorized } = useStaffCapabilities();
  const earningsEnabled = modules?.staffEarnings ?? false;

  // Redirect if unauthorized
  useEffect(() => {
    if (isUnauthorized) {
      router.push(`/${locale}/staff-login`);
    }
  }, [isUnauthorized, router, locale]);

  // State
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('this_month');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch earnings data
  const fetchEarnings = useCallback(async () => {
    const offset = dateRange === 'this_month' ? 0 : -1;
    const range = getMonthRange(offset);

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/staff/earnings?from=${range.from}&to=${range.to}`,
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));

        if (data.error?.code === 'MODULE_DISABLED') {
          setModuleDisabled(true);
          return;
        }

        if (response.status === 401) {
          router.push(`/${locale}/staff-login`);
          return;
        }

        setError(data.error?.message || 'Failed to load earnings');
        return;
      }

      const data = await response.json();
      setEarnings(data.data);
      setModuleDisabled(false);
    } catch (err) {
      console.error('Failed to fetch earnings:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [dateRange, router, locale]);

  // Fetch when capabilities loaded and module enabled
  useEffect(() => {
    if (!capabilitiesLoading && earningsEnabled) {
      fetchEarnings();
    } else if (!capabilitiesLoading && !earningsEnabled) {
      setLoading(false);
    }
  }, [capabilitiesLoading, earningsEnabled, fetchEarnings]);

  // Date range labels
  const thisMonthRange = getMonthRange(0);
  const lastMonthRange = getMonthRange(-1);

  // Show skeleton while loading capabilities
  if (capabilitiesLoading) {
    return (
      <div
        className="min-h-screen pb-24"
        style={{
          background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
        }}
      >
        <div className="mx-auto max-w-2xl px-4">
          <StaffHeader
            title="My Earnings"
            showBack
            onBack={() => router.push(`/${locale}/staff`)}
          />
          <ModuleSkeleton />
        </div>
        <StaffBottomNav activeItem="earnings" />
      </div>
    );
  }

  // Show disabled state if module is off
  if (!earningsEnabled || moduleDisabled) {
    return (
      <div
        className="min-h-screen pb-24"
        style={{
          background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
        }}
      >
        <div className="mx-auto max-w-2xl px-4">
          <StaffHeader
            title="My Earnings"
            showBack
            onBack={() => router.push(`/${locale}/staff`)}
          />
          <ModuleDisabledState featureName="Earnings" />
        </div>
        <StaffBottomNav activeItem="earnings" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-24"
      style={{
        background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto max-w-2xl px-4">
        <StaffHeader
          title="My Earnings"
          showBack
          onBack={() => router.push(`/${locale}/staff`)}
        />

        {/* Date Range Toggle */}
        <div
          className="mb-6 flex gap-1 rounded-2xl p-1 shadow-sm"
          style={{
            backgroundColor: themeVars.cardBg,
            borderColor: themeVars.cardBorder,
            borderWidth: 1,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <button
            type="button"
            onClick={() => setDateRange('this_month')}
            className="flex-1 rounded-xl px-4 py-3 text-center text-sm font-semibold transition-all"
            style={{
              backgroundColor: dateRange === 'this_month' ? themeVars.primary : 'transparent',
              color: dateRange === 'this_month' ? 'white' : themeVars.secondaryText,
            }}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => setDateRange('last_month')}
            className="flex-1 rounded-xl px-4 py-3 text-center text-sm font-semibold transition-all"
            style={{
              backgroundColor: dateRange === 'last_month' ? themeVars.primary : 'transparent',
              color: dateRange === 'last_month' ? 'white' : themeVars.secondaryText,
            }}
          >
            Last Month
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div
              className="size-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
            />
          </div>
        ) : error ? (
          <div
            className="rounded-2xl bg-white p-6 text-center shadow-lg"
            style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
          >
            <div className="mb-2 text-4xl">⚠️</div>
            <p className="text-neutral-600">{error}</p>
            <button
              type="button"
              onClick={fetchEarnings}
              className="mt-4 rounded-xl px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: themeVars.selectedBackground, color: themeVars.titleText }}
            >
              Try Again
            </button>
          </div>
        ) : earnings ? (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
            }}
          >
            {/* Period Label */}
            <div className="text-center text-sm text-neutral-500">
              {dateRange === 'this_month' ? thisMonthRange.label : lastMonthRange.label}
            </div>

            {/* Totals Card */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="p-6">
                {/* Earnings (Primary) */}
                <div className="mb-6 text-center">
                  <div className="text-sm font-medium text-neutral-500">My Earnings</div>
                  <div
                    className="text-4xl font-bold"
                    style={{ color: themeVars.accent }}
                  >
                    {formatCurrency(earnings.totals.earnings)}
                  </div>
                  {earnings.totals.earnings === 0 && earnings.totals.grossSales > 0 && (
                    <div className="mt-1 text-xs text-neutral-400">
                      (Commission not configured)
                    </div>
                  )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: themeVars.titleText }}>
                      {earnings.totals.appointmentCount}
                    </div>
                    <div className="text-xs text-neutral-500">Appointments</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: themeVars.titleText }}>
                      {formatCurrency(earnings.totals.grossSales)}
                    </div>
                    <div className="text-xs text-neutral-500">Gross Sales</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: themeVars.titleText }}>
                      {formatCurrency(earnings.totals.tips)}
                    </div>
                    <div className="text-xs text-neutral-500">Tips</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Daily Breakdown */}
            {earnings.daily.length > 0 && (
              <div
                className="overflow-hidden rounded-2xl bg-white shadow-lg"
                style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
              >
                <div className="p-4">
                  <h3 className="mb-3 font-bold" style={{ color: themeVars.titleText }}>
                    Daily Breakdown
                  </h3>
                  <div className="space-y-2">
                    {earnings.daily.map((day) => (
                      <div
                        key={day.date}
                        className="flex items-center justify-between rounded-xl p-3"
                        style={{ backgroundColor: themeVars.surfaceAlt }}
                      >
                        <div>
                          <div className="font-medium text-neutral-900">
                            {formatDate(day.date)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {day.appointmentCount} appointment{day.appointmentCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold" style={{ color: themeVars.accent }}>
                            {formatCurrency(day.earnings)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {formatCurrency(day.grossSales)} sales
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {earnings.daily.length === 0 && (
              <div
                className="rounded-2xl bg-white p-8 text-center shadow-lg"
                style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
              >
                <div className="mb-2 text-4xl">📊</div>
                <p className="text-lg font-medium" style={{ color: themeVars.titleText }}>
                  No completed appointments
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Earnings will appear here once you complete appointments
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <StaffBottomNav activeItem="earnings" />
    </div>
  );
}
