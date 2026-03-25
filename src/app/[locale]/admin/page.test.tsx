import React from 'react';

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchMock,
  routerReplace,
  routerPush,
  routerRefresh,
  searchParamGet,
  adminModalHostSpy,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  routerReplace: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  searchParamGet: vi.fn((key: string) => (key === 'salon' ? 'salon-b' : null)),
  adminModalHostSpy: vi.fn(),
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
  SwipeablePages: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
      expect(fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/admin/analytics?salonSlug=salon-b&period=weekly&anchor='),
      )).toBe(true);
    });

    await waitFor(() => {
      expect(adminModalHostSpy).toHaveBeenCalledWith(expect.objectContaining({
        activeSalonSlug: 'salon-b',
      }));
    });

    expect(routerReplace).not.toHaveBeenCalledWith('/en/admin-login');
  });
});
