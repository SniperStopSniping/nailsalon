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
  birthday?: string | null;
  archivedAt?: string | null;
  mergedIntoClientId?: string | null;
  updatedAt?: string;
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
    birthday: '1992-06-12',
    archivedAt: null,
    mergedIntoClientId: null,
    updatedAt: '2026-03-20T12:00:00.000Z',
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
  summary: Record<string, unknown>;
  submittedPreferences: Record<string, unknown> | null;
  management: Record<string, unknown>;
  notesHistory: Array<Record<string, unknown>>;
}>) {
  return {
    data: {
      client: {
        id: 'client_1',
        phone: '1111111111',
        fullName: 'Ava Thompson',
        firstName: 'Ava',
        lastName: 'Thompson',
        email: 'ava@example.com',
        birthday: '1992-06-12',
        preferredTechnician: {
          id: 'tech_1',
          name: 'Daniela',
          avatarUrl: null,
        },
        notes: 'Prefers shorter almond shape.',
        sensitivities: null,
        nailPreferences: {},
        tags: ['regular'],
        rebookIntervalDays: 21,
        nextRebookDueAt: null,
        lastContactAt: null,
        lastVisitAt: '2026-03-10T14:00:00.000Z',
        totalVisits: 6,
        totalSpent: 45500,
        averageSpend: 7583,
        noShowCount: 1,
        loyaltyPoints: 820,
        hasGoogleReview: false,
        googleReviewMarkedAt: null,
        archivedAt: null,
        mergedIntoClientId: null,
        updatedAt: '2026-03-20T12:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        ...overrides?.client,
      },
      management: overrides?.management ?? {
        resolvedFromClientId: null,
        canManageLifecycle: true,
        canPermanentlyDelete: false,
        authenticationIdentityDeferred: true,
      },
      upcomingAppointments: overrides?.upcomingAppointments ?? [{
        id: 'appt_upcoming',
        startTime: '2026-04-04T15:00:00.000Z',
        endTime: '2026-04-04T16:00:00.000Z',
        status: 'confirmed',
        totalPrice: 9500,
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
          payments: [{
            id: 'payment_1',
            amountCents: 4000,
            method: 'cash',
            recordedAt: '2026-03-10T15:00:00.000Z',
          }],
          paymentStatus: 'partially_paid',
          completedOutstandingCents: 6000,
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
      notesHistory: overrides?.notesHistory ?? [{
        id: 'note_merged',
        body: 'Avoid acetone soak when possible.',
        sourceClientId: 'client_merged',
        createdAt: '2026-02-20T12:00:00.000Z',
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
    expect(getClientListCalls().some(([requestUrl]) => (
      new URL(String(requestUrl), 'http://localhost').searchParams.get('scope') === 'active'
    ))).toBe(true);

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

  it('defaults to the active directory and replaces it with archived clients when requested', async () => {
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

      if (url.pathname === '/api/admin/clients') {
        if (url.searchParams.get('scope') === 'archived') {
          return new Response(JSON.stringify(buildListResponse([
            buildListClient({
              id: 'client_archived',
              fullName: 'Archived Avery',
              phone: '4165550199',
              archivedAt: '2026-03-21T12:00:00.000Z',
            }),
          ])), { status: 200 });
        }

        return new Response(JSON.stringify(buildListResponse([
          buildListClient({
            id: 'client_active',
            fullName: 'Active Avery',
          }),
        ])), { status: 200 });
      }

      throw new Error(`Unhandled fetch: ${url.pathname}${url.search}`);
    });

    render(<ClientsModal onClose={() => {}} />);

    expect(await screen.findByRole('button', { name: /active avery/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archived avery/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Active' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Archived' }));

    expect(await screen.findByRole('button', { name: /archived avery/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /active avery/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Archived' })).toHaveAttribute('aria-selected', 'true');
    expect(getClientListCalls().some(([requestUrl]) => (
      new URL(String(requestUrl), 'http://localhost').searchParams.get('scope') === 'archived'
    ))).toBe(true);
  });

  it('keeps Book, Text, and Call intact and places management controls in More actions', async () => {
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

    for (const action of ['Book', 'Text', 'Call']) {
      expect(await screen.findByRole('button', { name: action })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByText('More actions'));

    expect(screen.getByRole('button', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive client' })).toBeInTheDocument();
  });

  it('refreshes profile, flags, and delete eligibility after an archived profile edit', async () => {
    let edited = false;
    let detailFetchCount = 0;
    let flagFetchCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/admin/settings/modules?')) {
        return new Response(JSON.stringify({
          data: { moduleReasons: { clientFlags: 'ENABLED', clientBlocking: 'ENABLED' } },
        }), { status: 200 });
      }
      if (url.startsWith('/api/admin/clients?')) {
        return new Response(JSON.stringify(buildListResponse([buildListClient({
          archivedAt: '2026-03-21T12:00:00.000Z',
        })])), { status: 200 });
      }
      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1?salonSlug=isla-nail-studio') {
        detailFetchCount += 1;
        return new Response(JSON.stringify(buildDetailResponse({
          client: {
            archivedAt: '2026-03-21T12:00:00.000Z',
            email: edited ? 'updated@example.com' : 'ava@example.com',
            updatedAt: edited
              ? '2026-03-21T13:00:00.000Z'
              : '2026-03-20T12:00:00.000Z',
          },
          management: {
            resolvedFromClientId: null,
            canManageLifecycle: true,
            canPermanentlyDelete: !edited,
            authenticationIdentityDeferred: false,
          },
        })), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio') {
        flagFetchCount += 1;
        return new Response(JSON.stringify(buildFlagsResponse()), { status: 200 });
      }
      if (url === '/api/admin/clients/client_1' && init?.method === 'PATCH') {
        edited = true;
        return new Response(JSON.stringify({
          data: {
            client: {
              id: 'client_1',
              email: 'updated@example.com',
              updatedAt: '2026-03-21T13:00:00.000Z',
            },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    render(<ClientsModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
    fireEvent.click(screen.getByText('More actions'));

    expect(await screen.findByRole('button', { name: 'Delete permanently' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'updated@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete permanently' }))
        .not.toBeInTheDocument();
      expect(detailFetchCount).toBeGreaterThanOrEqual(2);
      expect(flagFetchCount).toBeGreaterThanOrEqual(2);
    });
  });

  it('keeps the profile edit surface constrained for an exact 390×844 viewport', async () => {
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 390 },
      innerHeight: { configurable: true, value: 844 },
    });
    window.dispatchEvent(new Event('resize'));

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

    try {
      render(<ClientsModal onClose={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: /ava thompson/i }));
      fireEvent.click(screen.getByText('More actions'));
      fireEvent.click(await screen.findByRole('button', { name: 'Edit client' }));

      const profileSurface = screen.getByRole('heading', { name: 'Ava Thompson' })
        .closest('.overflow-x-hidden');
      const editDialog = await screen.findByRole('dialog', { name: 'Edit client' });

      expect(profileSurface).toBeInTheDocument();
      expect(editDialog).toHaveClass('min-w-0');
      expect(screen.getByLabelText('Phone number')).toHaveClass('w-full', 'min-w-0');
      expect(screen.getByLabelText('First name').parentElement?.parentElement).toHaveClass(
        'grid-cols-1',
        'min-w-0',
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    } finally {
      Object.defineProperties(window, {
        innerWidth: { configurable: true, value: previousWidth },
        innerHeight: { configurable: true, value: previousHeight },
      });
      window.dispatchEvent(new Event('resize'));
    }
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

  it('separates completed value, recorded payments, and completed outstanding', async () => {
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
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getAllByText('$60.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Notes & Photos' }));

    expect(screen.getByLabelText('Private notes')).toHaveValue('Prefers shorter almond shape.');
    expect(screen.getByText('Preserved note history')).toBeInTheDocument();
    expect(screen.getByText('Avoid acetone soak when possible.')).toBeInTheDocument();
    expect(screen.getByText(/From merged profile/)).toBeInTheDocument();
    expect(screen.getByText('No appointment photos yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByLabelText('Preferred artist')).toBeInTheDocument();
    expect(screen.getByLabelText('Private notes')).toBeInTheDocument();
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
    let detailFetchCount = 0;
    let flagFetchCount = 0;
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
        detailFetchCount += 1;
        return new Response(JSON.stringify(buildDetailResponse()), { status: 200 });
      }

      if (url === '/api/admin/technicians?salonSlug=isla-nail-studio&limit=100') {
        return new Response(JSON.stringify(buildTechniciansResponse()), { status: 200 });
      }

      if (url === '/api/admin/clients/client_1/flag?salonSlug=isla-nail-studio') {
        flagFetchCount += 1;
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
      expectedUpdatedAt: '2026-03-20T12:00:00.000Z',
      isProblemClient: true,
      flagReason: 'Aggressive behavior',
      isBlocked: true,
      blockedReason: 'Repeated no-shows',
    });

    await waitFor(() => {
      expect(detailFetchCount).toBeGreaterThanOrEqual(2);
      expect(flagFetchCount).toBeGreaterThanOrEqual(2);
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
