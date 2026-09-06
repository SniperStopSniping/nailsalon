import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH } from './route';

const {
  requireAdminSalonFromRequest,
  logAuditEvent,
  buildTimeOffDecisionNotification,
  createStaffNotification,
  db,
  selectLimit,
  tx,
  txSelectLimit,
  txInsertValues,
  txUpdateReturning,
} = vi.hoisted(() => {
  const selectLimit = vi.fn(async (): Promise<unknown[]> => []);
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
  }));

  const txUpdateReturning = vi.fn(async (): Promise<unknown[]> => []);
  const txSelectLimit = vi.fn(async (): Promise<unknown[]> => []);
  const txInsertValues = vi.fn(async () => undefined);
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => ({ returning: txUpdateReturning })) })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: txSelectLimit })) })),
    })),
    insert: vi.fn(() => ({ values: txInsertValues })),
  };

  const db = {
    select,
    transaction: vi.fn(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  return {
    requireAdminSalonFromRequest: vi.fn(),
    logAuditEvent: vi.fn(async () => undefined),
    buildTimeOffDecisionNotification: vi.fn(() => ({ title: 'Decision', body: 'Body' })),
    createStaffNotification: vi.fn(),
    db,
    selectLimit,
    tx,
    txSelectLimit,
    txInsertValues,
    txUpdateReturning,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonFromRequest,
}));

vi.mock('@/libs/auditLog', () => ({
  logAuditEvent,
}));

vi.mock('@/libs/notifications', () => ({
  buildTimeOffDecisionNotification,
  createStaffNotification,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

// `time_off_request.start_date` / `end_date` are DATE columns: the mapper
// hands the route 'YYYY-MM-DD' strings, never Dates.
const START = '2026-03-14';
const END = '2026-03-15';
// technician_time_off stores real timestamps; whole days go in at midnight UTC.
const BLOCK_START = new Date('2026-03-14T00:00:00.000Z');
const BLOCK_END = new Date('2026-03-15T00:00:00.000Z');

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req_1',
    salonId: 'salon_active',
    technicianId: 'tech_1',
    startDate: START,
    endDate: END,
    note: null,
    status: 'PENDING',
    decidedAt: null,
    decidedByAdminId: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

function decidedRow(status: 'APPROVED' | 'DENIED') {
  return {
    id: 'req_1',
    startDate: START,
    endDate: END,
    note: null,
    status,
    decidedAt: new Date('2026-03-02T00:00:00.000Z'),
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
  };
}

function patchRequest(status: 'APPROVED' | 'DENIED') {
  return PATCH(
    new Request('http://localhost/api/admin/time-off-requests/req_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: 'req_1' }) },
  );
}

describe('/api/admin/time-off-requests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1', name: 'Admin' },
    });
    txSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides requests outside the active salon on GET', async () => {
    selectLimit.mockResolvedValueOnce([pendingRequest({ salonId: 'salon_other' })]);

    const response = await GET(
      new Request('http://localhost/api/admin/time-off-requests/req_1'),
      { params: Promise.resolve({ id: 'req_1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('hides requests outside the active salon on PATCH', async () => {
    selectLimit.mockResolvedValueOnce([pendingRequest({ salonId: 'salon_other' })]);

    const response = await patchRequest('APPROVED');

    expect(response.status).toBe(404);
    expect(createStaffNotification).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('approving a request creates the technician_time_off block availability reads', async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest({ note: 'Family trip' })])
      .mockResolvedValue([{ name: 'Daniela' }]);
    txUpdateReturning.mockResolvedValueOnce([decidedRow('APPROVED')]);

    const response = await patchRequest('APPROVED');

    expect(response.status).toBe(200);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        technicianId: 'tech_1',
        salonId: 'salon_active',
        startDate: BLOCK_START,
        endDate: BLOCK_END,
        notes: 'Approved staff request: Family trip',
      }),
    );
    expect(createStaffNotification).toHaveBeenCalledWith(
      expect.objectContaining({ technicianId: 'tech_1', type: 'TIME_OFF_DECISION' }),
    );
    expect(buildTimeOffDecisionNotification).toHaveBeenCalledWith({
      status: 'APPROVED',
      startDate: START,
      endDate: END,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { request: { startDate: START, endDate: END } },
    });
  });

  it('writes an audit entry naming the decision, the request and the block', async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest({ note: 'Family trip' })])
      .mockResolvedValue([{ name: 'Daniela' }]);
    txUpdateReturning.mockResolvedValueOnce([decidedRow('APPROVED')]);

    const response = await patchRequest('APPROVED');

    expect(response.status).toBe(200);
    // Approving writes a real calendar block: the decision has to be
    // reconstructable later, not just a line in a server log.
    expect(logAuditEvent).toHaveBeenCalledWith({
      salonId: 'salon_active',
      actorType: 'admin',
      actorId: 'admin_1',
      action: 'time_off_request_decided',
      entityType: 'time_off_request',
      entityId: 'req_1',
      metadata: {
        status: 'APPROVED',
        technicianId: 'tech_1',
        startDate: START,
        endDate: END,
        blockCreated: true,
      },
    });
  });

  it('records a denial in the audit log with no block created', async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest()])
      .mockResolvedValue([{ name: 'Daniela' }]);
    txUpdateReturning.mockResolvedValueOnce([decidedRow('DENIED')]);

    const response = await patchRequest('DENIED');

    expect(response.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'time_off_request_decided',
        metadata: expect.objectContaining({ status: 'DENIED', blockCreated: false }),
      }),
    );
  });

  it('refuses to decide a request whose stored dates cannot be read', async () => {
    // Regression: an unreadable date used to reach `.toISOString()` and 500.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    selectLimit
      .mockResolvedValueOnce([pendingRequest({ startDate: 'not-a-date' })])
      .mockResolvedValue([{ name: 'Daniela' }]);

    const response = await patchRequest('APPROVED');
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('INVALID_DATE_RANGE');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(createStaffNotification).not.toHaveBeenCalled();
  });

  it('denying a request never writes a time-off block', async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest()])
      .mockResolvedValue([{ name: 'Daniela' }]);
    txUpdateReturning.mockResolvedValueOnce([decidedRow('DENIED')]);

    const response = await patchRequest('DENIED');

    expect(response.status).toBe(200);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('approval is idempotent when an identical block already exists', async () => {
    selectLimit
      .mockResolvedValueOnce([pendingRequest()])
      .mockResolvedValue([{ name: 'Daniela' }]);
    txUpdateReturning.mockResolvedValueOnce([decidedRow('APPROVED')]);
    txSelectLimit.mockResolvedValue([{ id: 'timeoff_existing' }]);

    const response = await patchRequest('APPROVED');

    expect(response.status).toBe(200);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
