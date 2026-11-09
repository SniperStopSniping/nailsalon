import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { createClosedCheckoutSdkExecution, createClosedCheckoutSdkTransport, inspectClosedCheckoutSdkTransport, releaseClosedCheckoutSdkTransport } from '../inactiveStripe/closedCheckoutSdkTransport';
import { createDurableSdkCheckoutRepository } from '../inactiveStripe/durableCheckoutRepository';
import { createDurableCheckoutSdkBridge } from '../inactiveStripe/durableCheckoutSdkBridge';
import { closedCheckoutSession, createDurableCheckoutFixture } from '../inactiveStripe/durableCheckoutTestSupport';
import { isCustomerPaymentReservationBlocked } from './reservationGuard';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_PROVIDER_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_PROVIDER_PG_REQUIRED === 'true') {
  throw new Error('SDK reservation PostgreSQL target required but absent');
}
const suite = target ? describe.sequential : describe.skip;
type Database = NodePgDatabase<typeof schema>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Transport = ReturnType<typeof createClosedCheckoutSdkTransport>;
const clients: pg.PoolClient[] = [];
const databases: Database[] = [];
const pids: number[] = [];
let pool: pg.Pool | undefined;
const worker = () => ({ workerId: randomUUID(), leaseMs: 60000 });
const repo = (index = 0) => createDurableSdkCheckoutRepository(databases[index]!);
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function code(error: unknown) {
  const failure = error as { code?: string; cause?: { code?: string } };
  return failure.cause?.code ?? failure.code;
}
// Attach rejection handlers immediately, including while another backend is held.
const settled = <T>(promise: Promise<T>) => Promise.allSettled([promise]).then(results => results[0]!);
async function rejected<T>(result: PromiseSettledResult<T>, expectedCode?: string) {
  expect(result.status).toBe('rejected');

  if (result.status !== 'rejected') {
    throw new Error('Expected rejection');
  }
  if (expectedCode) {
    expect(code(result.reason)).toBe(expectedCode);
  }
  return result.reason;
}
async function blocked(action: Promise<unknown>) {
  expect(isCustomerPaymentReservationBlocked(await rejected(await settled(action)))).toBe(true);
}
async function waitUntil(check: () => Promise<boolean> | boolean) {
  const deadline = performance.now() + 5000;
  while (!await check()) {
    if (performance.now() >= deadline) {
      throw new Error('Expected concurrent backend state was not reached');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function blockingPids(index: number) {
  return (await clients[3]!.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [pids[index]])).rows[0]!.blockers;
}
async function waitForBlocker(waiter: number, holder: number) {
  await waitUntil(async () => (await blockingPids(waiter)).includes(pids[holder]!));
}
function heldRepository(index: number) {
  const entered = barrier();
  const release = barrier();
  const database = databases[index]!;
  const wrapped = {
    select: database.select.bind(database),
    transaction: (callback: Parameters<Database['transaction']>[0], options: Parameters<Database['transaction']>[1]) => database.transaction(async (tx) => {
      const result = await callback(tx);
      entered.release();
      await release.promise;
      return result;
    }, options),
  };
  return { repository: createDurableSdkCheckoutRepository(wrapped as never), entered, release };
}
async function reached<T>(entry: ReturnType<typeof barrier>, outcome: Promise<PromiseSettledResult<T>>) {
  await Promise.race([entry.promise, outcome.then((result) => {
    if (result.status === 'rejected') {
      throw result.reason;
    }
    throw new Error('Operation completed without reaching the barrier');
  })]);
}
// The hook pauses only an attested connection's SQL call. It does not replace
// source reads, locks, trigger execution, database time or transaction commits.
function beforeSql(index: number, matches: (sql: string) => boolean) {
  const entered = barrier();
  const release = barrier();
  const client = clients[index]!;
  let paused = false;
  const proxy = new Proxy(client, {
    get(object, key) {
      if (key === 'query') {
        return async (...args: unknown[]) => {
          const query = typeof args[0] === 'string' ? args[0] : (args[0] as { text: string }).text;
          if (!paused && matches(query)) {
            paused = true;
            entered.release();
            await release.promise;
          }
          return Reflect.apply(client.query, client, args);
        };
      }
      return Reflect.get(object, key);
    },
  });
  return { repository: createDurableSdkCheckoutRepository(drizzle(proxy, { schema })), entered, release };
}
async function fixture() {
  const f = await createDurableCheckoutFixture(databases[0]!);
  return { ...f, input: { token: f.token, salonId: f.salonId, appointmentId: f.appointmentId, quoteId: f.quote.id, operationId: f.operation.material.operationId, requestId: f.operation.material.requestId, platformAccountId: f.operation.binding.platformAccountId } };
}
function script(f: Fixture, pausePost = false) {
  return [
    { method: 'GET' as const, path: '/v1/account', response: { id: f.operation.binding.platformAccountId, object: 'account' } },
    { method: 'GET' as const, path: '/v1/balance', response: { object: 'balance', livemode: false } },
    { method: 'GET' as const, path: `/v1/accounts/${f.operation.binding.connectedAccountId}`, response: { id: f.operation.binding.connectedAccountId, object: 'account', country: 'CA', default_currency: 'cad', controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' }, charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { card_payments: 'active' }, requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: [] } } },
    { method: 'GET' as const, path: '/v1/balance', account: f.operation.binding.connectedAccountId, response: { object: 'balance', livemode: false } },
    { method: 'POST' as const, path: '/v1/checkout/sessions', account: f.operation.binding.connectedAccountId, response: closedCheckoutSession(f.operation), pause: pausePost },
  ];
}
const posts = (transport: Transport) => inspectClosedCheckoutSdkTransport(transport).calls.filter(call => call.method === 'POST');
async function prepareIntent(f: Fixture) {
  await repo().reserveAuthenticated(f.input);
  const claimed = await repo().claimCreate(f.operation, worker());
  const intent = await repo().recordDispatchIntent(f.operation, claimed.lease!);

  expect(intent.lease).not.toBeNull();

  return intent.lease!;
}
async function assertHeld(f: Fixture, state?: string) {
  const rows = (await clients[3]!.query('SELECT o.execution_kind, s.state, s.create_consumed_at FROM customer_payment_closed_checkout_operation o JOIN customer_payment_closed_checkout_state s ON s.operation_id=o.id WHERE o.id=$1', [f.input.operationId])).rows;

  expect(rows).toHaveLength(1);
  expect(rows[0].execution_kind).toBe('sdk_closed_http_v1');

  if (state) {
    expect(rows[0].state).toBe(state);
  }
  await blocked(clients[2]!.query('UPDATE appointment SET total_price=total_price+1 WHERE id=$1', [f.appointmentId]));
}
async function assertNotReserved(f: Fixture) {
  expect((await clients[3]!.query('SELECT id FROM customer_payment_closed_checkout_operation WHERE id=$1', [f.input.operationId])).rows).toEqual([]);
}
async function revision(key: string) {
  return (await clients[3]!.query<{ revision: number }>('SELECT revision FROM customer_payment_checkout_source_revision WHERE source_key=$1', [key])).rows[0]!.revision;
}
async function pinnedRevision(f: Fixture, key: string) {
  return Number((await clients[3]!.query<{ revision: string }>('SELECT source_revisions->>$2 AS revision FROM customer_payment_closed_checkout_operation WHERE id=$1', [f.input.operationId, key])).rows[0]!.revision);
}
function mutateSource(kind: 'capability' | 'binding_set', index: number, f: Fixture) {
  return kind === 'capability'
    ? clients[index]!.query('UPDATE appointment_access_token SET revoked_at=clock_timestamp() WHERE id=$1', [f.tokenId])
    : clients[index]!.query('UPDATE salon_stripe_account SET stripe_account_id=$1 WHERE id=$2 AND salon_id=$3', [`acct_${randomUUID().replaceAll('-', '')}`, f.bindingId, f.salonId]);
}
function sourceKey(kind: 'capability' | 'binding_set', f: Fixture) {
  return `${kind}:${kind === 'capability' ? f.tokenId : f.salonId}`;
}
const writes = [
  { name: 'ordinary cash tender', child: true, sql: 'INSERT INTO appointment_payment(id,salon_id,appointment_id,amount_cents,method,recorded_by_type) VALUES($1,$2,$3,1,\'cash\',\'admin\')' },
  { name: 'deposit', child: true, sql: 'INSERT INTO appointment_deposit(id,salon_id,appointment_id,amount_cents,status,stripe_account_id) VALUES($1,$2,$3,1,\'checkout_created\',\'acct_closedDeposit\')' },
  { name: 'final invoice item', child: true, sql: 'INSERT INTO appointment_final_item(id,salon_id,appointment_id,kind,name,unit_price_cents,line_total_cents) VALUES($1,$2,$3,\'custom\',\'Closed item\',1,1)' },
  { name: 'booked service price', child: true, sql: 'UPDATE appointment_services SET price_at_booking=10001 WHERE id=$1 AND appointment_id=$3 AND $2::text IS NOT NULL' },
  { name: 'booked service deletion', child: true, sql: 'DELETE FROM appointment_services WHERE id=$1 AND appointment_id=$3 AND $2::text IS NOT NULL' },
  { name: 'add-on', child: true, sql: 'INSERT INTO appointment_add_on(id,appointment_id,name_snapshot,category_snapshot,pricing_type_snapshot,unit_price_cents_snapshot,duration_minutes_snapshot,line_total_cents_snapshot,line_duration_minutes_snapshot) VALUES($1,$3,$2,\'addon\',\'fixed\',1,1,1,1)' },
  { name: 'financial total', child: false, sql: 'UPDATE appointment SET total_price=10001 WHERE id=$3 AND salon_id=$2 AND $1::text IS NOT NULL' },
  { name: 'completion', child: false, sql: 'UPDATE appointment SET completed_at=clock_timestamp(),status=\'completed\' WHERE id=$3 AND salon_id=$2 AND $1::text IS NOT NULL' },
];
function write(index: number, f: Fixture, spec: typeof writes[number]) {
  return clients[index]!.query(spec.sql, [spec.name.startsWith('booked service') ? f.itemId : randomUUID(), f.salonId, f.appointmentId]);
}

suite('SDK financial reservation — attested PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Target missing');
    }
    const expected = resolveDisposableDatabaseServerExpectation(target);
    pool = new pg.Pool({ connectionString: target.connectionString, max: 4, connectionTimeoutMillis: 5000 });
    for (let index = 0; index < 4; index += 1) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout=\'15s\'; SET lock_timeout=\'8s\'; SET idle_in_transaction_session_timeout=\'20s\'');
      pids.push((await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      databases.push(drizzle(client, { schema }));
    }

    expect(new Set(pids).size).toBe(4);

    await migrate(databases[0]!, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120000);

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL', '');
    vi.spyOn(http, 'request').mockImplementation(() => {
      throw new Error('NETWORK_FORBIDDEN');
    });
    vi.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('NETWORK_FORBIDDEN');
    });
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('NETWORK_FORBIDDEN');
    }));
  });

  afterEach(async () => {
    await Promise.all(clients.map(client => client.query('ROLLBACK')));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    clients.forEach(client => client.release());
    await pool?.end();
  });

  it.each(writes)('reservation commits first: refuses $name while locked and after commit', async (spec) => {
    const f = await fixture();
    const held = heldRepository(0);
    const reservation = settled(held.repository.reserveAuthenticated(f.input));
    await reached(held.entered, reservation);
    const contender = settled(write(1, f, spec));
    try {
      if (spec.child) {
        await rejected(await contender, '55P03');

        expect(await blockingPids(1)).toEqual([]);
      } else {
        await waitForBlocker(1, 0);
      }
    } finally {
      held.release.release();
      await reservation;
    }

    expect((await reservation).status).toBe('fulfilled');

    if (!spec.child) {
      expect(isCustomerPaymentReservationBlocked(await rejected(await contender))).toBe(true);
    }
    await blocked(write(1, f, spec));
    await assertHeld(f, 'prepared');

    expect((await clients[3]!.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
  }, 20000);

  it.each(writes)('$name commits first: admission rereads the committed mutation and sends nothing', async (spec) => {
    const f = await fixture();
    const transport = createClosedCheckoutSdkTransport(script(f));
    await clients[1]!.query('BEGIN');

    expect((await write(1, f, spec)).rowCount).toBe(1);

    const admission = settled(createDurableCheckoutSdkBridge(repo(), transport).create(f.input));
    try {
      await waitForBlocker(0, 1);
    } finally {
      await clients[1]!.query('COMMIT');
    }
    const error = await rejected(await admission);

    expect(code(error)).not.toBe('40P01');
    expect(code(error)).not.toBe('55P03');
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toEqual([]);

    await assertNotReserved(f);
  }, 20000);

  it('source revocation commits first: bearer is rechecked after the capability lock wait', async () => {
    const f = await fixture();
    const key = sourceKey('capability', f);
    const before = await revision(key);
    const transport = createClosedCheckoutSdkTransport(script(f));
    await clients[1]!.query('BEGIN');
    await mutateSource('capability', 1, f);
    const admission = settled(createDurableCheckoutSdkBridge(repo(), transport).create(f.input));
    try {
      await waitForBlocker(0, 1);
    } finally {
      await clients[1]!.query('COMMIT');
    }

    expect(String(await rejected(await admission))).toContain('SDK_ACCESS_REQUIRED');
    expect(await revision(key)).toBe(before + 1);
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toEqual([]);

    await assertNotReserved(f);
  });

  it.each(['capability', 'binding_set'] as const)('admission commits before %s change: persisted pin is invalidated, never refreshed away', async (kind) => {
    const f = await fixture();
    const key = sourceKey(kind, f);
    const before = await revision(key);
    const transport = createClosedCheckoutSdkTransport(script(f));
    const held = heldRepository(0);
    const admission = settled(held.repository.reserveAuthenticated(f.input));
    await reached(held.entered, admission);
    const change = settled(mutateSource(kind, 1, f));
    try {
      await waitForBlocker(1, 0);
    } finally {
      held.release.release();
      await admission;
    }

    expect((await change).status).toBe('fulfilled');
    expect(await pinnedRevision(f, key)).toBe(before);
    expect(await revision(key)).toBe(before + 1);

    if (kind === 'capability') {
      const outcome = settled(createDurableCheckoutSdkBridge(repo(2), transport).create(f.input));

      expect(String(await rejected(await outcome))).toContain('SDK_ACCESS_REQUIRED');

      const claimed = await repo(2).claimCreate(f.operation, worker());

      expect((await repo(2).recordDispatchIntent(f.operation, claimed.lease!)).result).toMatchObject({ state: 'review', reason: 'source_context_changed' });
    } else {
      expect(await createDurableCheckoutSdkBridge(repo(2), transport).create(f.input)).toMatchObject({ state: 'review', reason: 'source_context_changed' });
    }

    expect(posts(transport)).toEqual([]);

    await assertHeld(f, 'review');
  });

  it('uncommitted active binding change refuses admission NOWAIT and stays invalid after commit', async () => {
    const f = await fixture();
    const key = sourceKey('binding_set', f);
    const before = await revision(key);
    const transport = createClosedCheckoutSdkTransport(script(f));
    await clients[1]!.query('BEGIN');
    await mutateSource('binding_set', 1, f);
    try {
      await rejected(await settled(createDurableCheckoutSdkBridge(repo(), transport).create(f.input)), '55P03');

      expect(await blockingPids(0)).toEqual([]);
      expect(inspectClosedCheckoutSdkTransport(transport).calls).toEqual([]);

      await assertNotReserved(f);
    } finally {
      await clients[1]!.query('COMMIT');
    }

    await expect(createDurableCheckoutSdkBridge(repo(), transport).create(f.input)).rejects.toThrow('SOURCE_CONTEXT_REJECTED');

    await assertNotReserved(f);

    expect(await revision(key)).toBe(before + 1);
    expect(posts(transport)).toEqual([]);
  });

  it('serializes a binding change after the reservation source reread', async () => {
    const f = await fixture();
    const key = sourceKey('binding_set', f);
    const before = await revision(key);
    const held = beforeSql(0, (query) => {
      const normalized = query.toLowerCase();
      return normalized.includes('from "salon_stripe_account"') && normalized.includes('order by');
    });
    const admission = settled(held.repository.reserveAuthenticated(f.input));
    await reached(held.entered, admission);
    const change = settled(mutateSource('binding_set', 1, f));
    try {
      await waitForBlocker(1, 0);
    } finally {
      held.release.release();
    }

    expect((await admission).status).toBe('fulfilled');
    expect((await change).status).toBe('fulfilled');
    expect(await pinnedRevision(f, key)).toBe(before);
    expect(await revision(key)).toBe(before + 1);

    // A worker lease is not permission to dispatch. Source validity is checked
    // before dispatch intent and again before one-use consumption.
    const claim = await repo().claimCreate(f.operation, worker());

    expect(claim.lease).not.toBeNull();
    expect(await repo().recordDispatchIntent(f.operation, claim.lease!)).toMatchObject({
      lease: null,
      result: { state: 'review', reason: 'source_context_changed' },
    });
    expect((await repo().inspect(f.operation)).createConsumedAt).toBeNull();

    await assertHeld(f, 'review');
  });

  it.each(['capability', 'binding_set'] as const)('%s commits before final authorization: actual SDK makes zero POSTs', async (kind) => {
    const f = await fixture();
    const claim = await prepareIntent(f);
    const transport = createClosedCheckoutSdkTransport(script(f));
    const execution = createClosedCheckoutSdkExecution(transport, f.operation, 'create', null);
    await execution.preflight();
    await clients[1]!.query('BEGIN');
    await mutateSource(kind, 1, f);
    const dispatch = settled(execution.execute(claim, () => repo().consumeSdkPermit(f.operation, claim)));
    try {
      if (kind === 'capability') {
        await waitForBlocker(0, 1);
      } else {
        expect(String(await rejected(await dispatch))).toContain('SDK_PERMIT_NOT_CONFIRMED');
      }
    } finally {
      await clients[1]!.query('COMMIT');
    }
    if (kind === 'binding_set') {
      // Contended watermark refused before commit. A later attempt may record
      // review, but the same intent can never obtain fresh authority.
      expect(await repo(2).consumeSdkPermit(f.operation, claim)).toMatchObject({ lease: null, permit: null, result: { state: 'review' } });
    } else {
      expect(await dispatch).toMatchObject({ status: 'fulfilled', value: { lease: null, outcome: null, result: { state: 'review' } } });
    }

    expect(posts(transport)).toEqual([]);
    expect((await repo().inspect(f.operation)).createConsumedAt).toBeNull();

    await assertHeld(f, 'review');
  });

  it.each(['capability', 'binding_set'] as const)('authorization commits before %s invalidation: late SDK response is held for review', async (kind) => {
    const f = await fixture();
    const claim = await prepareIntent(f);
    const transport = createClosedCheckoutSdkTransport(script(f, true));
    const execution = createClosedCheckoutSdkExecution(transport, f.operation, 'create', null);
    await execution.preflight();
    const held = heldRepository(0);
    const dispatch = settled(execution.execute(claim, () => held.repository.consumeSdkPermit(f.operation, claim)));
    await reached(held.entered, dispatch);
    const change = settled(mutateSource(kind, 1, f));
    try {
      await waitForBlocker(1, 0);

      expect(posts(transport)).toEqual([]);
    } finally {
      held.release.release();
    }

    // The mutation commits while the HTTP response is paused. Thus no source or
    // appointment transaction is being held across the actual SDK transport.
    expect((await change).status).toBe('fulfilled');

    await waitUntil(() => inspectClosedCheckoutSdkTransport(transport).paused === 1);

    expect(posts(transport)).toHaveLength(1);

    releaseClosedCheckoutSdkTransport(transport);
    const outcome = await dispatch;

    expect(outcome.status).toBe('fulfilled');

    if (outcome.status !== 'fulfilled') {
      throw outcome.reason;
    }
    const result = await repo(2).recordSdkOutcome(f.operation, outcome.value.lease!, outcome.value.outcome!);

    expect(result).toMatchObject({ state: 'review', reason: 'source_context_changed', session: { sessionId: closedCheckoutSession(f.operation).id }, financialPostingAllowed: false, providerOriginVerified: false });
    expect(result.createConsumedAt).not.toBeNull();
    expect((await repo().claimCreate(f.operation, worker())).lease).toBeNull();

    await assertHeld(f, 'review');
  });

  it('salon-then-policy writer cannot deadlock reverse admission: salon SHARE is NOWAIT', async () => {
    const f = await fixture();
    const transport = createClosedCheckoutSdkTransport(script(f));
    await clients[1]!.query('BEGIN');
    await clients[1]!.query('SELECT id FROM salon WHERE id=$1 FOR UPDATE', [f.salonId]);
    const held = beforeSql(0, query => query.includes('from "salon"') && query.includes('for share nowait'));
    const admission = settled(createDurableCheckoutSdkBridge(held.repository, transport).create(f.input));
    await reached(held.entered, admission);
    const policy = settled(clients[1]!.query('UPDATE customer_payment_policy SET revision=revision+1 WHERE salon_id=$1', [f.salonId]));
    try {
      await waitForBlocker(1, 0);
    } finally {
      held.release.release();
    }
    await rejected(await admission, '55P03');

    expect((await policy).status).toBe('fulfilled');

    await clients[1]!.query('COMMIT');

    expect(await blockingPids(0)).toEqual([]);
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toEqual([]);

    await assertNotReserved(f);
  });

  it('two actual SDK clients cannot consume the same final authorization or POST twice', async () => {
    const f = await fixture();
    const claim = await prepareIntent(f);
    const firstWire = createClosedCheckoutSdkTransport(script(f));
    const secondWire = createClosedCheckoutSdkTransport(script(f));
    const firstExecution = createClosedCheckoutSdkExecution(firstWire, f.operation, 'create', null);
    const secondExecution = createClosedCheckoutSdkExecution(secondWire, f.operation, 'create', null);
    await Promise.all([firstExecution.preflight(), secondExecution.preflight()]);
    const held = heldRepository(0);
    const first = settled(firstExecution.execute(claim, () => held.repository.consumeSdkPermit(f.operation, claim)));
    await reached(held.entered, first);
    try {
      expect(String(await rejected(await settled(secondExecution.execute(claim, () => repo(1).consumeSdkPermit(f.operation, claim)))))).toContain('SDK_PERMIT_NOT_CONFIRMED');
      expect(posts(firstWire)).toEqual([]);
      expect(posts(secondWire)).toEqual([]);
    } finally {
      held.release.release();
    }
    const outcome = await first;
    if (outcome.status !== 'fulfilled') {
      throw outcome.reason;
    }
    await repo(2).recordSdkOutcome(f.operation, outcome.value.lease!, outcome.value.outcome!);

    expect(posts(firstWire)).toHaveLength(1);
    expect(posts(secondWire)).toEqual([]);
    await expect(repo(1).consumeSdkPermit(f.operation, claim)).rejects.toThrow('DURABLE_LEASE_FENCED');
    expect((await clients[3]!.query('SELECT operation_id FROM customer_payment_closed_checkout_audit WHERE operation_id=$1 AND snapshot->>\'reason\'=\'create_consumed\'', [f.input.operationId])).rows).toHaveLength(1);

    await assertHeld(f, 'session_observed');
  });

  it('source triggers do not acquire held appointment/journal locks; security changes and owner disable remain possible', async () => {
    const f = await fixture();
    await repo().reserveAuthenticated(f.input);
    await clients[0]!.query('BEGIN');
    await clients[0]!.query('LOCK TABLE customer_payment_closed_checkout_operation IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    await clients[0]!.query('SELECT id FROM appointment WHERE id=$1 FOR UPDATE', [f.appointmentId]);
    try {
      await mutateSource('capability', 1, f);
      await clients[1]!.query('UPDATE customer_payment_policy SET revision=revision+1,settings=jsonb_set(settings,\'{enabled}\',\'false\'::jsonb) WHERE salon_id=$1', [f.salonId]);
      await clients[1]!.query('UPDATE salon_stripe_account SET charges_enabled=false WHERE id=$1', [f.bindingId]);
      await clients[1]!.query('UPDATE salon SET status=\'inactive\' WHERE id=$1', [f.salonId]);

      expect(await blockingPids(1)).toEqual([]);
    } finally {
      await clients[0]!.query('COMMIT');
    }
    const claim = await repo().claimCreate(f.operation, worker());

    expect((await repo().recordDispatchIntent(f.operation, claim.lease!)).result).toMatchObject({ state: 'review', reason: 'source_context_changed' });

    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
    vi.stubEnv('APP_ENV', 'production');

    expect(() => repo().inspect(f.operation)).toThrow('RUNTIME_DISABLED');

    await assertHeld(f, 'review');
    await blocked(clients[1]!.query('DELETE FROM appointment WHERE id=$1', [f.appointmentId]));
    await blocked(clients[1]!.query('INSERT INTO appointment_payment(id,salon_id,appointment_id,amount_cents,method,recorded_by_type) VALUES($1,$2,$3,1,\'cash\',\'system\')', [`cpay_${randomUUID()}`, f.salonId, f.appointmentId]));
    await clients[1]!.query('UPDATE appointment SET notes=\'Owner note\',client_name=\'Display correction\',arrived_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1', [f.appointmentId]);

    expect((await clients[3]!.query('SELECT status,total_price,deposit_hold_expires_at FROM appointment WHERE id=$1', [f.appointmentId])).rows[0]).toEqual({ status: 'confirmed', total_price: 10000, deposit_hold_expires_at: null });
  });

  it('booked service reparenting checks both OLD and NEW reserved parents', async () => {
    const f = await fixture();
    const ordinary = await fixture();
    await repo().reserveAuthenticated(f.input);
    await blocked(clients[1]!.query('UPDATE appointment_services SET appointment_id=$1 WHERE id=$2', [ordinary.appointmentId, f.itemId]));
    await blocked(clients[1]!.query('UPDATE appointment_services SET appointment_id=$1 WHERE id=$2', [f.appointmentId, ordinary.itemId]));
    await assertHeld(f, 'prepared');
  });

  it.each(['appointment_deposit', 'appointment_final_item'] as const)('%s reparent locks OLD and NEW before admission, then rejects a move into the reserved parent', async (table) => {
    const f = await fixture();
    const ordinary = await fixture();
    const id = randomUUID();
    if (table === 'appointment_deposit') {
      await clients[1]!.query('INSERT INTO appointment_deposit(id,salon_id,appointment_id,amount_cents,status,stripe_account_id) VALUES($1,$2,$3,1,\'checkout_created\',\'acct_closedDeposit\')', [id, f.salonId, f.appointmentId]);
    } else {
      await clients[1]!.query('INSERT INTO appointment_final_item(id,salon_id,appointment_id,kind,name,unit_price_cents,line_total_cents) VALUES($1,$2,$3,\'custom\',\'Closed item\',1,1)', [id, f.salonId, f.appointmentId]);
    }
    // A valid reservation cannot already contain deposit/final history. Move
    // that history away naturally, and prove admission waits on its OLD parent.
    await clients[1]!.query('BEGIN');
    await clients[1]!.query(`UPDATE ${table} SET appointment_id=$1,salon_id=$2 WHERE id=$3`, [ordinary.appointmentId, ordinary.salonId, id]);
    const admission = settled(repo().reserveAuthenticated(f.input));
    try {
      await waitForBlocker(0, 1);
    } finally {
      await clients[1]!.query('COMMIT');
    }

    expect((await admission).status).toBe('fulfilled');

    await blocked(clients[1]!.query(`UPDATE ${table} SET appointment_id=$1,salon_id=$2 WHERE id=$3`, [f.appointmentId, f.salonId, id]));

    expect((await clients[3]!.query(`SELECT appointment_id FROM ${table} WHERE id=$1`, [id])).rows[0]).toEqual({ appointment_id: ordinary.appointmentId });

    await assertHeld(f, 'prepared');
  });
});
