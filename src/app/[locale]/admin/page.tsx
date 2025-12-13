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
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AnalyticsWidgets } from '@/components/admin/AnalyticsWidgets';
import { AppGrid, type AppId } from '@/components/admin/AppGrid';
import { AppModal } from '@/components/admin/AppModal';
import { AppointmentsModal } from '@/components/admin/AppointmentsModal';
import { ClientsModal } from '@/components/admin/ClientsModal';
import { FraudSignalsModal } from '@/components/admin/FraudSignalsModal';
import { MarketingModal } from '@/components/admin/MarketingModal';
import { NotificationsModal } from '@/components/admin/NotificationsModal';
import { ReviewsModal } from '@/components/admin/ReviewsModal';
import { RewardsModal } from '@/components/admin/RewardsModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { SettingsModal } from '@/components/admin/SettingsModal';
import { SkeletonWidgets } from '@/components/admin/SkeletonWidgets';
import { StaffModal } from '@/components/admin/StaffModal';
import { StaffOpsModal } from '@/components/admin/StaffOpsModal';
import { CancelledBanner, SuspendedBanner, TrialBanner } from '@/components/admin/SuspendedBanner';
import { PageIndicator, SwipeablePages } from '@/components/admin/SwipeablePages';
import { useSalon } from '@/providers/SalonProvider';
// =============================================================================
// Main Page Component
// =============================================================================
// Use shared type from admin types
import type { AnalyticsResponse } from '@/types/admin';

// =============================================================================
// Types
// =============================================================================

type AdminUser = {
  id: string;
  phone: string;
  name: string | null;
  isSuperAdmin: boolean;
  salons: Array<{
    id: string;
    slug: string;
    name: string;
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

// =============================================================================
// iOS Header Component
// =============================================================================

function IOSHeader({
  title,
  subtitle,
  avatar,
  notificationCount = 0,
  onNotificationTap,
  onLogout,
}: {
  title: string;
  subtitle: string;
  avatar: string;
  notificationCount?: number;
  onNotificationTap?: () => void;
  onLogout?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#1C1C1E]">
          {title}
        </h1>
        <p className="mt-0.5 text-[15px] text-[#8E8E93]">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onNotificationTap}
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
          onClick={onLogout}
          className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 active:bg-red-200"
        >
          <LogOut size={16} />
          <span>Log Out</span>
        </button>
        <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#007AFF] to-[#5856D6] text-[15px] font-semibold text-white">
          {avatar}
        </div>
      </div>
    </div>
  );
}

// Main component that uses useSearchParams (must be wrapped in Suspense)
function AdminDashboardContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';
  const { salonName, salonSlug, status } = useSalon();

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
  const [analyticsData, setAnalyticsData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Swipe page state
  const [currentPage, setCurrentPage] = useState(0);

  // Modal state
  const [activeModal, setActiveModal] = useState<AppId | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFraudSignals, setShowFraudSignals] = useState(false);

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

  // Check admin auth on mount and sync salon cookie
  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch('/api/admin/auth/me');
        if (response.ok) {
          const data = await response.json();
          setAdminUser(data.user);

          // If admin has multiple salons and no salon selected, show selector
          if (data.user.salons.length > 1 && !searchParams.get('salon')) {
            setShowSalonSelector(true);
          }

          // Sync cookie with query param if different from current salon (only once)
          const querySalon = searchParams.get('salon')?.trim().toLowerCase();
          if (querySalon && querySalon !== salonSlug?.toLowerCase() && !hasSynced) {
            setHasSynced(true);
            // Update the active salon cookie to match query param
            const syncResponse = await fetch('/api/admin/auth/set-active-salon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ salonSlug: querySalon }),
            });
            // Only reload if the sync was successful
            if (syncResponse.ok) {
              window.location.reload();
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
  }, [router, locale, searchParams, salonSlug, hasSynced]);

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
      if (!response.ok) throw new Error('Failed to load');
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
    try {
      setError(null);

      // Fetch fraud signals in parallel with analytics
      fetchFraudSignals();

      // Fetch from analytics API
      const analyticsResponse = await fetch(`/api/admin/analytics?salonSlug=${salonSlug}&period=monthly`);

      if (!analyticsResponse.ok) {
        throw new Error('Failed to load analytics');
      }

      if (analyticsResponse.ok) {
        const analyticsResult = await analyticsResponse.json();
        const analytics = analyticsResult.data;

        // Generate availability slots from upcoming appointments
        const slots: ('booked' | 'open')[] = [];
        for (let i = 0; i < 16; i++) {
          // More realistic: mark slots as booked based on upcoming count
          const bookedRatio = analytics?.appointments?.upcoming
            ? Math.min(analytics.appointments.upcoming / 8, 1)
            : 0.4;
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
            : [
                { name: 'No staff', status: 'free' as const },
              ],
          badges: {
            referrals: 0,
            reviews: 0,
            marketing: 0,
            alerts: analytics?.appointments?.noShows ?? 0,
          },
        });

        // Store analytics for widgets
        setAnalyticsData(analytics);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!authLoading && adminUser && !showSalonSelector) {
      fetchData();
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [authLoading, adminUser, showSalonSelector, fetchData]);

  // Handle app tile tap - all tiles now open modals
  const handleAppTap = (appId: AppId) => {
    setActiveModal(appId);
  };

  // Handle quick action tap
  const handleQuickAction = useCallback((actionId: string) => {
    switch (actionId) {
      case 'new-appointment':
      case 'walk-in':
        setActiveModal('bookings');
        break;
      case 'send-sms':
        setActiveModal('marketing');
        break;
      case 'today-schedule':
        setActiveModal('bookings');
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
  if (showSalonSelector && adminUser.salons.length > 1) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F2F2F7] px-5">
        <h1 className="mb-2 text-[24px] font-semibold text-[#1C1C1E]">
          Select a Salon
        </h1>
        <p className="mb-6 text-[15px] text-[#8E8E93]">
          Choose which salon to manage
        </p>
        <div className="w-full max-w-sm space-y-3">
          {adminUser.salons.map(salon => (
            <button
              key={salon.id}
              type="button"
              onClick={() => {
                router.push(`/${locale}/admin?salon=${salon.slug}`);
                setShowSalonSelector(false);
              }}
              className="w-full rounded-xl bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="font-semibold text-[#1C1C1E]">{salon.name}</div>
              <div className="text-sm text-[#8E8E93]">{salon.role}</div>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 text-sm text-[#8E8E93] hover:text-[#1C1C1E]"
        >
          Log out
        </button>
      </div>
    );
  }

  // 4) Authenticated but dashboard data still loading - show skeleton
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F2F2F7]">
        <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
          {/* Skeleton Header */}
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <div className="h-8 w-32 animate-pulse rounded-lg bg-gray-200" />
              <div className="mt-1 h-4 w-24 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="flex items-center gap-3">
              <div className="size-9 animate-pulse rounded-full bg-gray-200" />
              <div className="size-9 animate-pulse rounded-full bg-gray-200" />
            </div>
          </div>
          {/* Skeleton Content */}
          <SkeletonWidgets />
        </div>
      </div>
    );
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
      {/* Status Banners - Show for suspended/cancelled/trial accounts */}
      {status === 'suspended' && (
        <SuspendedBanner
          message="Your salon is suspended. New bookings are disabled and changes cannot be made."
        />
      )}
      {status === 'cancelled' && (
        <CancelledBanner
          message="Your salon account has been cancelled. Please contact support to restore access."
        />
      )}
      {status === 'trial' && (
        <TrialBanner daysRemaining={14} />
      )}
      {/* Fraud Signals Banner */}
      {fraudSignalCount > 0 && (
        <button
          type="button"
          onClick={() => setShowFraudSignals(true)}
          className="mx-4 mt-2 flex items-center justify-between rounded-xl bg-amber-50 p-3 border border-amber-200 transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-amber-100">
              <span className="text-amber-600">⚠️</span>
            </div>
            <span className="text-sm font-medium text-amber-800">
              {fraudSignalCount} {fraudSignalCount === 1 ? 'activity' : 'activities'} flagged for review
            </span>
          </div>
          <span className="text-xs text-amber-600">Review →</span>
        </button>
      )}

      {/* Safe Area Top Padding */}
      <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
        {/* Header */}
        <IOSHeader
          title="Dashboard"
          subtitle={salonName}
          avatar={userInitial}
          notificationCount={notificationCount}
          onNotificationTap={() => setShowNotifications(true)}
          onLogout={handleLogout}
        />

        {/* Error Banner */}
        {error && (
          <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{error}</p>
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

      {/* Modals */}
      <AppModal
        isOpen={activeModal === 'bookings'}
        onClose={handleCloseModal}
      >
        <AppointmentsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'settings'}
        onClose={handleCloseModal}
      >
        <SettingsModal
          onClose={handleCloseModal}
          userName={userName}
          userInitials={userInitial}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'analytics'}
        onClose={handleCloseModal}
      >
        <AnalyticsWidgets
          revenue={data.revenue.today ?? 0}
          revenueTrend={data.revenue.trend ?? 0}
          staffData={staffData}
          utilization={utilization}
          services={services}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'clients'}
        onClose={handleCloseModal}
      >
        <ClientsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'staff'}
        onClose={handleCloseModal}
      >
        <StaffModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'services'}
        onClose={handleCloseModal}
      >
        <ServicesModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'marketing'}
        onClose={handleCloseModal}
      >
        <MarketingModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'reviews'}
        onClose={handleCloseModal}
      >
        <ReviewsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'rewards'}
        onClose={handleCloseModal}
      >
        <RewardsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'staff-ops'}
        onClose={handleCloseModal}
      >
        <StaffOpsModal onClose={handleCloseModal} />
      </AppModal>

      {/* Notifications Modal */}
      <AppModal
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      >
        <NotificationsModal onClose={() => setShowNotifications(false)} />
      </AppModal>

      {/* Fraud Signals Modal */}
      <AppModal
        isOpen={showFraudSignals}
        onClose={() => setShowFraudSignals(false)}
      >
        <FraudSignalsModal
          signals={fraudSignals}
          totalCount={fraudSignalsTotalCount}
          loading={fraudSignalsLoading}
          error={fraudSignalsError}
          onClose={() => setShowFraudSignals(false)}
          onResolved={(signalId) => {
            // Called ONLY after PATCH succeeds (not optimistic)
            // Remove signal from local list (for current page display)
            setFraudSignals(prev => prev.filter(s => s.id !== signalId));
            // Decrement total count (for badge) - server truth was totalCount, now -1
            setFraudSignalsTotalCount(prev => Math.max(0, prev - 1));
          }}
          onRefetch={fetchFraudSignals}
        />
      </AppModal>
    </div>
  );
}

// Loading fallback for Suspense
function AdminDashboardLoading() {
  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
        {/* Skeleton Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <div className="h-8 w-32 animate-pulse rounded-lg bg-gray-200" />
            <div className="mt-1 h-4 w-24 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="flex items-center gap-3">
            <div className="size-9 animate-pulse rounded-full bg-gray-200" />
            <div className="size-9 animate-pulse rounded-full bg-gray-200" />
          </div>
        </div>
        {/* Skeleton Content */}
        <SkeletonWidgets />
      </div>
    </div>
  );
}

// Page Export - wrap in Suspense for useSearchParams
export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<AdminDashboardLoading />}>
      <AdminDashboardContent />
    </Suspense>
  );
}
