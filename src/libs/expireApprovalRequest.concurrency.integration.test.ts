/**
 * L1 PR5 — H. Genuine-PostgreSQL race matrix for the request-approval
 * expiry lifecycle.
 *
 * PGlite has one physical connection and cannot exercise real row-lock
 * contention (see `appointmentBlocking.test.ts` / `expireApprovalRequest
 * .test.ts` for the single-connection correctness proofs this file does
 * NOT repeat). This suite is the other half: races that only a genuine
 * second Postgres session can show. Ordinary Vitest runs skip it; set
 * `L1_PR5_CONCURRENCY_REQUIRED=true` to make a missing/rejected target a
 * hard failure instead of a skip (mirrors the D5/D6 CI convention).
 *
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa@127.0.0.1:55432/luster_qa \
 *     ./node_modules/.bin/vitest run src/libs/expireApprovalRequest.concurrency.integration.test.ts
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const REQUIRED = process.env.L1_PR5_CONCURRENCY_REQUIRED === 'true';

let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new Error(
    'L1 PR5 PostgreSQL concurrency is required, but CONCURRENCY_TEST_DATABASE_URL is absent.',
  );
}

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  confirmAccess: null as unknown,
  cancelAccess: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess: vi.fn(async () => holder.confirmAccess),
  requireAppointmentManagerAccess: vi.fn(async () => holder.cancelAccess),
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
  enqueueGoogleCalendarUpsert: vi.fn(async () => {}),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
  enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationNotificationToTech: vi.fn(async () => ({ success: true })),
  sendCancellationConfirmation: vi.fn(async () => ({ success: true })),
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendRescheduleConfirmation: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled: vi.fn(async () => {}),
}));

vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: vi.fn(async () => ({ status: 'skipped' })),
}));

vi.mock('@/libs/queries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/queries')>()),
  getAppointmentServiceNames: vi.fn(async () => []),
  getSalonById: vi.fn(async () => null),
  getTechnicianById: vi.fn(async () => null),
  updateSalonClientStats: vi.fn(async () => {}),
}));

const { PATCH: confirmPatch } = await import('@/app/api/appointments/[id]/route');
const { PATCH: cancelPatch } = await import('@/app/api/appointments/[id]/cancel/route');
const { expireApprovalRequest } = await import('./expireApprovalRequest');
const { sweepExpiredApprovalRequests } = await import('./approvalRequestSweeper');

const SALON_ID = 'salon_l1_pr5_concurrency';
const TECH_ID = 'tech_l1_pr5_concurrency';
const CLIENT_ID = 'client_l1_pr5_concurrency';
/** A distinct client for tests that need two SIMULTANEOUSLY-active appointments — the "one active appointment per client" rule (unrelated to this PR) would otherwise block the second one. */
const CLIENT_ID_2 = 'client_l1_pr5_concurrency_2';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pool: pg.Pool;
let db: TestDb;
let executedTests = 0;
const EXPECTED_EXECUTED_TESTS = 8;
let seedOrdinal = 0;

function confirmAccessFor(
  appointmentId: string,
  status: string,
  requestExpiresAt: Date | null,
  client: { id: string; phone: string } = { id: CLIENT_ID, phone: '4165550000' },
) {
  return {
    ok: true,
    actorRole: 'admin',
    salon: { id: SALON_ID, slug: 'l1-pr5-concurrency', name: 'L1 PR5 Concurrency' },
    appointment: {
      id: appointmentId,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      salonClientId: client.id,
      clientPhone: client.phone,
      clientName: 'Concurrency Client',
      clientEmail: null,
      startTime: new Date('2099-09-01T14:00:00.000Z'),
      endTime: new Date('2099-09-01T15:00:00.000Z'),
      status,
      requestExpiresAt,
      canvasState: 'waiting',
      googleCalendarEventId: null,
      totalPrice: 4500,
      totalDurationMinutes: 60,
    },
  };
}

function cancelAccessFor(appointmentId: string, status: string, requestExpiresAt: Date | null) {
  return {
    ...confirmAccessFor(appointmentId, status, requestExpiresAt),
    appointment: {
      ...confirmAccessFor(appointmentId, status, requestExpiresAt).appointment,
      cancelReason: null,
      notes: null,
      updatedAt: new Date(),
    },
  };
}

function confirmRequest(appointmentId: string) {
  return new Request(`http://localhost/api/appointments/${appointmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed' }),
  });
}

function declineRequest(appointmentId: string) {
  return new Request(`http://localhost/api/appointments/${appointmentId}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancelReason: 'declined_by_salon' }),
  });
}

async function seedAppointment(args: {
  status: string;
  requestExpiresAt: Date | null;
  /** Hours from the fixed base instant — generous spacing so same-technician slots never overlap (each appointment blocks 60 minutes). */
  startOffsetHours?: number;
  clientId?: string;
  clientPhone?: string;
}): Promise<string> {
  seedOrdinal += 1;
  const id = `appt_l1_pr5_${seedOrdinal}`;
  const start = new Date(Date.UTC(2099, 8, 1, 14, 0, 0) + (args.startOffsetHours ?? seedOrdinal * 2) * 60 * 60_000);
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    salonClientId: args.clientId ?? CLIENT_ID,
    clientPhone: args.clientPhone ?? '4165550000',
    clientName: 'Concurrency Client',
    startTime: start,
    endTime: new Date(start.getTime() + 60 * 60_000),
    status: args.status,
    requestExpiresAt: args.requestExpiresAt,
    confirmationModeSnapshot: args.requestExpiresAt !== null ? 'request_approval' : null,
    canvasState: 'waiting',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    invoiceCurrency: 'CAD',
  });
  return id;
}

async function readAppointment(id: string) {
  const [row] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id));
  return row;
}

async function countAuditRows(id: string) {
  const rows = await db.select().from(schema.appointmentAuditLogSchema)
    .where(eq(schema.appointmentAuditLogSchema.appointmentId, id));
  return rows.length;
}

async function countIntents(id: string) {
  const rows = await db.select().from(schema.communicationIntentSchema)
    .where(eq(schema.communicationIntentSchema.appointmentId, id));
  return rows.length;
}

const suite = disposableTarget ? describe.sequential : describe.skip;

suite('L1 PR5 — request-approval expiry lifecycle: genuine PostgreSQL races', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent inside active L1 PR5 suite.');
    }
    const expectedServer = resolveDisposableDatabaseServerExpectation(disposableTarget);
    pool = new pg.Pool({ connectionString: disposableTarget.connectionString, max: 16 });
    const attestationClient = await pool.connect();
    try {
      await attestDisposableDatabaseSession(attestationClient, disposableTarget, expectedServer);
    } finally {
      attestationClient.release();
    }
    db = drizzle(pool, { schema });
    holder.db = db;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    holder.db = db;
    seedOrdinal = 0;
    await pool.query('TRUNCATE TABLE salon RESTART IDENTITY CASCADE');
    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'L1 PR5 Concurrency Salon',
      slug: 'l1-pr5-concurrency',
      ownerEmail: 'owner@example.com',
    });
    await db.insert(schema.technicianSchema).values({
      id: TECH_ID,
      salonId: SALON_ID,
      name: 'Concurrency Tech',
    });
    await db.insert(schema.salonClientSchema).values([
      { id: CLIENT_ID, salonId: SALON_ID, phone: '4165550000' },
      { id: CLIENT_ID_2, salonId: SALON_ID, phone: '4165550001' },
    ]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `L1_PR5_CONCURRENCY_POSTGRES_TESTS_EXECUTED=${executedTests} L1_PR5_CONCURRENCY_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('confirm-wins vs sweep-wins: exactly one side transitions the row, never both, never a mixed state', async () => {
    const requestExpiresAt = new Date(Date.now() - 1000);
    const id = await seedAppointment({ status: 'pending', requestExpiresAt });
    holder.confirmAccess = confirmAccessFor(id, 'pending', requestExpiresAt);

    const [confirmResponse, sweepOutcome] = await Promise.all([
      confirmPatch(confirmRequest(id), { params: Promise.resolve({ id }) }),
      db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() })),
    ]);

    const row = await readAppointment(id);

    // The deadline is already in the past, so BOTH sides agree the request
    // has lapsed — the sweep always wins the transition (only it performs
    // the pending -> cancelled CAS), and confirm always loses, however the
    // row lock happens to order the two transactions.
    expect(sweepOutcome.outcome).toBe('transitioned');
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelReason).toBe('request_expired');
    expect(confirmResponse.status).not.toBe(200);
    expect(await countAuditRows(id)).toBe(1);
    expect(await countIntents(id)).toBe(1);

    executedTests += 1;
  }, 30_000);

  it('two concurrent sweeps over the same lapsed request: exactly one transitions, the other observes already_expired', async () => {
    const requestExpiresAt = new Date(Date.now() - 1000);
    const id = await seedAppointment({ status: 'pending', requestExpiresAt });

    const [first, second] = await Promise.all([
      db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() })),
      db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() })),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();

    expect(outcomes).toEqual(['already_expired', 'transitioned']);
    expect(await countAuditRows(id)).toBe(1);
    expect(await countIntents(id)).toBe(1);
    expect((await readAppointment(id))?.status).toBe('cancelled');

    executedTests += 1;
  }, 30_000);

  it('two concurrent sweeper runs over a batch of lapsed requests never double-count or double-transition any row', async () => {
    const ids = await Promise.all([
      seedAppointment({ status: 'pending', requestExpiresAt: new Date(Date.now() - 5000) }),
      seedAppointment({ status: 'pending', requestExpiresAt: new Date(Date.now() - 4000) }),
      seedAppointment({ status: 'pending', requestExpiresAt: new Date(Date.now() - 3000) }),
    ]);

    const [summaryA, summaryB] = await Promise.all([
      sweepExpiredApprovalRequests(),
      sweepExpiredApprovalRequests(),
    ]);

    expect(summaryA.expired + summaryB.expired).toBe(ids.length);

    for (const id of ids) {
      expect((await readAppointment(id))?.status).toBe('cancelled');
      expect(await countAuditRows(id)).toBe(1);
      expect(await countIntents(id)).toBe(1);
    }

    executedTests += 1;
  }, 30_000);

  it('decline racing expiry: exactly one terminal reason wins, never both applied', async () => {
    const requestExpiresAt = new Date(Date.now() - 1000);
    const id = await seedAppointment({ status: 'pending', requestExpiresAt });
    holder.cancelAccess = cancelAccessFor(id, 'pending', requestExpiresAt);

    const [declineResponse, sweepOutcome] = await Promise.all([
      cancelPatch(declineRequest(id), { params: Promise.resolve({ id }) }),
      db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() })),
    ]);

    const row = await readAppointment(id);

    expect(row?.status).toBe('cancelled');
    expect(['declined_by_salon', 'request_expired']).toContain(row?.cancelReason);

    // Whichever side won the row lock, the loser's response must never
    // report an unrelated 200 success that silently overwrote the winner's
    // reason — either it is itself the 200 (and matches the row), or it
    // failed/no-op'd.
    if (declineResponse.status === 200) {
      expect(row?.cancelReason).toBe('declined_by_salon');
    } else {
      expect(sweepOutcome.outcome).toBe('transitioned');
      expect(row?.cancelReason).toBe('request_expired');
    }

    executedTests += 1;
  }, 30_000);

  it('crash-after-commit then a retrying caller produces NO duplicate notification intent', async () => {
    const requestExpiresAt = new Date(Date.now() - 1000);
    const id = await seedAppointment({ status: 'pending', requestExpiresAt });

    // Two callers racing the SAME finalization, exactly as a retrying caller
    // that never observed its own earlier commit would.
    await Promise.all([
      db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() })),
      db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() })),
    ]);

    expect(await countIntents(id)).toBe(1);

    executedTests += 1;
  }, 30_000);

  it('retry-after-completion (sequential, after the transition already committed) is a no-op', async () => {
    const requestExpiresAt = new Date(Date.now() - 1000);
    const id = await seedAppointment({ status: 'pending', requestExpiresAt });

    const first = await db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() }));

    expect(first.outcome).toBe('transitioned');

    const retry = await db.transaction(tx => expireApprovalRequest(tx, { appointmentId: id, transactionNow: new Date() }));

    expect(retry).toEqual({ outcome: 'already_expired' });
    expect(await countAuditRows(id)).toBe(1);
    expect(await countIntents(id)).toBe(1);

    executedTests += 1;
  }, 30_000);

  it('at/after-deadline rejection: confirm PATCH refuses a request exactly at its deadline (409 REQUEST_EXPIRED), and one instant before still confirms', async () => {
    const atDeadline = new Date(Date.now() + 2000);
    const idAt = await seedAppointment({
      status: 'pending',
      requestExpiresAt: atDeadline,
      startOffsetHours: 500,
    });
    holder.confirmAccess = confirmAccessFor(idAt, 'pending', atDeadline);

    // Wait until real time reaches (or passes) the deadline instant.
    await new Promise(resolve => setTimeout(resolve, 2100));

    const atResponse = await confirmPatch(confirmRequest(idAt), { params: Promise.resolve({ id: idAt }) });

    expect(atResponse.status).toBe(409);
    expect((await atResponse.json()).error.code).toBe('REQUEST_EXPIRED');
    expect((await readAppointment(idAt))?.status).toBe('pending');

    // A DIFFERENT client — idAt is still 'pending' (correctly, since it was
    // just rejected) and the unrelated "one active appointment per client"
    // rule would otherwise block this second, independent assertion.
    const notYet = new Date(Date.now() + 60 * 60 * 1000);
    const idBefore = await seedAppointment({
      status: 'pending',
      requestExpiresAt: notYet,
      startOffsetHours: 600,
      clientId: CLIENT_ID_2,
      clientPhone: '4165550001',
    });
    holder.confirmAccess = confirmAccessFor(idBefore, 'pending', notYet, { id: CLIENT_ID_2, phone: '4165550001' });

    const beforeResponse = await confirmPatch(confirmRequest(idBefore), { params: Promise.resolve({ id: idBefore }) });

    expect(beforeResponse.status).toBe(200);
    expect((await readAppointment(idBefore))?.status).toBe('confirmed');

    executedTests += 1;
  }, 30_000);

  it('legacy NULL requestExpiresAt is never swept and always confirms, even racing a sweep pass', async () => {
    const id = await seedAppointment({ status: 'pending', requestExpiresAt: null, startOffsetHours: 700 });
    holder.confirmAccess = confirmAccessFor(id, 'pending', null);

    const [confirmResponse, sweepSummary] = await Promise.all([
      confirmPatch(confirmRequest(id), { params: Promise.resolve({ id }) }),
      sweepExpiredApprovalRequests(),
    ]);

    expect(confirmResponse.status).toBe(200);
    expect((await readAppointment(id))?.status).toBe('confirmed');
    expect(sweepSummary.expired).toBe(0);

    executedTests += 1;
  }, 30_000);
});
