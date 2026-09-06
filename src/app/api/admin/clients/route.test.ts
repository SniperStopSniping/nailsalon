/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAdminSession,
  requireAdminSalon,
  getClientInsightsDirectoryPage,
  getCompletedFinancialResolution,
  getSalonClients,
  lockSalonClientIdentityKeysWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  withClientLifecycleTransactionRetry,
  ClientLifecycleStabilizationError,
  isClientLifecycleTransactionTimeoutError,
  normalizeSalonClientIdentity,
  insertReturning,
  transactionInsert,
  transactionSelectQueue,
  db,
} = vi.hoisted(() => {
  const transactionSelectQueue: unknown[] = [];

  const createQuery = (result: unknown) => {
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => result),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  };

  const transactionSelect = vi.fn(() =>
    createQuery(transactionSelectQueue.shift() ?? []));
  const insertReturning: unknown[][] = [];
  const transactionInsertValues = vi.fn((_values: unknown) => {
    const query = {
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => insertReturning.shift() ?? []),
      })),
      returning: vi.fn(async () => insertReturning.shift() ?? []),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    return query;
  });
  const transactionInsert = vi.fn(() => ({ values: transactionInsertValues }));
  const transaction = vi.fn(async (operation: (tx: unknown) => unknown) =>
    operation({
      execute: vi.fn(),
      select: transactionSelect,
      insert: transactionInsert,
    }));

  return {
    getAdminSession: vi.fn(),
    requireAdminSalon: vi.fn(),
    getClientInsightsDirectoryPage: vi.fn(),
    getCompletedFinancialResolution: vi.fn(),
    getSalonClients: vi.fn(),
    lockSalonClientIdentityKeysWithHandle: vi.fn(),
    resolveCanonicalSalonClientIdentityWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(),
    ClientLifecycleStabilizationError: class ClientLifecycleStabilizationError
      extends Error {
      code: string;

      constructor(code: string) {
        super(code);
        this.code = code;
      }
    },
    isClientLifecycleTransactionTimeoutError: vi.fn(() => false),
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
      return { phone: phone || null, email };
    }),
    insertReturning,
    transactionInsert,
    transactionInsertValues,
    transactionSelectQueue,
    db: { transaction },
  };
});

vi.mock('@/libs/adminAuth', () => ({ getAdminSession, requireAdminSalon }));

vi.mock('@/libs/bookingConfig', () => ({
  resolveBookingConfigFromSettings: () => ({
    currency: 'CAD',
    timezone: 'America/Toronto',
  }),
}));

vi.mock('@/libs/clientInsights.server', () => ({
  getClientInsightsDirectoryPage,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError,
  isClientLifecycleTransactionTimeoutError,
  lockSalonClientIdentityKeysWithHandle,
  normalizeSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  withClientLifecycleTransactionRetry,
}));

vi.mock('@/libs/DB', () => ({ db }));

vi.mock('@/libs/financialReportingServer', () => ({
  getCompletedFinancialResolution,
}));

vi.mock('@/libs/queries', () => ({ getSalonClients }));

vi.mock('server-only', () => ({}));

import { GET, POST } from './route';

type DirectoryClient = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  totalVisits: number;
  notes: string | null;
};

function directoryClient(overrides: Partial<DirectoryClient> & { id: string }) {
  return {
    phone: '4165550100',
    fullName: 'Client',
    email: null,
    preferredTechnician: null,
    lastVisitAt: null,
    totalVisits: 0,
    noShowCount: 0,
    loyaltyPoints: 0,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function listRequest(query: string): Request {
  return new Request(`http://localhost/api/admin/clients?${query}`);
}

function createRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionSelectQueue.length = 0;
  insertReturning.length = 0;
  requireAdminSalon.mockResolvedValue({
    error: null,
    salon: { id: 'salon_1', settings: null },
  });
  getAdminSession.mockResolvedValue({
    id: 'admin_1',
    phoneE164: '+14165550000',
  });
  getCompletedFinancialResolution.mockResolvedValue({
    resolvedRows: [],
    unresolvedRows: [],
  });
  isClientLifecycleTransactionTimeoutError.mockReturnValue(false);
  withClientLifecycleTransactionRetry.mockImplementation(
    (operation: (attempt: number) => unknown) => operation(1),
  );
});

describe('GET /api/admin/clients', () => {
  it('does not ship staff notes to the directory payload', async () => {
    // AG-clients-05 / AG-w2-clients-04: the list renders no note, so it must
    // not carry one.
    getSalonClients.mockResolvedValue({
      clients: [directoryClient({
        id: 'sc_1',
        fullName: 'AUDIT Client Ada',
        notes: 'AUDIT-0905 staff-only note',
      })],
      total: 1,
    });

    const response = await GET(listRequest('salonSlug=salon-a'));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data.clients).toHaveLength(1);
    expect(body.data.clients[0]).not.toHaveProperty('notes');
    expect(serialized).not.toContain('staff-only note');
  });

  it('never ranks a never-spent client above a paying client whose spend is under review', async () => {
    // AG-clients-07 / AG-w2-clients-05.
    getSalonClients.mockResolvedValue({
      clients: [
        directoryClient({ id: 'sc_eli', fullName: 'Eli', phone: '4165550301' }),
        directoryClient({ id: 'sc_fay', fullName: 'Fay', phone: '4165550302' }),
        directoryClient({
          id: 'sc_ada',
          fullName: 'Ada',
          phone: '4165550303',
          totalVisits: 2,
        }),
        directoryClient({
          id: 'sc_ben',
          fullName: 'Ben',
          phone: '4165550304',
          totalVisits: 5,
        }),
        directoryClient({
          id: 'sc_zoe',
          fullName: 'Zoe',
          phone: '4165550305',
        }),
      ],
      total: 5,
    });
    getCompletedFinancialResolution.mockResolvedValue({
      resolvedRows: [{
        salonClientId: 'sc_zoe',
        clientPhone: '4165550305',
        financiallySettled: true,
        serviceValueCents: 22_000,
      }],
      unresolvedRows: [
        { salonClientId: 'sc_ada', clientPhone: '4165550303' },
        { salonClientId: 'sc_ben', clientPhone: '4165550304' },
      ],
    });

    const response = await GET(
      listRequest('salonSlug=salon-a&sortBy=spent&sortOrder=desc'),
    );
    const body = await response.json();

    expect(body.data.clients.map((client: { id: string }) => client.id))
      .toEqual(['sc_zoe', 'sc_ben', 'sc_ada', 'sc_eli', 'sc_fay']);
    expect(body.data.clients[1].spendState).toBe('under_review');
    expect(body.data.clients[3].spendState).toBe('canonical_settled');
    expect(body.data.clients[3].totalSpent).toBe(0);
  });
});

describe('POST /api/admin/clients', () => {
  it('records a new walk-in client', async () => {
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue(null);
    insertReturning.push([{
      id: 'sc_new',
      phone: '4165550207',
      fullName: 'AUDIT Client Gia',
      email: null,
      archivedAt: null,
      totalVisits: 0,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
    }]);

    const response = await POST(createRequest({
      salonSlug: 'salon-a',
      firstName: 'AUDIT Client',
      lastName: 'Gia',
      phone: '(416) 555-0207',
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.created).toBe(true);
    expect(body.data.client.fullName).toBe('AUDIT Client Gia');
    expect(body.data.client.phone).toBe('4165550207');
    expect(lockSalonClientIdentityKeysWithHandle).toHaveBeenCalledWith(
      expect.anything(),
      { salonId: 'salon_1', phone: '4165550207', email: null },
    );
    // The write is accountable: client row + audit row.
    expect(transactionInsert).toHaveBeenCalledTimes(2);
  });

  it('returns the existing client instead of forking a duplicate phone', async () => {
    // AG-clients-01 / AG-w2-clients-08 acceptance: re-adding an existing phone
    // surfaces the client already in the book.
    resolveCanonicalSalonClientIdentityWithHandle.mockResolvedValue({
      terminal: { id: 'sc_existing' },
    });
    transactionSelectQueue.push([{
      id: 'sc_existing',
      phone: '4165550207',
      fullName: 'AUDIT Client Gia',
      email: null,
      archivedAt: null,
      totalVisits: 3,
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
    }]);

    const response = await POST(createRequest({
      salonSlug: 'salon-a',
      firstName: 'Gia',
      lastName: 'Duplicate',
      phone: '4165550207',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.created).toBe(false);
    expect(body.data.client.id).toBe('sc_existing');
    expect(body.data.message).toContain('already in your book');
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('rejects a missing name and an unusable phone with field errors', async () => {
    const response = await POST(createRequest({
      salonSlug: 'salon-a',
      firstName: '   ',
      phone: '12',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.fieldErrors.firstName[0])
      .toBe('First name is required');
    expect(body.error.details.fieldErrors.phone[0])
      .toContain('valid Canadian or international phone number');
    expect(transactionInsert).not.toHaveBeenCalled();
  });
});
