import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import { APPROVAL_REQUEST_SWEEP_BATCH, sweepExpiredApprovalRequests } from './approvalRequestSweeper';
/* eslint-enable import/first */

const SALON_ID = 'salon_sweeper';
const TECH_ID = 'tech_sweeper';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedAppointment(args: {
  id: string;
  status: string;
  requestExpiresAt: Date | null;
  startTime: Date;
}): Promise<void> {
  await db.insert(schema.appointmentSchema).values({
    id: args.id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165551234',
    startTime: args.startTime,
    endTime: new Date(args.startTime.getTime() + 60 * 60_000),
    status: args.status,
    requestExpiresAt: args.requestExpiresAt,
    confirmationModeSnapshot: args.requestExpiresAt !== null ? 'request_approval' : null,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
}

async function readAppointment(id: string) {
  const [row] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id));
  return row;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Sweeper Salon',
    slug: 'sweeper-salon',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Sweeper Tech',
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.communicationIntentSchema);
  await db.delete(schema.appointmentAuditLogSchema);
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

describe('sweepExpiredApprovalRequests', () => {
  it('finalizes an expired explicit request and leaves an unexpired one and a legacy NULL one untouched', async () => {
    const now = new Date('2099-07-01T12:00:00.000Z');
    await seedAppointment({
      id: 'appt_sweep_expired',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-01T10:00:00.000Z'),
      startTime: new Date('2099-07-01T14:00:00.000Z'),
    });
    await seedAppointment({
      id: 'appt_sweep_future',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-02T10:00:00.000Z'),
      startTime: new Date('2099-07-02T14:00:00.000Z'),
    });
    await seedAppointment({
      id: 'appt_sweep_legacy',
      status: 'pending',
      requestExpiresAt: null,
      startTime: new Date('2099-07-03T14:00:00.000Z'),
    });

    const summary = await sweepExpiredApprovalRequests({ now });

    expect(summary).toEqual({
      scanned: 1,
      expired: 1,
      alreadyExpired: 0,
      skipped: 0,
    });

    expect((await readAppointment('appt_sweep_expired'))?.status).toBe('cancelled');
    expect((await readAppointment('appt_sweep_expired'))?.cancelReason).toBe('request_expired');
    expect((await readAppointment('appt_sweep_future'))?.status).toBe('pending');
    expect((await readAppointment('appt_sweep_legacy'))?.status).toBe('pending');
  });

  it('is idempotent: a second sweep over an already-finalized row scans nothing (the row is no longer pending)', async () => {
    const now = new Date('2099-07-01T12:00:00.000Z');
    await seedAppointment({
      id: 'appt_sweep_twice',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-01T10:00:00.000Z'),
      startTime: new Date('2099-07-01T14:00:00.000Z'),
    });

    const first = await sweepExpiredApprovalRequests({ now });

    expect(first.expired).toBe(1);

    const second = await sweepExpiredApprovalRequests({ now: new Date(now.getTime() + 60_000) });

    expect(second).toEqual({ scanned: 0, expired: 0, alreadyExpired: 0, skipped: 0 });
  });

  it('orders candidates by requestExpiresAt ascending (oldest lapsed request first)', async () => {
    const now = new Date('2099-07-10T12:00:00.000Z');
    await seedAppointment({
      id: 'appt_sweep_later',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-10T09:00:00.000Z'),
      startTime: new Date('2099-07-10T14:00:00.000Z'),
    });
    await seedAppointment({
      id: 'appt_sweep_earlier',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-10T08:00:00.000Z'),
      startTime: new Date('2099-07-11T14:00:00.000Z'),
    });

    const summary = await sweepExpiredApprovalRequests({ now });

    expect(summary.scanned).toBe(2);
    expect(summary.expired).toBe(2);

    const earlier = await readAppointment('appt_sweep_earlier');
    const later = await readAppointment('appt_sweep_later');

    expect(earlier?.updatedAt.getTime()).toBeLessThanOrEqual(later!.updatedAt.getTime());
  });

  it('processes every eligible row in one batch, independently (per-row transactions)', async () => {
    const now = new Date('2099-07-05T12:00:00.000Z');
    await seedAppointment({
      id: 'appt_sweep_multi_a',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-05T09:00:00.000Z'),
      startTime: new Date('2099-07-05T14:00:00.000Z'),
    });
    await seedAppointment({
      id: 'appt_sweep_multi_b',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-05T09:30:00.000Z'),
      startTime: new Date('2099-07-06T14:00:00.000Z'),
    });

    const summary = await sweepExpiredApprovalRequests({ now });

    expect(summary.expired).toBe(2);
    expect(summary.skipped).toBe(0);
    expect((await readAppointment('appt_sweep_multi_a'))?.status).toBe('cancelled');
    expect((await readAppointment('appt_sweep_multi_b'))?.status).toBe('cancelled');
  });

  it('a row whose transaction THROWS is isolated: it is counted as skipped, left standing, and the rest of the batch still completes', async () => {
    // The "no longer pending" case below exercises a row the finalizer
    // declines to touch — not a row that genuinely blows up. This is the
    // other half: prove the per-row try/catch actually contains a thrown
    // error so one poisoned row cannot take down every other salon's sweep.
    const now = new Date('2099-07-05T12:00:00.000Z');
    await seedAppointment({
      id: 'appt_sweep_throws',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-05T08:00:00.000Z'),
      startTime: new Date('2099-07-05T14:00:00.000Z'),
    });
    await seedAppointment({
      id: 'appt_sweep_survivor',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-05T09:00:00.000Z'),
      startTime: new Date('2099-07-05T15:00:00.000Z'),
    });

    // The sweep is expected to log this failure; assert it does rather than
    // letting vitest-fail-on-console reject the run. A silently swallowed
    // per-row failure would be its own defect.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realDb = db;
    let transactionCalls = 0;
    holder.db = {
      select: realDb.select.bind(realDb),
      transaction: async (fn: Parameters<typeof realDb.transaction>[0]) => {
        transactionCalls += 1;
        // The oldest deadline sorts first, so this is `appt_sweep_throws`.
        if (transactionCalls === 1) {
          throw new Error('simulated per-row finalizer failure');
        }
        return realDb.transaction(fn);
      },
    };

    try {
      const summary = await sweepExpiredApprovalRequests({ now });

      expect(summary.scanned).toBe(2);
      expect(summary.skipped).toBe(1);
      expect(summary.expired).toBe(1);
      // Asserted before the `finally` restores the spy — mockRestore() clears
      // the recorded calls, so checking afterwards would always see zero.
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      holder.db = realDb;
      consoleError.mockRestore();
    }

    // The failing row is left exactly as it was — never half-transitioned.
    const failed = await readAppointment('appt_sweep_throws');

    expect(failed?.status).toBe('pending');
    expect(failed?.cancelReason).toBeNull();
    // ...and the batch still made forward progress on the healthy row.
    expect((await readAppointment('appt_sweep_survivor'))?.status).toBe('cancelled');
  });

  it('a row that is no longer pending at scan time is excluded from the batch, and does not stop the rest of it from being processed', async () => {
    const now = new Date('2099-07-05T12:00:00.000Z');
    await seedAppointment({
      id: 'appt_sweep_already_confirmed',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-05T09:00:00.000Z'),
      startTime: new Date('2099-07-05T14:00:00.000Z'),
    });
    await seedAppointment({
      id: 'appt_sweep_healthy',
      status: 'pending',
      requestExpiresAt: new Date('2099-07-05T09:30:00.000Z'),
      startTime: new Date('2099-07-06T14:00:00.000Z'),
    });
    // Won the confirm race before the sweep ever ran — appointmentBlocking's
    // predicate already stopped this from being considered a lapsed request
    // the moment it left 'pending', and the sweeper's own query (mirroring
    // that same predicate) correctly excludes it from the candidate scan.
    await db.update(schema.appointmentSchema)
      .set({ status: 'confirmed' })
      .where(eq(schema.appointmentSchema.id, 'appt_sweep_already_confirmed'));

    const summary = await sweepExpiredApprovalRequests({ now });

    expect(summary.scanned).toBe(1);
    expect(summary.expired).toBe(1);
    expect(summary.skipped).toBe(0);
    expect((await readAppointment('appt_sweep_healthy'))?.status).toBe('cancelled');
    expect((await readAppointment('appt_sweep_already_confirmed'))?.status).toBe('confirmed');
  });

  it('the derived batch cap is a positive, sane bound', () => {
    expect(APPROVAL_REQUEST_SWEEP_BATCH).toBeGreaterThan(0);
    expect(APPROVAL_REQUEST_SWEEP_BATCH).toBeLessThanOrEqual(1000);
  });
});
