'use client';

/**
 * Admin Dashboard Home
 *
 * iOS-style swipeable dashboard with:
 * - Page 1: Analytics widgets (revenue, utilization, staff)
 * - Page 2: App grid with gradient icons
 * - Fullscreen modals for apps (Appointments, Settings, etc.)
 * - iOS spring physics and animations
 */

import { Bell, LogOut } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { AdminModalHost } from '@/components/admin/AdminModalHost';
import { AnalyticsWidgets, type TimePeriod } from '@/components/admin/AnalyticsWidgets';
import { AppGrid, type AppId } from '@/components/admin/AppGrid';
import { AdminImpersonationBanner } from '@/components/admin/AdminImpersonationBanner';
import { PageIndicator, SwipeablePages } from '@/components/admin/SwipeablePages';
import { AdminDashboardNoticeStack } from '@/components/admin/dashboard/AdminDashboardNoticeStack';
import { AdminDashboardSkeleton } from '@/components/admin/dashboard/AdminDashboardSkeleton';
import { AdminSalonSelector } from '@/components/admin/dashboard/AdminSalonSelector';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';
// =============================================================================
// Main Page Component
// =============================================================================
// Use shared type from admin types
import type { AnalyticsResponse } from '@/types/admin';

// =============================================================================
// Types
// =============================================================================

/** Analytics with optional dateRange (when API fails, UI computes from anchor) */
type PartialAnalytics = Omit<AnalyticsResponse, 'dateRange'> & {
  dateRange?: AnalyticsResponse['dateRange'];
};

/**
 * Empty analytics fallback - ensures dashboard always has safe defaults
 * Note: dateRange is intentionally undefined so the UI computes it from anchorDate
 */
function getEmptyAnalytics(): PartialAnalytics {
  return {
    period: 'weekly',
    revenue: {
      total: 0,
      trend: 0,
      completed: 0,
    },
    appointments: {
      total: 0,
      completed: 0,
      noShows: 0,
      upcoming: 0,
    },
    staff: [],
    services: [],
    // dateRange intentionally omitted - UI will compute from anchor
  };
}

// =============================================================================
// Period Navigation Helpers (stable references - outside component)
// =============================================================================

const PERIOD_PARAM_MAP: Record<TimePeriod, 'daily' | 'weekly' | 'monthly' | 'yearly'> = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Yearly: 'yearly',
};

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(ymd: string, months: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addYears(ymd: string, years: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function shiftAnchor(ymd: string, period: TimePeriod, dir: -1 | 1): string {
  if (period === 'Daily') {
    return addDays(ymd, dir);
  }
  if (period === 'Weekly') {
    return addDays(ymd, dir * 7);
  }
  if (period === 'Monthly') {
    return addMonths(ymd, dir);
  }
  return addYears(ymd, dir);
}

type AdminUser = {
  id: string;
  phone: string;
  name: string | null;
  isSuperAdmin: boolean;
  impersonation: {
    isActive: boolean;
    salonId: string;
    salonSlug: string;
    salonName: string;
    startedAt: string;
  } | null;
  salons: Array<{
    id: string;
    slug: string;
    name: string;
    status?: string | null;
    role: string;
  }>;
};

type DashboardData = {
  revenue: {
    today: number;
    completed: number;
    trend: number;
  };
  appointments: {
    total: number;
    completed: number;
    noShows: number;
    upcoming: number;
  };
  openSpots: {
    count: number;
    nextTime: string | null;
    slots: ('booked' | 'open')[];
  };
  staff: Array<{
    name: string;
    status: 'busy' | 'free' | 'break';
    detail?: string;
  }>;
  badges: {
    referrals: number;
    reviews: number;
    marketing: number;
    alerts: number;
  };
};

// Main component that uses useSearchParams (must be wrapped in Suspense)
function AdminDashboardContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';
  const requestedSalonSlug = searchParams.get('salon')?.trim().toLowerCase() ?? null;

  // Admin auth state
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showSalonSelector, setShowSalonSelector] = useState(false);

  // Dashboard data state
  const [data, setData] = useState<DashboardData>({
    revenue: { today: 0, completed: 0, trend: 0 },
    appointments: { total: 0, completed: 0, noShows: 0, upcoming: 0 },
    openSpots: { count: 0, nextTime: null, slots: [] },
    staff: [],
    badges: { referrals: 0, reviews: 0, marketing: 0, alerts: 0 },
  });
  const [analyticsData, setAnalyticsData] = useState<PartialAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonBlockingMessage, setNonBlockingMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Analytics should never block rendering:
  // - Preserve last known-good analytics on transient failures
  // - Ignore out-of-order fetches
  const lastGoodAnalyticsRef = useRef<PartialAnalytics>(getEmptyAnalytics());
  const latestFetchIdRef = useRef<string>('');

  // Swipe page state
  const [currentPage, setCurrentPage] = useState(0);

  // Modal state
  const [activeModal, setActiveModal] = useState<AppId | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFraudSignals, setShowFraudSignals] = useState(false);
  const [showScheduleCalendar, setShowScheduleCalendar] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const activeDashboardSalonSlug = adminUser?.impersonation?.salonSlug
    ?? requestedSalonSlug
    ?? adminUser?.salons[0]?.slug
    ?? null;
  const activeDashboardSalon = adminUser?.salons.find(
    s => s.slug?.toLowerCase() === activeDashboardSalonSlug?.toLowerCase(),
  ) ?? adminUser?.salons[0] ?? null;
  const activeDashboardSalonName = activeDashboardSalon?.name ?? null;
  const activeDashboardSalonStatus = activeDashboardSalon?.status ?? null;

  // Fraud signals - parent owns state
  const [fraudSignals, setFraudSignals] = useState<import('@/components/admin/FraudSignalsModal').FraudSignal[]>([]);
  const [fraudSignalsTotalCount, setFraudSignalsTotalCount] = useState(0); // Total from API (for pagination)
  const [fraudSignalsLoading, setFraudSignalsLoading] = useState(true);
  const [fraudSignalsError, setFraudSignalsError] = useState<string | null>(null);
  // Badge count: use total from API, decrement optimistically on resolve
  const fraudSignalCount = fraudSignalsTotalCount;

  // Notification count (in production, this would come from API)
  const notificationCount = data.badges.alerts + data.badges.reviews;

  // Track if we've already synced to prevent infinite loops
  const [hasSynced, setHasSynced] = useState(false);

  // Performance period controls (API-driven)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('Weekly');
  const [anchorDate, setAnchorDate] = useState<string>(() => {
    // Today in YYYY-MM-DD format (local time, not UTC)
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  // Helper to get today's date in YYYY-MM-DD (local time)
  const getTodayYMD = useCallback(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  // Navigation callbacks (stable via useCallback)
  const onPrev = useCallback(() => setAnchorDate(a => shiftAnchor(a, timePeriod, -1)), [timePeriod]);
  const onNext = useCallback(() => setAnchorDate(a => shiftAnchor(a, timePeriod, +1)), [timePeriod]);
  const onToday = useCallback(() => setAnchorDate(getTodayYMD()), [getTodayYMD]);

  // Check admin auth on mount and sync salon cookie
  useEffect(() => {
    async function checkAuth() {
      try {
        const adminMeUrl = requestedSalonSlug
          ? `/api/admin/auth/me?salonSlug=${encodeURIComponent(requestedSalonSlug)}`
          : '/api/admin/auth/me';
        const response = await fetch(adminMeUrl);
        if (response.ok) {
          const data = await response.json();
          setAdminUser(data.user);

          if (data.user.impersonation?.isActive) {
            const lockedSlug = data.user.impersonation.salonSlug;
            if (requestedSalonSlug !== lockedSlug.toLowerCase()) {
              router.replace(`/${locale}/admin?salon=${encodeURIComponent(lockedSlug)}`);
            }
            setShowSalonSelector(false);
          }

          // If admin has multiple salons and no salon selected, show selector
          if (!data.user.impersonation?.isActive && data.user.salons.length > 1 && !requestedSalonSlug) {
            setShowSalonSelector(true);
          }

          // Sync cookie with query param if different from current salon (only once).
          // Do not hard reload; the dashboard can already render against the requested slug.
          if (!data.user.impersonation?.isActive && requestedSalonSlug && !hasSynced) {
            setHasSynced(true);
            const syncResponse = await fetch('/api/admin/auth/set-active-salon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ salonSlug: requestedSalonSlug }),
            });
            if (!syncResponse.ok) {
              const syncError = await syncResponse.json().catch(() => ({}));
              setNonBlockingMessage(syncError.error || 'The selected salon could not be synced yet for admin actions.');
            } else {
              router.refresh();
            }
          }
        } else {
          // Not authenticated - redirect to login immediately
          router.replace(`/${locale}/admin-login`);
        }
      } catch {
        router.replace(`/${locale}/admin-login`);
        return;
      } finally {
        setAuthLoading(false);
      }
    }
    checkAuth();
  }, [router, locale, requestedSalonSlug, hasSynced]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    router.push(`/${locale}/admin-login`);
  };

  // Fetch fraud signals - parent owns this state
  const fetchFraudSignals = useCallback(async () => {
    try {
      setFraudSignalsError(null);
      // API returns signals + unresolvedCount for total
      const response = await fetch('/api/admin/fraud-signals');
      if (!response.ok) {
        throw new Error('Failed to load');
      }
      const result = await response.json();
      setFraudSignals(result.data.signals);
      // Use unresolvedCount from API for badge (accurate even with pagination)
      setFraudSignalsTotalCount(result.data.unresolvedCount ?? result.data.signals.length);
    } catch {
      setFraudSignalsError('Failed to load fraud signals');
    } finally {
      setFraudSignalsLoading(false);
    }
  }, []);

  // Fetch dashboard data from analytics API
  const fetchData = useCallback(async () => {
    if (!activeDashboardSalonSlug) {
      return;
    }

    const requestId = crypto.randomUUID();
    latestFetchIdRef.current = requestId;

    try {
      if (latestFetchIdRef.current === requestId) {
        setError(null);
        setNonBlockingMessage(null);
      }

      // Fetch from analytics API (non-blocking - never throws)
      let analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
      let analyticsNonBlockingMessage: string | null = null;

      try {
        const period = PERIOD_PARAM_MAP[timePeriod];
        const analyticsResponse = await fetch(`/api/admin/analytics?salonSlug=${activeDashboardSalonSlug}&period=${period}&anchor=${encodeURIComponent(anchorDate)}`);

        const text = await analyticsResponse.text();
        let parsed: any = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          // Non-JSON body is fine; keep parsed as null
        }

        if (analyticsResponse.ok) {
          const candidate = parsed?.data ?? parsed;
          if (candidate) {
            analytics = candidate as AnalyticsResponse;
            lastGoodAnalyticsRef.current = analytics;
          } else {
            // No usable data -> keep last good (or empty if first load)
            analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
          }
        } else {
          // 401 is auth-critical: redirect to login and stop processing
          if (analyticsResponse.status === 401) {
            if (latestFetchIdRef.current === requestId) {
              router.replace(`/${locale}/admin-login`);
            }
            return;
          }

          // Expected/normal failures: no banner, no scary logs; keep last good
          if (analyticsResponse.status === 403 || analyticsResponse.status === 404) {
            analyticsNonBlockingMessage = null;
            analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
          } else {
            // Unexpected failures: still render (with last good), but log + mild banner
            const errBody = parsed ?? (text ? text.slice(0, 500) : null);
            console.error('[AdminDashboard] analytics failed', {
              status: analyticsResponse.status,
              errBody,
            });
            analyticsNonBlockingMessage = 'Some dashboard analytics are temporarily unavailable.';
            analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
          }
        }
      } catch (e) {
        // Network failure, JSON parse crash, etc.
        console.error('[AdminDashboard] analytics request crashed', e);
        analyticsNonBlockingMessage = 'Some dashboard analytics are temporarily unavailable.';
        analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
      }

      // Always set non-blocking message if there was one
      if (latestFetchIdRef.current !== requestId) {
        return;
      }
      setNonBlockingMessage(analyticsNonBlockingMessage);

      // Generate availability slots from upcoming appointments
      const slots: ('booked' | 'open')[] = [];
      for (let i = 0; i < 16; i++) {
        // More realistic: mark slots as booked based on upcoming count
        const bookedRatio = analytics?.appointments?.upcoming
          ? Math.min(analytics.appointments.upcoming / 8, 1)
          : 0;
        slots.push(Math.random() < bookedRatio ? 'booked' : 'open');
      }

      const openCount = slots.filter(s => s === 'open').length;
      const openSlotIndex = slots.findIndex(s => s === 'open');
      let nextTime = null;
      if (openSlotIndex !== -1) {
        const baseHour = 9;
        const slotHour = baseHour + Math.floor(openSlotIndex / 2);
        const slotMinute = (openSlotIndex % 2) * 30;
        const slotDate = new Date();
        slotDate.setHours(slotHour, slotMinute, 0, 0);
        if (slotDate > new Date()) {
          nextTime = slotDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
        }
      }

      // Map staff data from API
      const staffStatus = (analytics?.staff || []).slice(0, 3).map((tech: { name: string; appointmentCount: number }) => ({
        name: tech.name.split(' ')[0] || tech.name,
        status: tech.appointmentCount > 0 ? 'busy' : 'free' as 'busy' | 'free' | 'break',
        detail: tech.appointmentCount > 0 ? `${tech.appointmentCount} appts` : undefined,
      }));

      // Always set data - even if analytics failed, use empty defaults
      setData({
        revenue: {
          today: analytics?.revenue?.total ?? 0,
          completed: analytics?.revenue?.completed ?? 0,
          trend: analytics?.revenue?.trend ?? 0,
        },
        appointments: {
          total: analytics?.appointments?.total ?? 0,
          completed: analytics?.appointments?.completed ?? 0,
          noShows: analytics?.appointments?.noShows ?? 0,
          upcoming: analytics?.appointments?.upcoming ?? 0,
        },
        openSpots: {
          count: openCount,
          nextTime,
          slots,
        },
        staff: staffStatus.length > 0
          ? staffStatus
          : [],
        badges: {
          referrals: 0,
          reviews: 0,
          marketing: 0,
          alerts: analytics?.appointments?.noShows ?? 0,
        },
      });

      // Store analytics for widgets (always set, even if empty)
      setAnalyticsData(analytics);
      setLastUpdated(new Date());
    } catch (err) {
      // Only catch truly unexpected errors (shouldn't happen now, but safety net)
      console.error('[AdminDashboard] unexpected error in fetchData', err);
      // Don't set error banner - dashboard should still render with empty data
    } finally {
      if (latestFetchIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [activeDashboardSalonSlug, timePeriod, anchorDate, fetchFraudSignals, locale, router]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch data when auth is ready or fetchData changes (which includes period/anchor)
  useEffect(() => {
    if (!authLoading && adminUser && !showSalonSelector) {
      fetchData();
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [authLoading, adminUser, showSalonSelector, fetchData]);

  useEffect(() => {
    if (!authLoading && adminUser && !showSalonSelector) {
      fetchFraudSignals().catch((err) => {
        console.error('[AdminDashboard] fraud signals fetch failed', err);
      });
      const interval = setInterval(() => {
        fetchFraudSignals().catch((err) => {
          console.error('[AdminDashboard] fraud signals fetch failed', err);
        });
      }, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [authLoading, adminUser, showSalonSelector, fetchFraudSignals]);

  // Handle app tile tap - all tiles now open modals
  const handleAppTap = (appId: AppId) => {
    if (appId === 'schedule') {
      setShowScheduleCalendar(true);
    } else {
      setActiveModal(appId);
    }
  };

  // Handle quick action tap
  const handleQuickAction = useCallback((actionId: string) => {
    switch (actionId) {
      case 'new-appointment':
        setShowScheduleCalendar(true);
        break;
      case 'walk-in':
        setShowWalkIn(true);
        break;
      case 'send-sms':
        setActiveModal('marketing');
        break;
      case 'today-schedule':
        setShowScheduleCalendar(true);
        break;
      default:
        break;
    }
  }, []);

  // Close modal
  const handleCloseModal = () => {
    setActiveModal(null);
  };

  // 1) Auth check phase - never show dashboard UI here
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F2F7]">
        <div className="size-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  // 2) Not authenticated - redirect should have happened, but keep safe fallback
  if (!adminUser) {
    return null;
  }

  // 3) Salon selector for admins with multiple salons (check before loading since fetchData waits for salon selection)
  if (!adminUser.impersonation?.isActive && showSalonSelector && adminUser.salons.length > 1) {
    return (
      <AdminSalonSelector
        salons={adminUser.salons}
        onSelect={(salon) => {
          router.push(`/${locale}/admin?salon=${salon.slug}`);
          setShowSalonSelector(false);
        }}
        footerAction={(
          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 text-sm text-[#8E8E93] hover:text-[#1C1C1E]"
          >
            Log out
          </button>
        )}
      />
    );
  }

  // 4) Authenticated but dashboard data still loading - show skeleton
  if (loading) {
    return <AdminDashboardSkeleton />;
  }

  const userName = adminUser.name || 'Admin';
  const userInitial = userName.charAt(0).toUpperCase();

  // Map badges to app grid format
  const appBadges: Record<string, number> = {
    marketing: data.badges.marketing,
    reviews: data.badges.reviews,
  };

  // Staff data for analytics - use real data from API
  const avatarColors = [
    'bg-blue-100 text-blue-600',
    'bg-purple-100 text-purple-600',
    'bg-pink-100 text-pink-600',
    'bg-green-100 text-green-600',
    'bg-orange-100 text-orange-600',
  ];

  const staffData = analyticsData?.staff?.slice(0, 5).map((tech, index) => ({
    id: index + 1,
    name: tech.name,
    role: tech.role || 'Technician',
    revenue: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(tech.revenue / 100),
    avatarColor: avatarColors[index % avatarColors.length]!,
  })) || [];

  // Utilization data - use real data from API
  const utilization = analyticsData?.staff?.slice(0, 3).map(tech => ({
    name: tech.name.substring(0, 3),
    percent: tech.utilization,
    color: tech.color,
  })) || [];

  // Service mix data - use real data from API
  const services = analyticsData?.services?.slice(0, 4).map(svc => ({
    label: svc.label,
    percent: svc.percent,
    color: svc.color,
  })) || [];

  return (
    <div
      className="min-h-screen bg-[#F2F2F7] font-sans"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 300ms ease-out, transform 300ms ease-out',
      }}
    >
      <AdminDashboardNoticeStack
        status={activeDashboardSalonStatus}
        fraudSignalCount={fraudSignalCount}
        onOpenFraudSignals={() => setShowFraudSignals(true)}
      />

      {/* Safe Area Top Padding */}
      <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
        {/* Header */}
        <div className="px-5 py-3">
          <WorkspacePageHeader
            title="Dashboard"
            subtitle={activeDashboardSalonName}
            titleClassName="text-[28px] font-bold tracking-tight text-[#1C1C1E]"
            subtitleClassName="text-[15px] text-[#8E8E93]"
            actions={(
              <>
                <button
                  type="button"
                  onClick={() => setShowNotifications(true)}
                  className="relative flex size-9 items-center justify-center rounded-full bg-black/5 transition-colors active:bg-black/10"
                >
                  <Bell size={20} className="text-[#8E8E93]" />
                  {notificationCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3B30] px-1">
                      <span className="text-[11px] font-bold text-white">
                        {notificationCount > 9 ? '9+' : notificationCount}
                      </span>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 active:bg-red-200"
                >
                  <LogOut size={16} />
                  <span>Log Out</span>
                </button>
                <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#007AFF] to-[#5856D6] text-[15px] font-semibold text-white">
                  {userInitial}
                </div>
              </>
            )}
          />
        </div>

        <AdminImpersonationBanner />

        {/* Critical Error Banner */}
        {error && (
          <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Non-blocking Analytics Warning */}
        {nonBlockingMessage && (
          <div className="mx-4 mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-700">{nonBlockingMessage}</p>
          </div>
        )}

        {/* Swipeable Pages Container */}
        <div className="h-[calc(100vh-140px)]">
          <SwipeablePages
            onPageChange={setCurrentPage}
            initialPage={currentPage}
            onRefresh={handleRefresh}
            lastUpdated={lastUpdated}
          >
            {/* Page 1: Analytics Widgets */}
            <AnalyticsWidgets
              revenue={data.revenue.today ?? 0}
              revenueTrend={data.revenue.trend ?? 0}
              staffData={staffData}
              utilization={utilization}
              services={services}
              onQuickAction={handleQuickAction}
              timePeriod={timePeriod}
              onTimePeriodChange={setTimePeriod}
              dateRange={analyticsData?.dateRange}
              anchorDate={anchorDate}
              onPrev={onPrev}
              onNext={onNext}
              onToday={onToday}
              onAnchorChange={setAnchorDate}
            />

            {/* Page 2: App Grid */}
            <AppGrid
              theme="apple"
              badges={appBadges}
              onAppTap={handleAppTap}
            />
          </SwipeablePages>
        </div>

        {/* Page Indicator */}
        <div className="pb-safe fixed inset-x-0 bottom-0">
          <PageIndicator
            pageCount={2}
            currentPage={currentPage}
            onPageSelect={setCurrentPage}
          />
        </div>
      </div>

      <AdminModalHost
        activeModal={activeModal}
        activeSalonSlug={activeDashboardSalonSlug}
        onCloseModal={handleCloseModal}
        showNotifications={showNotifications}
        setShowNotifications={setShowNotifications}
        showFraudSignals={showFraudSignals}
        setShowFraudSignals={setShowFraudSignals}
        showScheduleCalendar={showScheduleCalendar}
        setShowScheduleCalendar={setShowScheduleCalendar}
        showWalkIn={showWalkIn}
        setShowWalkIn={setShowWalkIn}
        userName={userName}
        userInitial={userInitial}
        analyticsProps={{
          revenue: data.revenue.today ?? 0,
          revenueTrend: data.revenue.trend ?? 0,
          staffData,
          utilization,
          services,
          timePeriod,
          onTimePeriodChange: setTimePeriod,
          dateRange: analyticsData?.dateRange,
          anchorDate,
          onPrev,
          onNext,
          onToday,
          onAnchorChange: setAnchorDate,
        }}
        fraudSignals={fraudSignals}
        fraudSignalsTotalCount={fraudSignalsTotalCount}
        fraudSignalsLoading={fraudSignalsLoading}
        fraudSignalsError={fraudSignalsError}
        fetchFraudSignals={fetchFraudSignals}
        onFraudSignalResolved={(signalId) => {
          setFraudSignals(prev => prev.filter(s => s.id !== signalId));
          setFraudSignalsTotalCount(prev => Math.max(0, prev - 1));
        }}
      />
    </div>
  );
}

// Loading fallback for Suspense
function AdminDashboardLoading() {
  return <AdminDashboardSkeleton />;
}

// Page Export - wrap in Suspense for useSearchParams
export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<AdminDashboardLoading />}>
      <AdminDashboardContent />
    </Suspense>
  );
}
