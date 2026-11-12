/** Opt-in genuine PostgreSQL evidence. Missing dedicated target skips, never falls back to DATABASE_URL. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint, type CustomerPaymentQuoteBuilder } from './preparationRepository';

vi.mock('server-only', () => ({}));

const rawUrl = process.env.CUSTOMER_PAYMENT_PREPARATION_TEST_DATABASE_URL ?? '';
const required = process.env.CUSTOMER_PAYMENT_PREPARATION_PG_REQUIRED === 'true';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  // Supplied-but-invalid targets fail; only genuinely absent opt-in may skip.
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (required) {
  throw new Error('Customer payment PostgreSQL checks required: CUSTOMER_PAYMENT_PREPARATION_TEST_DATABASE_URL is absent.');
}

const suite = target ? describe.sequential : describe.skip;
type Database = NodePgDatabase<typeof schema>;
const clients: pg.PoolClient[] = [];
const databases: Database[] = [];
const pids: number[] = [];
const salons: string[] = [];
let pool: pg.Pool | undefined;
const settings = { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true };
const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, discountCents: 0, taxCents: 1300, tipCents: 2000 });

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function blockedBy(waiter: number, blocker: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await clients[3]!.query<{ blocking: number[] }>(`WITH RECURSIVE blockers(pid) AS (
      SELECT unnest(pg_blocking_pids($1))
      UNION
      SELECT parent.pid FROM blockers b
      CROSS JOIN LATERAL unnest(pg_blocking_pids(b.pid)) AS parent(pid)
    ) SELECT coalesce(array_agg(pid), ARRAY[]::integer[]) AS blocking FROM blockers`, [waiter]);
    if (result.rows[0]?.blocking.includes(blocker)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Expected PostgreSQL session ${waiter} to wait for ${blocker}.`);
}

async function fixture() {
  const suffix = randomUUID();
  const salonId = `cp_pg_${suffix}`;
  const appointmentId = `cp_pg_appt_${suffix}`;
  salons.push(salonId);
  await databases[0]!.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Disposable payment fixture' });
  await databases[0]!.insert(schema.technicianSchema).values({ id: `tech_${suffix}`, salonId, name: 'Fixture technician' });
  await databases[0]!.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId: `tech_${suffix}`, clientName: 'Synthetic customer', clientPhone: '4165550111', startTime: new Date('2099-01-01T12:00:00Z'), endTime: new Date('2099-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const write = { salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings };
  const request = { salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ tipCents: 2000 }) };
  const expiresAt = new Date(Date.now() + 600000);
  const build: CustomerPaymentQuoteBuilder = async (_tx, _appointment, _policy, existing) => ({ snapshot, stripeAccountId: 'acct_pgfixture', expiresAt: existing?.expiresAt ?? expiresAt, context: { revision: 'fixture_v1' } });
  const repositories = databases.map(database => createCustomerPaymentPreparationRepository(database));
  return { salonId, appointmentId, write, request, build, repositories };
}

suite('customer payment preparation — attested PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Disposable target missing inside active PostgreSQL suite.');
    }
    const expected = resolveDisposableDatabaseServerExpectation(target);
    pool = new pg.Pool({ connectionString: target.connectionString, max: 4, connectionTimeoutMillis: 5000 });
    // Attest EACH physical session before migrations, fixture writes or locks.
    for (let i = 0; i < 4; i += 1) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout = \'15s\'; SET lock_timeout = \'8s\'; SET idle_in_transaction_session_timeout = \'20s\'');
      const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pids.push(pid.rows[0]!.pid);
      databases.push(drizzle(client, { schema }));
    }

    expect(new Set(pids).size).toBe(4);

    await migrate(databases[0]!, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120000);

  afterAll(async () => {
    try {
      // Only this suite's synthetic tenant rows; never blanket TRUNCATE.
      if (clients[0] && salons.length) {
        await clients[0].query('DELETE FROM salon WHERE id = ANY($1::text[])', [salons]);
      }
    } finally {
      for (const client of clients) {
        client.release();
      }
      await pool?.end();
    }
  }, 30000);

  it('serializes competing policy CAS writes across distinct physical sessions', async () => {
    const f = await fixture();
    await clients[0]!.query('BEGIN');
    await clients[0]!.query('SELECT id FROM salon WHERE id=$1 FOR NO KEY UPDATE', [f.salonId]);
    const outcomes = Promise.allSettled([
      f.repositories[1]!.saveCustomerPaymentSettingsDraft(f.write),
      f.repositories[2]!.saveCustomerPaymentSettingsDraft({ ...f.write, requestId: randomUUID() }),
    ]);
    try {
      await blockedBy(pids[1]!, pids[0]!);
      await blockedBy(pids[2]!, pids[0]!);
    } finally {
      await clients[0]!.query('ROLLBACK');
      await outcomes;
    }
    const results = await outcomes;

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);

    const failure = results.find(result => result.status === 'rejected');

    expect(failure?.status === 'rejected' ? String(failure.reason) : '').toContain('REVISION_CONFLICT');
    expect((await f.repositories[0]!.readCustomerPaymentSettingsDraft(f.salonId)).revision).toBe(1);
  }, 20000);

  it('replays simultaneous identical policy requests without a second revision', async () => {
    const f = await fixture();
    await clients[0]!.query('BEGIN');
    await clients[0]!.query('SELECT id FROM salon WHERE id=$1 FOR NO KEY UPDATE', [f.salonId]);
    const outcomes = Promise.allSettled([f.repositories[1]!.saveCustomerPaymentSettingsDraft(f.write), f.repositories[2]!.saveCustomerPaymentSettingsDraft(f.write)]);
    try {
      await blockedBy(pids[1]!, pids[0]!);
      await blockedBy(pids[2]!, pids[0]!);
    } finally {
      await clients[0]!.query('ROLLBACK');
      await outcomes;
    }
    const results = await outcomes;

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect((await f.repositories[0]!.readCustomerPaymentSettingsDraft(f.salonId)).revision).toBe(1);
  }, 20000);

  it('serializes same-key quotes and revalidates the winner before replay', async () => {
    const f = await fixture();
    await f.repositories[0]!.saveCustomerPaymentSettingsDraft(f.write);
    const entered = barrier();
    const release = barrier();
    let callbacks = 0;
    const first = f.repositories[1]!.prepareCustomerPaymentQuote(f.request, async (...args) => {
      callbacks += 1;
      entered.release();
      await release.promise;
      return f.build(...args);
    });
    // Attach error handling immediately, including setup failures before barrier.
    const firstResult = first.finally(() => entered.release());
    const handledFirst = Promise.allSettled([firstResult]);
    await entered.promise;
    const second = f.repositories[2]!.prepareCustomerPaymentQuote(f.request, async (...args) => {
      callbacks += 1;
      return f.build(...args);
    });
    const outcomes = Promise.allSettled([firstResult, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
    }
    const results = await outcomes;
    await handledFirst;

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect(callbacks).toBe(2);

    const count = await clients[0]!.query<{ count: number }>('SELECT count(*)::integer AS count FROM customer_payment_prepared_quote WHERE appointment_id=$1', [f.appointmentId]);

    expect(count.rows[0]!.count).toBe(1);
  }, 20000);

  it('admits only one competing quote at the 49-to-50 draft boundary', async () => {
    const f = await fixture();
    await f.repositories[0]!.saveCustomerPaymentSettingsDraft(f.write);
    const original = await f.repositories[0]!.prepareCustomerPaymentQuote(f.request, f.build);
    await clients[0]!.query(`INSERT INTO customer_payment_prepared_quote SELECT id || '_' || n, salon_id, appointment_id, request_id || '_' || n, request_fingerprint, fingerprint, policy_revision, stripe_account_id, mode, executable, snapshot, context, expires_at, created_at FROM customer_payment_prepared_quote CROSS JOIN generate_series(1,48) AS n WHERE id=$1`, [original.id]);
    const entered = barrier();
    const release = barrier();
    const first = f.repositories[1]!.prepareCustomerPaymentQuote({ ...f.request, requestId: randomUUID() }, async (...args) => {
      entered.release();
      await release.promise;
      return f.build(...args);
    });
    const handledFirst = Promise.allSettled([first.finally(() => entered.release())]);
    await entered.promise;
    const second = f.repositories[2]!.prepareCustomerPaymentQuote({ ...f.request, requestId: randomUUID() }, f.build);
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
    }
    const results = await outcomes;
    await handledFirst;

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status === 'rejected' ? String(results[1].reason) : '').toContain('QUOTE_LIMIT_REACHED');

    const count = await clients[0]!.query<{ count: number }>('SELECT count(*)::integer AS count FROM customer_payment_prepared_quote WHERE appointment_id=$1', [f.appointmentId]);

    expect(count.rows[0]!.count).toBe(50);
    expect(await f.repositories[0]!.prepareCustomerPaymentQuote(f.request, f.build)).toEqual(original);
  }, 20000);

  it('avoids policy-writer/quote deadlock and makes the old quote stale after commit', async () => {
    const f = await fixture();
    await f.repositories[0]!.saveCustomerPaymentSettingsDraft(f.write);
    const entered = barrier();
    const release = barrier();
    const quote = f.repositories[1]!.prepareCustomerPaymentQuote(f.request, async (tx, ...args) => {
      // Already holds appointment + policy. A writer will hold salon then wait
      // for policy. KEY SHARE simulates FK/reference work and MUST be compatible
      // with the writer's NO KEY UPDATE lock. FOR UPDATE would deadlock here.
      entered.release();
      await release.promise;
      await tx.execute(sql`SELECT id FROM salon WHERE id=${f.salonId} FOR KEY SHARE`);
      return f.build(tx, ...args);
    });
    const handledQuote = Promise.allSettled([quote.finally(() => entered.release())]);
    await entered.promise;
    const writer = f.repositories[2]!.saveCustomerPaymentSettingsDraft({ ...f.write, expectedRevision: 1, requestId: randomUUID(), settings: { ...settings, cancellationPolicy: 'Changed after quote' } });
    const outcomes = Promise.allSettled([quote, writer]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
    }
    const results = await outcomes;
    await handledQuote;

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect((await f.repositories[0]!.readCustomerPaymentSettingsDraft(f.salonId)).revision).toBe(2);
    await expect(f.repositories[0]!.prepareCustomerPaymentQuote(f.request, f.build)).rejects.toThrow('QUOTE_STALE');
  }, 20000);
});
