import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientsModal } from './ClientsModal';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  // Cache per tag: a fresh component type on every property access would make
  // React remount the subtree on each render, detaching queried nodes.
  const motionCache = new Map<string, ReturnType<typeof makeMotionTag>>();

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => {
        if (!motionCache.has(tag)) {
          motionCache.set(tag, makeMotionTag(tag));
        }
        return motionCache.get(tag);
      },
    }),
  };
});

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({
    salonSlug: 'isla-nail-studio',
    salonId: 'salon_1',
    salonName: 'Isla Nail Studio',
    themeKey: 'isla',
    status: 'active',
    isAccessible: true,
  }),
}));

vi.mock('./NewAppointmentModal', () => ({
  NewAppointmentModal: ({
    isOpen,
    clientPrefill,
    onClose,
    onSuccess,
  }: {
    isOpen: boolean;
    clientPrefill?: unknown;
    onClose?: () => void;
    onSuccess?: () => void;
  }) => (
    isOpen
      ? (
          <div data-testid="new-appointment-modal">
            {JSON.stringify(clientPrefill ?? null)}
            <button
              type="button"
              aria-label="Complete mocked booking"
              data-testid="complete-mocked-booking"
              onClick={() => {
                onSuccess?.();
                onClose?.();
              }}
            />
          </div>
        )
      : null
  ),
}));

function buildManageDetailResponse(appointmentId: string) {
  return {
    data: {
      appointment: {
        id: appointmentId,
        salonId: 'salon_1',
        salonSlug: 'isla-nail-studio',
        clientName: 'Ava Thompson',
        clientPhone: '1111111111',
        clientEmail: 'ava@example.com',
        technicianId: 'tech_1',
        locationId: null,
        locationName: null,
        status: 'confirmed',
        startTime: '2026-04-04T15:00:00.000Z',
        endTime: '2026-04-04T16:00:00.000Z',
        totalPrice: 9500,
        totalDurationMinutes: 60,
        bufferMinutes: 10,
        slotIntervalMinutes: 15,
        isLocked: false,
        lockedAt: null,
        paymentStatus: 'pending',
        baseServiceId: 'svc_1',
        baseServiceName: 'Gel Fill',
        discountType: null,
        discountAmountCents: 0,
        notes: null,
        techNotes: null,
      },
      services: [],
      addOns: [],
      serviceOptions: [{ id: 'svc_1', name: 'Gel Fill', category: 'manicure', priceCents: 9500, durationMinutes: 60 }],
      technicianOptions: [{ id: 'tech_1', name: 'Daniela' }],
      permissions: {
        canMove: true,
        canChangeService: true,
        canCancel: true,
        canMarkCompleted: true,
        canStart: false,
        canConfirm: false,
        canMarkNoShow: true,
        canReassignTechnician: true,
      },
      warnings: [],
      communications: [],
    },
  };
}

type ListClient = {
  id: string;
  phone: string;
  fullName: string;
  email?: string | null;
  preferredTechnician?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  lastVisitAt?: string | null;
  totalVisits?: number;
  totalSpent?: number;
  spendCurrency?: string | null;
  noShowCount?: number;
  loyaltyPoints?: number;
  notes?: string | null;
  createdAt?: string;
};

function buildListClient(overrides: Partial<ListClient> = {}): ListClient {
  return {
    id: 'client_1',
    phone: '1111111111',
    fullName: 'Ava Thompson',
    email: 'ava@example.com',
    preferredTechnician: {
      id: 'tech_1',
      name: 'Daniela',
      avatarUrl: null,
    },
    lastVisitAt: '2026-03-10T14:00:00.000Z',
    totalVisits: 6,
    totalSpent: 45500,
    spendCurrency: 'CAD',
    noShowCount: 1,
    loyaltyPoints: 820,
    notes: 'Prefers shorter almond shape.',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildListResponse(clients: ListClient[], pagination?: Partial<{
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>) {
  return {
    data: {
      clients,
      pagination: {
        total: pagination?.total ?? clients.length,
        page: pagination?.page ?? 1,
        limit: pagination?.limit ?? 50,
        totalPages: pagination?.totalPages ?? 1,
      },
    },
  };
}

function buildDetailResponse(overrides?: Partial<{
  client: Record<string, unknown>;
  upcomingAppointments: Array<Record<string, unknown>>;
  pastAppointments: Array<Record<string, unknown>>;
  recentIssues: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  submittedPreferences: Record<string, unknown> | null;
}>) {
  return {
    data: {
      client: {
        id: 'client_1',
        phone: '1111111111',
        fullName: 'Ava Thompson',
        email: 'ava@example.com',
        birthday: '1992-06-15',
        preferredTechnician: {
          id: 'tech_1',
          name: 'Daniela',
          avatarUrl: null,
        },
        notes: 'Prefers shorter almond shape.',
        lastVisitAt: '2026-03-10T14:00:00.000Z',
        totalVisits: 6,
        totalSpent: 45500,
        averageSpend: 7583,
        noShowCount: 1,
        loyaltyPoints: 820,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2026-07-25T15:30:00.000Z',
        ...overrides?.client,
      },
      upcomingAppointments: overrides?.upcomingAppointments ?? [{
        id: 'appt_upcoming',
        startTime: '2026-04-04T15:00:00.000Z',
        endTime: '2026-04-04T16:00:00.000Z',
        status: 'confirmed',
        totalPrice: 9500,
        currency: 'CAD',
        technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        services: [{ id: 'svc_gel_fill', name: 'Gel Fill', price: 9500 }],
        notes: 'French finish',
      }],
      pastAppointments: overrides?.pastAppointments ?? [{
        id: 'appt_completed',
        startTime: '2026-03-10T14:00:00.000Z',
        endTime: '2026-03-10T15:00:00.000Z',
        status: 'completed',
        totalPrice: 8200,
        currency: 'CAD',
        technician: { id: 'tech_2', name: 'Mila', avatarUrl: null },
        services: [{ id: 'svc_pedicure', name: 'Classic Pedicure', price: 8200 }],
        addOns: [{ id: 'addon_art', name: 'Nail art', quantity: 1, lineTotalCents: 1200 }],
        financial: {
          completedValueCents: 10000,
          source: 'finalized',
          discountCents: 0,
          taxCents: 0,
          tipsCents: 0,
          paymentsReceivedCents: 4000,
          depositCollectedCents: 2500,
          depositRefundedCents: 2500,
          depositForfeitedCents: 0,
          depositCreditCents: 0,
          depositState: 'fully_refunded',
          depositBlockCode: null,
          amountAlreadyPaidCents: 4000,
          payments: [{
            id: 'payment_1',
            amountCents: 4000,
            method: 'cash',
            recordedAt: '2026-03-10T15:00:00.000Z',
          }],
          paymentStatus: 'partially_paid',
          completedOutstandingCents: 6000,
          financialState: 'resolved',
          balanceCents: 6000,
          balanceState: 'completed_outstanding',
        },
        notes: null,
      }],
      recentIssues: overrides?.recentIssues ?? [{
        id: 'appt_issue',
        startTime: '2026-03-02T14:00:00.000Z',
        endTime: '2026-03-02T15:00:00.000Z',
        status: 'no_show',
        totalPrice: 0,
        technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        services: [{ id: 'svc_builder_fill', name: 'Builder Gel Fill', price: 9900 }],
        notes: 'Did not arrive',
      }],
      summary: overrides?.summary ?? {
        currency: 'CAD',
        timeZone: 'America/Toronto',
        lifetimeSpendCents: 45500,
        spendThisMonthCents: 10000,
        completedOutstandingCents: 6000,
        financialState: 'resolved',
        completedVisits: 6,
        mostBookedService: { id: 'svc_pedicure', name: 'Classic Pedicure', count: 3 },
        rebooking: { status: 'overdue', dueAt: '2026-03-31T14:00:00.000Z' },
        provenance: {
          lifetimeSpend: { mode: 'mixed', unresolvedAppointmentCount: 0, isEstimated: true },
          spendThisMonth: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false },
          completedOutstanding: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false },
        },
      },
      submittedPreferences: overrides?.submittedPreferences ?? {
        favoriteTechnician: { id: 'tech_2', name: 'Mila', avatarUrl: null },
        favoriteServices: ['svc_pedicure'],
        nailShape: 'almond',
        nailLength: 'short',
        finishes: ['glossy'],
        colorFamilies: ['nude'],
        preferredBrands: ['Luster Gel'],
        sensitivities: ['HEMA-free'],
        musicPreference: 'soft',
        conversationLevel: 'quiet',
        beveragePreference: ['tea'],
        techNotes: null,
        appointmentNotes: null,
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      photos: [],
    },
  };
}

function buildTechniciansResponse() {
  return {
    data: {
      technicians: [
        { id: 'tech_1', name: 'Daniela', avatarUrl: null, isActive: true },
        { id: 'tech_2', name: 'Mila', avatarUrl: null, isActive: true },
      ],
    },
  };
}

function buildFlagsResponse(overrides?: Partial<{
  isProblemClient: boolean;
  flagReason: string;
  isBlocked: boolean;
  blockedReason: string;
  noShowCount: number;
  lateCancelCount: number;
}>) {
  return {
    data: {
      client: {
        id: 'client_1',
        phone: '1111111111',
        fullName: 'Ava Thompson',
        adminFlags: {
          isProblemClient: overrides?.isProblemClient ?? false,
          flagReason: overrides?.flagReason ?? '',
        },
        isBlocked: overrides?.isBlocked ?? false,
        blockedReason: overrides?.blockedReason ?? '',
        noShowCount: overrides?.noShowCount ?? 1,
        lateCancelCount: overrides?.lateCancelCount ?? 0,
      },
    },
  };
}

function getClientListCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/clients?'));
}

function buildInsightsResponse() {
  const counts = {
    active: 2,
    new_this_month: 1,
    rebooked: 1,
    due_to_return: 1,
    due_soon: 0,
    due_now: 1,
    overdue: 1,
    needs_rebooking: 2,
    no_future_appointment: 2,
    first_time_no_return: 0,
    recent_cancellation: 0,
    not_seen_30: 1,
    not_seen_60: 1,
    inactive_90: 0,
    completed_outstanding: 0,
  } as const;
  return {
    data: {
      generatedAt: '2026-07-15T16:00:00.000Z',
      timeZone: 'America/Toronto',
      rulesVersion: '2026-07-24',
      kpis: {
        active: counts.active,
        new_this_month: counts.new_this_month,
        due_to_return: counts.due_to_return,
        overdue: counts.overdue,
      },
      segments: Object.entries(counts).map(([id, count]) => ({
        id,
        label: id,
        count,
      })),
      attention: { total: 0, items: [] },
    },
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function listResponse(
  clients: ListClient[],
  pagination?: Parameters<typeof buildListResponse>[1],
): Response {
  return new Response(JSON.stringify(buildListResponse(clients, pagination)), {
    status: 200,
  });
}

function mockDirectoryRaceRoutes(
  clientsRoute: (
    url: URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
) {
  fetchMock.mockImplementation((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/admin/settings/modules') {
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          moduleReasons: {
            clientFlags: 'MODULE_DISABLED',
            clientBlocking: 'MODULE_DISABLED',
          },
        },
      }), { status: 200 }));
    }
    if (url.pathname === '/api/admin/technicians') {
      return Promise.resolve(
        new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 }),
      );
    }
    if (url.pathname === '/api/admin/client-insights') {
      return Promise.resolve(
        new Response(JSON.stringify(buildInsightsResponse()), { status: 200 }),
      );
    }
    if (url.pathname === '/api/admin/clients') {
      return clientsRoute(url, init);
    }
    return Promise.reject(
      new Error(`Unhandled fetch: ${url.pathname}${url.search}`),
    );
  });
}

describe('ClientsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads paginated clients, appends additional pages, and resets on sort/search changes', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/admin/settings/modules') {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'MODULE_DISABLED',
            },
          },
        }), { status: 200 });
      }

      if (url.pathname === '/api/admin/technicians') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      if (url.pathname === '/api/admin/clients') {
        const sortBy = url.searchParams.get('sortBy');
        const search = url.searchParams.get('search');
        const page = url.searchParams.get('page');

        if (search === 'zara') {
          return new Response(JSON.stringify(buildListResponse([
            buildListClient({
              id: 'client_search',
              fullName: 'Zara Bloom',
              phone: '3333333333',
              totalSpent: 18000,
            }),
          ])), { status: 200 });
        }

        if (sortBy === 'spent') {
          return new Response(JSON.stringify(buildListResponse([
            buildListClient({
              id: 'client_spent',
              fullName: 'Nora Vale',
              phone: '4444444444',
              totalSpent: 99000,
              totalVisits: 11,
              noShowCount: 0,
            }),
          ])), { status: 200 });
        }

        if (page === '2') {
          return new Response(JSON.stringify(buildListResponse([
            buildListClient({
              id: 'client_2',
              fullName: 'Bella Chen',
              phone: '2222222222',
              totalVisits: 2,
              totalSpent: 21000,
              noShowCount: 0,
            }),
          ], {
            total: 2,
            page: 2,
            totalPages: 2,
          })), { status: 200 });
        }

        return new Response(JSON.stringify(buildListResponse([
          buildListClient(),
        ], {
          total: 2,
          page: 1,
          totalPages: 2,
        })), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url.pathname}${url.search}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    expect(await screen.findByRole('button', { name: /ava thompson/i })).toBeInTheDocument();
    expect(screen.getByText('2 total')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load More Clients' }));

    expect(await screen.findByRole('button', { name: /bella chen/i })).toBeInTheDocument();
    expect(getClientListCalls().some(([url]) => String(url).includes('page=2'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Spent' }));

    expect(await screen.findByRole('button', { name: /nora vale/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bella chen/i })).not.toBeInTheDocument();
    expect(getClientListCalls().some(([url]) => String(url).includes('sortBy=spent') && String(url).includes('page=1'))).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Search clients'), { target: { value: 'zara' } });

    await waitFor(() => {
      expect(getClientListCalls().some(([url]) => String(url).includes('search=zara') && String(url).includes('page=1'))).toBe(true);
    });

    expect(await screen.findByRole('button', { name: /zara bloom/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nora vale/i })).not.toBeInTheDocument();
  });

  it('opens an exact client from a dashboard notification even when they are not on the first list page', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }
      if (url === '/api/admin/clients/client_dashboard?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildDetailResponse({
          client: {
            id: 'client_dashboard',
            fullName: 'Dashboard Lead',
            phone: '4165559999',
            email: 'lead@example.com',
          },
          upcomingAppointments: [],
          pastAppointments: [],
          recentIssues: [],
        })), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} initialClientId="client_dashboard" />);

    expect(await screen.findByRole('heading', { name: 'Dashboard Lead' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/clients/client_dashboard?salonSlug=isla-nail-studio',
      { cache: 'no-store' },
    );
  });

  it('loads real client detail, separates completed history from recent issues, and reuses cached detail on reopen', async () => {
    let detailFetchCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'ENABLED',
              clientBlocking: 'ENABLED',
            },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }

      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        detailFetchCount += 1;
        return new Response(JSON.stringify(buildDetailResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildFlagsResponse()), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));

    expect(await screen.findByText('Upcoming appointments')).toBeInTheDocument();
    expect(screen.getByText('Completed appointments')).toBeInTheDocument();
    expect(screen.getByText('Recent issues')).toBeInTheDocument();
    expect(screen.getByText('Gel Fill')).toBeInTheDocument();
    expect(screen.getByText('Classic Pedicure')).toBeInTheDocument();
    expect(screen.getByText('Builder Gel Fill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clients' }));
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));

    expect(await screen.findByText('Completed appointments')).toBeInTheDocument();
    expect(detailFetchCount).toBe(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100')).toHaveLength(1);
  });

  it('opens Edit only from owner client detail, preserves name parts, and refreshes after success', async () => {
    let detailFetchCount = 0;
    let currentName = 'Ava Marie Thompson';
    let currentUpdatedAt = '2026-07-25T15:30:00.000Z';

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'MODULE_DISABLED',
            },
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([
          buildListClient({ fullName: 'Ava Marie Thompson' }),
        ])), { status: 200 });
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        detailFetchCount += 1;
        return new Response(JSON.stringify(buildDetailResponse({
          client: {
            fullName: currentName,
            updatedAt: currentUpdatedAt,
          },
        })), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        currentName = `${body.firstName} ${body.lastName}`;
        currentUpdatedAt = '2026-07-25T15:31:00.000Z';
        return new Response(JSON.stringify({
          data: {
            client: {
              id: 'client_1',
              fullName: currentName,
              phone: '1111111111',
              email: 'ava@example.com',
              birthday: '1992-06-15',
              notes: 'Prefers shorter almond shape.',
              updatedAt: currentUpdatedAt,
            },
          },
        }), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    expect(screen.queryByTestId('edit-client-action')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /ava marie thompson/i }));

    fireEvent.click(await screen.findByTestId('edit-client-action'));

    expect(await screen.findByRole('dialog', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Ava');
    expect(screen.getByLabelText('Last name')).toHaveValue('Marie Thompson');
    expect(screen.getByLabelText('Birthday')).toHaveValue('1992-06-15');

    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: 'Marie Thompson-Santos' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit client' })).not.toBeInTheDocument();
    });
    const patchCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === '/api/admin/clients/client_1' && init?.method === 'PATCH');

    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      salonSlug: 'isla-nail-studio',
      expectedUpdatedAt: '2026-07-25T15:30:00.000Z',
      firstName: 'Ava',
      lastName: 'Marie Thompson-Santos',
    });
    expect(await screen.findAllByText('Ava Marie Thompson-Santos')).not.toHaveLength(0);
    expect(detailFetchCount).toBe(2);
  });

  it('keeps committed contact actions current when the post-save profile refresh fails', async () => {
    let detailFetchCount = 0;
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'MODULE_DISABLED',
            },
          },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([
          buildListClient(),
        ])), { status: 200 });
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), {
          status: 200,
        });
      }
      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        detailFetchCount += 1;
        if (detailFetchCount > 1) {
          return new Response(JSON.stringify({ error: 'unavailable' }), {
            status: 503,
          });
        }
        return new Response(JSON.stringify(buildDetailResponse()), {
          status: 200,
        });
      }
      if (url === '/api/admin/clients/client_1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          data: {
            client: {
              id: 'client_1',
              fullName: 'Ava Thompson',
              phone: '4165550998',
              email: 'ava@example.com',
              birthday: '1992-06-15',
              notes: 'Prefers shorter almond shape.',
              updatedAt: '2026-07-25T15:31:00.000000Z',
            },
          },
        }), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(await screen.findByTestId('edit-client-action'));

    fireEvent.change(await screen.findByLabelText('Phone'), {
      target: { value: '416-555-0998' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit client' }))
        .not.toBeInTheDocument();
    });

    expect(await screen.findByText(
      'The client was saved, but the latest profile could not be refreshed.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('(416) 555-0998').length).toBeGreaterThan(0);
    expect(screen.queryByText(/could not save/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('client-book-appointment'));

    expect(await screen.findByTestId('new-appointment-modal'))
      .toHaveTextContent('"phone":"4165550998"');
    expect(detailFetchCount).toBe(2);

    consoleError.mockRestore();
  });

  it('ignores an older detail response that resolves after a committed contact edit', async () => {
    const staleDetail = deferredResponse();
    let detailFetchCount = 0;

    fetchMock.mockImplementation((
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'MODULE_DISABLED',
            },
          },
        }), { status: 200 }));
      }
      if (url.startsWith('/api/admin/clients?')) {
        return Promise.resolve(new Response(JSON.stringify(buildListResponse([
          buildListClient(),
        ])), { status: 200 }));
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return Promise.resolve(new Response(JSON.stringify(buildTechniciansResponse()), {
          status: 200,
        }));
      }
      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        detailFetchCount += 1;
        if (detailFetchCount === 2) {
          return staleDetail.promise;
        }
        return Promise.resolve(new Response(JSON.stringify(buildDetailResponse({
          client: detailFetchCount === 1
            ? {}
            : {
                phone: '4165550998',
                updatedAt: '2026-07-25T15:31:00.000000Z',
              },
        })), { status: 200 }));
      }
      if (url === '/api/admin/clients/client_1' && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            client: {
              id: 'client_1',
              fullName: 'Ava Thompson',
              phone: '4165550998',
              email: 'ava@example.com',
              birthday: '1992-06-15',
              notes: 'Prefers shorter almond shape.',
              updatedAt: '2026-07-25T15:31:00.000000Z',
            },
          },
        }), { status: 200 }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));

    fireEvent.click(await screen.findByTestId('client-book-appointment'));
    fireEvent.click(await screen.findByTestId('complete-mocked-booking'));
    await waitFor(() => expect(detailFetchCount).toBe(2));

    fireEvent.click(await screen.findByTestId('edit-client-action'));
    fireEvent.change(await screen.findByLabelText('Phone'), {
      target: { value: '416-555-0998' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit client' }))
        .not.toBeInTheDocument();
    });

    expect(await screen.findAllByText('(416) 555-0998')).not.toHaveLength(0);
    expect(detailFetchCount).toBe(3);

    const detailCalls = fetchMock.mock.calls.filter(([requestUrl]) =>
      String(requestUrl) === '/api/admin/clients/client_1?salonSlug=isla-nail-studio');

    expect(detailCalls[1]?.[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      staleDetail.resolve(new Response(JSON.stringify(buildDetailResponse()), {
        status: 200,
      }));
      await staleDetail.promise;
    });

    expect(screen.getAllByText('(416) 555-0998')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Clients' }));
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));

    expect(await screen.findAllByText('(416) 555-0998')).not.toHaveLength(0);
    expect(detailFetchCount).toBe(3);

    fireEvent.click(screen.getByTestId('client-book-appointment'));

    expect(await screen.findByTestId('new-appointment-modal'))
      .toHaveTextContent('"phone":"4165550998"');
    expect(screen.queryByText(
      'The client was saved, but the latest profile could not be refreshed.',
    )).not.toBeInTheDocument();
  });

  it('separates deposit, refund, other payments, paid amount, and balance', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildDetailResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    render(<ClientsModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));

    expect(await screen.findByText('Lifetime spend')).toBeInTheDocument();
    expect(screen.getByText('Spend this month')).toBeInTheDocument();
    expect(screen.getByText('Completed outstanding')).toBeInTheDocument();
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$60.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Payments' }));

    expect(await screen.findByText(/Completed appointment value and recorded payments are separate/)).toBeInTheDocument();
    expect(screen.getByText('Deposit paid')).toBeInTheDocument();
    expect(screen.getByText('Deposit refunded')).toBeInTheDocument();
    expect(screen.getByText('Other payments')).toBeInTheDocument();
    expect(screen.getByText('Already paid')).toBeInTheDocument();
    expect(screen.getByText('Balance')).toBeInTheDocument();
    expect(screen.getAllByText('$25.00')).toHaveLength(2);
    expect(screen.getAllByText('$40.00')).toHaveLength(2);
    expect(screen.getAllByText('$60.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Notes & Photos' }));

    expect(screen.getByLabelText('Private notes')).toHaveValue('Prefers shorter almond shape.');
    expect(screen.getByText('No appointment photos yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByLabelText('Preferred artist')).toBeInTheDocument();
    expect(screen.getByLabelText('Private notes')).toBeInTheDocument();
  });

  it.each([
    ['pending refund', 'DEPOSIT_REFUND_IN_FLIGHT'],
    ['failed refund', 'DEPOSIT_REFUND_UNRESOLVED'],
    ['refund conflict', 'DEPOSIT_REFUND_CONFLICT'],
  ])('shows only under-review copy for a %s appointment', async (_case, blockCode) => {
    const detail = buildDetailResponse({
      upcomingAppointments: [],
      recentIssues: [],
      pastAppointments: [{
        id: 'appt_blocked',
        startTime: '2026-03-10T14:00:00.000Z',
        endTime: '2026-03-10T15:00:00.000Z',
        status: 'completed',
        totalPrice: 54321,
        currency: 'CAD',
        technician: { id: 'tech_2', name: 'Mila', avatarUrl: null },
        services: [{ id: 'svc_pedicure', name: 'Classic Pedicure', price: 54321 }],
        addOns: [{ id: 'addon_art', name: 'Nail art', quantity: 1, lineTotalCents: 3333 }],
        financial: {
          completedValueCents: 12345,
          source: 'finalized',
          discountCents: 1000,
          taxCents: 1111,
          tipsCents: 2222,
          paymentsReceivedCents: 4567,
          paymentLedgerState: 'ledger',
          paymentLedgerBlockCode: null,
          depositCollectedCents: 2345,
          depositRefundedCents: 3456,
          depositForfeitedCents: 0,
          depositCreditCents: 2345,
          // Exercise the UI's own block-code fence instead of trusting the
          // companion state label from the API.
          depositState: 'resolved',
          depositBlockCode: blockCode,
          depositPresentationState: 'refund_in_flight',
          amountAlreadyPaidCents: 6912,
          payments: [{
            id: 'payment_blocked',
            amountCents: 4567,
            method: 'cash',
            recordedAt: '2026-03-10T15:00:00.000Z',
          }],
          paymentStatus: 'partially_paid',
          completedOutstandingCents: 6544,
          balanceCents: 6544,
          balanceState: 'completed_outstanding',
        },
        notes: null,
      }],
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(detail), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    render(<ClientsModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Payments' }));

    const paymentCard = await screen.findByTestId('client-payment-appointment-appt_blocked');

    expect(within(paymentCard).getByText('Under review')).toBeInTheDocument();
    expect(within(paymentCard).getByText(
      'Financial details under review. Amounts and balance are unavailable.',
    )).toBeInTheDocument();
    expect(within(paymentCard).queryByText('Deposit paid')).not.toBeInTheDocument();

    for (const leakedMoney of [
      '$543.21',
      '$123.45',
      '$23.45',
      '$34.56',
      '$45.67',
      '$69.12',
      '$11.11',
      '$22.22',
      '$65.44',
    ]) {
      expect(within(paymentCard).queryByText(leakedMoney)).not.toBeInTheDocument();
    }
  });

  it('saves preferred artist changes, then reloads the persisted value', async () => {
    let detailFetchCount = 0;
    let currentNotes = 'Prefers shorter almond shape.';
    let currentPreferredTechnician: { id: string; name: string; avatarUrl: null } | null = {
      id: 'tech_1',
      name: 'Daniela',
      avatarUrl: null,
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'ENABLED',
              clientBlocking: 'ENABLED',
            },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }

      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        detailFetchCount += 1;
        return new Response(JSON.stringify(buildDetailResponse({
          client: {
            notes: currentNotes,
            preferredTechnician: currentPreferredTechnician,
          },
        })), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildFlagsResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        currentNotes = body.notes;
        currentPreferredTechnician = body.preferredTechnicianId
          ? { id: 'tech_2', name: 'Mila', avatarUrl: null }
          : null;
        return new Response(JSON.stringify({
          data: {
            client: {
              id: 'client_1',
              preferredTechnicianId: body.preferredTechnicianId,
              notes: body.notes,
            },
          },
        }), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

    expect(await screen.findByLabelText('Preferred artist')).toHaveValue('tech_1');
    expect(screen.getByText('Client-submitted preferences')).toBeInTheDocument();
    expect(screen.getByText('quiet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Preferred artist'), { target: { value: 'tech_2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/admin/clients/client_1' && init?.method === 'PATCH'),
      ).toBe(true);
    });

    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/admin/clients/client_1' && init?.method === 'PATCH');

    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual(expect.objectContaining({
      salonSlug: 'isla-nail-studio',
      expectedUpdatedAt: '2026-07-25T15:30:00.000Z',
      notes: 'Prefers shorter almond shape.',
      preferredTechnicianId: 'tech_2',
    }));

    await waitFor(() => {
      expect(screen.getByLabelText('Preferred artist')).toHaveValue('tech_2');
    });

    expect(detailFetchCount).toBe(2);
  });

  it('shows explicit empty states for clients without upcoming or completed history', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'MODULE_DISABLED',
            },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient({
          id: 'client_empty',
          fullName: 'Nova Guest',
          phone: '5555555555',
          totalVisits: 0,
          totalSpent: 0,
          noShowCount: 0,
          loyaltyPoints: 0,
        })])), { status: 200 });
      }

      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_empty?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildDetailResponse({
          client: {
            id: 'client_empty',
            phone: '5555555555',
            fullName: 'Nova Guest',
            email: null,
            preferredTechnician: null,
            notes: null,
            totalVisits: 0,
            totalSpent: 0,
            averageSpend: 0,
            noShowCount: 0,
            loyaltyPoints: 0,
          },
          upcomingAppointments: [],
          pastAppointments: [],
          recentIssues: [],
        })), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /nova guest/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));

    expect(await screen.findByText('No upcoming appointments booked.')).toBeInTheDocument();
    expect(screen.getByText('No completed appointments yet.')).toBeInTheDocument();
    expect(screen.queryByText('Recent issues')).not.toBeInTheDocument();
  });

  it('hides flag and block controls when the modules are unavailable', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'UPGRADE_REQUIRED',
            },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildDetailResponse()), { status: 200 });
      }

      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));

    expect(await screen.findByText('Upcoming appointments')).toBeInTheDocument();
    expect(screen.queryByLabelText('Problem client flag')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Block future booking')).not.toBeInTheDocument();
  });

  it('renders and saves flag and block controls when their modules are enabled', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'ENABLED',
              clientBlocking: 'ENABLED',
            },
          },
        }), { status: 200 });
      }

      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildDetailResponse()), { status: 200 });
      }

      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio') {
        return new Response(JSON.stringify(buildFlagsResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1/flag' && init?.method === 'PUT') {
        return new Response(JSON.stringify(buildFlagsResponse({
          isProblemClient: true,
          flagReason: 'Aggressive behavior',
          isBlocked: true,
          blockedReason: 'Repeated no-shows',
        })), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));

    expect(await screen.findByLabelText('Problem client flag')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Problem client flag'));
    fireEvent.change(screen.getByLabelText('Problem client reason'), { target: { value: 'Aggressive behavior' } });

    fireEvent.click(screen.getByLabelText('Block future booking'));
    fireEvent.change(screen.getByLabelText('Blocked booking reason'), { target: { value: 'Repeated no-shows' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save status' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/admin/clients/client_1/flag' && init?.method === 'PUT'),
      ).toBe(true);
    });

    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/admin/clients/client_1/flag' && init?.method === 'PUT');

    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      salonSlug: 'isla-nail-studio',
      isProblemClient: true,
      flagReason: 'Aggressive behavior',
      isBlocked: true,
      blockedReason: 'Repeated no-shows',
    });
  });

  it('renames Client Hub to Client Insights and opens exact server-filtered directory results', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/admin/settings/modules') {
        return new Response(JSON.stringify({
          data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } },
        }), { status: 200 });
      }
      if (url.pathname === '/api/admin/technicians') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }
      if (url.pathname === '/api/admin/client-insights') {
        return new Response(JSON.stringify(buildInsightsResponse()), { status: 200 });
      }
      if (url.pathname === '/api/admin/clients') {
        if (url.searchParams.get('segment') === 'overdue') {
          return new Response(JSON.stringify(buildListResponse([
            buildListClient({
              id: 'client_overdue',
              fullName: 'Overdue Olivia',
              phone: '4165550110',
            }),
          ])), { status: 200 });
        }
        return new Response(JSON.stringify(buildListResponse([
          buildListClient(),
        ])), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    const search = await screen.findByPlaceholderText('Search clients');
    fireEvent.change(search, { target: { value: 'Ava' } });
    await waitFor(() => expect(search).toHaveValue('Ava'));

    const directory = screen.getByTestId('clients-directory-scroll');
    directory.scrollTop = 137;
    fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));

    expect(await screen.findByRole('heading', { name: 'Client health' })).toBeInTheDocument();
    expect(screen.queryByText('Client Hub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Clients' }));
    await waitFor(() => expect(
      screen.getByTestId('clients-directory-scroll').scrollTop,
    ).toBe(137));

    fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));

    expect(await screen.findByRole('heading', { name: 'Client health' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('client-insights-kpi-overdue'));

    expect(await screen.findByTestId('clients-active-segment')).toHaveTextContent('Overdue');
    expect(await screen.findByRole('button', { name: /Overdue Olivia/ })).toBeInTheDocument();

    const filteredCall = getClientListCalls()
      .map(([url]) => new URL(String(url), 'http://localhost'))
      .find(url => url.searchParams.get('segment') === 'overdue');

    expect(filteredCall?.searchParams.get('search')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(await screen.findByPlaceholderText('Search clients')).toHaveValue('Ava');
    expect(screen.getByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();
  });

  it('archives a stale-source detail, closes it, purges both IDs, refetches, and invalidates retention', async () => {
    let listFetchCount = 0;
    let detailFetchCount = 0;
    let archiveSubmitCount = 0;
    let completeArchiveResponse!: (response: Response) => void;
    const archiveResponse = new Promise<Response>((resolve) => {
      completeArchiveResponse = resolve;
    });
    const retentionChanged = vi.fn();
    const googleSuggestionsRefresh = vi.fn();
    window.addEventListener('luster:retention-data-changed', retentionChanged);

    fetchMock.mockImplementation(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input), 'http://localhost');

      if (url.pathname === '/api/admin/settings/modules') {
        return new Response(JSON.stringify({
          data: {
            moduleReasons: {
              clientFlags: 'MODULE_DISABLED',
              clientBlocking: 'MODULE_DISABLED',
            },
          },
        }), { status: 200 });
      }
      if (url.pathname === '/api/admin/technicians') {
        return new Response(
          JSON.stringify(buildTechniciansResponse()),
          { status: 200 },
        );
      }
      if (url.pathname === '/api/admin/clients') {
        listFetchCount += 1;
        return new Response(JSON.stringify(buildListResponse(
          listFetchCount === 1
            ? [buildListClient({ id: 'source_client' })]
            : [],
        )), { status: 200 });
      }
      if (url.pathname === '/api/admin/clients/source_client') {
        detailFetchCount += 1;
        return new Response(JSON.stringify(buildDetailResponse({
          client: { id: 'terminal_client' },
        })), { status: 200 });
      }
      if (
        url.pathname === '/api/admin/clients/source_client/archive'
        && init?.method === 'POST'
      ) {
        archiveSubmitCount += 1;
        return archiveResponse;
      }
      throw new Error(`Unhandled fetch: ${url.pathname}${url.search}`);
    });

    try {
      render(
        <>
          <section data-testid="google-review-queue">
            <button
              type="button"
              aria-label="Refresh Google events"
              onClick={googleSuggestionsRefresh}
            />
          </section>
          <ClientsModal onClose={() => {}} />
        </>,
      );

      fireEvent.click(
        await screen.findByRole('button', { name: /ava thompson/i }),
      );
      fireEvent.click(await screen.findByTestId('client-delete-action'));

      const archiveDialog = await screen.findByTestId('client-archive-dialog');

      expect(
        within(archiveDialog).getByRole('heading', { name: 'Delete client?' }),
      ).toBeInTheDocument();
      expect(archiveDialog).toHaveTextContent(
        'This client will be removed from your active client list. Their appointments, payments and history will be kept.',
      );
      expect(screen.queryByText('Advanced', { exact: true }))
        .not.toBeInTheDocument();

      const archiveConfirm = within(archiveDialog).getByTestId(
        'client-archive-confirm',
      );
      fireEvent.click(archiveConfirm);
      fireEvent.click(archiveConfirm);

      expect(archiveConfirm).toBeDisabled();
      expect(archiveSubmitCount).toBe(1);

      await act(async () => {
        completeArchiveResponse(new Response(JSON.stringify({
          data: {
            code: 'CLIENT_ARCHIVED',
            clientId: 'terminal_client',
          },
        }), { status: 200 }));
        await archiveResponse;
      });

      expect(await screen.findByTestId('client-lifecycle-success'))
        .toHaveTextContent(
          'Client deleted from the active list. Their history was kept.',
        );
      expect(screen.queryByRole('heading', { name: 'Ava Thompson' }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ava thompson/i }))
        .not.toBeInTheDocument();

      await waitFor(() => expect(listFetchCount).toBeGreaterThanOrEqual(2));

      expect(detailFetchCount).toBe(1);
      expect(retentionChanged).toHaveBeenCalledTimes(1);
      expect(googleSuggestionsRefresh).toHaveBeenCalledTimes(1);

      const archiveCall = fetchMock.mock.calls.find(([requestUrl]) =>
        String(requestUrl).includes('/source_client/archive'));

      expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({
        salonSlug: 'isla-nail-studio',
        expectedUpdatedAt: '2026-07-25T15:30:00.000Z',
      });
    } finally {
      window.removeEventListener(
        'luster:retention-data-changed',
        retentionChanged,
      );
    }
  });

  describe('directory stale-request protection', () => {
    it('does not let a cleared segment response replace the restored directory', async () => {
      const overdue = deferredResponse();
      mockDirectoryRaceRoutes((url) => {
        if (url.searchParams.get('segment') === 'overdue') {
          return overdue.promise;
        }
        return listResponse([buildListClient()]);
      });

      render(<ClientsModal onClose={() => {}} />);

      expect(await screen.findByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));
      fireEvent.click(await screen.findByTestId('client-insights-kpi-overdue'));

      expect(await screen.findByTestId('clients-active-segment')).toBeInTheDocument();

      const filteredCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes('segment=overdue'));
      const filteredSignal = filteredCall?.[1]?.signal;
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      expect(filteredSignal?.aborted).toBe(true);
      expect(await screen.findByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();

      await act(async () => {
        overdue.resolve(listResponse([
          buildListClient({
            id: 'late-overdue',
            fullName: 'Late Overdue Result',
          }),
        ]));
        await overdue.promise;
      });

      expect(screen.queryByRole('button', { name: /Late Overdue Result/ }))
        .not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ava Thompson/ }))
        .toBeInTheDocument();
      expect(screen.queryByText('Unable to load clients')).not.toBeInTheDocument();
    });

    it('keeps Segment B when Segment A resolves last', async () => {
      const active = deferredResponse();
      const overdue = deferredResponse();
      mockDirectoryRaceRoutes((url) => {
        if (url.searchParams.get('segment') === 'active') {
          return active.promise;
        }
        if (url.searchParams.get('segment') === 'overdue') {
          return overdue.promise;
        }
        return listResponse([buildListClient()]);
      });

      render(<ClientsModal onClose={() => {}} />);

      expect(await screen.findByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));
      fireEvent.click(await screen.findByTestId('client-insights-kpi-active'));

      expect(await screen.findByTestId('clients-active-segment')).toHaveTextContent(
        'Active clients',
      );

      fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));
      fireEvent.click(await screen.findByTestId('client-insights-kpi-overdue'));

      expect(await screen.findByTestId('clients-active-segment')).toHaveTextContent(
        'Overdue',
      );

      await act(async () => {
        overdue.resolve(listResponse([
          buildListClient({
            id: 'segment-b',
            fullName: 'Segment B Client',
          }),
        ]));
        await overdue.promise;
      });

      expect(await screen.findByRole('button', { name: /Segment B Client/ }))
        .toBeInTheDocument();

      await act(async () => {
        active.resolve(listResponse([
          buildListClient({
            id: 'segment-a',
            fullName: 'Segment A Client',
          }),
        ]));
        await active.promise;
      });

      expect(screen.queryByRole('button', { name: /Segment A Client/ }))
        .not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Segment B Client/ }))
        .toBeInTheDocument();
    });

    it('ignores an older search response when the search changes', async () => {
      const firstSearch = deferredResponse();
      const secondSearch = deferredResponse();
      mockDirectoryRaceRoutes((url) => {
        if (url.searchParams.get('search') === 'old') {
          return firstSearch.promise;
        }
        if (url.searchParams.get('search') === 'new') {
          return secondSearch.promise;
        }
        return listResponse([buildListClient()]);
      });

      render(<ClientsModal onClose={() => {}} />);

      expect(await screen.findByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();

      const search = screen.getByPlaceholderText('Search clients');
      fireEvent.change(search, { target: { value: 'old' } });
      await waitFor(() => expect(
        getClientListCalls().some(([input]) => String(input).includes('search=old')),
      ).toBe(true));

      fireEvent.change(search, { target: { value: 'new' } });
      await waitFor(() => expect(
        getClientListCalls().some(([input]) => String(input).includes('search=new')),
      ).toBe(true));

      await act(async () => {
        secondSearch.resolve(listResponse([
          buildListClient({
            id: 'new-search',
            fullName: 'New Search Result',
          }),
        ]));
        await secondSearch.promise;
      });

      expect(await screen.findByRole('button', { name: /New Search Result/ }))
        .toBeInTheDocument();

      await act(async () => {
        firstSearch.resolve(listResponse([
          buildListClient({
            id: 'old-search',
            fullName: 'Old Search Result',
          }),
        ]));
        await firstSearch.promise;
      });

      expect(screen.queryByRole('button', { name: /Old Search Result/ }))
        .not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /New Search Result/ }))
        .toBeInTheDocument();
    });

    it('does not append a late Load More page after clearing its segment', async () => {
      const pageTwo = deferredResponse();
      mockDirectoryRaceRoutes((url) => {
        if (
          url.searchParams.get('segment') === 'overdue'
          && url.searchParams.get('page') === '2'
        ) {
          return pageTwo.promise;
        }
        if (url.searchParams.get('segment') === 'overdue') {
          return listResponse([
            buildListClient({
              id: 'overdue-page-one',
              fullName: 'Overdue Page One',
            }),
          ], {
            total: 2,
            page: 1,
            totalPages: 2,
          });
        }
        return listResponse([buildListClient()]);
      });

      render(<ClientsModal onClose={() => {}} />);

      expect(await screen.findByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));
      fireEvent.click(await screen.findByTestId('client-insights-kpi-overdue'));

      expect(await screen.findByRole('button', { name: /Overdue Page One/ }))
        .toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Load More Clients' }));
      await waitFor(() => expect(
        getClientListCalls().some(([input]) =>
          String(input).includes('segment=overdue')
          && String(input).includes('page=2')),
      ).toBe(true));

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      expect(await screen.findByRole('button', { name: /Ava Thompson/ }))
        .toBeInTheDocument();

      await act(async () => {
        pageTwo.resolve(listResponse([
          buildListClient({
            id: 'late-page-two',
            fullName: 'Late Page Two',
          }),
        ], {
          total: 2,
          page: 2,
          totalPages: 2,
        }));
        await pageTwo.promise;
      });

      expect(screen.queryByRole('button', { name: /Late Page Two/ }))
        .not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ava Thompson/ }))
        .toBeInTheDocument();
    });

    it('does not surface an obsolete request failure', async () => {
      const obsolete = deferredResponse();
      mockDirectoryRaceRoutes((url) => {
        if (url.searchParams.get('segment') === 'overdue') {
          return obsolete.promise;
        }
        return listResponse([buildListClient()]);
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ClientsModal onClose={() => {}} />);

      expect(await screen.findByRole('button', { name: /Ava Thompson/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Client Insights' }));
      fireEvent.click(await screen.findByTestId('client-insights-kpi-overdue'));

      expect(await screen.findByTestId('clients-active-segment')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      await act(async () => {
        obsolete.reject(new Error('obsolete failure'));
        await obsolete.promise.catch(() => {});
      });

      expect(screen.queryByText('Unable to load clients')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ava Thompson/ }))
        .toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalledWith(
        'Failed to fetch clients:',
        expect.anything(),
      );

      consoleError.mockRestore();
    });
  });

  describe('appointment management from the client profile', () => {
    function mockProfileRoutes() {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith('/api/admin/settings/modules?')) {
          return new Response(JSON.stringify({
            data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } },
          }), { status: 200 });
        }
        if (url.startsWith('/api/admin/clients?')) {
          return new Response(JSON.stringify(buildListResponse([buildListClient()])), { status: 200 });
        }
        if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
          return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
        }
        if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
          return new Response(JSON.stringify(buildDetailResponse()), { status: 200 });
        }
        if (url === '/api/appointments/appt_upcoming/manage?salonSlug=isla-nail-studio') {
          return new Response(JSON.stringify(buildManageDetailResponse('appt_upcoming')), { status: 200 });
        }
        throw new Error(`Unhandled fetch: ${url}`);
      });
    }

    it('opens the shared manage sheet from an upcoming appointment card with the salon hint', async () => {
      mockProfileRoutes();
      render(<ClientsModal onClose={() => {}} />);

      fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));
      fireEvent.click(await screen.findByTestId('client-appointment-change-appt_upcoming'));

      expect(await screen.findByTestId('appointment-quick-edit-sheet')).toBeInTheDocument();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_upcoming/manage?salonSlug=isla-nail-studio');
      });
    });

    it('opens the cancel confirmation directly from the card Cancel button', async () => {
      mockProfileRoutes();
      render(<ClientsModal onClose={() => {}} />);

      fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));
      fireEvent.click(await screen.findByTestId('client-appointment-cancel-appt_upcoming'));

      expect(await screen.findByText('Cancel this appointment?')).toBeInTheDocument();
      expect(screen.getByText(/frees the time slot/i)).toBeInTheDocument();
    });

    it('does not offer Cancel on completed history, but cards still open the sheet', async () => {
      mockProfileRoutes();
      render(<ClientsModal onClose={() => {}} />);

      fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Appointments' }));

      await screen.findByTestId('client-appointment-card-appt_completed');

      expect(screen.queryByTestId('client-appointment-cancel-appt_completed')).not.toBeInTheDocument();
      expect(screen.getByTestId('client-appointment-change-appt_completed')).toBeInTheDocument();
    });

    it('opens the booking modal prefilled with the client from Book appointment', async () => {
      mockProfileRoutes();
      render(<ClientsModal onClose={() => {}} />);

      fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
      fireEvent.click(await screen.findByTestId('client-book-appointment'));

      const bookingModal = await screen.findByTestId('new-appointment-modal');

      expect(JSON.parse(bookingModal.textContent!)).toEqual(expect.objectContaining({
        name: 'Ava Thompson',
        phone: '1111111111',
        email: 'ava@example.com',
        serviceId: 'svc_pedicure',
        technicianId: 'tech_2',
      }));
    });
  });
});
