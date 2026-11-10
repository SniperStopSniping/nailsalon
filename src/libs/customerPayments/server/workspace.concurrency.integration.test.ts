import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { resolveCustomerWorkspaceActor } from './workspaceAccess';
import type { PaymentProviderBinding, PaymentWorkspaceActor, PaymentWorkspaceState } from './workspaceContract';
import { createWorkspacePolicyRepository, readWorkspaceBinding } from './workspacePolicyRepository';
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

const dispatchBinding = async (_tx: unknown, _appointment: unknown, state: PaymentWorkspaceState) => ({ binding, billSourceHash: state.billSourceHash });

async function fixture() {
  const database = drizzle(clients[0]!, { schema });
  const id = randomUUID();
  const scope = { salonId: `workspace_salon_${id}`, appointmentId: `workspace_appointment_${id}` };
  await database.insert(schema.salonSchema).values({ id: scope.salonId, slug: scope.salonId, name: 'Native workspace fixture' });
  await database.insert(schema.technicianSchema).values({ id, salonId: scope.salonId, name: 'Fixture tech' });
  await database.insert(schema.appointmentSchema).values({ id: scope.appointmentId, salonId: scope.salonId, technicianId: id, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const actor: PaymentWorkspaceActor = { ...scope, id: 'owner', role: 'owner', impersonating: false, canEditItems: true, canRecordPayment: true };
  await database.insert(schema.adminUserSchema).values({ id: actor.id }).onConflictDoNothing();
  await database.insert(schema.adminSalonMembershipSchema).values({ salonId: scope.salonId, adminId: actor.id, role: 'owner' });
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

  it.each([false, true])('serializes invoice revisions against new collections; revision commits first=%s', async (revisionFirst) => {
    const f = await fixture();
    const entered = barrier();
    const release = barrier();
    const revised = { bill: { ...f.scope, revision: 0, serviceCents: 12000, taxCents: 0, tipCents: 0 }, billSourceHash: 'b'.repeat(64) };
    const change = { requestId: randomUUID(), expectedRevision: 0, changeFingerprint: 'c'.repeat(64), reason: 'Added service' };
    const write = vi.fn(async () => revised);
    const first = revisionFirst
      ? repositories[0]!.reviseBill(f.actor, change, async () => {
        entered.release();
        await release.promise;
        return write();
      })
      : repositories[0]!.command(f.actor, f.command, async () => {
        entered.release();
        await release.promise;
        return { binding, billSourceHash: sourceHash };
      });
    await entered.promise;
    const second = revisionFirst
      ? repositories[1]!.command(f.actor, f.command, dispatchBinding)
      : repositories[1]!.reviseBill(f.actor, change, write);
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[1]!, pids[0]!);
    } finally {
      release.release();
    }

    expect(await outcomes).toMatchObject([{ status: 'fulfilled' }, { status: 'rejected', reason: expect.objectContaining({ code: 'PAYMENT_WORKSPACE_STALE' }) }]);

    const state = (await repositories[2]!.read(f.actor))!;

    expect(state.revision).toBe(1);
    expect(write).toHaveBeenCalledTimes(revisionFirst ? 1 : 0);

    if (revisionFirst) {
      const requested = await repositories[1]!.command(f.actor, { ...f.command, expectedRevision: state.revision }, dispatchBinding);

      expect(requested.state.operations[0]).toMatchObject({ principalCents: 12000 });
    } else {
      await expect(repositories[1]!.reviseBill(f.actor, { ...change, expectedRevision: state.revision }, write)).rejects.toThrow('BALANCE_HELD');
      expect(write).not.toHaveBeenCalled();
      expect(state.operations[0]).toMatchObject({ principalCents: 10000 });
    }
  }, 20000);

  it('lets only one process own dispatch and retains its provider identity across restart', async () => {
    const f = await fixture();
    const saved = await repositories[0]!.command(f.actor, f.command, async () => ({ binding, billSourceHash: sourceHash }));
    const id = saved.state.operations[0]!.id;
    const results = await Promise.allSettled([repositories[0]!.claimDispatch(f.actor, id, dispatchBinding), repositories[1]!.claimDispatch(f.actor, id, dispatchBinding)]);
    const successes = results.filter(item => item.status === 'fulfilled');

    expect(successes).toHaveLength(1);

    const claim = successes[0]!.value;
    await repositories[2]!.recordUncertain(f.scope, id, claim.dispatchToken);
    const retry = await repositories[1]!.claimDispatch(f.actor, id, dispatchBinding);

    expect(retry.idempotencyKey).toBe(claim.idempotencyKey);
    expect(retry.operation.firstDispatchAt).toBe(claim.operation.firstDispatchAt);
    await expect(repositories[0]!.recordUncertain(f.scope, id, claim.dispatchToken)).rejects.toThrow('DISPATCH_FENCED');
    await expect(clients[0]!.query('UPDATE appointment SET total_price=1 WHERE id=$1', [f.scope.appointmentId])).rejects.toThrow('BALANCE_HELD');
    await expect(clients[0]!.query('UPDATE customer_payment_workspace SET revision=revision+1,state=jsonb_set(jsonb_set(state,\'{revision}\',to_jsonb(revision+1)),\'{operations,0,principalCents}\',\'1\'::jsonb),request_id=$2 WHERE appointment_id=$1', [f.scope.appointmentId, randomUUID()])).rejects.toThrow('OPERATION_IMMUTABLE');
  });

  it.each([false, true])('serializes customer capability revocation against dispatch; revocation commits first=%s', async (revokeFirst) => {
    const f = await fixture();
    const database = drizzle(clients[0]!, { schema });
    const credential = `${randomUUID()}${randomUUID()}`;
    const tokenId = randomUUID();
    await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, ...f.scope, tokenHash: createHash('sha256').update(credential).digest('hex'), expiresAt: new Date(Date.now() + 86400000) });
    const actor = await resolveCustomerWorkspaceActor(database, credential);
    const reader = async () => ({ binding: { ...binding, policyRevision: 1 }, billSourceHash: sourceHash });
    const saved = await repositories[0]!.command(actor, { ...f.command, acceptedPolicyRevision: 1, expectedInvoiceHash: sourceHash }, reader);
    const operationId = saved.state.operations[0]!.id;

    if (revokeFirst) {
      await clients[0]!.query('BEGIN');
      await clients[0]!.query('UPDATE appointment_access_token SET revoked_at=clock_timestamp() WHERE id=$1', [tokenId]);
      const claim = repositories[1]!.claimDispatch(actor, operationId, reader);
      const outcome = Promise.allSettled([claim]);
      try {
        await blockedBy(pids[1]!, pids[0]!);
      } finally {
        await clients[0]!.query('COMMIT');
      }

      expect(await outcome).toMatchObject([{ status: 'rejected', reason: expect.objectContaining({ code: 'PAYMENT_WORKSPACE_ACCESS_REQUIRED' }) }]);
      expect((await repositories[2]!.read(f.actor))?.operations[0]?.firstDispatchAt).toBeNull();
    } else {
      const entered = barrier();
      const release = barrier();
      const claim = repositories[0]!.claimDispatch(actor, operationId, async () => {
        entered.release();
        await release.promise;
        return reader();
      });
      await entered.promise;
      const revoke = clients[1]!.query('UPDATE appointment_access_token SET revoked_at=clock_timestamp() WHERE id=$1', [tokenId]);
      const outcomes = Promise.allSettled([claim, revoke]);
      try {
        await blockedBy(pids[1]!, pids[0]!);
      } finally {
        release.release();
      }

      expect((await outcomes).every(result => result.status === 'fulfilled')).toBe(true);
      expect((await repositories[2]!.read(f.actor))?.operations[0]?.firstDispatchAt).not.toBeNull();
    }

    await expect(repositories[2]!.read(actor)).rejects.toThrow('ACCESS_REQUIRED');
  }, 20000);

  it.each([false, true])('serializes owner disable against dispatch; disable commits first=%s', async (disableFirst) => {
    const f = await fixture();
    const database = drizzle(clients[0]!, { schema });
    const runtime = { executionEnabled: true, platformAccountId: 'acct_platform', livemode: false, returnOrigin: 'https://example.invalid' };
    const bindingId = randomUUID();
    await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId: f.scope.salonId, stripeAccountId: `acct_${bindingId.replaceAll('-', '')}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    const input = { requestId: randomUUID(), expectedRevision: 0, enabled: true, cancellationPolicy: 'Synthetic cancellation policy' };
    await createWorkspacePolicyRepository(database).write(f.scope.salonId, f.actor.id, input, runtime);
    const reader = async (tx: Parameters<typeof readWorkspaceBinding>[0]) => ({ binding: await readWorkspaceBinding(tx, f.scope.salonId, runtime), billSourceHash: sourceHash });
    const saved = await repositories[0]!.command(f.actor, f.command, reader);
    const operationId = saved.state.operations[0]!.id;

    if (disableFirst) {
      await clients[0]!.query('BEGIN');
      await clients[0]!.query('UPDATE customer_payment_workspace_policy SET enabled=false,revision=revision+1,request_id=$2,request_hash=$3 WHERE salon_id=$1', [f.scope.salonId, randomUUID(), 'b'.repeat(64)]);
      const claim = repositories[1]!.claimDispatch(f.actor, operationId, reader);
      const outcome = Promise.allSettled([claim]);
      try {
        await blockedBy(pids[1]!, pids[0]!);
      } finally {
        await clients[0]!.query('COMMIT');
      }

      expect(await outcome).toMatchObject([{ status: 'rejected', reason: expect.objectContaining({ code: 'PAYMENT_WORKSPACE_ACTIVATION_CHANGED' }) }]);
      expect((await repositories[2]!.read(f.actor))?.operations[0]?.firstDispatchAt).toBeNull();
    } else {
      const entered = barrier();
      const release = barrier();
      const claim = repositories[0]!.claimDispatch(f.actor, operationId, async (tx) => {
        const material = await reader(tx);
        entered.release();
        await release.promise;
        return material;
      });
      await entered.promise;
      const disable = createWorkspacePolicyRepository(drizzle(clients[1]!, { schema })).write(f.scope.salonId, f.actor.id, { ...input, requestId: randomUUID(), expectedRevision: 1, enabled: false }, runtime);
      const outcomes = Promise.allSettled([claim, disable]);
      try {
        await blockedBy(pids[1]!, pids[0]!);
      } finally {
        release.release();
      }

      expect((await outcomes).every(result => result.status === 'fulfilled')).toBe(true);
      expect((await repositories[2]!.read(f.actor))?.operations[0]?.firstDispatchAt).not.toBeNull();
    }
  }, 20000);
});
