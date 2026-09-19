/** Real PostgreSQL proof that intraday blocks and bookings share one fence. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { lockTechnicianAndAssertSlotFree, lockTechnicianSchedule, SlotConflictError } from '@/libs/bookingConflictGuard';
import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (!rawUrl && process.env.CALENDAR_BLOCK_PG_REQUIRED === 'true') {
  throw new Error('Calendar block PostgreSQL gate requires an attested disposable target.');
}
if (rawUrl && process.env.CALENDAR_BLOCK_DISPOSABLE_DATABASE_CONFIRMED !== 'true') {
  throw new Error('Calendar block PostgreSQL tests require CALENDAR_BLOCK_DISPOSABLE_DATABASE_CONFIRMED=true.');
}
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;

const START = new Date('2099-06-15T14:00:00.000Z');
const END = new Date('2099-06-15T15:00:00.000Z');
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
let executed = 0;
const runId = randomUUID();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 3_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function seed() {
  const n = ++sequence;
  const salonId = `block-race-salon-${runId}-${n}`;
  const otherSalonId = `block-race-other-salon-${runId}-${n}`;
  const techId = `block-race-tech-${runId}-${n}`;
  const otherTechId = `block-race-other-tech-${runId}-${n}`;
  const clientId = `block-race-client-${runId}-${n}`;
  await database.insert(schema.salonSchema).values([
    { id: salonId, slug: salonId, name: 'Block Race Salon', settings: { booking: { timezone: 'America/Toronto' } } as never },
    { id: otherSalonId, slug: otherSalonId, name: 'Other Block Race Salon', settings: { booking: { timezone: 'America/Toronto' } } as never },
  ]);
  await database.insert(schema.technicianSchema).values([
    { id: techId, salonId, name: 'Ava', isActive: true },
    { id: otherTechId, salonId: otherSalonId, name: 'Bea', isActive: true },
  ]);
  await database.insert(schema.salonClientSchema).values({ id: clientId, salonId, phone: `416555${String(1000 + n).padStart(4, '0')}`, fullName: 'Race Client' });
  return { salonId, otherSalonId, techId, otherTechId, clientId };
}

type Writer = 'block' | 'booking';
type Isolation = 'READ COMMITTED' | 'SERIALIZABLE';
type Fixture = Awaited<ReturnType<typeof seed>>;

async function write(tx: NodePgDatabase<typeof schema>, kind: Writer, fixture: Fixture, start: Date, end: Date) {
  await lockTechnicianAndAssertSlotFree(tx as never, {
    salonId: fixture.salonId,
    technicianId: fixture.techId,
    startTime: start,
    blockedEndTime: end,
  });
  if (kind === 'block') {
    await tx.insert(schema.technicianBlockedSlotSchema).values({
      id: randomUUID(),
      salonId: fixture.salonId,
      technicianId: fixture.techId,
      dayOfWeek: null,
      specificDate: null,
      startTime: '10:00',
      endTime: '11:00',
      startsAt: start,
      endsAt: end,
      label: 'Race block',
      isRecurring: false,
    });
    return;
  }
  await tx.insert(schema.appointmentSchema).values({
    id: randomUUID(),
    salonId: fixture.salonId,
    salonClientId: fixture.clientId,
    technicianId: fixture.techId,
    clientPhone: '4165550100',
    clientName: 'Race Client',
    startTime: start,
    endTime: end,
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
}

async function transactionWithRetry(args: {
  fixture: Fixture;
  kind: Writer;
  isolation: Isolation;
  start: Date;
  end: Date;
  snapshot: () => void;
  acquired: () => void;
  release: Promise<void>;
}) {
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${args.isolation}`);
      // Customer AI holds this shared technician lock while authorizing. Both
      // writers must still reach the schedule barrier without an upgrade deadlock.
      await client.query('SELECT id FROM technician WHERE id = $1 FOR SHARE', [args.fixture.techId]);
      args.snapshot();
      await args.release;
      const tx = drizzle(client, { schema });
      await write(tx, args.kind, args.fixture, args.start, args.end);
      args.acquired();
      await client.query('COMMIT');
      return { outcome: 'created' as const, attempts };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof SlotConflictError) {
        return { outcome: 'conflict' as const, attempts };
      }
      if ((error as { code?: string }).code === '40001' && attempts < 3) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
  throw new Error('Calendar block race exhausted retries');
}

async function race(args: { first: Writer; bookingIsolation: Isolation; overlap: boolean; guard: 'absent' | 'existing' }) {
  const fixture = await seed();
  if (args.guard === 'existing') {
    await database.insert(schema.technicianScheduleGuardSchema).values({ salonId: fixture.salonId, technicianId: fixture.techId, revision: 0 });
  }
  const firstSnapshot = deferred();
  const secondSnapshot = deferred();
  const firstRelease = deferred();
  const secondRelease = deferred();
  const firstAcquired = deferred();
  const secondAcquired = deferred();
  const firstStart = START;
  const secondStart = args.overlap ? new Date(START.getTime() + 30 * 60_000) : END;
  const firstKind = args.first;
  const secondKind: Writer = args.first === 'block' ? 'booking' : 'block';
  const firstTask = transactionWithRetry({
    fixture,
    kind: firstKind,
    isolation: firstKind === 'booking' ? args.bookingIsolation : 'READ COMMITTED',
    start: firstStart,
    end: END,
    snapshot: () => firstSnapshot.resolve(),
    acquired: firstAcquired.resolve,
    release: firstRelease.promise,
  });
  const secondTask = transactionWithRetry({
    fixture,
    kind: secondKind,
    isolation: secondKind === 'booking' ? args.bookingIsolation : 'READ COMMITTED',
    start: secondStart,
    end: new Date(secondStart.getTime() + 60 * 60_000),
    snapshot: () => secondSnapshot.resolve(),
    acquired: secondAcquired.resolve,
    release: secondRelease.promise,
  });
  // Both serializable/RC snapshots exist before either advisory-lock arrival.
  await bounded(Promise.all([firstSnapshot.promise, secondSnapshot.promise]), 'writers did not establish snapshots');
  firstRelease.resolve();
  await bounded(firstAcquired.promise, 'first writer did not acquire the technician fence');
  secondRelease.resolve();
  const result = await bounded(Promise.all([firstTask, secondTask]), 'calendar race timed out');
  return { result, fixture };
}

(target ? describe : describe.skip)('calendar blocks share the booking fence — real PostgreSQL', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing loopback block-time target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 12 });
    const connection = await pool.connect();
    try {
      await attestDisposableDatabaseSession(connection, target, resolveDisposableDatabaseServerExpectation(target));
    } finally {
      connection.release();
    }

    database = drizzle(pool, { schema });
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();

    expect(executed).toBe(11);

    process.stdout.write('CALENDAR_BLOCK_POSTGRES_TESTS_EXECUTED=11 CALENDAR_BLOCK_POSTGRES_TESTS_SKIPPED=0\n');
  });

  it.each([
    { first: 'block' as const, bookingIsolation: 'SERIALIZABLE' as const, guard: 'absent' as const },
    { first: 'booking' as const, bookingIsolation: 'SERIALIZABLE' as const, guard: 'absent' as const },
    { first: 'block' as const, bookingIsolation: 'SERIALIZABLE' as const, guard: 'existing' as const },
    { first: 'booking' as const, bookingIsolation: 'SERIALIZABLE' as const, guard: 'existing' as const },
    { first: 'block' as const, bookingIsolation: 'READ COMMITTED' as const, guard: 'absent' as const },
    { first: 'booking' as const, bookingIsolation: 'READ COMMITTED' as const, guard: 'absent' as const },
    { first: 'block' as const, bookingIsolation: 'READ COMMITTED' as const, guard: 'existing' as const },
    { first: 'booking' as const, bookingIsolation: 'READ COMMITTED' as const, guard: 'existing' as const },
  ])('serializes an exact overlap when $first arrives first with $bookingIsolation booking and $guard guard', async ({ first, bookingIsolation, guard }) => {
    const { result } = await race({ first, bookingIsolation, overlap: true, guard });

    expect(result.map(row => row.outcome).sort()).toEqual(['conflict', 'created']);

    // A block that commits first makes a serializable booking snapshot stale,
    // so retry must re-read and find the overlap. A block arriving second is
    // read committed and sees the booking directly after the common fence.
    if (bookingIsolation === 'SERIALIZABLE' && first === 'block') {
      expect(Math.max(...result.map(row => row.attempts))).toBeGreaterThanOrEqual(2);
    } else {
      expect(result.every(row => row.attempts === 1)).toBe(true);
    }

    executed += 1;
  });

  it('allows adjacent block and appointment windows after both snapshots', async () => {
    const { result } = await race({ first: 'block', bookingIsolation: 'SERIALIZABLE', overlap: false, guard: 'absent' });

    expect(result.map(row => row.outcome)).toEqual(['created', 'created']);

    executed += 1;
  });

  it('rejects a cross-salon technician guard tuple at the database boundary', async () => {
    const fixture = await seed();

    await expect(database.execute(sql`insert into technician_schedule_guard (salon_id, technician_id, revision) values (${fixture.salonId}, ${fixture.otherTechId}, 0)`))
      .rejects.toMatchObject({ code: '23503' });

    executed += 1;
  });

  it('does not serialize valid unrelated technician and salon tuples', async () => {
    const fixture = await seed();
    const a = database.transaction(async (tx) => {
      await lockTechnicianSchedule(tx as never, fixture.salonId, fixture.techId);
      await tx.insert(schema.technicianBlockedSlotSchema).values({ id: randomUUID(), salonId: fixture.salonId, technicianId: fixture.techId, dayOfWeek: null, specificDate: null, startTime: '10:00', endTime: '11:00', startsAt: START, endsAt: END, label: 'A', isRecurring: false });
    });
    const b = database.transaction(async (tx) => {
      await lockTechnicianSchedule(tx as never, fixture.otherSalonId, fixture.otherTechId);
      await tx.insert(schema.technicianBlockedSlotSchema).values({ id: randomUUID(), salonId: fixture.otherSalonId, technicianId: fixture.otherTechId, dayOfWeek: null, specificDate: null, startTime: '10:00', endTime: '11:00', startsAt: START, endsAt: END, label: 'B', isRecurring: false });
    });

    await expect(Promise.all([a, b])).resolves.toHaveLength(2);

    const rows = await database.select().from(schema.technicianBlockedSlotSchema).where(eq(schema.technicianBlockedSlotSchema.startsAt, START));

    expect(rows.filter(row => row.salonId === fixture.salonId || row.salonId === fixture.otherSalonId)).toHaveLength(2);

    executed += 1;
  });
});
