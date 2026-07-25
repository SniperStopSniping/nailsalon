import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PUT } from './route';

const {
  requireAdminSalon,
  getAdminSession,
  guardModuleOr403,
  resolveTerminalSalonClient,
  lockTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
  ClientLifecycleStabilizationError,
  selectResults,
  updateResults,
  selectCalls,
  updateCalls,
  transaction,
  transactionHandle,
  db,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updateResults: unknown[][] = [];
  const selectCalls: Array<{ where?: unknown }> = [];
  const updateCalls: Array<{ set?: unknown; where?: unknown }> = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((where: unknown) => {
        const call = { where };
        selectCalls.push(call);
        const result = selectResults.shift() ?? [];
        return {
          limit: vi.fn(async () => result),
        };
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((set: unknown) => {
      const call: { set?: unknown; where?: unknown } = { set };
      updateCalls.push(call);
      return {
        where: vi.fn((where: unknown) => {
          call.where = where;
          return {
            returning: vi.fn(async () => updateResults.shift() ?? []),
          };
        }),
      };
    }),
  }));

  const transactionHandle = {
    select,
    update,
  };
  const transaction = vi.fn(async (operation: (tx: typeof transactionHandle) => Promise<unknown>) =>
    operation(transactionHandle));

  class ClientLifecycleStabilizationError extends Error {
    code: string;

    constructor(code: string) {
      super('Client not found.');
      this.code = code;
    }
  }

  return {
    requireAdminSalon: vi.fn(),
    getAdminSession: vi.fn(),
    guardModuleOr403: vi.fn(),
    resolveTerminalSalonClient: vi.fn(),
    lockTerminalSalonClientWithHandle: vi.fn(),
    withClientLifecycleTransactionRetry: vi.fn(
      (operation: (attempt: number) => Promise<unknown>) => operation(1),
    ),
    ClientLifecycleStabilizationError,
    selectResults,
    updateResults,
    selectCalls,
    updateCalls,
    transaction,
    transactionHandle,
    db: {
      select,
      update,
      transaction,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
  getAdminSession,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  ClientLifecycleStabilizationError,
  resolveTerminalSalonClient,
  lockTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

function collectSqlValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value == null || typeof value !== 'object') {
    return [value];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  return Object.values(value).flatMap(child => collectSqlValues(child, seen));
}

describe('/api/admin/clients/[id]/flag auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    updateResults.length = 0;
    selectCalls.length = 0;
    updateCalls.length = 0;
    guardModuleOr403.mockResolvedValue(null);
    resolveTerminalSalonClient.mockImplementation(async ({
      salonId,
      clientId,
    }: {
      salonId: string;
      clientId: string;
    }) => ({
      id: clientId,
      salonId,
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: [clientId],
    }));
    lockTerminalSalonClientWithHandle.mockImplementation(async (_handle, {
      salonId,
      clientId,
    }: {
      salonId: string;
      clientId: string;
    }) => ({
      id: clientId,
      salonId,
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: [clientId],
    }));
  });

  it('rejects unauthenticated admins from reading client flags', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(401);
  });

  it('allows authorized admins to read client flags for their salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    selectResults.push([{
      id: 'client_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: { isProblemClient: true },
      isBlocked: true,
      blockedReason: 'Repeated no-shows',
      noShowCount: 2,
      lateCancelCount: 1,
    }]);

    const response = await GET(
      new Request('http://localhost/api/admin/clients/client_1/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveTerminalSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'client_1',
    });
    expect(body).toEqual({
      data: {
        client: {
          id: 'client_1',
          phone: '1111111111',
          fullName: 'Ava',
          adminFlags: { isProblemClient: true },
          isBlocked: true,
          blockedReason: 'Repeated no-shows',
          noShowCount: 2,
          lateCancelCount: 1,
        },
      },
    });
  });

  it('records admin-backed flag updates with the authenticated admin id', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    selectResults.push([{
      id: 'client_1',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
    }]);
    updateResults.push([{
      id: 'client_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {
        isProblemClient: true,
        flagReason: 'Abusive behavior',
        flaggedBy: 'admin_1',
      },
      isBlocked: true,
      blockedReason: 'Abusive behavior',
      noShowCount: 0,
      lateCancelCount: 0,
    }]);

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          isProblemClient: true,
          flagReason: 'Abusive behavior',
          isBlocked: true,
          blockedReason: 'Abusive behavior',
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(guardModuleOr403).toHaveBeenNthCalledWith(1, { salonId: 'salon_1', module: 'clientFlags' });
    expect(guardModuleOr403).toHaveBeenNthCalledWith(2, { salonId: 'salon_1', module: 'clientBlocking' });
    expect(withClientLifecycleTransactionRetry).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      transactionHandle,
      {
        salonId: 'salon_1',
        clientId: 'client_1',
      },
    );
    expect(body.data.client.adminFlags.flaggedBy).toBe('admin_1');
    expect(body.data.client.isBlocked).toBe(true);
  });

  it('reads and updates a merged source through its active terminal profile', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    resolveTerminalSalonClient.mockResolvedValue({
      id: 'primary_1',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'source_1',
      lineagePath: ['source_1', 'primary_1'],
    });
    lockTerminalSalonClientWithHandle.mockResolvedValue({
      id: 'primary_1',
      salonId: 'salon_1',
      archivedAt: null,
      redirectedFromClientId: 'source_1',
      lineagePath: ['source_1', 'primary_1'],
    });

    selectResults.push([{
      id: 'primary_1',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
    }]);
    const getResponse = await GET(
      new Request('http://localhost/api/admin/clients/source_1/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'source_1' }) },
    );
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.data.client.id).toBe('primary_1');
    expect(collectSqlValues(selectCalls[0]?.where)).toContain('primary_1');
    expect(collectSqlValues(selectCalls[0]?.where)).not.toContain('source_1');

    selectResults.push([{
      id: 'primary_1',
      salonId: 'salon_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: false,
      blockedReason: null,
      noShowCount: 0,
      lateCancelCount: 0,
    }]);
    updateResults.push([{
      id: 'primary_1',
      phone: '1111111111',
      fullName: 'Ava',
      adminFlags: {},
      isBlocked: true,
      blockedReason: 'Safety concern',
      noShowCount: 0,
      lateCancelCount: 0,
    }]);
    const putResponse = await PUT(
      new Request('http://localhost/api/admin/clients/source_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          isBlocked: true,
          blockedReason: 'Safety concern',
        }),
      }),
      { params: Promise.resolve({ id: 'source_1' }) },
    );
    const putBody = await putResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putBody.data.client.id).toBe('primary_1');
    expect(lockTerminalSalonClientWithHandle).toHaveBeenCalledWith(
      transactionHandle,
      {
        salonId: 'salon_1',
        clientId: 'source_1',
      },
    );
    expect(collectSqlValues(updateCalls[0]?.where)).toContain('primary_1');
    expect(collectSqlValues(updateCalls[0]?.where)).not.toContain('source_1');
  });

  it('returns the same non-disclosing response for missing and foreign client ids', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    resolveTerminalSalonClient
      .mockRejectedValueOnce(new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND'))
      .mockRejectedValueOnce(new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND'));

    const missingResponse = await GET(
      new Request('http://localhost/api/admin/clients/missing/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    const foreignResponse = await GET(
      new Request('http://localhost/api/admin/clients/foreign/flag?salonSlug=salon-a'),
      { params: Promise.resolve({ id: 'foreign' }) },
    );

    expect(missingResponse.status).toBe(404);
    expect(foreignResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual(await foreignResponse.json());
    expect(selectCalls).toHaveLength(0);
  });

  it('keeps failed terminal flag writes non-disclosing and makes no client write', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    lockTerminalSalonClientWithHandle.mockRejectedValue(
      new ClientLifecycleStabilizationError('CLIENT_NOT_FOUND'),
    );

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/foreign/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          isBlocked: true,
        }),
      }),
      { params: Promise.resolve({ id: 'foreign' }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found in this salon',
      },
    });
    expect(selectCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('uses the clientBlocking module gate for booking blocks without requiring clientFlags', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    guardModuleOr403.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'MODULE_DISABLED', message: 'Module disabled' },
    }), { status: 403 }));

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          isBlocked: true,
          blockedReason: 'Repeated no-shows',
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(403);
    expect(guardModuleOr403).toHaveBeenCalledTimes(1);
    expect(guardModuleOr403).toHaveBeenCalledWith({ salonId: 'salon_1', module: 'clientBlocking' });
  });

  it('uses the clientFlags module gate for problem flags without requiring clientBlocking', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      name: 'Owner',
    });
    guardModuleOr403.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'MODULE_DISABLED', message: 'Module disabled' },
    }), { status: 403 }));

    const response = await PUT(
      new Request('http://localhost/api/admin/clients/client_1/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          isProblemClient: true,
          flagReason: 'Aggressive behavior',
        }),
      }),
      { params: Promise.resolve({ id: 'client_1' }) },
    );

    expect(response.status).toBe(403);
    expect(guardModuleOr403).toHaveBeenCalledTimes(1);
    expect(guardModuleOr403).toHaveBeenCalledWith({ salonId: 'salon_1', module: 'clientFlags' });
  });
});
