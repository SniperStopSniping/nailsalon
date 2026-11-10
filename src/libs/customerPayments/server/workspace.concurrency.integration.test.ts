import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import type { PaymentProviderBinding, PaymentWorkspaceActor } from './workspaceContract';
import { createPaymentWorkspaceRepository } from './workspaceRepository';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_WORKSPACE_TEST_DATABASE_URL;
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;
if (!target && process.env.CUSTOMER_PAYMENT_WORKSPACE_PG_REQUIRED === 'true') {
  throw new Error('Disposable PostgreSQL workspace target required.');
}
const suite = target ? describe.sequential : describe.skip;
const clients: pg.PoolClient[] = [];
const pids: number[] = [];
const repositories: ReturnType<typeof createPaymentWorkspaceRepository>[] = [];
let pool: pg.Pool | undefined;
const binding: PaymentProviderBinding = { platformAccountId: 'acct_platform', connectedAccountId: 'acct_salon', bindingId: 'binding', livemode: false, currency: 'cad', returnOrigin: 'https://example.invalid' };
const sourceHash = 'a'.repeat(64);

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
    const result = await clients[2]!.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [waiter]);
    if (result.rows[0]!.blockers.includes(blocker)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock contention was not observed.');
}

async function fixture() {
  const database = drizzle(clients[0]!, { schema });
  const id = randomUUID();
  const scope = { salonId: `workspace_salon_${id}`, appointmentId: `workspace_appointment_${id}` };
  await database.insert(schema.salonSchema).values({ id: scope.salonId, slug: scope.salonId, name: 'Native workspace fixture' });
  await database.insert(schema.technicianSchema).values({ id, salonId: scope.salonId, name: 'Fixture tech' });
  await database.insert(schema.appointmentSchema).values({ id: scope.appointmentId, salonId: scope.salonId, technicianId: id, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const actor: PaymentWorkspaceActor = { ...scope, id: 'owner', role: 'owner', impersonating: false, canEditItems: true, canRecordPayment: true };
  await repositories[0]!.initialize(actor, randomUUID(), async () => ({ bill: { ...scope, revision: 0, serviceCents: 10000, taxCents: 0, tipCents: 0 }, billSourceHash: sourceHash, payments: [] }));
  const command = { kind: 'request_payment' as const, requestId: randomUUID(), expectedRevision: 0 };
  return { scope, actor, command };
}

suite('workspace commands on separate PostgreSQL connections', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Disposable target absent.');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 3, connectionTimeoutMillis: 5000 });
    const expected = resolveDisposableDatabaseServerExpectation(target);
    for (let i = 0; i < 3; i++) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout=\'15s\'; SET lock_timeout=\'8s\'; SET idle_in_transaction_session_timeout=\'20s\'');
      pids.push((await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      repositories.push(createPaymentWorkspaceRepository(drizzle(client, { schema })));
    }

    expect(new Set(pids).size).toBe(3);

    await migrate(drizzle(clients[0]!, { schema }), { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 60000);

  afterAll(async () => {
    for (const client of clients) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool?.end();
  });

  it.each([false, true])('serializes overlapping requests and handles an identical retry=%s', async (identical) => {
    const f = await fixture();
    const entered = barrier();
    const release = barrier();
    const first = repositories[0]!.command(f.actor, f.command, async () => {
      entered.release();
      await release.promise;
      return { binding, billSourceHash: sourceHash };
    });
    await entered.promise;
    const second = repositories[1]!.command(f.actor, identical ? f.command : { ...f.command, requestId: randomUUID() }, async () => ({ binding, billSourceHash: sourceHash }));
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[1]!, pids[0]!);
    } finally {
      release.release();
    }
    const results = await outcomes;

    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(identical ? 2 : 1);

    if (identical) {
      expect(await second).toMatchObject({ replayed: true });
    } else {
      expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ code: 'PAYMENT_WORKSPACE_STALE' }) });
    }

    expect((await repositories[2]!.read(f.actor))!.operations).toHaveLength(1);
  }, 20000);

  it('lets only one process own dispatch and retains its provider identity across restart', async () => {
    const f = await fixture();
    const saved = await repositories[0]!.command(f.actor, f.command, async () => ({ binding, billSourceHash: sourceHash }));
    const id = saved.state.operations[0]!.id;
    const results = await Promise.allSettled([repositories[0]!.claimDispatch(f.scope, id), repositories[1]!.claimDispatch(f.scope, id)]);
    const successes = results.filter(item => item.status === 'fulfilled');

    expect(successes).toHaveLength(1);

    const claim = successes[0]!.value;
    await repositories[2]!.recordUncertain(f.scope, id, claim.dispatchToken);
    const retry = await repositories[1]!.claimDispatch(f.scope, id);

    expect(retry.idempotencyKey).toBe(claim.idempotencyKey);
    expect(retry.operation.firstDispatchAt).toBe(claim.operation.firstDispatchAt);
    await expect(repositories[0]!.recordUncertain(f.scope, id, claim.dispatchToken)).rejects.toThrow('DISPATCH_FENCED');
    await expect(clients[0]!.query('UPDATE appointment SET total_price=1 WHERE id=$1', [f.scope.appointmentId])).rejects.toThrow('BALANCE_HELD');
    await expect(clients[0]!.query('UPDATE customer_payment_workspace SET revision=revision+1,state=jsonb_set(jsonb_set(state,\'{revision}\',to_jsonb(revision+1)),\'{operations,0,principalCents}\',\'1\'::jsonb),request_id=$2 WHERE appointment_id=$1', [f.scope.appointmentId, randomUUID()])).rejects.toThrow('OPERATION_IMMUTABLE');
  });
});
