/* eslint-disable import/first */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  ClientLifecycleStabilizationError,
  getSalonClientHistoricalPhoneHints,
  hasUnsafeSalonClientExternalIdentityWithHandle,
  isClientLifecycleTransactionTimeoutError,
  lockGlobalClientIdentityTablesWithHandle,
  lockSalonClientIdentityKeySetWithHandle,
  lockTerminalSalonClientWithHandle,
  normalizeSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClient,
  resolveTerminalSalonClientWithHandle,
  setClientContactEditTransactionTimeoutsWithHandle,
  withClientLifecycleTransactionRetry,
  normalizePhone,
  selectQueue,
  transactionSelectQueue,
  transactionUpdateQueue,
  transactionUpdate,
  transactionUpdateWhere,
  transactionInsert,
  transactionInsertValues,
  getFinancialBalanceSummary,
  getCompletedFinancialRows,
  db,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const transactionSelectQueue: unknown[] = [];
  const transactionUpdateQueue: unknown[][] = [];

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
  const transactionSelect = vi.fn(() =>
    createQuery(transactionSelectQueue.shift() ?? []));
  const transactionUpdateWhere = vi.fn();
  const transactionUpdate = vi.fn(() => {
    const result = transactionUpdateQueue.shift() ?? [];
    const query = {
      set: vi.fn(() => query),
      where: vi.fn((condition: unknown) => {
        transactionUpdateWhere(condition);
        return query;
      }),
      returning: vi.fn(async () => result),
    };
    return query;
  });
  const transactionInsertValues = vi.fn((_values: unknown) => {
    const query = {
      onConflictDoNothing: vi.fn(async () => []),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    return query;
  });
  const transactionInsert = vi.fn(() => ({
    values: transactionInsertValues,
  }));
  const transaction = vi.fn(async (operation: (tx: unknown) => unknown) =>
    operation({
      execute: vi.fn(),
      select: transactionSelect,
      update: transactionUpdate,
      insert: transactionInsert,
    }));

  return {
    requireAdminSalon: vi.fn(),
    ClientLifecycleStabilizationError: class ClientLifecycleStabilizationError extends Error {
      code: string;

      constructor(code: string) {
        super(code);
        this.code = code;
      }
    },
    getSalonClientHistoricalPhoneHints: vi.fn(),
    hasUnsafeSalonClientExternalIdentityWithHandle: vi.fn(),
    isClientLifecycleTransactionTimeoutError: vi.fn(),
    lockGlobalClientIdentityTablesWithHandle: vi.fn(),
    lockSalonClientIdentityKeySetWithHandle: vi.fn(),
    lockTerminalSalonClientWithHandle: vi.fn(),
    normalizeSalonClientIdentity: vi.fn((input: {
      phone?: string | null;
      email?: string | null;
    }) => {
      const digits = input.phone?.replace(/\D/g, '') ?? '';
      const phone = digits.length === 11 && digits.startsWith('1')
        ? digits.slice(1)
        : digits;
      if (input.phone != null && input.phone.trim() && phone.length !== 10) {
        throw new TypeError('invalid phone');
      }
      const email = input.email?.trim().toLowerCase() || null;
      if (email) {
        const [local, domain, extra] = email.split('@');
        if (!local || !domain?.includes('.') || extra !== undefined) {
          throw new TypeError('invalid email');
        }
      }
      return {
        phone: phone || null,
        email,
      };
    }),
    resolveCanonicalSalonClientIdentityWithHandle: vi.fn(),
    resolveTerminalSalonClient: vi.fn(),
    resolveTerminalSalonClientWithHandle: vi.fn(),
    setClientContactEditTransactionTimeoutsWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(),
    normalizePhone: vi.fn((phone: string) => phone.replace(/\D/g, '')),
    selectQueue,
    transactionSelectQueue,
    transactionUpdateQueue,
    transactionUpdate,
    transactionUpdateWhere,
    transactionInsert,
    transactionInsertValues,
    getFinancialBalanceSummary: vi.fn(),
    getCompletedFinancialRows: vi.fn(),
    db: {
      select,
      transaction,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError,
  getSalonClientHistoricalPhoneHints,
  hasUnsafeSalonClientExternalIdentityWithHandle,
  isClientLifecycleTransactionTimeoutError,
  lockGlobalClientIdentityTablesWithHandle,
  lockSalonClientIdentityKeySetWithHandle,
  lockTerminalSalonClientWithHandle,
  normalizeSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClient,
  resolveTerminalSalonClientWithHandle,
  setClientContactEditTransactionTimeoutsWithHandle,
  withClientLifecycleTransactionRetry,
}));

vi.mock('@/libs/queries', () => ({
  normalizePhone,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/financialReportingServer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/financialReportingServer')>();
  return {
    ...actual,
    getFinancialBalanceSummary,
    getCompletedFinancialRows,
  };
});

vi.mock('server-only', () => ({}));

import { GET, PATCH } from './route';

describe('GET /api/admin/clients/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    resolveTerminalSalonClient.mockImplementation(async ({ salonId, clientId }) => ({
      id: clientId,
      salonId,
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: [clientId],
    }));
    getSalonClientHistoricalPhoneHints.mockImplementation(
      async ({ salonId, clientId }) => ({
        terminal: {
          id: clientId,
          salonId,
          archivedAt: null,
          redirectedFromClientId: null,
          lineagePath: [clientId],
        },
        phones: ['1111111111'],
      }),
    );
    getFinancialBalanceSummary.mockResolvedValue({
      completedOutstandingCents: 0,
      completedOutstandingAppointmentCount: 0,
      completedOutstandingProvenance: {
        state: 'complete',
        source: 'none',
        finalizedAppointmentCount: 0,
        legacyAppointmentCount: 0,
        unresolvedAppointmentCount: 0,
        finalizedAmountCents: 0,
        legacyFallbackAmountCents: 0,
      },
      upcomingBalanceCents: 0,
      upcomingAppointmentCount: 0,
      unresolvedUpcomingAppointmentCount: 0,
      settledByLegacyPaymentStatusCount: 0,
    });
    getCompletedFinancialRows.mockResolvedValue([]);
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
    expect(resolveTerminalSalonClient).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(
      /client|phone|email|currency|timezone|financial|preference|record/i,
    );
  });

  it('uses the same non-disclosing 404 for an unknown synthetic client in an authorized salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_fixture_owned' },
    });
    selectQueue.push([]);

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
    expect(db.select).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toMatch(
      /phone|email|currency|timezone|financial|preference|record/i,
    );
  });

  it.each([
    'missing target',
    'cyclic lineage',
    'excessive lineage depth',
    'foreign-salon target',
  ])('returns the same private 404 for invalid lifecycle state: %s', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_fixture_owned' },
    });
    resolveTerminalSalonClient.mockRejectedValue(
      new ClientLifecycleStabilizationError('Client lifecycle state is unavailable.'),
    );

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_fixture_source?salonSlug=salon-fixture-owned'),
      { params: Promise.resolve({ id: 'client_fixture_source' }) },
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
    expect(db.select).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(
      /phone|email|currency|timezone|financial|preference|record/i,
    );
  });

  it('returns upcoming appointments separately from completed history and recent issues', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getCompletedFinancialRows.mockResolvedValue([{
      salonClientId: 'client_1',
      clientPhone: '1111111111',
      startTime: new Date('2026-03-10T14:00:00.000Z'),
      completedOutstandingCents: 0,
      serviceValueCents: 8200,
      source: 'legacy',
      financiallySettled: true,
    }]);
    selectQueue.push(
      [{
        id: 'client_1',
        phone: '1111111111',
        fullName: 'Ava Thompson',
        email: 'ava@example.com',
        birthday: '1990-05-12',
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
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.123Z'),
        updatedAtVersion: '2026-03-01T00:00:00.123456Z',
      }],
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
      [],
      [{ id: 'svc_2', name: 'Classic Pedicure', count: 1, lastBookedAt: new Date('2026-03-10T14:00:00.000Z') }],
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
    expect(body.data.client).toMatchObject({
      birthday: '1990-05-12',
      updatedAt: '2026-03-01T00:00:00.123456Z',
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

describe('PATCH /api/admin/clients/[id]', () => {
  const loadedAt = new Date('2026-07-25T11:00:00.000Z');
  const loadedVersion = '2026-07-25T11:00:00.000000Z';
  const savedAt = new Date('2026-07-25T12:00:00.000Z');
  const savedVersion = '2026-07-25T12:00:00.000000Z';
  const currentClient = {
    id: 'client_primary',
    salonId: 'salon_1',
    clientId: null,
    phone: '1111111111',
    fullName: '  Ava   van der Thompson  ',
    email: 'ava@example.com',
    birthday: '1990-05-12',
    preferredTechnicianId: null,
    notes: 'Original note',
    sensitivities: null,
    nailPreferences: {},
    tags: [],
    rebookIntervalDays: null,
    nextRebookDueAt: null,
    lastContactAt: null,
    lastVisitAt: null,
    totalVisits: 0,
    totalSpent: 0,
    noShowCount: 0,
    loyaltyPoints: 0,
    welcomeBonusGrantedAt: null,
    hasGoogleReview: false,
    googleReviewMarkedAt: null,
    googleReviewMarkedBy: null,
    lateCancelCount: 0,
    lastLateCancelAt: null,
    adminFlags: null,
    isBlocked: false,
    blockedReason: null,
    archivedAt: null,
    archivedBy: null,
    mergedIntoClientId: null,
    mergedAt: null,
    mergedBy: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: loadedAt,
    updatedAtVersion: loadedVersion,
  };

  function editRequest(
    fields: Record<string, unknown>,
    clientId = 'client_source',
  ): Promise<Response> {
    return PATCH(
      new Request(`http://localhost/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          ...fields,
        }),
      }),
      { params: Promise.resolve({ id: clientId }) },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    transactionSelectQueue.length = 0;
    transactionUpdateQueue.length = 0;
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    lockTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
    });
    resolveTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'client_source',
      lineagePath: ['client_source', 'client_primary'],
    });
    lockSalonClientIdentityKeySetWithHandle.mockResolvedValue([
      {
        salonId: 'salon_1',
        kind: 'email',
        normalizedValue: 'ava@example.com',
        advisoryKey: 'old-email',
      },
      {
        salonId: 'salon_1',
        kind: 'email',
        normalizedValue: 'updated@example.com',
        advisoryKey: 'new-email',
      },
    ]);
    hasUnsafeSalonClientExternalIdentityWithHandle.mockResolvedValue(false);
    isClientLifecycleTransactionTimeoutError.mockReturnValue(false);
    setClientContactEditTransactionTimeoutsWithHandle
      .mockResolvedValue(undefined);
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue({
      terminal: {
        id: 'client_primary',
        salonId: 'salon_1',
        archivedAt: null,
        redirectedFromClientId: null,
        lineagePath: ['client_primary'],
        phone: '1111111111',
        email: 'updated@example.com',
      },
      clientIds: ['client_primary'],
      phones: ['1111111111'],
      emails: ['updated@example.com'],
      externalClientId: null,
      matchedBy: [{ kind: 'email', value: 'updated@example.com' }],
    });
    withClientLifecycleTransactionRetry.mockImplementation(
      async operation => operation(1),
    );
    transactionSelectQueue.push(
      [currentClient],
      [{ updatedAtVersion: savedVersion }],
    );
  });

  it('updates the same-salon terminal primary for a stale source profile ID', async () => {
    transactionUpdateQueue.push([{
      ...currentClient,
      notes: 'Updated operational note',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          notes: 'Updated operational note',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'client_source',
        allowArchived: true,
      },
    );
    expect(body.data.client.id).toBe('client_primary');
    expect(body.data.client.fullName).toBe('  Ava   van der Thompson  ');
    expect(body.data.client.updatedAt).toBe(savedVersion);
    expect(transactionInsertValues).toHaveBeenCalledOnce();
    expect(transactionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'client_primary',
        metadata: {
          terminalClientId: 'client_primary',
          changedFields: ['notes'],
          redirectedFromStaleSource: true,
        },
      }),
    );
    expect(lockGlobalClientIdentityTablesWithHandle).not.toHaveBeenCalled();
    expect(setClientContactEditTransactionTimeoutsWithHandle)
      .not.toHaveBeenCalled();
    expect(lockSalonClientIdentityKeySetWithHandle).not.toHaveBeenCalled();
    expect(hasUnsafeSalonClientExternalIdentityWithHandle)
      .not.toHaveBeenCalled();
  });

  it('edits a terminal client directly without marking a stale-source redirect', async () => {
    lockTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'client_primary',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: ['client_primary'],
    });
    transactionUpdateQueue.push([{
      ...currentClient,
      notes: 'Direct terminal edit',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await editRequest(
      { notes: 'Direct terminal edit' },
      'client_primary',
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.id).toBe('client_primary');
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'client_primary',
        allowArchived: true,
      },
    );
    expect(transactionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          terminalClientId: 'client_primary',
          changedFields: ['notes'],
          redirectedFromStaleSource: false,
        },
      }),
    );
  });

  it('sets bounded timeouts before the global-first lock order for an email update', async () => {
    transactionUpdateQueue.push([{
      ...currentClient,
      email: 'updated@example.com',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          email: ' UPDATED@Example.COM ',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client).toMatchObject({
      id: 'client_primary',
      email: 'updated@example.com',
    });
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'client_source',
        allowArchived: true,
      },
    );
    expect(lockSalonClientIdentityKeySetWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        contacts: [
          { phone: '1111111111', email: 'ava@example.com' },
          { phone: '1111111111', email: 'updated@example.com' },
        ],
      },
    );
    expect(resolveTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        clientId: 'client_source',
        allowArchived: true,
      },
    );
    expect(
      setClientContactEditTransactionTimeoutsWithHandle
        .mock.invocationCallOrder[0],
    )
      .toBeLessThan(
        lockGlobalClientIdentityTablesWithHandle.mock.invocationCallOrder[0]!,
      );
    expect(lockGlobalClientIdentityTablesWithHandle.mock.invocationCallOrder[0])
      .toBeLessThan(
        lockTerminalSalonClientWithHandle.mock.invocationCallOrder[0]!,
      );
    expect(lockTerminalSalonClientWithHandle.mock.invocationCallOrder[0])
      .toBeLessThan(
        lockSalonClientIdentityKeySetWithHandle.mock.invocationCallOrder[0]!,
      );
    expect(lockSalonClientIdentityKeySetWithHandle.mock.invocationCallOrder[0])
      .toBeLessThan(
        resolveTerminalSalonClientWithHandle.mock.invocationCallOrder[0]!,
      );
    expect(resolveCanonicalSalonClientIdentityWithHandle.mock.invocationCallOrder[0])
      .toBeLessThan(transactionUpdate.mock.invocationCallOrder[0]!);
    expect(transactionInsertValues).toHaveBeenCalledTimes(2);
    expect(transactionInsertValues).toHaveBeenNthCalledWith(1, [{
      salonId: 'salon_1',
      salonClientId: 'client_primary',
      kind: 'email',
      normalizedValue: 'ava@example.com',
    }]);
    expect(transactionInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: {
          terminalClientId: 'client_primary',
          changedFields: ['email'],
          redirectedFromStaleSource: true,
        },
      }),
    );
  });

  it('normalizes and applies a phone-only edit while retaining the old phone as an alias', async () => {
    lockSalonClientIdentityKeySetWithHandle.mockResolvedValue([
      {
        salonId: 'salon_1',
        kind: 'phone',
        normalizedValue: '1111111111',
        advisoryKey: 'old-phone',
      },
      {
        salonId: 'salon_1',
        kind: 'phone',
        normalizedValue: '4165550101',
        advisoryKey: 'new-phone',
      },
    ]);
    transactionUpdateQueue.push([{
      ...currentClient,
      phone: '4165550101',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await editRequest({
      phone: '+1 (416) 555-0101',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.phone).toBe('4165550101');
    expect(lockSalonClientIdentityKeySetWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      {
        salonId: 'salon_1',
        contacts: [
          { phone: '1111111111', email: 'ava@example.com' },
          { phone: '4165550101', email: 'ava@example.com' },
        ],
      },
    );
    expect(transactionInsertValues).toHaveBeenNthCalledWith(1, [{
      salonId: 'salon_1',
      salonClientId: 'client_primary',
      kind: 'phone',
      normalizedValue: '1111111111',
    }]);
    expect(transactionInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          changedFields: ['phone'],
        }),
      }),
    );
  });

  it('applies a birthday-only edit without taking contact identity locks', async () => {
    transactionUpdateQueue.push([{
      ...currentClient,
      birthday: '1991-06-13',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await editRequest({
      birthday: '1991-06-13',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.birthday).toBe('1991-06-13');
    expect(lockGlobalClientIdentityTablesWithHandle).not.toHaveBeenCalled();
    expect(setClientContactEditTransactionTimeoutsWithHandle)
      .not.toHaveBeenCalled();
    expect(lockSalonClientIdentityKeySetWithHandle).not.toHaveBeenCalled();
    expect(hasUnsafeSalonClientExternalIdentityWithHandle)
      .not.toHaveBeenCalled();
    expect(transactionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          changedFields: ['birthday'],
        }),
      }),
    );
  });

  it('rolls back every profile field when the email belongs to another terminal', async () => {
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue({
      terminal: {
        id: 'client_other',
        salonId: 'salon_1',
        archivedAt: null,
        redirectedFromClientId: null,
        lineagePath: ['client_other'],
        phone: '2222222222',
        email: 'claimed@example.com',
      },
      clientIds: ['client_other'],
      phones: ['2222222222'],
      emails: ['claimed@example.com'],
      externalClientId: null,
      matchedBy: [{ kind: 'email', value: 'claimed@example.com' }],
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          email: 'claimed@example.com',
          notes: 'Must roll back with the email',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'CONTACT_IDENTITY_CONFLICT',
        message: 'Client contact information conflicts with another profile',
      },
    });
    expect(response.headers.get('cache-control')).toContain('private');
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('rejects a phone owned by another same-salon terminal', async () => {
    lockSalonClientIdentityKeySetWithHandle.mockResolvedValue([{
      salonId: 'salon_1',
      kind: 'phone',
      normalizedValue: '4165550101',
      advisoryKey: 'new-phone',
    }]);
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue({
      terminal: {
        id: 'client_other',
        salonId: 'salon_1',
        archivedAt: null,
        redirectedFromClientId: null,
        lineagePath: ['client_other'],
        phone: '4165550101',
        email: null,
      },
      clientIds: ['client_other'],
      phones: ['4165550101'],
      emails: [],
      externalClientId: null,
      matchedBy: [{ kind: 'phone', value: '4165550101' }],
    });

    const response = await editRequest({
      phone: '(416) 555-0101',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CONTACT_IDENTITY_CONFLICT');
    expect(resolveCanonicalSalonClientIdentityWithHandle)
      .toHaveBeenCalledWith(expect.anything(), {
        salonId: 'salon_1',
        phone: '4165550101',
        allowArchived: true,
      });
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('rejects ambiguous historical alias ownership without writing', async () => {
    lockSalonClientIdentityKeySetWithHandle.mockResolvedValue([{
      salonId: 'salon_1',
      kind: 'email',
      normalizedValue: 'alias@example.com',
      advisoryKey: 'alias-email',
    }]);
    resolveCanonicalSalonClientIdentityWithHandle.mockRejectedValue(
      new ClientLifecycleStabilizationError('INVALID_CLIENT_STATE'),
    );

    const response = await editRequest({
      email: 'alias@example.com',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CONTACT_IDENTITY_CONFLICT');
    expect(resolveCanonicalSalonClientIdentityWithHandle)
      .toHaveBeenCalledWith(expect.anything(), {
        salonId: 'salon_1',
        email: 'alias@example.com',
        allowArchived: true,
      });
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('does not update when the requested profile lineage is invalid', async () => {
    lockTerminalSalonClientWithHandle.mockRejectedValue(
      new ClientLifecycleStabilizationError('INVALID_CLIENT_STATE'),
    );

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          notes: 'Must not write',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found',
      },
    });
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('does not disclose a foreign-salon client or submitted PII', async () => {
    lockTerminalSalonClientWithHandle.mockRejectedValue(
      new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND'),
    );

    const response = await editRequest(
      {
        notes: 'private foreign note',
        email: 'foreign@example.com',
      },
      'client_foreign',
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found',
      },
    });
    expect(serialized).not.toContain('client_foreign');
    expect(serialized).not.toContain('private foreign note');
    expect(serialized).not.toContain('foreign@example.com');
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('fails only actual contact changes for an unsafe customer-login identity', async () => {
    hasUnsafeSalonClientExternalIdentityWithHandle.mockResolvedValue(true);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          phone: '+1 (416) 555-0101',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('UNSUPPORTED_CLIENT_IDENTITY');
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('allows a name-only edit without crossing the external identity boundary', async () => {
    transactionUpdateQueue.push([{
      ...currentClient,
      fullName: 'Ava Thompson',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          firstName: ' Ava ',
          lastName: ' Thompson ',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );

    expect(response.status).toBe(200);
    expect(hasUnsafeSalonClientExternalIdentityWithHandle)
      .not.toHaveBeenCalled();
    expect(setClientContactEditTransactionTimeoutsWithHandle)
      .not.toHaveBeenCalled();
    expect(lockSalonClientIdentityKeySetWithHandle).not.toHaveBeenCalled();
    expect(transactionUpdate).toHaveBeenCalledOnce();
    expect(transactionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          changedFields: ['fullName'],
        }),
      }),
    );
  });

  it('canonicalizes a valid offset version to the exact UTC token used by CAS', async () => {
    transactionUpdateQueue.push([{
      ...currentClient,
      notes: 'Offset token edit',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: '2026-07-25T07:00:00-04:00',
          notes: 'Offset token edit',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.updatedAt).toBe(savedVersion);

    const updatePredicate = new PgDialect().sqlToQuery(
      transactionUpdateWhere.mock.calls[0]![0] as SQL,
    );

    expect(updatePredicate.params).toEqual([
      'salon_1',
      'client_primary',
      loadedVersion,
    ]);
  });

  it('returns a conflict when the locked record changed after the form loaded', async () => {
    transactionSelectQueue.length = 0;
    transactionSelectQueue.push([{
      ...currentClient,
      notes: 'Changed elsewhere',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          notes: 'My pending change',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLIENT_EDIT_CONFLICT');
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('conflicts when versions differ only below JavaScript millisecond precision', async () => {
    transactionSelectQueue.length = 0;
    transactionSelectQueue.push([{
      ...currentClient,
      notes: 'Changed elsewhere',
      updatedAt: new Date('2026-07-25T11:00:00.123Z'),
      updatedAtVersion: '2026-07-25T11:00:00.123456Z',
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: '2026-07-25T11:00:00.123455Z',
          notes: 'My pending change',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLIENT_EDIT_CONFLICT');
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('returns 409 with no aliases or audit when the write-time CAS loses', async () => {
    transactionUpdateQueue.push([]);

    const response = await editRequest({
      email: 'updated@example.com',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLIENT_EDIT_CONFLICT');
    expect(transactionUpdate).toHaveBeenCalledOnce();
    expect(transactionUpdateWhere).toHaveBeenCalledOnce();
    expect(transactionInsert).not.toHaveBeenCalled();

    const updatePredicate = new PgDialect().sqlToQuery(
      transactionUpdateWhere.mock.calls[0]![0] as SQL,
    );

    expect(updatePredicate.sql).toContain('"salon_id" = $1');
    expect(updatePredicate.sql).toContain('"id" = $2');
    expect(updatePredicate.sql)
      .toMatch(/to_char\(\s*"salon_client"\."updated_at"/);
    expect(updatePredicate.sql).toContain('HH24:MI:SS.US');
    expect(updatePredicate.sql).toContain('= $3');
    expect(updatePredicate.sql).not.toContain('::timestamp');
    expect(updatePredicate.sql).not.toContain('>=');
    expect(updatePredicate.sql).not.toContain('<');
    expect(updatePredicate.params).toEqual([
      'salon_1',
      'client_primary',
      loadedVersion,
    ]);
  });

  it.each(['55P03', '57014'])(
    'maps contact-edit transaction timeout %s to a private retryable conflict',
    async (code) => {
      const databaseError = Object.assign(
        new Error('database details must remain private'),
        { code },
      );
      setClientContactEditTransactionTimeoutsWithHandle
        .mockRejectedValue(databaseError);
      isClientLifecycleTransactionTimeoutError
        .mockImplementation(error => error === databaseError);

      const response = await editRequest({
        phone: '4165550101',
      });
      const body = await response.json();
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(409);
      expect(body).toEqual({
        error: {
          code: 'CLIENT_EDIT_CONFLICT',
          message:
            'This client could not be updated right now. Try again in a moment.',
        },
      });
      expect(response.headers.get('cache-control')).toContain('private');
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain('database details');
      expect(serialized).not.toContain('4165550101');
      expect(lockGlobalClientIdentityTablesWithHandle).not.toHaveBeenCalled();
      expect(lockTerminalSalonClientWithHandle).not.toHaveBeenCalled();
      expect(transactionUpdate).not.toHaveBeenCalled();
      expect(transactionInsert).not.toHaveBeenCalled();
    },
  );

  it.each(['55P03', '57014'])(
    'preserves external-identity helper timeout %s as a private retryable conflict',
    async (code) => {
      const databaseError = Object.assign(
        new Error('external identity database details must remain private'),
        { code },
      );
      hasUnsafeSalonClientExternalIdentityWithHandle
        .mockRejectedValue(databaseError);
      isClientLifecycleTransactionTimeoutError
        .mockImplementation(error => error === databaseError);

      const response = await editRequest({
        phone: '4165550101',
      });
      const body = await response.json();
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(409);
      expect(body).toEqual({
        error: {
          code: 'CLIENT_EDIT_CONFLICT',
          message:
            'This client could not be updated right now. Try again in a moment.',
        },
      });
      expect(response.headers.get('cache-control')).toContain('private');
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain('database details');
      expect(serialized).not.toContain('4165550101');
      expect(lockGlobalClientIdentityTablesWithHandle).toHaveBeenCalledOnce();
      expect(transactionUpdate).not.toHaveBeenCalled();
      expect(transactionInsert).not.toHaveBeenCalled();
    },
  );

  it('returns a stale identical retry without advancing updatedAt or adding an audit', async () => {
    transactionSelectQueue.length = 0;
    transactionSelectQueue.push([{
      ...currentClient,
      notes: 'Already saved',
      updatedAt: savedAt,
      updatedAtVersion: savedVersion,
    }]);

    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          notes: 'Already saved',
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.idempotent).toBe(true);
    expect(body.data.client.updatedAt).toBe(savedVersion);
    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it.each([
    [{ firstName: '', lastName: 'Thompson' }, 'firstName'],
    [{ firstName: 'Ava' }, 'lastName'],
    [{ phone: '123' }, 'phone'],
    [{ email: 'not-an-email' }, 'email'],
    [{ birthday: '2024-02-30' }, 'birthday'],
    [{ birthday: '1899-12-31' }, 'birthday'],
    [{ notes: 'x'.repeat(5001) }, 'notes'],
  ])('validates edit fields before taking locks: %j', async (fields, path) => {
    const response = await PATCH(
      new Request('http://localhost/api/admin/clients/client_source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          expectedUpdatedAt: loadedAt.toISOString(),
          ...fields,
        }),
      }),
      { params: Promise.resolve({ id: 'client_source' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fieldErrors[path]).toBeDefined();
    expect(lockTerminalSalonClientWithHandle).not.toHaveBeenCalled();
  });
});
