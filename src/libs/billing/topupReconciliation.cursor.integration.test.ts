/**
 * Real PostgreSQL regression coverage for the public held-top-up reconciler.
 * Opt in only with a disposable database reached through a Unix socket:
 * TOPUP_CURSOR_TEST_SOCKET=/tmp/... TOPUP_CURSOR_TEST_DATABASE=topup_reconcile_fixture_...
 * TOPUP_CURSOR_DISPOSABLE_DATABASE_CONFIRMED=true
 * No application DB URL or real Stripe client is used.
 */
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));
const stripeMock = vi.hoisted(() => ({ checkout: { sessions: { retrieve: vi.fn() } } }));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@/libs/billing/stripePriceMap', () => ({ resolveTopupOfferFromStripePriceId: () => null }));

const socket = process.env.TOPUP_CURSOR_TEST_SOCKET;
const database = process.env.TOPUP_CURSOR_TEST_DATABASE;
const enabled = socket !== undefined || database !== undefined;
if (enabled && (
  socket === undefined
  || !path.isAbsolute(socket)
  || ![os.tmpdir(), '/tmp', '/private/tmp'].some(root => socket.startsWith(`${root}/`))
  || database === undefined
  || !/^topup_reconcile_fixture_[a-z0-9_]+$/.test(database)
  || process.env.TOPUP_CURSOR_DISPOSABLE_DATABASE_CONFIRMED !== 'true'
)) {
  throw new Error('Cursor integration tests require a confirmed disposable fixture database on a temporary Unix socket.');
}

const describePostgres = enabled ? describe : describe.skip;
const now = new Date('2026-10-28T12:00:00.000Z');
let pool: pg.Pool;
let restoreConnect: (() => void) | undefined;
let reconcile: typeof import('./topupReconciliation').reconcileHeldTopups;

async function seedUnbound(count: number, prefix = 'held', expiresAt = '2026-10-27T12:00:00Z', salonId = 'cursor-salon') {
  await pool.query(`
    INSERT INTO billing_checkout_attempt
      (id, salon_id, purpose, topup_offer_key, status, stripe_idempotency_key, expires_at)
    SELECT $1 || '_' || i, $4, 'sms_topup', 'topup_100_paid_2026_08',
      'creating', 'cursor-fixture:' || $1 || ':' || i, $3::timestamptz
    FROM generate_series(1, $2::integer) AS i
  `, [prefix, count, expiresAt, salonId]);
}

async function seedBound(id: string, state: 'paid' | 'expired' | 'open') {
  const sessionId = `cs_cursor_${id}`;
  const purchaseId = `stp_cursor_${id}`;
  await pool.query(`
    INSERT INTO billing_checkout_attempt
      (id, salon_id, purpose, topup_offer_key, status, stripe_idempotency_key,
       stripe_checkout_session_id, expires_at)
    VALUES ($1, 'cursor-salon', 'sms_topup', 'topup_100_paid_2026_08',
      'checkout_created', $1, $2, '2026-10-27T12:00:00Z')
  `, [id, sessionId]);
  await pool.query(`
    INSERT INTO sms_topup_purchase
      (id, salon_id, topup_offer_key, credits, amount_cents, currency,
       status, stripe_checkout_session_id)
    VALUES ($1, 'cursor-salon', 'topup_100_paid_2026_08', 100, 599, 'cad',
      'checkout_created', $2)
  `, [purchaseId, sessionId]);
  return {
    id: sessionId,
    payment_status: state === 'paid' ? 'paid' : 'unpaid',
    status: state === 'paid' ? 'complete' : state,
    amount_total: 599,
    currency: 'cad',
    metadata: { salonId: 'cursor-salon', purchaseId, attemptId: id },
    payment_intent: state === 'paid' ? `pi_cursor_${id}` : null,
    line_items: { data: [] },
  };
}

describePostgres('durable top-up reconciliation cursor (real PostgreSQL)', () => {
  beforeAll(async () => {
    // Deny every IP connection, including loopback. Only this fixture's socket
    // can be opened by pg; accidental provider/API access fails immediately.
    const originalConnect = net.Socket.prototype.connect;
    const guard = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      const first = args[0];
      const target = typeof first === 'string'
        ? first
        : first !== null && typeof first === 'object' && 'path' in first ? first.path : undefined;
      if (typeof target !== 'string' || !target.startsWith(`${socket}/.s.PGSQL.`)) {
        throw new Error('IP networking is forbidden in top-up cursor integration tests.');
      }
      return Reflect.apply(originalConnect, this, args);
    } as typeof net.Socket.prototype.connect);
    restoreConnect = () => guard.mockRestore();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('HTTP is forbidden in cursor integration tests.');
    }));
    pool = new pg.Pool({
      host: socket,
      port: 5432,
      database,
      user: process.env.USER,
      max: 3,
      connectionTimeoutMillis: 3000,
      options: '-c statement_timeout=5000 -c lock_timeout=1000',
    });
    const target = await pool.query<{ name: string }>('SELECT current_database() AS name');

    expect(target.rows[0]?.name).toBe(database);

    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
    ({ reconcileHeldTopups: reconcile } = await import('./topupReconciliation'));
  }, 20000);

  beforeEach(async () => {
    stripeMock.checkout.sessions.retrieve.mockReset();
    stripeMock.checkout.sessions.retrieve.mockImplementation(() => {
      throw new Error('Unexpected synthetic Stripe session');
    });
    await pool.query('TRUNCATE billing_topup_reconciliation_sweep, billing_checkout_attempt, sms_topup_purchase, sms_credit_ledger, sms_credit_account, salon CASCADE');
    await pool.query('INSERT INTO salon (id, name, slug) VALUES (\'cursor-salon\', \'Synthetic cursor fixture\', \'synthetic-cursor-fixture\')');
  });

  afterAll(async () => {
    await pool?.end();
    restoreConnect?.();
    vi.unstubAllGlobals();
  });

  it('reaches paid, expired and open sessions beyond 200 permanently unbound attempts', async () => {
    await seedUnbound(200);
    const paid = await seedBound('later_paid', 'paid');
    const expired = await seedBound('later_expired', 'expired');
    const open = await seedBound('later_open', 'open');
    const sessions = new Map([paid, expired, open].map(session => [session.id, session]));
    stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => sessions.get(id));

    const first = await reconcile({ now });

    expect(first.examined).toBe(200);
    expect(first.unbound).toHaveLength(200);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();

    const second = await reconcile({ now });

    expect(second).toMatchObject({ examined: 3, fulfilled: 1, expired: 1, left_open: 1, anomalies: [] });
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(3);

    const purchases = await pool.query('SELECT status FROM sms_topup_purchase ORDER BY id');

    expect(purchases.rows.map(row => row.status).sort()).toEqual(['checkout_created', 'expired', 'fulfilled']);

    const attempts = await pool.query('SELECT count(*)::int AS count FROM billing_checkout_attempt WHERE status = \'creating\'');

    expect(attempts.rows[0]?.count).toBe(200);

    // A fresh sweep revisits unresolved rows without granting the paid one again.
    const third = await reconcile({ now });

    expect(third.examined).toBeLessThanOrEqual(200);
    expect(third.unbound.length).toBeGreaterThan(0);

    const grants = await pool.query('SELECT count(*)::int AS count FROM sms_credit_ledger WHERE bucket = \'purchased\'');

    expect(grants.rows[0]?.count).toBe(1);
  });

  it('wraps only between calls and revisits a still-unbound first page', async () => {
    await seedUnbound(3);
    const first = await reconcile({ now, limit: 2 });
    const second = await reconcile({ now, limit: 2 });
    const third = await reconcile({ now, limit: 2 });

    expect(first.unbound.map(row => row.attemptId)).toEqual(['held_1', 'held_2']);
    expect(second.unbound.map(row => row.attemptId)).toEqual(['held_3']);
    expect(third.unbound.map(row => row.attemptId)).toEqual(['held_1', 'held_2']);
    expect([first.examined, second.examined, third.examined]).toEqual([2, 1, 2]);
  });

  it('keeps insertion boundaries finite and survives deletion of the last checkpointed attempt', async () => {
    await seedUnbound(3);
    const first = await reconcile({ now, limit: 2 });

    expect(first.examined).toBe(2);

    await pool.query('DELETE FROM billing_checkout_attempt WHERE id = \'held_2\'');
    await seedUnbound(1, 'inserted');
    await seedUnbound(1, 'aaa_inserted');
    // Backdating does not move a newly inserted attempt into the active sweep.
    await pool.query('UPDATE billing_checkout_attempt SET created_at = \'2000-01-01\' WHERE id = \'inserted_1\'');
    const rest = await reconcile({ now, limit: 2 });

    expect(rest.unbound.map(row => row.attemptId)).toEqual(['held_3']);

    const wrapped = await reconcile({ now, limit: 2 });
    const tail = await reconcile({ now, limit: 2 });

    expect(wrapped.unbound.map(row => row.attemptId)).toEqual(['aaa_inserted_1', 'held_1']);
    expect(tail.unbound.map(row => row.attemptId)).toEqual(['held_3', 'inserted_1']);
  });

  it('evaluates multi-attempt salon eligibility across cursor pages', async () => {
    await seedUnbound(2, 'future', '2026-10-29T12:00:00Z');
    const first = await reconcile({ now, limit: 1 });
    const second = await reconcile({ now, limit: 1 });

    expect(first.unbound.map(row => row.attemptId)).toEqual(['future_1']);
    expect(second.unbound.map(row => row.attemptId)).toEqual(['future_2']);
  });

  it('revisits newly expired rows behind the cursor and counts pending peers beyond the high-water', async () => {
    await pool.query('INSERT INTO salon (id, name, slug) VALUES (\'future-salon\', \'Synthetic future fixture\', \'synthetic-future-fixture\')');
    await seedUnbound(1, 'a_future', '2026-10-28T13:00:00Z', 'future-salon');
    await seedUnbound(2, 'm_held');
    await seedUnbound(1, 'z_future', '2026-10-29T12:00:00Z', 'future-salon');
    // Keep a_future ineligible initially, and move z_future to its own salon.
    await pool.query('INSERT INTO salon (id, name, slug) VALUES (\'outside-salon\', \'Synthetic outside fixture\', \'synthetic-outside-fixture\')');
    await pool.query('UPDATE billing_checkout_attempt SET salon_id = \'outside-salon\' WHERE id = \'z_future_1\'');
    const first = await reconcile({ now, limit: 1 });

    expect(first.unbound.map(row => row.attemptId)).toEqual(['m_held_1']);

    await seedUnbound(1, 'zz_outside_peer', '2026-10-29T12:00:00Z', 'outside-salon');
    const laterNow = new Date('2026-10-28T14:00:00Z');
    const rest = await reconcile({ now: laterNow, limit: 2 });

    expect(rest.unbound.map(row => row.attemptId)).toEqual(['m_held_2', 'z_future_1']);

    // a_future became eligible behind the cursor; it is deferred, then reached.
    const wrapped = await reconcile({ now: laterNow, limit: 1 });

    expect(wrapped.unbound.map(row => row.attemptId)).toEqual(['a_future_1']);
  });

  it('returns promptly on an active lease conflict without inspecting another session', async () => {
    const session = await seedBound('lease_conflict', 'open');
    let started!: () => void;
    const retrievalStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let resume!: () => void;
    const retrievalBlocked = new Promise<void>((resolve) => {
      resume = resolve;
    });
    stripeMock.checkout.sessions.retrieve.mockImplementation(async () => {
      started();
      await retrievalBlocked;
      return session;
    });

    const owner = reconcile({ now, limit: 1 });
    try {
      await retrievalStarted;
      const contender = await reconcile({ now, limit: 1 });

      expect(contender).toMatchObject({ leaseBusy: true, examined: 0, fulfilled: 0, expired: 0, unbound: [], anomalies: [] });
      expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    } finally {
      resume();
      await owner;
    }
  });

  it('fences a suspended worker before financial writes and cannot release a reclaimed active lease', async () => {
    const paid = await seedBound('lease_a_paid', 'paid');
    const open = await seedBound('lease_z_later', 'open');
    const fulfillment = await import('./topupFulfillment');
    const fulfillSpy = vi.spyOn(fulfillment, 'applyTopupSessionCompleted');
    let staleStarted!: () => void;
    const staleRetrievalStarted = new Promise<void>((resolve) => {
      staleStarted = resolve;
    });
    let resumeStale!: () => void;
    const staleRetrievalBlocked = new Promise<void>((resolve) => {
      resumeStale = resolve;
    });
    let freshStarted!: () => void;
    const freshRetrievalStarted = new Promise<void>((resolve) => {
      freshStarted = resolve;
    });
    let resumeFresh!: () => void;
    const freshRetrievalBlocked = new Promise<void>((resolve) => {
      resumeFresh = resolve;
    });
    stripeMock.checkout.sessions.retrieve.mockImplementationOnce(async () => {
      staleStarted();
      await staleRetrievalBlocked;
      return paid;
    }).mockImplementation(async (id: string) => {
      if (id === paid.id) {
        return paid;
      }
      freshStarted();
      await freshRetrievalBlocked;
      return open;
    });

    const stale = reconcile({ now, limit: 2 });
    const staleFailure = expect(stale).rejects.toThrow('TOPUP_RECONCILIATION_LEASE_LOST');
    let fresh: ReturnType<typeof reconcile> | undefined;
    try {
      await staleRetrievalStarted;
      await pool.query('UPDATE billing_topup_reconciliation_sweep SET lease_expires_at = clock_timestamp() - interval \'1 second\'');
      fresh = reconcile({ now, limit: 2 });
      await freshRetrievalStarted;
      const freshState = await pool.query('SELECT cursor_attempt_id, high_water_attempt_id, lease_token FROM billing_topup_reconciliation_sweep');

      expect(freshState.rows[0]?.lease_token).toEqual(expect.any(String));
      expect(fulfillSpy).toHaveBeenCalledTimes(1);

      resumeStale();
      await staleFailure;

      expect(fulfillSpy).toHaveBeenCalledTimes(1);
      expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(3);

      const afterStale = await pool.query('SELECT cursor_attempt_id, high_water_attempt_id, lease_token FROM billing_topup_reconciliation_sweep');

      expect(afterStale.rows).toEqual(freshState.rows);

      resumeFresh();

      expect(await fresh).toMatchObject({ examined: 2, fulfilled: 1, left_open: 1 });

      const grants = await pool.query('SELECT count(*)::int AS count FROM sms_credit_ledger WHERE bucket = \'purchased\'');

      expect(grants.rows[0]?.count).toBe(1);
    } finally {
      resumeStale();
      resumeFresh();
      await Promise.allSettled([stale, fresh]);
      fulfillSpy.mockRestore();
    }
  });

  it('replays safely after fulfillment commits but durable checkpointing fails', async () => {
    const paid = await seedBound('a_checkpoint_paid', 'paid');
    await seedUnbound(1, 'after_failure');
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(paid);
    await pool.query(`
      CREATE FUNCTION cursor_fixture_checkpoint_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cursor_attempt_id IS NOT NULL AND NEW.cursor_attempt_id IS DISTINCT FROM OLD.cursor_attempt_id THEN
          RAISE EXCEPTION 'synthetic checkpoint interruption';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER cursor_fixture_checkpoint_failure BEFORE UPDATE
      ON billing_topup_reconciliation_sweep FOR EACH ROW EXECUTE FUNCTION cursor_fixture_checkpoint_failure();
    `);
    try {
      await expect(reconcile({ now, limit: 1 })).rejects.toThrow();

      const purchase = await pool.query('SELECT status FROM sms_topup_purchase WHERE id = $1', [paid.metadata.purchaseId]);

      expect(purchase.rows[0]?.status).toBe('fulfilled');

      const state = await pool.query('SELECT cursor_attempt_id, lease_token FROM billing_topup_reconciliation_sweep');

      expect(state.rows[0]).toMatchObject({ cursor_attempt_id: null, lease_token: null });
    } finally {
      await pool.query('DROP TRIGGER cursor_fixture_checkpoint_failure ON billing_topup_reconciliation_sweep');
      await pool.query('DROP FUNCTION cursor_fixture_checkpoint_failure()');
    }

    const retry = await reconcile({ now, limit: 1 });

    expect(retry.unbound.map(row => row.attemptId)).toEqual(['after_failure_1']);
    expect(retry.fulfilled).toBe(0);
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);

    const grants = await pool.query('SELECT count(*)::int AS count FROM sms_credit_ledger WHERE bucket = \'purchased\'');

    expect(grants.rows[0]?.count).toBe(1);
  });

  it('fails observably if a successor reclaims ownership just before sweep finalization', async () => {
    await seedUnbound(1);
    const sweep = await import('./topupReconciliationSweep');
    const originalQuery = pool.query.bind(pool);
    let successor: Awaited<ReturnType<typeof sweep.acquireTopupSweepLease>> = null;
    let injected = false;
    // Place a real DB reclaim at the final statement boundary. The predecessor
    // must detect a zero-row fenced update and cannot clear the successor state.
    const querySpy = vi.spyOn(pool, 'query').mockImplementation((async (...args: unknown[]) => {
      const first = args[0];
      const text = typeof first === 'string'
        ? first
        : first !== null && typeof first === 'object' && 'text' in first ? first.text : '';
      if (!injected && typeof text === 'string' && text.includes('WITH sweep_end AS')) {
        injected = true;
        await originalQuery('UPDATE billing_topup_reconciliation_sweep SET lease_expires_at = clock_timestamp() - interval \'1 second\'');
        successor = await sweep.acquireTopupSweepLease();
      }
      return Reflect.apply(originalQuery, pool, args);
    }) as typeof pool.query);
    try {
      await expect(reconcile({ now, limit: 1 })).rejects.toThrow('TOPUP_RECONCILIATION_LEASE_LOST');
      expect(injected).toBe(true);

      const state = await originalQuery('SELECT cursor_attempt_id, high_water_attempt_id, lease_token FROM billing_topup_reconciliation_sweep');

      expect(state.rows[0]).toMatchObject({ cursor_attempt_id: 'held_1', high_water_attempt_id: 'held_1', lease_token: successor!.token });
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    } finally {
      querySpy.mockRestore();
    }
  });

  it('checkpoints a failed paid transition so healthy later purchases progress and the failure is retried next sweep', async () => {
    const poison = await seedBound('a_poison_paid', 'paid');
    const healthy = await seedBound('z_healthy_paid', 'paid');
    stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => id === poison.id ? poison : healthy);
    await pool.query(`
      CREATE FUNCTION cursor_fixture_paid_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = 'stp_cursor_a_poison_paid' AND NEW.status = 'paid' THEN
          RAISE EXCEPTION 'synthetic paid transition failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER cursor_fixture_paid_failure BEFORE UPDATE
      ON sms_topup_purchase FOR EACH ROW EXECUTE FUNCTION cursor_fixture_paid_failure();
    `);
    try {
      const failed = await reconcile({ now, limit: 1 });

      expect(failed).toMatchObject({ examined: 1, fulfilled: 0 });
      expect(failed.anomalies).toEqual([expect.objectContaining({ attemptId: 'a_poison_paid' })]);

      const later = await reconcile({ now, limit: 1 });

      expect(later).toMatchObject({ examined: 1, fulfilled: 1, anomalies: [] });

      const revisited = await reconcile({ now, limit: 1 });

      expect(revisited.anomalies).toEqual([expect.objectContaining({ attemptId: 'a_poison_paid' })]);
      expect(stripeMock.checkout.sessions.retrieve.mock.calls.filter(([id]) => id === poison.id)).toHaveLength(2);

      const grants = await pool.query('SELECT count(*)::int AS count FROM sms_credit_ledger WHERE bucket = \'purchased\'');

      expect(grants.rows[0]?.count).toBe(1);
    } finally {
      await pool.query('DROP TRIGGER cursor_fixture_paid_failure ON sms_topup_purchase');
      await pool.query('DROP FUNCTION cursor_fixture_paid_failure()');
    }

    expect(await reconcile({ now, limit: 1 })).toMatchObject({ examined: 1, fulfilled: 1, anomalies: [] });
    expect(await reconcile({ now, limit: 1 })).toMatchObject({ examined: 0, fulfilled: 0 });

    const grants = await pool.query('SELECT count(*)::int AS count FROM sms_credit_ledger WHERE bucket = \'purchased\'');

    expect(grants.rows[0]?.count).toBe(2);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 201])('rejects invalid examination limit %s without claiming state', async (limit) => {
    await seedUnbound(1);

    await expect(reconcile({ now, limit })).rejects.toThrow();
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();

    const state = await pool.query('SELECT count(*)::int AS count FROM billing_topup_reconciliation_sweep');

    expect(state.rows[0]?.count).toBe(0);
  });

  it('fails closed before Stripe retrieval when the cursor migration is missing', async () => {
    const paid = await seedBound('missing_migration_paid', 'paid');
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(paid);
    await pool.query('ALTER TABLE billing_topup_reconciliation_sweep RENAME TO cursor_fixture_saved_sweep');
    try {
      await expect(reconcile({ now, limit: 1 })).rejects.toThrow();
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();

      const purchase = await pool.query('SELECT status FROM sms_topup_purchase WHERE id = $1', [paid.metadata.purchaseId]);

      expect(purchase.rows[0]?.status).toBe('checkout_created');

      const grants = await pool.query('SELECT count(*)::int AS count FROM sms_credit_ledger');

      expect(grants.rows[0]?.count).toBe(0);
    } finally {
      await pool.query('ALTER TABLE cursor_fixture_saved_sweep RENAME TO billing_topup_reconciliation_sweep');
    }
  });

  it('rolls back the additive migration transaction without changing checkout data', async () => {
    await seedUnbound(1);
    const migration = await readFile(path.join(process.cwd(), 'migrations/0115_topup_reconciliation_sweep.sql'), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE billing_topup_reconciliation_sweep RENAME TO cursor_fixture_saved_sweep');
      await client.query(migration);
      await client.query('INSERT INTO billing_topup_reconciliation_sweep (scope) VALUES (\'global\')');
      const created = await client.query('SELECT count(*)::int AS count FROM billing_topup_reconciliation_sweep');

      expect(created.rows[0]?.count).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const state = await pool.query('SELECT count(*)::int AS count FROM billing_topup_reconciliation_sweep');

    expect(state.rows[0]?.count).toBe(0);

    const renamed = await pool.query('SELECT to_regclass(\'public.cursor_fixture_saved_sweep\') AS relation');

    expect(renamed.rows[0]?.relation).toBeNull();

    const attempts = await pool.query('SELECT id, status FROM billing_checkout_attempt');

    expect(attempts.rows).toEqual([{ id: 'held_1', status: 'creating' }]);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });
});
