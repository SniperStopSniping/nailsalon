import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminDashboardPage from './page';

const {
  fetchMock,
  routerReplace,
  routerRefresh,
  routerMock,
  searchParamGet,
  adminModalHostSpy,
  appGridSpy,
  newAppointmentModalSpy,
  handoffComponentSpy,
  ownerTodayWorkspaceSpy,
  swipeablePagesSpy,
  clerkAuth,
  clerkGetToken,
  clerkSignOut,
  clerkInstance,
  clerkStatusHandlers,
  ownerAdminFeatureFlags,
} = vi.hoisted(() => {
  const routerReplace = vi.fn();
  const routerPush = vi.fn();
  const routerRefresh = vi.fn();
  const clerkSignOut = vi.fn();
  const clerkStatusHandlers = new Map<string, (status: string) => void>();

  return {
    fetchMock: vi.fn(),
    routerReplace,
    routerRefresh,
    routerMock: {
      replace: routerReplace,
      push: routerPush,
      refresh: routerRefresh,
    },
    searchParamGet: vi.fn<(key: string) => string | null>((key: string) => (key === 'salon' ? 'salon-b' : null)),
    adminModalHostSpy: vi.fn(),
    appGridSpy: vi.fn(),
    newAppointmentModalSpy: vi.fn(),
    handoffComponentSpy: vi.fn(),
    ownerTodayWorkspaceSpy: vi.fn(),
    swipeablePagesSpy: vi.fn(),
    clerkAuth: { isLoaded: true, isSignedIn: false, sessionId: null as string | null },
    clerkGetToken: vi.fn(),
    clerkSignOut,
    clerkInstance: {
      signOut: clerkSignOut,
      status: 'loading' as string,
      on: (event: string, handler: (status: string) => void) => {
        clerkStatusHandlers.set(event, handler);
      },
      off: (event: string) => {
        clerkStatusHandlers.delete(event);
      },
    },
    clerkStatusHandlers,
    ownerAdminFeatureFlags: { onboardingV1IntegrationEnabled: true },
  };
});

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ ...clerkAuth, getToken: clerkGetToken }),
  useClerk: () => clerkInstance,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({
    get: searchParamGet,
  }),
}));

vi.mock('./OwnerAdminFeatureFlags', () => ({
  useOwnerAdminFeatureFlags: () => ownerAdminFeatureFlags,
}));

vi.mock('@/components/admin/AdminModalHost', () => ({
  AdminModalHost: (props: unknown) => {
    adminModalHostSpy(props);
    const value = props as {
      activeModal?: string | null;
      onOpenPromotionSettings?: (
        stage: 'promo_6w' | 'promo_8w',
        clientId: string,
      ) => void;
      onClosePromotionSettings?: () => void;
    };
    return (
      <>
        {value.activeModal === 'clients' && (
          <button
            type="button"
            onClick={() =>
              value.onOpenPromotionSettings?.('promo_6w', 'client_bob')}
          >
            Configure Bob promotion
          </button>
        )}
        {value.activeModal === 'marketing' && (
          <button
            type="button"
            onClick={value.onClosePromotionSettings}
          >
            Back to Bob
          </button>
        )}
      </>
    );
  },
}));

vi.mock('@/components/admin/OwnerTodayWorkspace', () => ({
  OwnerTodayWorkspace: (props: { onOpenClient: (clientId: string) => void }) => {
    ownerTodayWorkspaceSpy(props);
    return (
      <main data-testid="owner-today-workspace">
        <button
          type="button"
          onClick={() => props.onOpenClient('client_bob')}
        >
          Open Bob retention alert
        </button>
      </main>
    );
  },
}));

vi.mock('@/components/admin/AnalyticsWidgets', () => ({
  AnalyticsWidgets: () => <div>Analytics widgets</div>,
}));

vi.mock('@/components/admin/NewAppointmentModal', () => ({
  NewAppointmentModal: (props: unknown) => {
    newAppointmentModalSpy(props);
    return null;
  },
}));

vi.mock('@/components/admin/AppGrid', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/admin/AppGrid')>(),
  AppGrid: (props: unknown) => {
    appGridSpy(props);
    return <div>App grid</div>;
  },
}));

vi.mock('@/components/admin/onboarding/OnboardingWorkspaceHandoff', () => ({
  OnboardingWorkspaceHandoff: (props: {
    onAvailabilityChange?: (available: boolean) => void;
    onHandoffChange?: (handoff: unknown) => void;
    onResolutionChange?: (resolution: 'absent' | 'available' | 'error') => void;
  }) => {
    handoffComponentSpy(props);
    return (
      <>
        <button
          data-testid="load-account-backed-site"
          onClick={() => {
            props.onAvailabilityChange?.(true);
            props.onResolutionChange?.('available');
            props.onHandoffChange?.({
              handoff: { planIntent: 'free', showWelcome: true, tourCompleted: false },
              setup: {
                googleCalendar: 'not_started',
                payments: 'not_started',
                servicesAdded: true,
                shareLink: 'not_started',
              },
              site: {
                hasVisibleBookingSection: true,
                id: 'site_1',
                previewUrl: '/en/admin/website/preview/site_1',
                revision: 1,
                setupAvailable: true,
                setupUrl: '/en/onboarding-v1?resume=review&site=site_1&revision=1',
              },
            });
          }}
          type="button"
        >
          Load account-backed website
        </button>
        <button
          data-testid="resolve-legacy-site"
          onClick={() => {
            props.onAvailabilityChange?.(false);
            props.onHandoffChange?.(null);
            props.onResolutionChange?.('absent');
          }}
          type="button"
        >
          Resolve legacy website
        </button>
      </>
    );
  },
}));

vi.mock('@/components/admin/AdminImpersonationBanner', () => ({
  AdminImpersonationBanner: () => null,
}));

vi.mock('@/components/admin/SwipeablePages', () => ({
  PageIndicator: () => null,
  SwipeablePages: (props: { children: React.ReactNode }) => {
    swipeablePagesSpy(props);
    return <div>{props.children}</div>;
  },
}));

vi.mock('@/components/admin/dashboard/AdminDashboardNoticeStack', () => ({
  AdminDashboardNoticeStack: () => null,
}));

vi.mock('@/components/admin/dashboard/AdminDashboardSkeleton', () => ({
  AdminDashboardSkeleton: () => <div>Loading dashboard</div>,
}));

vi.mock('@/components/admin/dashboard/AdminSalonSelector', () => ({
  AdminSalonSelector: () => <div>Salon selector</div>,
}));

vi.mock('@/components/ui/workspace-page-header', () => ({
  WorkspacePageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  clerkInstance.status = 'loading';
  clerkStatusHandlers.clear();
  Object.assign(clerkAuth, { isLoaded: true, isSignedIn: false, sessionId: null });
  clerkGetToken.mockReset();
  ownerAdminFeatureFlags.onboardingV1IntegrationEnabled = true;
  searchParamGet.mockImplementation(
    (key: string) => (key === 'salon' ? 'salon-b' : null),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('scrollTo', vi.fn());
});

describe('AdminDashboardPage', () => {
  it('waits after an early cookie 401 and refreshes Clerk before retrying the authenticated workspace', async () => {
    clerkAuth.isLoaded = false;
    searchParamGet.mockReturnValue(null);
    let finishRefresh!: (token: string) => void;
    clerkGetToken.mockImplementation(() => new Promise<string>((resolve) => {
      finishRefresh = resolve;
    }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({
      user: {
        id: 'admin_1',
        name: 'Admin User',
        isSuperAdmin: false,
        impersonation: null,
        salons: [
          { id: 'sal_a', slug: 'salon-a', name: 'Salon A', status: 'active', role: 'owner' },
          { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
        ],
      },
    }), { status: 200 }));
    const view = render(<AdminDashboardPage />);
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clerkGetToken).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.queryByText('Salon selector')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    Object.assign(clerkAuth, { isLoaded: true, isSignedIn: true, sessionId: 'session_owner' });
    view.rerender(<AdminDashboardPage />);

    expect(clerkGetToken).toHaveBeenCalledTimes(1);
    expect(clerkGetToken).toHaveBeenCalledWith({ skipCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => finishRefresh('current-session-token'));
    await screen.findByText('Salon selector');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/me');
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('still checks the legacy cookie session when Clerk is loaded and signed out', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    render(<AdminDashboardPage />);

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/en/admin-login'));

    // A salon-scoped 401 is re-probed without the scope before the session is
    // declared lost (AG-w2-appointments-03); both refusals → sign-in.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/auth/me?salonSlug=salon-b');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/auth/me');
    expect(clerkGetToken).not.toHaveBeenCalled();
  });

  it('opens a server-authorized impersonation workspace even when Clerk never loads', async () => {
    clerkAuth.isLoaded = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: { isActive: true, salonSlug: 'salon-b' },
            salons: [{ id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' }],
          },
        }), { status: 200 });
      }
      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: { modules: {}, entitledModules: {}, moduleReasons: {} },
        }), { status: 200 });
      }
      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');

    expect(clerkGetToken).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/auth/me'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/auth/set-active-salon')).toBe(false);
  });

  it.each(['rejected', 'missing'] as const)('does not loop or make an unready auth request when token refresh is %s', async (failure) => {
    Object.assign(clerkAuth, { isSignedIn: true, sessionId: 'session_owner' });
    if (failure === 'rejected') {
      clerkGetToken.mockRejectedValue(new Error('Session refresh unavailable'));
    } else {
      clerkGetToken.mockResolvedValue(null);
    }
    const view = render(<AdminDashboardPage />);

    await screen.findByRole('alert');
    view.rerender(<AdminDashboardPage />);

    expect(clerkGetToken).toHaveBeenCalledTimes(1);
    expect(clerkGetToken).toHaveBeenCalledWith({ skipCache: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-today-workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('alert');

    expect(clerkGetToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it.each([401, 500])('offers a bounded retry instead of redirecting a signed-in owner when admin/me returns %s', async (status) => {
    Object.assign(clerkAuth, { isSignedIn: true, sessionId: 'session_owner' });
    clerkGetToken.mockResolvedValue('current-session-token');
    fetchMock.mockImplementation(async () => new Response('{}', { status }));
    const view = render(<AdminDashboardPage />);

    await screen.findByRole('alert');
    view.rerender(<AdminDashboardPage />);

    // 401 on a salon-scoped check is re-probed unscoped once; 500 is not.
    expect(fetchMock).toHaveBeenCalledTimes(status === 401 ? 2 : 1);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-today-workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('alert');

    expect(clerkGetToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(status === 401 ? 4 : 2);
    expect(routerReplace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(clerkSignOut).toHaveBeenCalledWith({ redirectUrl: '/owner' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/logout', { method: 'POST' });
  });

  it('ignores a token refresh from a session that was replaced while it was loading', async () => {
    Object.assign(clerkAuth, { isSignedIn: true, sessionId: 'session_previous' });
    let finishPrevious!: (token: string | null) => void;
    let finishCurrent!: (token: string) => void;
    clerkGetToken
      .mockImplementationOnce(() => new Promise<string | null>((resolve) => {
        finishPrevious = resolve;
      }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        finishCurrent = resolve;
      }));
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const view = render(<AdminDashboardPage />);
    clerkAuth.sessionId = 'session_current';
    view.rerender(<AdminDashboardPage />);

    await act(async () => finishPrevious(null));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();

    await act(async () => finishCurrent('current-session-token'));

    // Scoped check + the unscoped re-probe (both 401) — still exactly one
    // session's worth of requests, none from the replaced session.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/auth/me?salonSlug=salon-b');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/auth/me');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it.each([true, false])('loads the server-authorized legacy dashboard and syncs salons without a hard reload when Clerk loaded is %s', async (clerkLoaded) => {
    clerkAuth.isLoaded = clerkLoaded;
    let requestedApp: string | null = null;
    searchParamGet.mockImplementation((key: string) => {
      if (key === 'salon') {
        return 'salon-b';
      }
      return key === 'app' ? requestedApp : null;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_a', slug: 'salon-a', name: 'Salon A', status: 'active', role: 'owner' },
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/auth/set-active-salon') {
        expect(init?.method).toBe('POST');

        return new Response(JSON.stringify({ ok: true, salonSlug: 'salon-b' }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: true },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'ENABLED' },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/analytics?')) {
        return new Response(JSON.stringify({
          data: {
            period: 'weekly',
            revenue: { total: 0, trend: 0, completed: 0 },
            appointments: { total: 0, completed: 0, noShows: 0, upcoming: 0 },
            staff: [],
            services: [],
            dateRange: {
              start: '2026-03-15',
              end: '2026-03-21',
              label: 'This week',
            },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    const view = render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/me?salonSlug=salon-b');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/set-active-salon', expect.objectContaining({
        method: 'POST',
      }));
    });

    expect(routerRefresh).toHaveBeenCalled();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/modules?salonSlug=salon-b');
    });

    await screen.findByTestId('owner-today-workspace');

    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);

    const latestTodayProps = ownerTodayWorkspaceSpy.mock.calls.at(-1)?.[0] as
      Record<string, unknown>;

    expect(latestTodayProps).not.toHaveProperty('financials');
    expect(latestTodayProps).not.toHaveProperty('onRefreshReporting');

    requestedApp = 'analytics';
    view.rerender(<AdminDashboardPage />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/admin/analytics?salonSlug=salon-b&period=weekly&anchor='),
      )).toBe(true);
    });

    const moduleFetchIndex = fetchMock.mock.calls.findIndex(([url]) =>
      String(url) === '/api/admin/settings/modules?salonSlug=salon-b',
    );
    const analyticsFetchIndex = fetchMock.mock.calls.findIndex(([url]) =>
      String(url).startsWith('/api/admin/analytics?salonSlug=salon-b&period=weekly&anchor='),
    );

    expect(moduleFetchIndex).toBeGreaterThan(-1);
    expect(analyticsFetchIndex).toBeGreaterThan(moduleFetchIndex);

    await waitFor(() => {
      expect(adminModalHostSpy).toHaveBeenCalledWith(expect.objectContaining({
        activeSalonSlug: 'salon-b',
      }));
    });

    expect(routerReplace).not.toHaveBeenCalledWith('/en/admin-login');
  });

  it('hides disabled analytics but keeps core retention settings visible for Free Luster', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner', freeSoloEnabled: true },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: false },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'MODULE_DISABLED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/modules?salonSlug=salon-b'));

    expect(screen.queryByText('Analytics dashboard is turned off for this salon.')).not.toBeInTheDocument();

    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);

    fireEvent.click(screen.getByTestId('owner-nav-more'));
    await waitFor(() => {
      const latestProps = appGridSpy.mock.calls.at(-1)?.[0] as {
        hiddenIds?: string[];
      };

      expect(latestProps.hiddenIds).toContain('analytics');
      expect(latestProps.hiddenIds).not.toContain('marketing');
    });
  });

  it('preserves the exact legacy Booking Page and hides all handoff UI when integration is disabled', async () => {
    ownerAdminFeatureFlags.onboardingV1IntegrationEnabled = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }
      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }
      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: false },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'MODULE_DISABLED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');

    expect(handoffComponentSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('owner-nav-more'));
    await waitFor(() => expect(appGridSpy).toHaveBeenCalled());
    const appGridProps = appGridSpy.mock.calls.at(-1)?.[0] as {
      hiddenIds?: string[];
      onAppTap?: (appId: string) => void;
    };

    expect(appGridProps.hiddenIds).toContain('workspace-tour');

    act(() => appGridProps.onAppTap?.('booking-page'));

    expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin/website?salon=salon-b');
    expect(screen.queryByText(/Checking your saved website/i)).not.toBeInTheDocument();

    act(() => appGridProps.onAppTap?.('workspace-tour'));

    expect(screen.queryByTestId('workspace-quick-tour')).not.toBeInTheDocument();
    expect(handoffComponentSpy).not.toHaveBeenCalled();
  });

  it('opens the Booking Page hub on the first tap whether or not the onboarding handoff has resolved', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }
      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: false },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'MODULE_DISABLED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');
    fireEvent.click(screen.getByTestId('owner-nav-more'));

    await waitFor(() => expect(appGridSpy).toHaveBeenCalled());
    let appGridProps = appGridSpy.mock.calls.at(-1)?.[0] as {
      onAppTap?: (appId: string) => void;
    };
    act(() => appGridProps.onAppTap?.('booking-page'));

    // The handoff has not resolved yet: the hub resolves the saved site itself,
    // so the tile must never hold the owner on the grid (AG-hub-publish-01).
    expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin/website?salon=salon-b');
    expect(screen.queryByText(/Checking your saved website/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('owner-nav-today'));
    fireEvent.click(await screen.findByTestId('resolve-legacy-site'));
    fireEvent.click(screen.getByTestId('owner-nav-more'));
    await waitFor(() => expect(appGridSpy).toHaveBeenCalled());
    appGridProps = appGridSpy.mock.calls.at(-1)?.[0] as {
      onAppTap?: (appId: string) => void;
    };
    act(() => appGridProps.onAppTap?.('booking-page'));

    expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin/website?salon=salon-b');

    fireEvent.click(screen.getByTestId('owner-nav-today'));
    fireEvent.click(await screen.findByTestId('load-account-backed-site'));
    fireEvent.click(screen.getByTestId('owner-nav-more'));

    await waitFor(() => {
      appGridProps = appGridSpy.mock.calls.at(-1)?.[0] as {
        onAppTap?: (appId: string) => void;
      };

      expect(appGridProps).toBeDefined();
    });
    act(() => appGridProps.onAppTap?.('booking-page'));

    expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin/website?salon=salon-b');
  });

  it('hides analytics and never requests it when the module is not entitled', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: true,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: true },
            entitledModules: { analyticsDashboard: false },
            moduleReasons: { analyticsDashboard: 'UPGRADE_REQUIRED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/modules?salonSlug=salon-b'));

    expect(screen.queryByText('Analytics dashboard is not included for this salon.')).not.toBeInTheDocument();

    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);
  });

  it('keeps analytics hidden when module availability fails and does not request analytics', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({ error: 'failed' }), { status: 500 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/modules?salonSlug=salon-b'));

    expect(screen.queryByText('Analytics availability could not be loaded right now.')).not.toBeInTheDocument();

    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);
  });

  it('caches module availability by salon slug while switching salons', async () => {
    let currentSalon = 'salon-b';

    searchParamGet.mockImplementation((key: string) => (key === 'salon' ? currentSalon : null));

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_a', slug: 'salon-a', name: 'Salon A', status: 'active', role: 'owner' },
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b' || url === '/api/admin/settings/modules?salonSlug=salon-a') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: true },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'ENABLED' },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/analytics?')) {
        return new Response(JSON.stringify({
          data: {
            period: 'weekly',
            revenue: { total: 0, trend: 0, completed: 0 },
            appointments: { total: 0, completed: 0, noShows: 0, upcoming: 0 },
            staff: [],
            services: [],
            dateRange: { start: '2026-03-15', end: '2026-03-21' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    const view = render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/modules?salonSlug=salon-b');
    });

    currentSalon = 'salon-a';
    view.rerender(<AdminDashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/modules?salonSlug=salon-a');
    });

    const salonBRequestsBeforeReturn = fetchMock.mock.calls.filter(([url]) =>
      String(url) === '/api/admin/settings/modules?salonSlug=salon-b',
    ).length;

    currentSalon = 'salon-b';
    view.rerender(<AdminDashboardPage />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });

    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url) === '/api/admin/settings/modules?salonSlug=salon-b',
    )).toHaveLength(salonBRequestsBeforeReturn);
  });

  it('downgrades to the disabled state when analytics returns a gated 403', async () => {
    let analyticsRequests = 0;
    searchParamGet.mockImplementation((key: string) => {
      if (key === 'salon') {
        return 'salon-b';
      }
      return key === 'app' ? 'analytics' : null;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: true },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'ENABLED' },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/analytics?')) {
        analyticsRequests += 1;
        return new Response(JSON.stringify({
          error: { code: 'MODULE_DISABLED', message: 'Module disabled' },
        }), { status: 403 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-today-workspace');
    await waitFor(() => expect(analyticsRequests).toBeGreaterThan(0));

    expect(screen.queryByText('Analytics dashboard is turned off for this salon.')).not.toBeInTheDocument();

    expect(analyticsRequests).toBeGreaterThan(0);
  });

  it('opens the exact client selected from a dashboard retention alert', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            phone: '+15555550100',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }

      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }

      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: false },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'MODULE_DISABLED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Bob retention alert' }),
    );

    await waitFor(() => {
      expect(adminModalHostSpy.mock.calls.some(([props]) => {
        const value = props as {
          activeModal?: string | null;
          initialClientId?: string | null;
        };

        return value.activeModal === 'clients'
          && value.initialClientId === 'client_bob';
      })).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configure Bob promotion' }));

    await waitFor(() => {
      expect(adminModalHostSpy.mock.calls.some(([props]) => {
        const value = props as {
          activeModal?: string | null;
          initialClientId?: string | null;
          initialPromotionStage?: string | null;
        };

        return value.activeModal === 'marketing'
          && value.initialClientId === 'client_bob'
          && value.initialPromotionStage === 'promo_6w';
      })).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back to Bob' }));

    await waitFor(() => {
      const lastProps = adminModalHostSpy.mock.calls.at(-1)?.[0] as {
        activeModal?: string | null;
        initialClientId?: string | null;
      };

      expect(lastProps).toMatchObject({
        activeModal: 'clients',
        initialClientId: 'client_bob',
      });
    });
  });

  it('ends the auth phase with the reconnect card when the Clerk script never loads', async () => {
    vi.useFakeTimers();
    clerkAuth.isLoaded = false;
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

    render(<AdminDashboardPage />);
    await act(async () => {});

    const loading = screen.getByTestId('admin-auth-loading');

    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveTextContent('Checking your session…');
    expect(screen.queryByText('Let’s reconnect your account')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByText('Let’s reconnect your account')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('We can’t reach the sign-in service right now.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByTestId('admin-auth-loading')).not.toBeInTheDocument();
    expect(routerReplace).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('treats a Clerk load failure as terminal without waiting out the bound', async () => {
    clerkAuth.isLoaded = false;
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

    render(<AdminDashboardPage />);
    await act(async () => {});

    expect(screen.getByTestId('admin-auth-loading')).toBeInTheDocument();

    // Clerk reports failed_to_load_clerk_js_timeout through its status stream.
    await act(async () => {
      clerkStatusHandlers.get('status')?.('error');
    });

    expect(screen.getByText('Let’s reconnect your account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('opens the Booking Page hub on the first tap when the More tab is entered directly', async () => {
    searchParamGet.mockImplementation((key: string) => {
      if (key === 'salon') {
        return 'salon-b';
      }
      if (key === 'tab') {
        return 'more';
      }
      return null;
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }
      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }
      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: {},
            entitledModules: {},
            moduleReasons: { analyticsDashboard: 'ENABLED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    await screen.findByTestId('owner-more-workspace');
    await waitFor(() => expect(appGridSpy).toHaveBeenCalled());

    // Nothing on the More tab ever fetches the onboarding handoff.
    expect(handoffComponentSpy).not.toHaveBeenCalled();

    const appGridProps = appGridSpy.mock.calls.at(-1)?.[0] as {
      onAppTap?: (appId: string) => void;
    };
    act(() => appGridProps.onAppTap?.('booking-page'));

    expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin/website?salon=salon-b');
    expect(screen.queryByText(/Checking your saved website/i)).not.toBeInTheDocument();
  });

  it('explains a deep link to an app this salon cannot open instead of dropping it', async () => {
    searchParamGet.mockImplementation((key: string) => {
      if (key === 'salon') {
        return 'salon-b';
      }
      if (key === 'app') {
        return 'analytics';
      }
      return null;
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }
      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }
      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: {
            modules: { analyticsDashboard: true },
            entitledModules: { analyticsDashboard: false },
            moduleReasons: { analyticsDashboard: 'UPGRADE_REQUIRED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    const notice = await screen.findByTestId('blocked-app-notice');

    expect(notice).toHaveTextContent('Analytics isn’t included in your plan yet.');
    // The address bar must stop advertising an app that is not open.
    expect(routerReplace).toHaveBeenCalledWith('/en/admin?salon=salon-b');
    expect(screen.getByTestId('owner-more-workspace')).toBeInTheDocument();
    expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      activeModal: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('blocked-app-notice')).not.toBeInTheDocument();
  });

  it('opens the create form, not the calendar, from the New Appt quick action', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/auth/me')) {
        return new Response(JSON.stringify({
          user: {
            id: 'admin_1',
            name: 'Admin User',
            isSuperAdmin: false,
            impersonation: null,
            salons: [
              { id: 'sal_b', slug: 'salon-b', name: 'Salon B', status: 'active', role: 'owner' },
            ],
          },
        }), { status: 200 });
      }
      if (url === '/api/admin/auth/set-active-salon') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/admin/fraud-signals') {
        return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
      }
      if (url === '/api/admin/settings/modules?salonSlug=salon-b') {
        return new Response(JSON.stringify({
          data: { modules: {}, entitledModules: {}, moduleReasons: {} },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    const view = render(<AdminDashboardPage />);
    await screen.findByTestId('owner-today-workspace');

    const workspaceProps = ownerTodayWorkspaceSpy.mock.calls.at(-1)?.[0] as {
      onQuickAction?: (actionId: string) => void;
    };

    expect(newAppointmentModalSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      isOpen: false,
      salonSlug: 'salon-b',
    });

    act(() => workspaceProps.onQuickAction?.('new-appointment'));

    const openProps = newAppointmentModalSpy.mock.calls.at(-1)?.[0] as {
      isOpen: boolean;
      preselectedDate?: Date;
      salonSlug?: string | null;
    };

    expect(openProps.isOpen).toBe(true);
    expect(openProps.salonSlug).toBe('salon-b');
    expect(openProps.preselectedDate?.toDateString()).toBe(new Date().toDateString());
    // "Schedule" is the tile that opens the calendar; "New Appt" must not.
    expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      showScheduleCalendar: false,
    });

    // The calendar is now addressable, so "Schedule" pushes ?app=schedule and
    // the URL effect opens it (AG-today-calendar-03). It is no longer opened
    // as pure state, which is what left it without a history entry.
    act(() => workspaceProps.onQuickAction?.('today-schedule'));

    expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin?salon=salon-b&app=schedule');

    searchParamGet.mockImplementation((key: string) => {
      if (key === 'salon') {
        return 'salon-b';
      }
      if (key === 'app') {
        return 'schedule';
      }
      return null;
    });
    view.rerender(<AdminDashboardPage />);

    await waitFor(() => {
      expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        showScheduleCalendar: true,
      });
    });
  });

  describe('workspace URL contract', () => {
    function mockOwnerSession(salonSlug = 'salon-b') {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith('/api/admin/auth/me')) {
          return new Response(JSON.stringify({
            user: {
              id: 'admin_1',
              name: 'Admin User',
              isSuperAdmin: false,
              impersonation: null,
              salons: [
                { id: 'sal_b', slug: salonSlug, name: 'Salon B', status: 'active', role: 'owner' },
              ],
            },
          }), { status: 200 });
        }
        if (url === '/api/admin/auth/set-active-salon') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url === '/api/admin/fraud-signals') {
          return new Response(JSON.stringify({ data: { signals: [], unresolvedCount: 0 } }), { status: 200 });
        }
        if (url === `/api/admin/settings/modules?salonSlug=${salonSlug}`) {
          return new Response(JSON.stringify({
            data: { modules: {}, entitledModules: {}, moduleReasons: {} },
          }), { status: 200 });
        }

        throw new Error(`Unhandled fetch: ${url}`);
      });
    }

    it('opens the calendar from ?app=schedule and closes it when the segment goes away', async () => {
      searchParamGet.mockImplementation((key: string) => {
        if (key === 'salon') {
          return 'salon-b';
        }
        if (key === 'app') {
          return 'schedule';
        }
        return null;
      });
      mockOwnerSession();

      const view = render(<AdminDashboardPage />);

      await waitFor(() => {
        expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
          showScheduleCalendar: true,
          activeModal: null,
        });
      });

      // A deep link to the calendar is a destination, not a More app.
      expect(screen.queryByTestId('owner-more-workspace')).not.toBeInTheDocument();

      // Browser Back drops ?app= — the calendar closes and Today comes back.
      searchParamGet.mockImplementation(
        (key: string) => (key === 'salon' ? 'salon-b' : null),
      );
      view.rerender(<AdminDashboardPage />);

      await waitFor(() => {
        expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
          showScheduleCalendar: false,
        });
      });

      expect(await screen.findByTestId('owner-today-workspace')).toBeInTheDocument();
    });

    it('closing the calendar strips ?app= and keeps the salon segment', async () => {
      searchParamGet.mockImplementation((key: string) => {
        if (key === 'salon') {
          return 'salon-b';
        }
        if (key === 'app') {
          return 'schedule';
        }
        return null;
      });
      mockOwnerSession();

      render(<AdminDashboardPage />);

      await waitFor(() => {
        expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
          showScheduleCalendar: true,
        });
      });

      const hostProps = adminModalHostSpy.mock.calls.at(-1)?.[0] as {
        setShowScheduleCalendar: (value: boolean) => void;
      };
      act(() => hostProps.setShowScheduleCalendar(false));

      expect(routerReplace).toHaveBeenLastCalledWith('/en/admin?salon=salon-b');
    });

    it('keeps ?salon= on every app link even when the shell was entered without one', async () => {
      searchParamGet.mockImplementation(
        (key: string) => (key === 'tab' ? 'more' : null),
      );
      mockOwnerSession();

      const view = render(<AdminDashboardPage />);
      await screen.findByTestId('owner-more-workspace');

      const appGridProps = appGridSpy.mock.calls.at(-1)?.[0] as {
        onAppTap?: (appId: string) => void;
      };
      act(() => appGridProps.onAppTap?.('marketing'));

      // The post-sign-in landing is /admin with no ?salon=; the link an owner
      // copies still has to name the salon they are looking at
      // (AG-w2-more-tools-06).
      expect(routerMock.push).toHaveBeenLastCalledWith('/en/admin?salon=salon-b&app=marketing');

      searchParamGet.mockImplementation((key: string) => {
        if (key === 'tab') {
          return 'more';
        }
        return key === 'app' ? 'marketing' : null;
      });
      view.rerender(<AdminDashboardPage />);

      await waitFor(() => {
        expect(adminModalHostSpy.mock.calls.at(-1)?.[0]).toMatchObject({
          activeModal: 'marketing',
        });
      });

      const hostProps = adminModalHostSpy.mock.calls.at(-1)?.[0] as {
        onCloseModal: () => void;
      };
      act(() => hostProps.onCloseModal());

      expect(routerReplace).toHaveBeenLastCalledWith('/en/admin?salon=salon-b');
    });
  });
});
