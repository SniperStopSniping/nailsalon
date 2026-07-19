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
  ownerTodayWorkspaceSpy,
  swipeablePagesSpy,
  clerkSignOut,
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
    ownerTodayWorkspaceSpy: vi.fn(),
    swipeablePagesSpy: vi.fn(),
    clerkSignOut: vi.fn(),
  };
});

vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut: clerkSignOut }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({
    get: searchParamGet,
  }),
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
    const value = props as { onAppTap?: (appId: string) => void };
    return (
      <div>
        <button type="button" onClick={() => value.onAppTap?.('luster')}>
          Open Luster
        </button>
      </div>
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
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('scrollTo', vi.fn());
});

describe('AdminDashboardPage', () => {
  it('syncs the selected salon without a hard reload and fetches analytics for the requested salon', async () => {
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

    render(<AdminDashboardPage />);

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

  it('routes More → Luster to the internal Luster application', async () => {
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
            modules: { analyticsDashboard: false },
            entitledModules: { analyticsDashboard: true },
            moduleReasons: { analyticsDashboard: 'MODULE_DISABLED' },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AdminDashboardPage />);

    fireEvent.click(await screen.findByTestId('owner-nav-more'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Luster' }));

    expect(routerMock.push).toHaveBeenCalledWith('/en/admin/luster?salon=salon-b');
  });
});
