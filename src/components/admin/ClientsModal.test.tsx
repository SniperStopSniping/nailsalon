import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  NewAppointmentModal: ({ isOpen, clientPrefill }: { isOpen: boolean; clientPrefill?: unknown }) => (
    isOpen
      ? <div data-testid="new-appointment-modal">{JSON.stringify(clientPrefill ?? null)}</div>
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
}>) {
  return {
    data: {
      client: {
        id: 'client_1',
        phone: '1111111111',
        fullName: 'Ava Thompson',
        email: 'ava@example.com',
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
        ...overrides?.client,
      },
      upcomingAppointments: overrides?.upcomingAppointments ?? [{
        id: 'appt_upcoming',
        startTime: '2026-04-04T15:00:00.000Z',
        endTime: '2026-04-04T16:00:00.000Z',
        status: 'confirmed',
        totalPrice: 9500,
        technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        services: [{ name: 'Gel Fill', price: 9500 }],
        notes: 'French finish',
      }],
      pastAppointments: overrides?.pastAppointments ?? [{
        id: 'appt_completed',
        startTime: '2026-03-10T14:00:00.000Z',
        endTime: '2026-03-10T15:00:00.000Z',
        status: 'completed',
        totalPrice: 8200,
        technician: { id: 'tech_2', name: 'Mila', avatarUrl: null },
        services: [{ name: 'Classic Pedicure', price: 8200 }],
        notes: null,
      }],
      recentIssues: overrides?.recentIssues ?? [{
        id: 'appt_issue',
        startTime: '2026-03-02T14:00:00.000Z',
        endTime: '2026-03-02T15:00:00.000Z',
        status: 'no_show',
        totalPrice: 0,
        technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        services: [{ name: 'Builder Gel Fill', price: 9900 }],
        notes: 'Did not arrive',
      }],
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

    expect(await screen.findByText('Upcoming appointments')).toBeInTheDocument();
    expect(screen.getByText('Completed appointments')).toBeInTheDocument();
    expect(screen.getByText('Recent issues')).toBeInTheDocument();
    expect(screen.getByText('Gel Fill')).toBeInTheDocument();
    expect(screen.getByText('Classic Pedicure')).toBeInTheDocument();
    expect(screen.getByText('Builder Gel Fill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clients' }));
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));

    expect(await screen.findByText('Completed appointments')).toBeInTheDocument();
    expect(detailFetchCount).toBe(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100')).toHaveLength(1);
  });

  it('saves notes and preferred artist changes, then reloads persisted values', async () => {
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

    expect(await screen.findByLabelText('Preferred artist')).toHaveValue('tech_1');

    fireEvent.change(screen.getByLabelText('Preferred artist'), { target: { value: 'tech_2' } });
    fireEvent.change(screen.getByLabelText('Private notes'), { target: { value: 'VIP chrome client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/admin/clients/client_1' && init?.method === 'PATCH'),
      ).toBe(true);
    });

    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/admin/clients/client_1' && init?.method === 'PATCH');

    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual(expect.objectContaining({
      salonSlug: 'isla-nail-studio',
      notes: 'VIP chrome client',
      preferredTechnicianId: 'tech_2',
    }));

    await waitFor(() => {
      expect(screen.getByLabelText('Private notes')).toHaveValue('VIP chrome client');
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
      fireEvent.click(await screen.findByTestId('client-appointment-cancel-appt_upcoming'));

      expect(await screen.findByText('Cancel this appointment?')).toBeInTheDocument();
      expect(screen.getByText(/frees the time slot/i)).toBeInTheDocument();
    });

    it('does not offer Cancel on completed history, but cards still open the sheet', async () => {
      mockProfileRoutes();
      render(<ClientsModal onClose={() => {}} />);

      fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));

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
      }));
    });
  });
});
