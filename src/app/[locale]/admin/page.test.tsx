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
  handoffComponentSpy,
  ownerTodayWorkspaceSpy,
  swipeablePagesSpy,
  clerkAuth,
  clerkGetToken,
  clerkSignOut,
  ownerAdminFeatureFlags,
} = vi.hoisted(() => {
  const routerReplace = vi.fn();
  const routerPush = vi.fn();
  const routerRefresh = vi.fn();

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
    handoffComponentSpy: vi.fn(),
    ownerTodayWorkspaceSpy: vi.fn(),
    swipeablePagesSpy: vi.fn(),
    clerkAuth: { isLoaded: true, isSignedIn: false, sessionId: null as string | null },
    clerkGetToken: vi.fn(),
    clerkSignOut: vi.fn(),
    ownerAdminFeatureFlags: { onboardingV1IntegrationEnabled: true },
  };
});

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ ...clerkAuth, getToken: clerkGetToken }),
  useClerk: () => ({ signOut: clerkSignOut }),
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

vi.mock('@/components/admin/AppGrid', () => ({
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/me?salonSlug=salon-b');
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('owner-today-workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('alert');

    expect(clerkGetToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/me?salonSlug=salon-b');
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

  it('opens the exact saved site from Booking Page while preserving the legacy route elsewhere when integration is enabled', async () => {
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

    expect(routerMock.push).not.toHaveBeenCalledWith('/en/admin/website?salon=salon-b');
    expect(screen.getByText(/Checking your saved website/i)).toBeInTheDocument();

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
});
