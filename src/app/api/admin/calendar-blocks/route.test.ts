import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalonFromRequest,
  db,
  insertValues,
  lockTechnicianAndAssertSlotFree,
  lockTechnicianSchedule,
  logAuditEvent,
  selectResults,
  updateValues,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertValues: unknown[] = [];
  const updateValues: unknown[] = [];

  const makeSelect = () => {
    const rows = selectResults.shift() ?? [];
    const query: Record<string, unknown> = {
      from: () => query,
      where: () => query,
      orderBy: () => query,
      for: () => query,
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  };

  const insert = vi.fn(() => {
    const query: Record<string, unknown> = {
      values: (values: unknown) => {
        insertValues.push(values);
        return query;
      },
      returning: () => Promise.resolve([insertValues.at(-1)]),
    };
    return query;
  });
  const update = vi.fn(() => {
    const query: Record<string, unknown> = {
      set: (values: unknown) => {
        updateValues.push(values);
        return query;
      },
      where: () => query,
      returning: () => Promise.resolve([updateValues.at(-1)]),
    };
    return query;
  });
  const remove = vi.fn(() => {
    const query: Record<string, unknown> = { where: () => Promise.resolve() };
    return query;
  });
  const tx = { select: vi.fn(makeSelect), insert, update, delete: remove, execute: vi.fn() };
  const db = {
    select: vi.fn(makeSelect),
    transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
  };

  return {
    requireAdminSalonFromRequest: vi.fn(),
    db,
    insertValues,
    updateValues,
    selectResults,
    lockTechnicianAndAssertSlotFree: vi.fn(),
    lockTechnicianSchedule: vi.fn(),
    logAuditEvent: vi.fn(),
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalonFromRequest }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/bookingConflictGuard', async () => {
  const actual = await vi.importActual<typeof import('@/libs/bookingConflictGuard')>('@/libs/bookingConflictGuard');
  return {
    ...actual,
    lockTechnicianAndAssertSlotFree,
    lockTechnicianSchedule,
  };
});

/* eslint-disable import/first */
import { SlotConflictError } from '@/libs/bookingConflictGuard';

import { DELETE, GET, PATCH, POST } from './route';
/* eslint-enable import/first */

const BLOCK_ID = '018f4b16-93d7-7c3c-8e57-dc8d6f11e001';
const OTHER_BLOCK_ID = '018f4b16-93d7-7c3c-8e57-dc8d6f11e002';
const VERSION = '2026-06-15T14:00:00.000Z';
const SALON = {
  id: 'salon_a',
  status: 'active',
  deletedAt: null,
  settings: { booking: { timezone: 'America/Toronto' } },
};

function request(method: string, body?: unknown, query = '') {
  return new Request(`http://localhost/api/admin/calendar-blocks${query}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    technicianId: 'tech_a',
    date: '2026-06-15',
    startTime: '09:00',
    endTime: '10:00',
    label: 'Lunch',
    ...overrides,
  };
}

function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    salonId: 'salon_a',
    technicianId: 'tech_a',
    startsAt: new Date('2026-06-15T13:00:00.000Z'),
    endsAt: new Date('2026-06-15T14:00:00.000Z'),
    label: 'Lunch',
    updatedAt: new Date(VERSION),
    ...overrides,
  };
}

describe('calendar block API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.splice(0);
    insertValues.splice(0);
    updateValues.splice(0);
    requireAdminSalonFromRequest.mockResolvedValue({ error: null, salon: SALON, admin: { id: 'admin_a' } });
  });

  it('rejects an unauthenticated request before reading blocks', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      salon: null,
      admin: null,
    });

    const response = await GET(request('GET', undefined, '?date=2026-06-15&salonSlug=salon-a'));

    expect(response.status).toBe(401);
  });

  it('sends a salon-qualified URL through the tenant guard and does not accept another salon’s technician', async () => {
    selectResults.push([]);
    const req = request('POST', block({ technicianId: 'tech_other' }), '?salonSlug=salon-a');

    const response = await POST(req);

    expect(requireAdminSalonFromRequest).toHaveBeenCalledWith(req);
    expect(response.status).toBe(404);
    expect(lockTechnicianAndAssertSlotFree).not.toHaveBeenCalled();
  });

  it('creates an exact local window and permits a boundary-adjacent window through the shared conflict guard', async () => {
    selectResults.push([{ id: 'tech_a' }], []);

    const response = await POST(request('POST', block({ startTime: '10:00', endTime: '11:00' })));

    expect(response.status).toBe(200);
    expect(lockTechnicianAndAssertSlotFree).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      salonId: 'salon_a',
      technicianId: 'tech_a',
      startTime: new Date('2026-06-15T14:00:00.000Z'),
      blockedEndTime: new Date('2026-06-15T15:00:00.000Z'),
      excludedBlockId: BLOCK_ID,
    }));
    expect(insertValues).toHaveLength(1);
  });

  it('returns a conflict when an appointment or an overlapping block is found by the shared guard', async () => {
    selectResults.push([{ id: 'tech_a' }]);
    lockTechnicianAndAssertSlotFree.mockRejectedValueOnce(new SlotConflictError());

    const response = await POST(request('POST', block()));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('SLOT_CONFLICT');
    expect(insertValues).toHaveLength(0);
  });

  it('replays an identical create idempotently without inserting another block', async () => {
    selectResults.push([{ id: 'tech_a' }], [existing()]);

    const response = await POST(request('POST', block()));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.block.id).toBe(BLOCK_ID);
    expect(insertValues).toHaveLength(0);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_a',
      entityType: 'calendar_block',
      entityId: BLOCK_ID,
    }));
  });

  it('rejects a create replay whose same id has different block content', async () => {
    selectResults.push([{ id: 'tech_a' }], [existing()]);

    const response = await POST(request('POST', block({ label: 'Client call' })));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('STALE_BLOCK');
    expect(insertValues).toHaveLength(0);
  });

  it('rejects stale updates before changing a block', async () => {
    selectResults.push([{ id: 'tech_a' }], [existing({ updatedAt: new Date('2026-06-15T14:00:01.000Z') })]);

    const response = await PATCH(request('PATCH', block({ version: VERSION, label: 'Break' })));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('STALE_BLOCK');
    expect(updateValues).toHaveLength(0);
  });

  it('updates only with the current version and excludes its own window from conflict detection', async () => {
    selectResults.push([{ id: 'tech_a' }], [existing()]);

    const response = await PATCH(request('PATCH', block({ version: VERSION, label: 'Break' })));

    expect(response.status).toBe(200);
    expect(lockTechnicianAndAssertSlotFree).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      excludedBlockId: BLOCK_ID,
    }));
    expect(updateValues).toHaveLength(1);
    expect((updateValues[0] as { label: string }).label).toBe('Break');
  });

  it('deletes only with the current version and serializes the technician schedule', async () => {
    selectResults.push([{ id: 'tech_a' }], [existing()]);

    const response = await DELETE(request('DELETE', {
      id: BLOCK_ID,
      technicianId: 'tech_a',
      version: VERSION,
    }));

    expect(response.status).toBe(200);
    expect(lockTechnicianSchedule).toHaveBeenCalledWith(expect.anything(), 'salon_a', 'tech_a');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ operation: 'delete', technicianId: 'tech_a' }),
    }));
  });

  it('rejects invalid dates and DST-gap windows without acquiring a schedule lock', async () => {
    const invalidDate = await POST(request('POST', block({ date: '2026-02-30' })));
    const dstGap = await POST(request('POST', block({ date: '2026-03-08', startTime: '02:30', endTime: '03:30' })));

    expect(invalidDate.status).toBe(400);
    expect(dstGap.status).toBe(400);
    expect(lockTechnicianAndAssertSlotFree).not.toHaveBeenCalled();
  });

  it('lists only the selected salon’s day window through the admin tenant guard', async () => {
    const stored = existing({ id: OTHER_BLOCK_ID });
    selectResults.push([stored]);
    const req = request('GET', undefined, '?date=2026-06-15&salonSlug=salon-a');

    const response = await GET(req);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalonFromRequest).toHaveBeenCalledWith(req);
    expect(payload.data).toEqual({ blocks: [expect.objectContaining({ id: OTHER_BLOCK_ID })], timeZone: 'America/Toronto' });
  });
});
