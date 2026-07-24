/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  getAdminSession,
  normalizePhone,
  resolveSalonClient,
  collectClientContactAliases,
  getClientDependencySummary,
  selectQueue,
  db,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];

  const createQuery = (result: unknown) => {
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      groupBy: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => result),
      then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
      catch: (reject: (reason: unknown) => void) => Promise.resolve(result).catch(reject),
      finally: (onFinally: () => void) => Promise.resolve(result).finally(onFinally),
    };

    return query;
  };

  const select = vi.fn(() => createQuery(selectQueue.shift() ?? []));

  return {
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    normalizePhone: vi.fn((phone: string) => phone.replace(/\D/g, '')),
    resolveSalonClient: vi.fn(),
    collectClientContactAliases: vi.fn(),
    getClientDependencySummary: vi.fn(),
    selectQueue,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
  requireAdminSalon,
}));

vi.mock('@/libs/queries', () => ({
  normalizePhone,
}));

vi.mock('@/libs/clientLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/clientLifecycle')>();
  return {
    ...actual,
    resolveSalonClient,
    collectClientContactAliases,
    getClientDependencySummary,
  };
});

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('server-only', () => ({}));

import { ClientLifecycleError } from '@/libs/clientLifecycle';

import { GET } from './route';

describe('GET /api/admin/clients/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    collectClientContactAliases.mockResolvedValue({
      phones: ['1111111111'],
      emails: ['ava@example.com'],
    });
    getClientDependencySummary.mockResolvedValue({
      clientId: 'client_1',
      hasExternalClientIdentity: false,
      counts: {},
      hardDeleteEligible: false,
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      isSuperAdmin: false,
      salons: [{ salonId: 'salon_1', role: 'owner' }],
    });
  });

  it('rejects a synthetic wrong-tenant request without looking up or disclosing the client', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_fixture_foreign?salonSlug=salon-fixture-foreign'),
      { params: Promise.resolve({ id: 'client_fixture_foreign' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toEqual({ error: 'Forbidden' });
    expect(resolveSalonClient).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(
      /client|phone|email|currency|timezone|financial|preference|record/i,
    );
  });

  it('uses the same non-disclosing 404 for an unknown synthetic client in an authorized salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_fixture_owned' },
    });
    resolveSalonClient.mockRejectedValue(
      new ClientLifecycleError('CLIENT_NOT_FOUND', 'Client not found'),
    );

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_fixture_unknown?salonSlug=salon-fixture-owned'),
      { params: Promise.resolve({ id: 'client_fixture_unknown' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toEqual({
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found',
      },
    });
    expect(resolveSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_fixture_owned',
      clientId: 'client_fixture_unknown',
    });
    expect(JSON.stringify(body)).not.toMatch(
      /phone|email|currency|timezone|financial|preference|record/i,
    );
  });

  it('returns upcoming appointments separately from completed history and recent issues', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    const client = {
      id: 'client_1',
      phone: '1111111111',
      fullName: 'Ava Thompson',
      email: 'ava@example.com',
      birthday: null,
      preferredTechnicianId: 'tech_1',
      notes: 'VIP client',
      lastVisitAt: new Date('2026-03-10T14:00:00.000Z'),
      totalVisits: 4,
      totalSpent: 32000,
      noShowCount: 1,
      loyaltyPoints: 150,
      sensitivities: null,
      nailPreferences: {},
      tags: [],
      rebookIntervalDays: null,
      nextRebookDueAt: null,
      lastContactAt: null,
      hasGoogleReview: false,
      googleReviewMarkedAt: null,
      clientId: null,
      archivedAt: null,
      archivedBy: null,
      mergedIntoClientId: null,
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    resolveSalonClient.mockResolvedValue({
      client,
      redirectedFromClientId: null,
    });

    selectQueue.push(
      [{ id: 'tech_1', name: 'Daniela', avatarUrl: null }],
      [{
        id: 'appt_upcoming',
        startTime: new Date('2026-04-04T15:00:00.000Z'),
        endTime: new Date('2026-04-04T16:00:00.000Z'),
        status: 'confirmed',
        totalPrice: 9500,
        technicianId: 'tech_1',
        locationId: 'loc_secondary',
        notes: 'French finish',
      }],
      [{
        id: 'appt_completed',
        startTime: new Date('2026-03-10T14:00:00.000Z'),
        endTime: new Date('2026-03-10T15:00:00.000Z'),
        status: 'completed',
        totalPrice: 8200,
        technicianId: 'tech_2',
        locationId: null,
        notes: null,
      }],
      [{
        id: 'appt_issue',
        startTime: new Date('2026-03-02T14:00:00.000Z'),
        endTime: new Date('2026-03-02T15:00:00.000Z'),
        status: 'no_show',
        totalPrice: 0,
        technicianId: 'tech_1',
        locationId: null,
        notes: 'Did not arrive',
      }],
      [
        { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        { id: 'tech_2', name: 'Mila', avatarUrl: null },
      ],
      [{
        id: 'loc_secondary',
        name: 'Yorkville Studio',
        address: '88 Cumberland St',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5R 1A3',
      }],
      [
        { appointmentId: 'appt_upcoming', serviceId: 'svc_1', serviceName: 'Gel Fill', priceAtBooking: 9500 },
        { appointmentId: 'appt_completed', serviceId: 'svc_2', serviceName: 'Classic Pedicure', priceAtBooking: 8200 },
        { appointmentId: 'appt_issue', serviceId: 'svc_3', serviceName: 'Builder Gel Fill', priceAtBooking: 9900 },
      ],
      [],
      [],
      [],
      [{
        totalCents: 8200,
        finalizedAppointmentCount: 0,
        legacyAppointmentCount: 1,
        unresolvedAppointmentCount: 0,
        finalizedAmountCents: 0,
        legacyFallbackAmountCents: 8200,
        completedVisits: 1,
      }],
      [{
        totalCents: 0,
        finalizedAppointmentCount: 0,
        legacyAppointmentCount: 0,
        unresolvedAppointmentCount: 0,
        finalizedAmountCents: 0,
        legacyFallbackAmountCents: 0,
      }],
      [{
        finalizedAppointmentCount: 0,
        legacyAppointmentCount: 0,
        unresolvedAppointmentCount: 1,
        finalizedAmountCents: 0,
        legacyFallbackAmountCents: 0,
        upcomingBalanceCents: 9500,
        upcomingAppointmentCount: 1,
        unresolvedUpcomingAppointmentCount: 0,
        settledByLegacyPaymentStatusCount: 0,
      }],
      [],
      [{ id: 'svc_2', name: 'Classic Pedicure', count: 1, lastBookedAt: new Date('2026-03-10T14:00:00.000Z') }],
      [],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(normalizePhone).toHaveBeenCalledWith('1111111111');
    expect(body.data.client.preferredTechnician).toEqual({
      id: 'tech_1',
      name: 'Daniela',
      avatarUrl: null,
    });
    expect(body.data.upcomingAppointments).toHaveLength(1);
    expect(body.data.upcomingAppointments[0]).toMatchObject({
      id: 'appt_upcoming',
      status: 'confirmed',
      location: {
        id: 'loc_secondary',
        name: 'Yorkville Studio',
        address: '88 Cumberland St',
        city: 'Toronto',
        state: 'ON',
        zipCode: 'M5R 1A3',
      },
      services: [{ name: 'Gel Fill', price: 9500 }],
    });
    expect(body.data.pastAppointments).toEqual([
      expect.objectContaining({
        id: 'appt_completed',
        status: 'completed',
        services: [expect.objectContaining({ name: 'Classic Pedicure', price: 8200 })],
      }),
    ]);
    expect(body.data.recentIssues).toEqual([
      expect.objectContaining({
        id: 'appt_issue',
        status: 'no_show',
        services: [expect.objectContaining({ name: 'Builder Gel Fill', price: 9900 })],
      }),
    ]);
    expect(body.data.summary).toMatchObject({
      currency: 'CAD',
      lifetimeSpendCents: 8200,
      completedVisits: 1,
      mostBookedService: {
        id: 'svc_2',
        name: 'Classic Pedicure',
        count: 1,
      },
    });
  });
});
