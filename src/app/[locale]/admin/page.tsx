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

import { useAuth, useClerk } from '@clerk/nextjs';
import { MotionConfig } from 'framer-motion';
import { Bell, Building2, Sparkles } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminImpersonationBanner } from '@/components/admin/AdminImpersonationBanner';
import { AdminModalHost } from '@/components/admin/AdminModalHost';
import type { TimePeriod } from '@/components/admin/AnalyticsWidgets';
import { AppGrid, type AppId, APPS } from '@/components/admin/AppGrid';
import { AdminDashboardNoticeStack } from '@/components/admin/dashboard/AdminDashboardNoticeStack';
import { AdminDashboardSkeleton } from '@/components/admin/dashboard/AdminDashboardSkeleton';
import { AdminSalonSelector } from '@/components/admin/dashboard/AdminSalonSelector';
import { NewAppointmentModal } from '@/components/admin/NewAppointmentModal';
import { OnboardingWorkspaceHandoff } from '@/components/admin/onboarding/OnboardingWorkspaceHandoff';
import {
  WorkspaceQuickTour,
  type WorkspaceTourTarget,
} from '@/components/admin/onboarding/WorkspaceQuickTour';
import { OwnerTodayWorkspace } from '@/components/admin/OwnerTodayWorkspace';
import {
  OwnerWorkspaceNav,
  type OwnerWorkspaceTab,
} from '@/components/admin/OwnerWorkspaceNav';
import { LuckyCharmLoader } from '@/components/loading/LuckyCharmLoader';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';
import { formatMoney } from '@/libs/formatMoney';
// =============================================================================
// Main Page Component
// =============================================================================
// Use shared type from admin types
import type { AnalyticsResponse } from '@/types/admin';
import type { RetentionStage } from '@/types/retention';
import type { ModuleKey } from '@/types/salonPolicy';
import { cn } from '@/utils/Helpers';

import { useOwnerAdminFeatureFlags } from './OwnerAdminFeatureFlags';

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
      trendAvailable: false,
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
  // The Calendar is a workspace destination, not a transient overlay: it is
  // addressable (?app=schedule), survives a reload, and Back closes it.
  'schedule',
  'settings',
  'analytics',
  'clients',
  'staff',
  'services',
  'marketing',
  'reviews',
  'rewards',
  'rewards-reviews',
  'staff-ops',
  'team',
  'payments',
  'integrations',
  // Photos & Gallery: the More tile and the Booking Page hub both open the
  // shared Portfolio library through this URL.
  'portfolio',
] as const;

/**
 * Bottom-nav destinations. They are hidden from the More grid, and each one is
 * listed in URL_APP_IDS above, so a deep link to any of them always opens.
 * Entitlement rules never block them: their bottom-nav tabs are always allowed.
 */
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
    trendAvailable: boolean;
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
    revenue: {
      today: 0,
      completed: 0,
      trend: 0,
      trendAvailable: false,
    },
    appointments: { total: 0, completed: 0, noShows: 0, upcoming: 0 },
    openSpots: { count: 0, nextTime: null, slots: [] },
    staff: [],
    badges: { referrals: 0, reviews: 0, marketing: 0, alerts: 0 },
  };
}

/**
 * The auth phase must always end. Clerk's browser SDK can fail to load
 * (blocked script, captive network, provider incident) and then `clerkLoaded`
 * never flips, so nothing but this bound can clear the loading state.
 */
const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;

const AUTH_UNREACHABLE_MESSAGE
  = 'We can’t reach the sign-in service right now. Check your connection and try again.';

/** Modules that gate a deep-linkable app, for the "not on your plan" wording. */
const GATED_APP_MODULES: Partial<Record<string, ModuleKey[]>> = {
  'analytics': ['analyticsDashboard'],
  'rewards': ['rewards'],
  'rewards-reviews': ['rewards'],
  'staff': ['scheduleOverrides', 'staffEarnings'],
  'staff-ops': ['scheduleOverrides', 'staffEarnings'],
  'team': ['scheduleOverrides', 'staffEarnings'],
};

/** Explain a deep link to an app this salon cannot open, in the owner's words. */
function describeBlockedApp(
  appId: string,
  moduleReasons: Partial<Record<ModuleKey, ModuleReason>>,
): string {
  const legacyName = appId === 'staff' || appId === 'staff-ops'
    ? 'Team'
    : appId === 'rewards' || appId === 'reviews'
      ? 'Rewards & Reviews'
      : null;
  const appName = APPS.find(app => app.id === appId)?.name ?? legacyName ?? 'That app';
  const turnedOff = (GATED_APP_MODULES[appId] ?? []).some(
    module => moduleReasons[module] === 'MODULE_DISABLED',
  );
  return turnedOff
    ? `${appName} is turned off for this salon. Turn it back on in Settings to open it here.`
    : `${appName} isn’t included in your plan yet.`;
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
  const { onboardingV1IntegrationEnabled } = useOwnerAdminFeatureFlags();
  const clerk = useClerk();
  const { getToken, isLoaded: clerkLoaded, isSignedIn, sessionId } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';
  const requestedSalonSlug
    = searchParams.get('salon')?.trim().toLowerCase() ?? null;

  // Admin auth state
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
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
  const [workspaceTab, setWorkspaceTab] = useState<OwnerWorkspaceTab>(() => searchParams.get('tab') === 'more' ? 'more' : 'today');
  const [onboardingHandoffAvailable, setOnboardingHandoffAvailable]
    = useState(false);
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);

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
  // Set when "New Appt" is used, so the create form opens on that day directly.
  const [newAppointmentDate, setNewAppointmentDate] = useState<Date | null>(
    null,
  );
  // Explains a deep link to an app this salon cannot open (entitlement-gated).
  const [blockedAppNotice, setBlockedAppNotice] = useState<string | null>(null);
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
  useEffect(() => {
    setOnboardingHandoffAvailable(false);
    setBlockedAppNotice(null);
    if (!onboardingV1IntegrationEnabled) {
      setShowOnboardingTour(false);
    }
  }, [activeDashboardSalonSlug, onboardingV1IntegrationEnabled]);

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

  // Sync each selected salon/session without retriggering the auth request.
  const syncedSalonSessionRef = useRef<string | null>(null);

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

  // Clerk's instance identity is not stable in every host, so keep the latest
  // one in a ref instead of making the auth effect depend on it.
  const clerkRef = useRef(clerk);
  useEffect(() => {
    clerkRef.current = clerk;
  });

  // Check admin auth on mount and sync salon cookie
  useEffect(() => {
    let cancelled = false;
    let serverAuthenticated = false;
    let settled = false;
    setAuthLoading(true);
    setAuthError(null);
    setAdminUser(null);

    // Never leave the owner on a bare spinner: the auth phase ends either when
    // it resolves, when Clerk reports it could not load, or on this bound.
    let bootstrapTimer: number | undefined;
    const settleAuthPhase = () => {
      settled = true;
      window.clearTimeout(bootstrapTimer);
    };
    const failUnreachable = () => {
      if (cancelled || settled) {
        return;
      }
      settleAuthPhase();
      setAuthError(AUTH_UNREACHABLE_MESSAGE);
      setAuthLoading(false);
    };
    bootstrapTimer = window.setTimeout(
      failUnreachable,
      AUTH_BOOTSTRAP_TIMEOUT_MS,
    );

    // Clerk publishes its own load failure (failed_to_load_clerk_js_timeout)
    // as an 'error' status where the SDK supports the stream; treat it as
    // terminal so the reconnect card appears without waiting out the bound.
    const clerkStatusClient = clerkRef.current as unknown as {
      status?: string;
      on?: (event: string, handler: (status: string) => void) => void;
      off?: (event: string, handler: (status: string) => void) => void;
    } | null;
    const handleClerkStatus = (status: string) => {
      if (status === 'error') {
        failUnreachable();
      }
    };
    if (typeof clerkStatusClient?.on === 'function') {
      clerkStatusClient.on('status', handleClerkStatus);
    }
    if (clerkStatusClient?.status === 'error') {
      handleClerkStatus('error');
    }

    function handleAuthFailure() {
      if (cancelled || !clerkLoaded) {
        return;
      }
      if (isSignedIn) {
        // Redirecting an already signed-in owner back to sign-in can bounce
        // straight here again. Keep a bounded retry instead of a redirect loop.
        setAuthError('We couldn’t connect to your account yet. Try again, or sign out and sign back in.');
      } else {
        router.replace(`/${locale}/admin-login`);
      }
    }

    async function checkAuth() {
      try {
        // After signup, Safari can reach this page before Clerk's session cookie
        // has refreshed. Prepare the current session before the cookie-only API
        // check. A successful server check also permits legacy/impersonation
        // sessions even when Clerk's browser SDK has not loaded. An early 401
        // waits for Clerk readiness instead of redirecting a signing-in owner.
        if (clerkLoaded && isSignedIn) {
          const token = await getToken({ skipCache: true });
          if (cancelled) {
            return;
          }
          if (!token) {
            handleAuthFailure();
            return;
          }
        }
        const adminMeUrl = requestedSalonSlug
          ? `/api/admin/auth/me?salonSlug=${encodeURIComponent(requestedSalonSlug)}`
          : '/api/admin/auth/me';
        let response = await fetch(adminMeUrl);
        if (cancelled) {
          return;
        }
        // A `?salon=` deep link (an email alert, a shared appointment URL) asks
        // for a salon-SCOPED session check. That check can refuse before the
        // active salon has been set for this session, and a refusal there means
        // "not this salon yet", NOT "signed out" — bouncing the owner to
        // sign-in loses the link they followed (audit AG-w2-appointments-03).
        // So: re-probe the session without the salon scope, and if the session
        // is in fact valid, set the active salon from the URL and ask again.
        if (!response.ok && requestedSalonSlug && (response.status === 401 || response.status === 403)) {
          const unscoped = await fetch('/api/admin/auth/me');
          if (cancelled) {
            return;
          }
          if (unscoped.ok) {
            const syncResponse = await fetch('/api/admin/auth/set-active-salon', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ salonSlug: requestedSalonSlug }),
            });
            if (cancelled) {
              return;
            }
            if (syncResponse.ok) {
              syncedSalonSessionRef.current = `${sessionId ?? 'legacy'}:${requestedSalonSlug}`;
              response = await fetch(adminMeUrl);
              if (cancelled) {
                return;
              }
            }
            if (!response.ok) {
              // The session is genuinely signed in; it just cannot open this
              // salon. Keep the owner in the workspace on the salon they can
              // reach and say why, instead of sending them to sign-in.
              response = unscoped;
              setNonBlockingMessage(
                'That link points to a salon this account cannot open. Showing your own workspace instead.',
              );
              // Drop the unreachable slug so every scoped request below resolves
              // against a salon this session actually has.
              router.replace(`/${locale}/admin`);
            }
          }
        }
        if (response.ok) {
          const data = await response.json();
          if (cancelled) {
            return;
          }
          serverAuthenticated = true;
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

          // Sync cookie with the query param once per selected salon/session.
          // Do not hard reload; the dashboard can already render against the requested slug.
          const salonSessionKey = `${sessionId ?? 'legacy'}:${requestedSalonSlug}`;
          if (
            !data.user.impersonation?.isActive
            && requestedSalonSlug
            && syncedSalonSessionRef.current !== salonSessionKey
          ) {
            const syncResponse = await fetch(
              '/api/admin/auth/set-active-salon',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ salonSlug: requestedSalonSlug }),
              },
            );
            if (cancelled) {
              return;
            }
            if (!syncResponse.ok) {
              const syncError = await syncResponse.json().catch(() => ({}));
              if (cancelled) {
                return;
              }
              setNonBlockingMessage(
                syncError.error
                || 'The selected salon could not be synced yet for admin actions.',
              );
            } else {
              syncedSalonSessionRef.current = salonSessionKey;
              router.refresh();
            }
          }
        } else {
          handleAuthFailure();
        }
      } catch {
        handleAuthFailure();
        return;
      } finally {
        if (!cancelled && !settled && (clerkLoaded || serverAuthenticated)) {
          settleAuthPhase();
          setAuthLoading(false);
        }
      }
    }
    checkAuth();
    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      if (typeof clerkStatusClient?.off === 'function') {
        clerkStatusClient.off('status', handleClerkStatus);
      }
    };
  }, [authAttempt, clerkLoaded, getToken, isSignedIn, router, locale, requestedSalonSlug, sessionId]);

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
        setLoading(false);
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

        setLoading(false);

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
            trendAvailable: analytics?.revenue?.trendAvailable ?? false,
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
      `/api/admin/appointments?date=${date}&status=pending,confirmed,in_progress,awaiting_payment,completed,no_show`,
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

  // Advanced analytics is optional and potentially expensive. Load it only
  // while its entitled surface is actually visible, never for Owner Today.
  useEffect(() => {
    if (
      !authLoading
      && adminUser
      && !showSalonSelector
      && analyticsModuleStatus === 'enabled'
      && activeModal === 'analytics'
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
    activeModal,
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
    if (!moduleIsEnabled('rewards') && isFreeSolo) {
      hidden.push('rewards-reviews');
    }
    if (isFreeSolo && !staffToolsEnabled) {
      hidden.push('team', 'staff', 'staff-ops');
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
      // Keep the workspace URL salon-specific however the shell was entered:
      // the post-sign-in landing is /admin with no ?salon=, and dropping the
      // segment made every copied/bookmarked app link resolve from the
      // active-salon cookie instead of the salon the owner was looking at.
      // While the salon selector is still pending there is no answer yet, so
      // the param stays out rather than silently picking the first salon.
      const salonSlug = requestedSalonSlug
        ?? (showSalonSelector ? null : activeDashboardSalonSlug);
      if (salonSlug) {
        qs.set('salon', salonSlug);
      }
      if (app) {
        qs.set('app', app);
      }
      const query = qs.toString();
      return `/${locale}/admin${query ? `?${query}` : ''}`;
    },
    [locale, requestedSalonSlug, activeDashboardSalonSlug, showSalonSelector],
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
    const viewParam = searchParams.get('view');

    // Keep old bookmarked Settings destinations working while giving each
    // control one canonical app. Replace (rather than push) so Back does not
    // return the owner to the retired duplicate location.
    if (appParam === 'settings' && viewParam === 'payments') {
      router.replace(buildAdminUrl('payments'));
      return;
    }
    if (appParam === 'settings' && viewParam === 'visibility') {
      router.replace(`${buildAdminUrl('team')}&view=permissions`);
      return;
    }
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
      setBlockedAppNotice(null);
      urlOpenedAppRef.current = appParam;
      setInitialAppointmentId(
        appParam === 'bookings' ? appointmentParam : null,
      );
      setInitialClientId(null);
      setInitialPromotionStage(null);
      setPromotionSettingsReturnClientId(null);
      if (appParam === 'schedule') {
        // The calendar is its own workspace destination, not a More app: it
        // opens on the Calendar tab rather than behind the More grid.
        setActiveModal(null);
        setWorkspaceTab('calendar');
        setShowScheduleCalendar(true);
        return;
      }
      setShowScheduleCalendar(false);
      setWorkspaceTab('more');
      setActiveModal(appParam);
    } else if (isUrlAppId(appParam)) {
      // A known app this salon is not entitled to. Explain it in the workspace
      // instead of dropping the link silently, and stop the address bar
      // advertising an app that is not open.
      setBlockedAppNotice(describeBlockedApp(appParam, moduleReasons));
      setWorkspaceTab('more');
      router.replace(buildAdminUrl(null));
    } else if (!appParam) {
      // URL lost its app segment (browser Back, or a close that stripped it):
      // close the modal we opened from the URL. Capture the ref value before
      // clearing it — the state updater runs later, during render.
      const urlOpenedApp = urlOpenedAppRef.current;
      if (urlOpenedApp === 'schedule') {
        urlOpenedAppRef.current = null;
        setShowScheduleCalendar(false);
        setWorkspaceTab('today');
      } else if (urlOpenedApp) {
        urlOpenedAppRef.current = null;
        setActiveModal(current => (current === urlOpenedApp ? null : current));
      }
    }
  }, [
    searchParams,
    authLoading,
    adminUser,
    analyticsModuleStatus,
    buildAdminUrl,
    moduleReasons,
    router,
    urlBlockedAppIds,
  ]);

  // Handle app tile tap - grid apps open via URL (deep-linkable, Back closes)
  const handleAppTap = (appId: AppId) => {
    if (appId === 'luster') {
      router.push(
        `/${locale}/admin/luster${activeDashboardSalonSlug ? `?salon=${encodeURIComponent(activeDashboardSalonSlug)}` : ''}`,
      );
    } else if (appId === 'booking-page') {
      // Every resolution of the onboarding handoff opened the same hub, so the
      // tile never needs to wait for it. The Booking Page hub resolves the
      // saved site itself and gates what it shows; blocking here only stranded
      // owners who entered the More tab directly (the handoff fetch lives in
      // the Today subtree and never runs there).
      router.push(
        `/${locale}/admin/website${activeDashboardSalonSlug ? `?salon=${encodeURIComponent(activeDashboardSalonSlug)}` : ''}`,
      );
    } else if (appId === 'workspace-tour') {
      // The tour walks the workspace an owner already has; it never needed an
      // onboarding site. Gating it on the handoff meant an established owner
      // could not replay it, and the tile it lives on was hidden by the same
      // unresolved flag.
      setShowOnboardingTour(true);
    } else if (appId === 'schedule') {
      openAppViaUrl('schedule');
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
        // The highest-intent action on Today creates, it does not browse:
        // open the create form itself, on today's date.
        setNewAppointmentDate(new Date());
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
        openAppViaUrl('schedule');
        break;
      case 'view-bookings':
        setActiveModal('bookings');
        break;
      default:
        break;
    }
  }, [openAppViaUrl]);

  const handleRefreshAnalytics = useCallback(async () => {
    const nextStatus = await resolveAnalyticsModuleAvailability({
      force: true,
    });
    if (nextStatus === 'enabled' && activeModal === 'analytics') {
      await fetchData({ skipModuleCheck: true });
    }
  }, [activeModal, fetchData, resolveAnalyticsModuleAvailability]);

  const handleWorkspaceTab = useCallback((tab: OwnerWorkspaceTab) => {
    setShowScheduleCalendar(false);
    setActiveModal(null);
    setInitialPromotionStage(null);
    setPromotionSettingsReturnClientId(null);
    if (tab === 'calendar') {
      // The Calendar tab is addressable like every other destination: opening
      // it pushes ?app=schedule, so a reload keeps it open and system Back
      // closes it instead of leaving the workspace.
      if (urlOpenedAppRef.current !== 'schedule') {
        urlOpenedAppRef.current = 'schedule';
        router.push(buildAdminUrl('schedule'));
      }
    } else if (urlOpenedAppRef.current) {
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

  const handleWorkspaceTourTarget = useCallback((target: WorkspaceTourTarget) => {
    switch (target) {
      case 'today':
        handleWorkspaceTab('today');
        break;
      case 'calendar':
        handleWorkspaceTab('calendar');
        break;
      case 'clients':
        handleWorkspaceTab('clients');
        break;
      case 'services':
        handleWorkspaceTab('services');
        break;
      case 'website':
        handleWorkspaceTab('more');
        // handleWorkspaceTab resets the viewport across the next two animation
        // frames (so a tab change can never reopen a workspace mid-scroll). A
        // scroll queued inside those frames is cancelled by that reset, which
        // left the final tour step at the top of More instead of on the tile
        // it is describing. Wait for the resets to finish first.
        window.setTimeout(() => {
          document.querySelector<HTMLElement>('[data-testid="admin-app-tile-booking-page"]')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        break;
      default:
        break;
    }
  }, [handleWorkspaceTab]);

  const closeWorkspaceTour = useCallback(() => {
    setShowOnboardingTour(false);
    handleWorkspaceTab('today');
  }, [handleWorkspaceTab]);

  const completeWorkspaceTour = useCallback(() => {
    setShowOnboardingTour(false);
    handleWorkspaceTab('today');
    // The completion flag belongs to the onboarding hand-off record. An owner
    // replaying the tour without one has nothing to mark, so don't send a
    // write that can only 404 — the tour is a replayable tile either way.
    if (
      !activeDashboardSalonSlug
      || !onboardingV1IntegrationEnabled
      || !onboardingHandoffAvailable
    ) {
      return;
    }
    void fetch(
      `/api/admin/onboarding-site?salonSlug=${encodeURIComponent(activeDashboardSalonSlug)}`,
      {
        body: JSON.stringify({ action: 'complete_tour' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      },
    );
  }, [
    activeDashboardSalonSlug,
    handleWorkspaceTab,
    onboardingHandoffAvailable,
    onboardingV1IntegrationEnabled,
  ]);

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

  /**
   * The calendar is opened through the URL, so closing it has to strip ?app=
   * the same way handleCloseModal does for the More apps.
   */
  const handleScheduleCalendarVisibility = useCallback((value: boolean) => {
    setShowScheduleCalendar(value);
    if (value) {
      return;
    }
    if (urlOpenedAppRef.current === 'schedule') {
      urlOpenedAppRef.current = null;
      router.replace(buildAdminUrl(null));
    }
  }, [router, buildAdminUrl]);

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
      <div
        className="owner-workspace-theme min-h-screen"
        data-testid="admin-auth-loading"
        data-theme-scope="owner"
        role="status"
      >
        <LuckyCharmLoader />
      </div>
    );
  }

  if (authError) {
    return (
      <main className="owner-workspace-theme flex min-h-screen items-center justify-center bg-[var(--owner-ground)] p-5" data-theme-scope="owner">
        <section className="w-full max-w-md rounded-owner-card border border-[var(--owner-line)] bg-[var(--owner-surface)] p-6 shadow-owner-card">
          <h1 className="owner-title text-[22px] font-semibold text-[var(--owner-ink)]">Let’s reconnect your account</h1>
          <p role="alert" className="mt-3 text-[15px] leading-6 text-[var(--owner-muted)]">{authError}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className={cn(buttonVariants({ variant: 'ownerPrimary', size: 'pillSm' }), 'min-h-11 px-5')}
              onClick={() => setAuthAttempt(attempt => attempt + 1)}
              type="button"
            >
              Try again
            </button>
            <button
              className={cn(buttonVariants({ variant: 'ownerSecondary', size: 'pillSm' }), 'min-h-11 px-5')}
              onClick={handleLogout}
              type="button"
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
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
            className="mt-6 min-h-11 text-[13px] text-[var(--owner-muted)] transition-colors hover:text-[var(--owner-accent)]"
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
    'marketing': data.badges.marketing,
    'reviews': data.badges.reviews,
    'rewards-reviews': data.badges.reviews,
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
      revenue: formatMoney(tech.revenue, analyticsData?.currency ?? 'CAD'),
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
      className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] font-sans text-[var(--owner-ink)]"
      data-theme-scope="owner"
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
            titleClassName="owner-title text-[28px] font-semibold tracking-tight text-[var(--owner-ink)]"
            subtitleClassName="text-[15px] text-[var(--owner-muted)]"
            actions={(
              <>
                {!adminUser.impersonation?.isActive
                && selectableSalons.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowSalonSelector(true)}
                    aria-label="Switch salon"
                    className="flex size-11 items-center justify-center rounded-full border border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-accent)] shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2 active:bg-[var(--owner-blush)]"
                  >
                    <Building2 size={19} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotifications(true)}
                  aria-label={
                    notificationCount > 0
                      ? `Notifications (${notificationCount} unread)`
                      : 'Notifications'
                  }
                  className="relative flex size-11 items-center justify-center rounded-full border border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-accent)] shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2 active:bg-[var(--owner-blush)]"
                >
                  <Bell size={20} aria-hidden="true" />
                  {notificationCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--owner-accent-strong)] px-1">
                      <span className="text-[11px] font-bold text-white">
                        {notificationCount > 9 ? '9+' : notificationCount}
                      </span>
                    </span>
                  )}
                </button>
                {/*
                  AG-w2-settings-integrations-12: Log Out used to be a 32 px
                  red pill here — the loudest control on every dashboard
                  screen, in the left-thumb path, signing the owner out on a
                  single tap. The header keeps identity and the bell; ending
                  the session lives under More → Account, behind a
                  confirmation.
                */}
                <div
                  className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-[var(--owner-accent-strong)] to-[var(--owner-accent)] text-[15px] font-semibold text-white shadow-sm"
                  title="Luster owner account"
                >
                  {userInitial || <Sparkles size={16} />}
                </div>
              </>
            )}
          />
        </div>

        {/*
          The banner probes /api/super-admin/impersonate on mount. For an
          ordinary owner that request can only ever answer 403, which the
          browser logs as an error and which buries the console noise that
          actually matters (OP-007). The session already knows whether the
          answer could be yes, so only ask then.
        */}
        {(adminUser.isSuperAdmin || adminUser.impersonation?.isActive) && (
          <AdminImpersonationBanner />
        )}

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

        {/* Deep link to an app this salon cannot open */}
        {blockedAppNotice && (
          <div
            className="mx-4 mt-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
            data-testid="blocked-app-notice"
            role="status"
          >
            <p className="flex-1 text-sm text-amber-700">{blockedAppNotice}</p>
            <button
              type="button"
              onClick={() => setBlockedAppNotice(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-amber-900 underline underline-offset-2"
            >
              Dismiss
            </button>
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
                  /*
                    The Workspace tour tile used to be hidden unless the
                    onboarding integration flag was on AND an onboarding-site
                    hand-off had resolved — so an established owner could never
                    replay it, and on the More tab (where the hand-off fetch
                    never runs) it was invisible to everyone. The tour walks
                    tabs the owner already has, so it needs neither.
                  */
                  hiddenIds={hiddenAppIds}
                  /*
                    AG-w2-settings-integrations-12: the session-ending control
                    lives here, in the Account row AppGrid renders under the
                    tiles, with its own named confirmation — not as a one-tap
                    red pill in the header of every screen.
                  */
                  account={{
                    name: userName,
                    salonName: activeDashboardSalonName,
                    onLogOut: () => {
                      void handleLogout();
                    },
                  }}
                />
              </div>
            )
          : (
              <>
                {onboardingV1IntegrationEnabled && activeDashboardSalonSlug
                  ? (
                      <OnboardingWorkspaceHandoff
                        focusWelcome={searchParams.get('onboarding') === 'complete'}
                        locale={locale}
                        onAvailabilityChange={setOnboardingHandoffAvailable}
                        onTakeTour={() => setShowOnboardingTour(true)}
                        salonSlug={activeDashboardSalonSlug}
                      />
                    )
                  : null}
                <OwnerTodayWorkspace
                  salonSlug={activeDashboardSalonSlug || ''}
                  appointments={coreAppointments}
                  analyticsTitle={analyticsUnavailableState?.title}
                  analyticsMessage={analyticsUnavailableState?.description}
                  onRefreshAnalytics={
                    analyticsUnavailableState ? handleRefreshAnalytics : undefined
                  }
                  onQuickAction={handleQuickAction}
                  onOpenBookings={() => setActiveModal('bookings')}
                  onOpenCalendar={() => openAppViaUrl('schedule')}
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
              </>
            )}

        <OwnerWorkspaceNav
          active={workspaceTab}
          onSelect={handleWorkspaceTab}
        />
      </div>

      <AdminModalHost
        settingsInitialView={searchParams.get('view') ?? undefined}
        activeModal={activeModal}
        activeSalonSlug={activeDashboardSalonSlug}
        activeSalonId={activeDashboardSalon?.id ?? null}
        onOpenApp={openAppViaUrl}
        analyticsAppAvailable={!hiddenAppIds.includes('analytics')}
        rewardsAvailable={!hiddenAppIds.includes('rewards')}
        reviewsAvailable={!hiddenAppIds.includes('reviews')}
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
        onOpenSettingsFromIntegrations={() => router.push(`${buildAdminUrl('settings')}&view=communications`)}
        onManageReminders={() => router.push(`${buildAdminUrl('settings')}&view=communications`)}
        onOpenSocialPosting={() => router.push(`/${locale}/admin/policies${activeDashboardSalonSlug ? `?salon=${encodeURIComponent(activeDashboardSalonSlug)}&section=social` : '?section=social'}`)}
        showNotifications={showNotifications}
        setShowNotifications={setShowNotifications}
        showFraudSignals={showFraudSignals}
        setShowFraudSignals={setShowFraudSignals}
        showScheduleCalendar={showScheduleCalendar}
        setShowScheduleCalendar={handleScheduleCalendarVisibility}
        showWalkIn={showWalkIn}
        setShowWalkIn={setShowWalkIn}
        userName={userName}
        userInitial={userInitial}
        analyticsProps={{
          revenue: data.revenue.today ?? 0,
          tips: analyticsData?.revenue?.tips ?? 0,
          currency: analyticsData?.currency ?? 'CAD',
          revenueTrend: data.revenue.trend ?? 0,
          revenueTrendAvailable: data.revenue.trendAvailable,
          revenueSeries: analyticsData?.revenue?.series ?? [],
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

      <NewAppointmentModal
        isOpen={newAppointmentDate !== null}
        onClose={() => setNewAppointmentDate(null)}
        onSuccess={() => {
          void fetchData();
        }}
        preselectedDate={newAppointmentDate ?? undefined}
        salonSlug={activeDashboardSalonSlug}
      />

      {/*
        Mounted for every owner, not only the ones who arrived through
        onboarding: the tour is a replayable guide to tabs that already exist.
        It renders nothing while `open` is false.
      */}
      <WorkspaceQuickTour
        onClose={closeWorkspaceTour}
        onComplete={completeWorkspaceTour}
        onTargetChange={handleWorkspaceTourTarget}
        open={showOnboardingTour}
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
    // `reducedMotion="user"` makes every framer-motion animation in the owner
    // shell (tiles, toggles, sheets, quick actions) honour the operating
    // system's "reduce motion" setting. The CSS counterpart lives at the end of
    // src/styles/global.css for the animations that are not framer-driven.
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<AdminDashboardLoading />}>
        <AdminDashboardContent />
      </Suspense>
    </MotionConfig>
  );
}
