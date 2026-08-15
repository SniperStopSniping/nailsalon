import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DepositCreditRow } from './depositCredit';

vi.mock('server-only', () => ({}));

const { defaultDatabase } = vi.hoisted(() => ({
  defaultDatabase: { select: vi.fn() },
}));

vi.mock('@/libs/DB', () => ({ db: defaultDatabase }));

/* eslint-disable import/first */
import { loadAppointmentDepositCreditRows } from './depositCredit.server';
/* eslint-enable import/first */

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src/libs/depositCredit.server.ts'),
  'utf8',
);
const NOW = new Date('2026-08-15T12:00:00.000Z');

function row(id: string): DepositCreditRow {
  return {
    id,
    status: 'paid',
    amountCents: 2500,
    currency: 'cad',
    stripePaymentIntentId: `pi_${id}`,
    stripeRefundId: null,
    refundedAt: null,
    refundStatus: null,
    refundStatusChangedAt: null,
    refundAmountCents: null,
    refundRequestedAt: null,
    refundTrigger: null,
    refundLastErrorCode: null,
    refundFailureReason: null,
    externalRefundObservedCents: null,
    refundConflictFlag: false,
    refundTerminalFailureCount: 0,
    priorRefundIds: [],
    forfeitedAt: null,
    forfeitureTaxSnapshot: null,
    createdAt: NOW,
  };
}

function queryHarness(rows: DepositCreditRow[]) {
  const query: Record<string, unknown> = {};
  const from = vi.fn(() => query);
  const where = vi.fn(() => query);
  const orderBy = vi.fn(() => query);
  const forLock = vi.fn(() => Promise.resolve(rows));
  const limit = vi.fn(() => query);
  const then = (
    onFulfilled?: (value: DepositCreditRow[]) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(onFulfilled, onRejected);
  Object.assign(query, { from, where, orderBy, for: forLock, limit, then });
  const database = { select: vi.fn((_fields?: Record<string, unknown>) => query) };

  return { database, from, where, orderBy, forLock, limit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadAppointmentDepositCreditRows', () => {
  it('returns every row from the tenant-scoped, deterministically ordered query', async () => {
    const rows = [row('dep_old'), row('dep_current')];
    const harness = queryHarness(rows);

    const result = await loadAppointmentDepositCreditRows({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      database: harness.database as never,
    });

    expect(result).toEqual(rows);
    expect(harness.database.select).toHaveBeenCalledTimes(1);
    expect(harness.from).toHaveBeenCalledTimes(1);
    expect(harness.where).toHaveBeenCalledTimes(1);
    expect(harness.orderBy).toHaveBeenCalledTimes(1);
    expect(harness.orderBy.mock.calls[0]).toHaveLength(2);
    expect(harness.limit).not.toHaveBeenCalled();
    expect(harness.forLock).not.toHaveBeenCalled();
  });

  it('adds FOR UPDATE only when the caller acknowledges the appointment lock', async () => {
    const rows = [row('dep_locked')];
    const harness = queryHarness(rows);

    const result = await loadAppointmentDepositCreditRows({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      database: harness.database as never,
      forUpdate: true,
      appointmentLockHeld: true,
    });

    expect(result).toEqual(rows);
    expect(harness.forLock).toHaveBeenCalledTimes(1);
    expect(harness.forLock).toHaveBeenCalledWith('update');
  });

  it('selects the complete resolver input, including collection identity', async () => {
    const harness = queryHarness([]);

    await loadAppointmentDepositCreditRows({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      database: harness.database as never,
    });

    const selected = harness.database.select.mock.calls[0]?.[0];

    expect(Object.keys(selected ?? {}).sort()).toEqual([
      'amountCents',
      'createdAt',
      'currency',
      'externalRefundObservedCents',
      'forfeitedAt',
      'forfeitureTaxSnapshot',
      'id',
      'priorRefundIds',
      'refundAmountCents',
      'refundConflictFlag',
      'refundFailureReason',
      'refundLastErrorCode',
      'refundRequestedAt',
      'refundStatus',
      'refundStatusChangedAt',
      'refundTerminalFailureCount',
      'refundTrigger',
      'refundedAt',
      'status',
      'stripePaymentIntentId',
      'stripeRefundId',
    ]);
  });

  it('pins both tenant predicates, all-row loading, ordering, and lock order in source', () => {
    expect(SOURCE).toContain('eq(appointmentDepositSchema.salonId, args.salonId)');
    expect(SOURCE).toContain('eq(appointmentDepositSchema.appointmentId, args.appointmentId)');
    expect(SOURCE).toContain(
      '.orderBy(asc(appointmentDepositSchema.createdAt), asc(appointmentDepositSchema.id))',
    );
    expect(SOURCE).not.toContain('.limit(');
    expect(SOURCE).toContain('query.for(\'update\')');
    expect(SOURCE).toContain('appointmentLockHeld: true');
  });
});
