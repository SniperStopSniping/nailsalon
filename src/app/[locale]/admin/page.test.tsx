import React from 'react';

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchMock,
  routerReplace,
  routerPush,
  routerRefresh,
  searchParamGet,
  adminModalHostSpy,
  swipeablePagesSpy,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  searchParamGet: vi.fn<(key: string) => string | null>((key: string) => (key === 'salon' ? 'salon-b' : null)),
  adminModalHostSpy: vi.fn(),
  swipeablePagesSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routerReplace,
    push: routerPush,
    refresh: routerRefresh,
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => ({
    get: searchParamGet,
  }),
}));

vi.mock('@/components/admin/AdminModalHost', () => ({
  AdminModalHost: (props: unknown) => {
    adminModalHostSpy(props);
    return null;
  },
}));

vi.mock('@/components/admin/AnalyticsWidgets', () => ({
  AnalyticsWidgets: () => <div>Analytics widgets</div>,
}));

vi.mock('@/components/admin/AppGrid', () => ({
  AppGrid: () => <div>App grid</div>,
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
});

import AdminDashboardPage from './page';

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

  it('renders the disabled analytics state and never requests analytics when the module is disabled', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Analytics dashboard is turned off for this salon.')).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);
  });

  it('renders the upgrade-required analytics state and never requests analytics when the module is gated off', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Analytics dashboard is not included for this salon.')).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);
  });

  it('renders the temporary unavailable state when module availability fails and does not request analytics', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Analytics availability could not be loaded right now.')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Pull to refresh and try again.')).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith('/api/admin/analytics?'),
    )).toBe(false);
  });

  it('caches module availability by salon slug and only revalidates on manual refresh', async () => {
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

    currentSalon = 'salon-b';
    view.rerender(<AdminDashboardPage />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) =>
        String(url) === '/api/admin/settings/modules?salonSlug=salon-b',
      )).toHaveLength(1);
    });

    const swipeableProps = swipeablePagesSpy.mock.calls.at(-1)?.[0];
    act(() => {
      void swipeableProps.onRefresh();
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) =>
        String(url) === '/api/admin/settings/modules?salonSlug=salon-b',
      )).toHaveLength(2);
    });
  });

  it('downgrades to the disabled state when analytics returns a gated 403 and re-downgrades after a manual refresh retry', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Analytics dashboard is turned off for this salon.')).toBeInTheDocument();
    });

    const analyticsRequestsBeforeRefresh = analyticsRequests;
    expect(analyticsRequestsBeforeRefresh).toBeGreaterThan(0);

    const swipeableProps = swipeablePagesSpy.mock.calls.at(-1)?.[0];
    act(() => {
      void swipeableProps.onRefresh();
    });

    await waitFor(() => {
      expect(screen.getByText('Analytics dashboard is turned off for this salon.')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(analyticsRequests).toBe(analyticsRequestsBeforeRefresh + 1);
    });
  });
});
