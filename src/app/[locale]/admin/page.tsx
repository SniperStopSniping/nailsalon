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

import { useClerk } from '@clerk/nextjs';
import { Bell, Building2, LogOut, Sparkles } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminImpersonationBanner } from '@/components/admin/AdminImpersonationBanner';
import { AdminModalHost } from '@/components/admin/AdminModalHost';
import type { TimePeriod } from '@/components/admin/AnalyticsWidgets';
import { AppGrid, type AppId } from '@/components/admin/AppGrid';
import { AdminDashboardNoticeStack } from '@/components/admin/dashboard/AdminDashboardNoticeStack';
import { AdminDashboardSkeleton } from '@/components/admin/dashboard/AdminDashboardSkeleton';
import { AdminSalonSelector } from '@/components/admin/dashboard/AdminSalonSelector';
import { OwnerTodayWorkspace } from '@/components/admin/OwnerTodayWorkspace';
import {
  OwnerWorkspaceNav,
  type OwnerWorkspaceTab,
} from '@/components/admin/OwnerWorkspaceNav';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';
import { formatMoney } from '@/libs/formatMoney';
// =============================================================================
// Main Page Component
// =============================================================================
// Use shared type from admin types
import type { AnalyticsResponse } from '@/types/admin';
import type { RetentionStage } from '@/types/retention';
import type { ModuleKey } from '@/types/salonPolicy';

type PromotionSettingsStage = Extract<
  RetentionStage,
  'promo_6w' | 'promo_8w'
>;

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
      tips: 0,
      taxCollected: 0,
      trend: 0,
      completed: 0,
      series: [],
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

const PERIOD_PARAM_MAP: Record<
  TimePeriod,
  'daily' | 'weekly' | 'monthly' | 'yearly'
> = {
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

/**
 * Apps that are deep-linkable via /admin?app=<id>. Opening one pushes a
 * history entry so the browser Back button closes it again.
 */
const URL_APP_IDS = [
  'bookings',
  'settings',
  'analytics',
  'clients',
  'staff',
  'services',
  'marketing',
  'reviews',
  'rewards',
  'staff-ops',
  'integrations',
] as const;

/** Bottom-nav destinations are hidden from the More grid but stay deep-linkable. */
const NAV_ONLY_APP_IDS = ['schedule', 'bookings', 'clients', 'services'];

function isUrlAppId(value: string | null): value is (typeof URL_APP_IDS)[number] {
  return value !== null && (URL_APP_IDS as readonly string[]).includes(value);
}

/** One-time notice carried back from the Google/Twilio OAuth callbacks. */
function resolveIntegrationsNotice(
  googleParam: string | null,
  twilioParam: string | null,
): string | null {
  if (googleParam === 'connected') {
    return 'Google Calendar connected. Choose which calendars Luster should use.';
  }
  if (googleParam === 'not_configured') {
    return 'Google Calendar setup is temporarily unavailable. Luster support has been notified; your bookings still work normally.';
  }
  if (googleParam === 'error') {
    return 'Google could not finish connecting. Try again.';
  }
  if (googleParam === 'expired') {
    return 'That Google connection link expired for your security. Start a fresh connection.';
  }
  if (twilioParam === 'authorized') {
    return 'Twilio authorized. Choose a phone number to finish setup.';
  }
  if (twilioParam === 'error') {
    return 'Twilio could not finish connecting. Try again.';
  }
  return null;
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
    freeSoloEnabled?: boolean;
    publicUrl?: string;
    bookingUrl?: string;
  }>;
  availableSalons?: AdminUser['salons'];
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

type AnalyticsModuleStatus =
  | 'loading'
  | 'enabled'
  | 'module_disabled'
  | 'upgrade_required'
  | 'error';

type ModuleReason = 'ENABLED' | 'MODULE_DISABLED' | 'UPGRADE_REQUIRED';

type ModuleSettingsResponse = {
  data?: {
    moduleReasons?: Partial<Record<ModuleKey, ModuleReason>>;
  };
};

function getEmptyDashboardData(): DashboardData {
  return {
    revenue: { today: 0, completed: 0, trend: 0 },
    appointments: { total: 0, completed: 0, noShows: 0, upcoming: 0 },
    openSpots: { count: 0, nextTime: null, slots: [] },
    staff: [],
    badges: { referrals: 0, reviews: 0, marketing: 0, alerts: 0 },
  };
}

function mapAnalyticsModuleStatus(
  reason: ModuleReason | undefined,
): AnalyticsModuleStatus {
  switch (reason) {
    case 'ENABLED':
      return 'enabled';
    case 'MODULE_DISABLED':
      return 'module_disabled';
    case 'UPGRADE_REQUIRED':
      return 'upgrade_required';
    default:
      return 'error';
  }
}

// Main component that uses useSearchParams (must be wrapped in Suspense)
function AdminDashboardContent() {
  const clerk = useClerk();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';
  const requestedSalonSlug
    = searchParams.get('salon')?.trim().toLowerCase() ?? null;

  // Admin auth state
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showSalonSelector, setShowSalonSelector] = useState(false);

  // Dashboard data state
  const [data, setData] = useState<DashboardData>(getEmptyDashboardData);
  const [coreAppointments, setCoreAppointments] = useState<
    DashboardData['appointments']
  >(getEmptyDashboardData().appointments);
  const [analyticsData, setAnalyticsData] = useState<PartialAnalytics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonBlockingMessage, setNonBlockingMessage] = useState<string | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);
  const [, setLastUpdated] = useState<Date | null>(null);
  const [analyticsModuleStatus, setAnalyticsModuleStatus]
    = useState<AnalyticsModuleStatus>('loading');
  const [moduleReasons, setModuleReasons] = useState<
    Partial<Record<ModuleKey, ModuleReason>>
  >({});

  // Analytics should never block rendering:
  // - Preserve last known-good analytics on transient failures
  // - Ignore out-of-order fetches
  const lastGoodAnalyticsRef = useRef<PartialAnalytics>(getEmptyAnalytics());
  const latestFetchIdRef = useRef<string>('');
  const latestModuleRequestIdRef = useRef<string>('');
  const analyticsModuleCacheRef = useRef<
    Record<string, Exclude<AnalyticsModuleStatus, 'loading' | 'error'>>
  >({});
  const moduleReasonCacheRef = useRef<
    Record<string, Partial<Record<ModuleKey, ModuleReason>>>
  >({});
  const latestResolvedModuleRef = useRef<{
    salonSlug: string;
    status: AnalyticsModuleStatus;
  } | null>(null);

  // Swipe page state
  const [workspaceTab, setWorkspaceTab] = useState<OwnerWorkspaceTab>('today');

  // Modal state
  const [activeModal, setActiveModal] = useState<AppId | null>(null);
  const [initialAppointmentId, setInitialAppointmentId] = useState<
    string | null
  >(null);
  const [initialClientId, setInitialClientId] = useState<string | null>(null);
  const [initialPromotionStage, setInitialPromotionStage]
    = useState<PromotionSettingsStage | null>(null);
  const [promotionSettingsReturnClientId, setPromotionSettingsReturnClientId]
    = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFraudSignals, setShowFraudSignals] = useState(false);
  const [showScheduleCalendar, setShowScheduleCalendar] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const activeDashboardSalonSlug
    = adminUser?.impersonation?.salonSlug
    ?? requestedSalonSlug
    ?? adminUser?.salons[0]?.slug
    ?? null;
  const activeDashboardSalon = activeDashboardSalonSlug
    ? (adminUser?.salons.find(
        s => s.slug?.toLowerCase() === activeDashboardSalonSlug.toLowerCase(),
      ) ?? null)
    : (adminUser?.salons[0] ?? null);
  const activeDashboardSalonName = activeDashboardSalon?.name ?? null;
  const activeDashboardSalonStatus = activeDashboardSalon?.status ?? null;
  const isFreeSolo = activeDashboardSalon?.freeSoloEnabled === true;

  // Fraud signals - parent owns state
  const [fraudSignals, setFraudSignals] = useState<
    import('@/components/admin/FraudSignalsModal').FraudSignal[]
  >([]);
  const [fraudSignalsTotalCount, setFraudSignalsTotalCount] = useState(0); // Total from API (for pagination)
  const [fraudSignalsLoading, setFraudSignalsLoading] = useState(true);
  const [fraudSignalsError, setFraudSignalsError] = useState<string | null>(
    null,
  );
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
  const onPrev = useCallback(
    () => setAnchorDate(a => shiftAnchor(a, timePeriod, -1)),
    [timePeriod],
  );
  const onNext = useCallback(
    () => setAnchorDate(a => shiftAnchor(a, timePeriod, +1)),
    [timePeriod],
  );
  const onToday = useCallback(
    () => setAnchorDate(getTodayYMD()),
    [getTodayYMD],
  );

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
              router.replace(
                `/${locale}/admin?salon=${encodeURIComponent(lockedSlug)}`,
              );
            }
            setShowSalonSelector(false);
          }

          // If admin has multiple salons and no salon selected, show selector
          const salonChoices = data.user.availableSalons ?? data.user.salons;
          if (
            !data.user.impersonation?.isActive
            && salonChoices.length > 1
            && !requestedSalonSlug
          ) {
            setShowSalonSelector(true);
          }

          // Sync cookie with query param if different from current salon (only once).
          // Do not hard reload; the dashboard can already render against the requested slug.
          if (
            !data.user.impersonation?.isActive
            && requestedSalonSlug
            && !hasSynced
          ) {
            setHasSynced(true);
            const syncResponse = await fetch(
              '/api/admin/auth/set-active-salon',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ salonSlug: requestedSalonSlug }),
              },
            );
            if (!syncResponse.ok) {
              const syncError = await syncResponse.json().catch(() => ({}));
              setNonBlockingMessage(
                syncError.error
                || 'The selected salon could not be synced yet for admin actions.',
              );
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
    await clerk.signOut({ redirectUrl: '/owner' });
  };

  const resetAnalyticsPresentation = useCallback(() => {
    lastGoodAnalyticsRef.current = getEmptyAnalytics();
    setAnalyticsData(null);
    setData(getEmptyDashboardData());
    setLastUpdated(null);
  }, []);

  const resolveAnalyticsModuleAvailability = useCallback(
    async (options?: { force?: boolean }): Promise<AnalyticsModuleStatus> => {
      if (!activeDashboardSalonSlug) {
        setAnalyticsModuleStatus('error');
        resetAnalyticsPresentation();
        setLoading(false);
        return 'error';
      }

      const force = options?.force ?? false;
      const cached = !force
        ? analyticsModuleCacheRef.current[activeDashboardSalonSlug]
        : undefined;
      if (cached) {
        setModuleReasons(
          moduleReasonCacheRef.current[activeDashboardSalonSlug] ?? {},
        );
        latestResolvedModuleRef.current = {
          salonSlug: activeDashboardSalonSlug,
          status: cached,
        };
        resetAnalyticsPresentation();
        setNonBlockingMessage(null);
        setAnalyticsModuleStatus(cached);
        if (cached === 'enabled') {
          setLoading(true);
        } else {
          setLoading(false);
        }
        return cached;
      }

      if (
        !force
        && latestResolvedModuleRef.current?.salonSlug
        === activeDashboardSalonSlug
        && latestResolvedModuleRef.current.status !== 'loading'
      ) {
        return latestResolvedModuleRef.current.status;
      }

      const requestId = crypto.randomUUID();
      latestModuleRequestIdRef.current = requestId;
      setAnalyticsModuleStatus('loading');
      setNonBlockingMessage(null);
      setLoading(true);
      resetAnalyticsPresentation();

      try {
        const response = await fetch(
          `/api/admin/settings/modules?salonSlug=${encodeURIComponent(activeDashboardSalonSlug)}`,
        );
        const body = (await response
          .json()
          .catch(() => null)) as ModuleSettingsResponse | null;
        if (!response.ok) {
          throw new Error('Failed to load analytics module availability');
        }

        const nextStatus = mapAnalyticsModuleStatus(
          body?.data?.moduleReasons?.analyticsDashboard,
        );
        const nextModuleReasons = body?.data?.moduleReasons ?? {};

        if (latestModuleRequestIdRef.current !== requestId) {
          return nextStatus;
        }

        setAnalyticsModuleStatus(nextStatus);
        setModuleReasons(nextModuleReasons);
        moduleReasonCacheRef.current[activeDashboardSalonSlug]
          = nextModuleReasons;
        latestResolvedModuleRef.current = {
          salonSlug: activeDashboardSalonSlug,
          status: nextStatus,
        };
        if (
          nextStatus === 'enabled'
          || nextStatus === 'module_disabled'
          || nextStatus === 'upgrade_required'
        ) {
          analyticsModuleCacheRef.current[activeDashboardSalonSlug]
            = nextStatus;
        }

        if (nextStatus !== 'enabled') {
          setLoading(false);
        }

        return nextStatus;
      } catch {
        if (latestModuleRequestIdRef.current !== requestId) {
          return 'error';
        }

        setAnalyticsModuleStatus('error');
        setModuleReasons({});
        latestResolvedModuleRef.current = {
          salonSlug: activeDashboardSalonSlug,
          status: 'error',
        };
        setLoading(false);
        return 'error';
      }
    },
    [activeDashboardSalonSlug, resetAnalyticsPresentation],
  );

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
      setFraudSignalsTotalCount(
        result.data.unresolvedCount ?? result.data.signals.length,
      );
    } catch {
      setFraudSignalsError('Failed to load fraud signals');
    } finally {
      setFraudSignalsLoading(false);
    }
  }, []);

  // Fetch dashboard data from analytics API
  const fetchData = useCallback(
    async (options?: { skipModuleCheck?: boolean }) => {
      if (
        !activeDashboardSalonSlug
        || (!options?.skipModuleCheck && analyticsModuleStatus !== 'enabled')
      ) {
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
          const analyticsResponse = await fetch(
            `/api/admin/analytics?salonSlug=${activeDashboardSalonSlug}&period=${period}&anchor=${encodeURIComponent(anchorDate)}`,
          );

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

            if (analyticsResponse.status === 403) {
              const errorCode = parsed?.error?.code;
              if (
                errorCode === 'MODULE_DISABLED'
                || errorCode === 'UPGRADE_REQUIRED'
              ) {
                const nextStatus
                  = errorCode === 'MODULE_DISABLED'
                    ? 'module_disabled'
                    : 'upgrade_required';
                analyticsModuleCacheRef.current[activeDashboardSalonSlug]
                  = nextStatus;
                latestResolvedModuleRef.current = {
                  salonSlug: activeDashboardSalonSlug,
                  status: nextStatus,
                };
                setAnalyticsModuleStatus(nextStatus);
                setNonBlockingMessage(null);
                resetAnalyticsPresentation();
                setLoading(false);
                return;
              }

              analyticsNonBlockingMessage = null;
              analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
            } else if (analyticsResponse.status === 404) {
              analyticsNonBlockingMessage = null;
              analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
            } else {
              // Unexpected failures: still render (with last good), but log + mild banner
              const errBody = parsed ?? (text ? text.slice(0, 500) : null);
              console.error('[AdminDashboard] analytics failed', {
                status: analyticsResponse.status,
                errBody,
              });
              analyticsNonBlockingMessage
                = 'Some dashboard analytics are temporarily unavailable.';
              analytics = lastGoodAnalyticsRef.current ?? getEmptyAnalytics();
            }
          }
        } catch (e) {
          // Network failure, JSON parse crash, etc.
          console.error('[AdminDashboard] analytics request crashed', e);
          analyticsNonBlockingMessage
            = 'Some dashboard analytics are temporarily unavailable.';
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
        const staffStatus = (analytics?.staff || [])
          .slice(0, 3)
          .map((tech: { name: string; appointmentCount: number }) => ({
            name: tech.name.split(' ')[0] || tech.name,
            status:
              tech.appointmentCount > 0
                ? 'busy'
                : ('free' as 'busy' | 'free' | 'break'),
            detail:
              tech.appointmentCount > 0
                ? `${tech.appointmentCount} appts`
                : undefined,
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
          staff: staffStatus.length > 0 ? staffStatus : [],
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
    },
    [
      activeDashboardSalonSlug,
      timePeriod,
      anchorDate,
      locale,
      router,
      analyticsModuleStatus,
      resetAnalyticsPresentation,
    ],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (
      !authLoading
      && adminUser
      && !showSalonSelector
      && activeDashboardSalonSlug
    ) {
      resolveAnalyticsModuleAvailability().catch(() => {
        setAnalyticsModuleStatus('error');
        setLoading(false);
      });
    }
  }, [
    authLoading,
    adminUser,
    showSalonSelector,
    activeDashboardSalonSlug,
    resolveAnalyticsModuleAvailability,
  ]);

  useEffect(() => {
    const handleFeatureUpdate = (event: StorageEvent) => {
      if (
        event.key !== 'luster:feature-access-updated'
        || !event.newValue
        || !activeDashboardSalonSlug
      ) {
        return;
      }
      try {
        const payload = JSON.parse(event.newValue) as {
          salonSlug?: string | null;
        };
        if (
          payload.salonSlug
          && payload.salonSlug.toLowerCase()
          !== activeDashboardSalonSlug.toLowerCase()
        ) {
          return;
        }
      } catch {
        return;
      }
      delete analyticsModuleCacheRef.current[activeDashboardSalonSlug];
      delete moduleReasonCacheRef.current[activeDashboardSalonSlug];
      latestResolvedModuleRef.current = null;
      void resolveAnalyticsModuleAvailability({ force: true });
    };
    window.addEventListener('storage', handleFeatureUpdate);
    return () => window.removeEventListener('storage', handleFeatureUpdate);
  }, [activeDashboardSalonSlug, resolveAnalyticsModuleAvailability]);

  // Core operational counts must load independently of the optional analytics entitlement.
  useEffect(() => {
    if (
      authLoading
      || !adminUser
      || showSalonSelector
      || !activeDashboardSalonSlug
    ) {
      return;
    }
    const controller = new AbortController();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fetch(
      `/api/admin/appointments?date=${date}&status=pending,confirmed,in_progress,completed,no_show`,
      { signal: controller.signal },
    )
      .then(async response =>
        response.ok
          ? response.json()
          : Promise.reject(new Error('Core appointments unavailable')),
      )
      .then((payload) => {
        const appointments = (payload.data?.appointments ?? []) as Array<{
          status: string;
          startTime: string;
        }>;
        setCoreAppointments({
          total: appointments.length,
          completed: appointments.filter(item => item.status === 'completed')
            .length,
          noShows: appointments.filter(item => item.status === 'no_show')
            .length,
          upcoming: appointments.filter(
            item =>
              ['pending', 'confirmed', 'in_progress'].includes(item.status)
              && new Date(item.startTime) >= now,
          ).length,
        });
      })
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name !== 'AbortError') {
          setNonBlockingMessage(
            'Today’s appointment count could not be refreshed. Your calendar and bookings are still available.',
          );
        }
      });
    return () => controller.abort();
  }, [activeDashboardSalonSlug, adminUser, authLoading, showSalonSelector]);

  // Fetch analytics only when module availability is explicitly enabled
  useEffect(() => {
    if (
      !authLoading
      && adminUser
      && !showSalonSelector
      && analyticsModuleStatus === 'enabled'
    ) {
      fetchData();
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [
    authLoading,
    adminUser,
    showSalonSelector,
    analyticsModuleStatus,
    fetchData,
  ]);

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

  // Apps hidden from the More grid: bottom-nav destinations always, plus
  // anything the salon's module entitlements do not allow.
  const hiddenAppIds = useMemo(() => {
    const moduleIsEnabled = (module: ModuleKey) =>
      moduleReasons[module] === 'ENABLED';
    const staffToolsEnabled
      = moduleIsEnabled('scheduleOverrides') || moduleIsEnabled('staffEarnings');
    const hidden: string[] = [...NAV_ONLY_APP_IDS];
    if (!moduleIsEnabled('analyticsDashboard')) {
      hidden.push('analytics');
    }
    // Retention settings and editable native Messages drafts are core Luster
    // tools, including Free Luster. They do not depend on the paid Twilio SMS,
    // referral, or rewards entitlements that previously hid this app tile.
    if (!moduleIsEnabled('rewards')) {
      hidden.push('rewards');
    }
    if (isFreeSolo) {
      hidden.push('reviews');
    }
    if (isFreeSolo && !staffToolsEnabled) {
      hidden.push('staff', 'staff-ops');
    }
    return hidden;
  }, [moduleReasons, isFreeSolo]);

  // Role/entitlement restrictions also apply to deep links — nav-only apps
  // stay reachable via URL because their bottom-nav tabs are always allowed.
  const urlBlockedAppIds = useMemo(
    () => hiddenAppIds.filter(id => !NAV_ONLY_APP_IDS.includes(id)),
    [hiddenAppIds],
  );

  const buildAdminUrl = useCallback(
    (app: string | null) => {
      const qs = new URLSearchParams();
      if (requestedSalonSlug) {
        qs.set('salon', requestedSalonSlug);
      }
      if (app) {
        qs.set('app', app);
      }
      const query = qs.toString();
      return `/${locale}/admin${query ? `?${query}` : ''}`;
    },
    [locale, requestedSalonSlug],
  );

  /** Open an app through the URL so it is deep-linkable and Back closes it. */
  const openAppViaUrl = useCallback(
    (appId: string) => {
      router.push(buildAdminUrl(appId));
    },
    [router, buildAdminUrl],
  );

  // Tracks the app opened from the URL (vs. modals opened by tab/state flows)
  const urlOpenedAppRef = useRef<string | null>(null);
  // Tracks the last ?app value we reacted to, so state-driven modal switches
  // (e.g. promotion settings hopping marketing→clients) are left alone.
  const lastAppParamRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (authLoading || !adminUser || analyticsModuleStatus === 'loading') {
      return;
    }
    const appParam = searchParams.get('app');
    // Salon notification emails deep-link to a single appointment. The
    // appointment id is part of the guard key so two alerts for different
    // appointments both open, even though they share ?app=bookings.
    const appointmentParam = searchParams.get('appointment')?.trim() || null;
    const appKey = `${appParam ?? ''}|${appointmentParam ?? ''}`;
    if (lastAppParamRef.current === appKey) {
      return;
    }
    lastAppParamRef.current = appKey;
    if (isUrlAppId(appParam) && !urlBlockedAppIds.includes(appParam)) {
      urlOpenedAppRef.current = appParam;
      setInitialAppointmentId(
        appParam === 'bookings' ? appointmentParam : null,
      );
      setInitialClientId(null);
      setInitialPromotionStage(null);
      setPromotionSettingsReturnClientId(null);
      setShowScheduleCalendar(false);
      setWorkspaceTab('more');
      setActiveModal(appParam);
    } else if (!appParam) {
      // URL lost its app segment (browser Back, or a close that stripped it):
      // close the modal we opened from the URL. Capture the ref value before
      // clearing it — the state updater runs later, during render.
      const urlOpenedApp = urlOpenedAppRef.current;
      if (urlOpenedApp) {
        urlOpenedAppRef.current = null;
        setActiveModal(current => (current === urlOpenedApp ? null : current));
      }
    }
  }, [
    searchParams,
    authLoading,
    adminUser,
    analyticsModuleStatus,
    urlBlockedAppIds,
  ]);

  // Handle app tile tap - grid apps open via URL (deep-linkable, Back closes)
  const handleAppTap = (appId: AppId) => {
    if (appId === 'luster') {
      router.push(
        `/${locale}/admin/luster${activeDashboardSalonSlug ? `?salon=${encodeURIComponent(activeDashboardSalonSlug)}` : ''}`,
      );
    } else if (appId === 'schedule') {
      setShowScheduleCalendar(true);
    } else {
      if (appId === 'clients') {
        setInitialClientId(null);
      }
      if (appId === 'marketing') {
        setInitialPromotionStage(null);
        setPromotionSettingsReturnClientId(null);
      }
      openAppViaUrl(appId);
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
        setInitialPromotionStage(null);
        setPromotionSettingsReturnClientId(null);
        setActiveModal('marketing');
        break;
      case 'today-schedule':
        setShowScheduleCalendar(true);
        break;
      case 'view-bookings':
        setActiveModal('bookings');
        break;
      default:
        break;
    }
  }, []);

  const handleRefreshAnalytics = useCallback(async () => {
    const nextStatus = await resolveAnalyticsModuleAvailability({
      force: true,
    });
    if (nextStatus === 'enabled') {
      await fetchData({ skipModuleCheck: true });
    }
  }, [fetchData, resolveAnalyticsModuleAvailability]);

  const handleWorkspaceTab = useCallback((tab: OwnerWorkspaceTab) => {
    setShowScheduleCalendar(false);
    setActiveModal(null);
    setInitialPromotionStage(null);
    setPromotionSettingsReturnClientId(null);
    if (urlOpenedAppRef.current) {
      urlOpenedAppRef.current = null;
      router.replace(buildAdminUrl(null));
    }
    setWorkspaceTab(tab);
    const resetOwnerViewport = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    resetOwnerViewport();
    // AppModal restores the page scroll position during its cleanup. Repeat the
    // reset after React has unmounted it so bottom-navigation changes can never
    // reopen a workspace at the old, blank scroll position.
    window.requestAnimationFrame(() => {
      resetOwnerViewport();
      window.requestAnimationFrame(resetOwnerViewport);
    });
    if (tab === 'calendar') {
      setShowScheduleCalendar(true);
      return;
    }
    if (tab === 'clients') {
      setInitialClientId(null);
      setActiveModal('clients');
      return;
    }
    if (tab === 'services') {
      setActiveModal('services');
    }
  }, [router, buildAdminUrl]);

  // Close modal
  const handleCloseModal = () => {
    setActiveModal(null);
    setInitialAppointmentId(null);
    setInitialClientId(null);
    setInitialPromotionStage(null);
    setPromotionSettingsReturnClientId(null);
    // If this modal was opened through the URL, strip ?app so the address bar,
    // history, and reloads stay truthful.
    if (urlOpenedAppRef.current) {
      urlOpenedAppRef.current = null;
      router.replace(buildAdminUrl(null));
    }
  };

  const handleClosePromotionSettings = () => {
    const returnClientId = promotionSettingsReturnClientId;
    setInitialPromotionStage(null);
    setPromotionSettingsReturnClientId(null);
    if (returnClientId) {
      setInitialAppointmentId(null);
      setInitialClientId(returnClientId);
      setActiveModal('clients');
      return;
    }
    handleCloseModal();
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
  const selectableSalons = adminUser.availableSalons ?? adminUser.salons;
  if (
    !adminUser.impersonation?.isActive
    && showSalonSelector
    && selectableSalons.length > 1
  ) {
    return (
      <AdminSalonSelector
        salons={selectableSalons}
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

  const staffData
    = analyticsData?.staff?.slice(0, 5).map((tech, index) => ({
      id: index + 1,
      name: tech.name,
      role: tech.role || 'Technician',
      revenue: formatMoney(tech.revenue),
      avatarColor: avatarColors[index % avatarColors.length]!,
    })) || [];

  // Utilization data - use real data from API
  const utilization
    = analyticsData?.staff?.slice(0, 3).map(tech => ({
      name: tech.name.substring(0, 3),
      percent: tech.utilization,
      color: tech.color,
    })) || [];

  // Service mix data - use real data from API
  const services
    = analyticsData?.services?.slice(0, 4).map(svc => ({
      label: svc.label,
      percent: svc.percent,
      color: svc.color,
    })) || [];

  const analyticsUnavailableState
    = analyticsModuleStatus === 'module_disabled'
      ? {
          title: 'Analytics dashboard is turned off for this salon.',
          description:
            'Enable the analytics dashboard module in Settings to view performance and service mix here.',
          tone: 'neutral' as const,
        }
      : analyticsModuleStatus === 'upgrade_required'
        ? {
            title: 'Analytics dashboard is not included for this salon.',
            description:
              'This salon does not currently have analytics dashboard access enabled.',
            tone: 'warning' as const,
          }
        : analyticsModuleStatus === 'error'
          ? {
              title: 'Analytics availability could not be loaded right now.',
              description: 'Pull to refresh and try again.',
              tone: 'warning' as const,
            }
          : null;

  return (
    <div
      className="min-h-screen bg-[#F8F3F0] font-sans text-stone-950"
      style={{
        opacity: mounted ? 1 : 0,
        transition: 'opacity 300ms ease-out',
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
        <div className="mx-auto max-w-2xl px-5 pb-3 pt-4">
          <WorkspacePageHeader
            title="Luster Workspace"
            subtitle={
              activeDashboardSalonName
                ? `Managing ${activeDashboardSalonName}`
                : 'Salon owner workspace'
            }
            titleClassName="text-[28px] font-bold tracking-tight text-stone-950"
            subtitleClassName="text-[15px] text-stone-500"
            actions={(
              <>
                {!adminUser.impersonation?.isActive
                && selectableSalons.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowSalonSelector(true)}
                    aria-label="Switch salon"
                    className="flex size-9 items-center justify-center rounded-full border border-rose-100 bg-white text-rose-800 shadow-sm transition-colors active:bg-rose-50"
                  >
                    <Building2 size={19} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotifications(true)}
                  className="relative flex size-9 items-center justify-center rounded-full border border-rose-100 bg-white text-rose-800 shadow-sm transition-colors active:bg-rose-50"
                >
                  <Bell size={20} />
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
                <div
                  className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-rose-800 to-amber-500 text-[15px] font-semibold text-white shadow-sm"
                  title="Luster owner account"
                >
                  {userInitial || <Sparkles size={16} />}
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

        {workspaceTab === 'more'
          ? (
              <div
                className="min-h-[calc(100vh-140px)] pb-24"
                data-testid="owner-more-workspace"
              >
                <AppGrid
                  theme="apple"
                  badges={appBadges}
                  onAppTap={handleAppTap}
                  hiddenIds={hiddenAppIds}
                />
              </div>
            )
          : (
              <OwnerTodayWorkspace
                salonSlug={activeDashboardSalonSlug || ''}
                appointments={
                  analyticsModuleStatus === 'enabled'
                    ? data.appointments
                    : coreAppointments
                }
                analyticsTitle={analyticsUnavailableState?.title}
                analyticsMessage={analyticsUnavailableState?.description}
                onRefreshAnalytics={
                  analyticsUnavailableState ? handleRefreshAnalytics : undefined
                }
                onQuickAction={handleQuickAction}
                onOpenBookings={() => setActiveModal('bookings')}
                onOpenCalendar={() => setShowScheduleCalendar(true)}
                onOpenIntegrations={() => openAppViaUrl('integrations')}
                onOpenAppointment={(appointmentId) => {
                  setInitialClientId(null);
                  setInitialAppointmentId(appointmentId);
                  setActiveModal('bookings');
                }}
                onOpenClient={(clientId) => {
                  setInitialAppointmentId(null);
                  setInitialClientId(clientId);
                  setInitialPromotionStage(null);
                  setPromotionSettingsReturnClientId(null);
                  setActiveModal('clients');
                }}
              />
            )}

        <OwnerWorkspaceNav
          active={workspaceTab}
          onSelect={handleWorkspaceTab}
        />
      </div>

      <AdminModalHost
        activeModal={activeModal}
        activeSalonSlug={activeDashboardSalonSlug}
        activeSalonId={activeDashboardSalon?.id ?? null}
        onOpenApp={openAppViaUrl}
        analyticsAppAvailable={!hiddenAppIds.includes('analytics')}
        activeSalonName={activeDashboardSalon?.name ?? null}
        onOpenMarketingClient={(clientId) => {
          setInitialAppointmentId(null);
          setInitialClientId(clientId);
          setInitialPromotionStage(null);
          setPromotionSettingsReturnClientId(null);
          setActiveModal('clients');
        }}
        isFreeSolo={isFreeSolo}
        onCloseModal={handleCloseModal}
        initialAppointmentId={initialAppointmentId}
        initialClientId={initialClientId}
        initialPromotionStage={initialPromotionStage}
        onOpenPromotionSettings={(stage, clientId) => {
          setInitialAppointmentId(null);
          setInitialClientId(clientId);
          setInitialPromotionStage(stage);
          setPromotionSettingsReturnClientId(clientId);
          setActiveModal('marketing');
        }}
        onClosePromotionSettings={handleClosePromotionSettings}
        integrationsInitialView={
          searchParams.get('google')
            ? 'google'
            : searchParams.get('twilio')
              ? 'texting'
              : 'home'
        }
        integrationsNotice={resolveIntegrationsNotice(
          searchParams.get('google'),
          searchParams.get('twilio'),
        )}
        onOpenSettingsFromIntegrations={() => openAppViaUrl('settings')}
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
