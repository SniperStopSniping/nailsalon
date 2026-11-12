import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { verifyOfflineProviderReceipt } from '../provider/evidence';
import { createProviderFixtureMovementApplication } from './applyProviderFixtureMovements';
import type { createFixtureCaptureGraph } from './fixtureApplicationTestSupport';
import { signFixtureCapturePayload } from './fixtureApplicationTestSupport';
import { addFixtureRefund, createFixtureMovementGraph } from './fixtureMovementTestSupport';
import { withProviderFixtureTransaction } from './providerFixtureFence';
import { createProviderJournal } from './providerJournal';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_FIXTURE_MOVEMENT_PG_REQUIRED === 'true') {
  throw new Error('Fixture application PG target required but absent');
}
const suite = target ? describe.sequential : describe.skip;
type Database = NodePgDatabase<typeof schema>;
const clients: pg.PoolClient[] = [];
const databases: Database[] = [];
let pool: pg.Pool | undefined;
let database: Database;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function code(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}
async function unknownReceipt(f: Awaited<ReturnType<typeof createFixtureCaptureGraph>>) {
  const payload = { ...f.chargePayload, id: `evt_${randomUUID().replaceAll('-', '')}`, type: 'unknown.money' };
  const signed = signFixtureCapturePayload(payload);
  return verifyOfflineProviderReceipt(signed.input, f.config, signed.verifier);
}
async function revision(platformId: string) {
  return Number((await clients[0]!.query('SELECT revision FROM customer_payment_fixture_platform WHERE platform_id=$1', [platformId])).rows[0].revision);
}
async function holdCount(applicationId: string) {
  return Number((await clients[0]!.query('SELECT count(*)::int AS n FROM customer_payment_fixture_hold WHERE application_id=$1', [applicationId])).rows[0].n);
}

suite('offline canonical fixture movements — attested PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('target missing');
    }
    const expected = resolveDisposableDatabaseServerExpectation(target);
    pool = new pg.Pool({ connectionString: target.connectionString, max: 4, connectionTimeoutMillis: 5000 });
    for (let i = 0; i < 4; i += 1) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout=\'15s\'; SET lock_timeout=\'8s\'; SET idle_in_transaction_session_timeout=\'20s\'');
      databases.push(drizzle(client, { schema }));
    }
    database = databases[0]!;
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    for (const [key, value] of Object.entries({ NODE_ENV: 'test', APP_ENV: 'development', VERCEL_ENV: '', VERCEL: '', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true', CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED: 'true', CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED: 'true', CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED: 'true', CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED: 'true' })) {
      vi.stubEnv(key, value);
    }
  }, 120000);

  afterAll(async () => {
    for (const client of clients) {
      client.release();
    }
    await pool?.end();
    vi.unstubAllEnvs();
  }, 30000);

  it('competing complete batches preserve one movement and replay', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);
    const results = await Promise.allSettled([1, 2].map(i => createProviderFixtureMovementApplication(databases[i]!).reconcileMovements({ captureApplicationId: f.captureApplicationId })));

    expect(results.some(r => r.status === 'fulfilled' && r.value.state === 'applied')).toBe(true);

    for (const r of results) {
      if (r.status === 'rejected') {
        expect(['55P03', '40001', '40P01']).toContain(code(r.reason));
      }
    }

    expect((await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId })).state).toBe('replayed');
    expect((await clients[0]!.query('SELECT id FROM customer_payment_fixture_movement WHERE application_id=$1', [f.captureApplicationId])).rows).toHaveLength(1);
    expect(await holdCount(f.captureApplicationId)).toBeGreaterThan(0);
  }, 20000);

  it('source insertion loses NOWAIT while complete movement batch owns admission', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);
    const receipt = await unknownReceipt(f);
    const entered = barrier();
    const release = barrier();
    const wrapped = { select: databases[1]!.select.bind(databases[1]), transaction: (callback: Parameters<Database['transaction']>[0], options: Parameters<Database['transaction']>[1]) => databases[1]!.transaction(async (tx) => {
      const result = await callback(tx);
      entered.release();
      await release.promise;
      return result;
    }, options) };
    const applying = createProviderFixtureMovementApplication(wrapped as never).reconcileMovements({ captureApplicationId: f.captureApplicationId });
    const handled = Promise.allSettled([applying.finally(() => entered.release())]);
    await entered.promise;
    try {
      await expect(createProviderJournal(databases[2]!).ingestReceipt(receipt)).rejects.toSatisfy(error => code(error) === '55P03');
    } finally {
      release.release();
      await handled;
    }

    expect((await applying).state).toBe('applied');

    await createProviderJournal(databases[2]!).ingestReceipt(receipt);

    expect((await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId })).state).toBe('held');
    expect((await clients[0]!.query('SELECT amount_cents FROM customer_payment_fixture_movement WHERE application_id=$1', [f.captureApplicationId])).rows).toEqual([{ amount_cents: 1000 }]);
  }, 20000);

  it('old repeatable-read reconciliation cannot admit stale source revision', async () => {
    const f = await createFixtureMovementGraph(database);
    const receipt = await unknownReceipt(f);
    await clients[1]!.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await clients[1]!.query('SELECT revision FROM customer_payment_fixture_admission WHERE id=1');
      await createProviderJournal(databases[2]!).ingestReceipt(receipt);

      await expect(clients[1]!.query('SELECT customer_payment_fixture_admit()')).rejects.toSatisfy(error => code(error) === '40001');
    } finally {
      await clients[1]!.query('ROLLBACK');
    }
  });

  it('appointment-first protected edit fails closed against admission-first batch', async () => {
    const f = await createFixtureMovementGraph(database);
    const entered = barrier();
    const release = barrier();
    const locking = withProviderFixtureTransaction(databases[1]!, async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    try {
      await expect(clients[2]!.query('UPDATE appointment SET tip_cents=tip_cents+1 WHERE id=$1', [f.appointmentId])).rejects.toSatisfy(error => code(error) === '55P03');
    } finally {
      release.release();
      await locking;
    }
  });

  it('complete zero snapshot does not advance source revision and later source stales it', async () => {
    const f = await createFixtureMovementGraph(database);
    const before = await revision(f.config.platformId);
    const result = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(result.state).toBe('applied');
    expect(result.movementIds).toEqual([]);
    expect(await revision(f.config.platformId)).toBe(before);

    await addFixtureRefund(f);

    expect(await revision(f.config.platformId)).toBeGreaterThan(before);
    expect((await clients[0]!.query('SELECT movement_evidence FROM customer_payment_fixture_reconciliation WHERE id=$1', [result.reconciliationId])).rows[0]).toEqual({ movement_evidence: [] });
  });

  it('immutable movement updates and deletes fail without erasing cash', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);
    const result = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(result.state).toBe('applied');
    await expect(clients[1]!.query('UPDATE customer_payment_fixture_movement SET amount_cents=1 WHERE application_id=$1', [f.captureApplicationId])).rejects.toThrow();
    await expect(clients[1]!.query('DELETE FROM customer_payment_fixture_movement WHERE application_id=$1', [f.captureApplicationId])).rejects.toThrow();
    expect((await clients[0]!.query('SELECT amount_cents FROM customer_payment_fixture_movement WHERE application_id=$1', [f.captureApplicationId])).rows).toEqual([{ amount_cents: 1000 }]);
  });
});
