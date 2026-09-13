import path from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NextRequest } from 'next/server';
import pg from 'pg';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { isInsideDepositsTransaction } from './depositsTransaction';
import type { ShadowProvider } from './shadowObserver';
import { type Observation, projectShadowEvent } from './shadowProjection';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/core/redis/redisClient', () => ({ redis: null, isRedisAvailable: async () => false }));
const effects = vi.hoisted(() => ({ create: vi.fn(), apply: vi.fn() }));
vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  return { EXPECTED_STRIPE_API_VERSION: '2024-06-20', stripe: {
    webhooks: new RealStripe('sk_test_placeholder').webhooks,
    refunds: { create: effects.create },
  } };
});
// Real signed route and durable legacy receipt logic;
// Legacy money processor isolated here and separately exercised by D6 regressions.
vi.mock('@/libs/deposits/depositLifecycle', () => ({ applyRefundEvent: effects.apply }));
// Charge alias test isolates the unchanged legacy discovery consumer, like applyRefundEvent above.
vi.mock('@/libs/deposits/depositRefund', async importOriginal => ({ ...await importOriginal<typeof import('./depositRefund')>(), discoverAndAdoptDepositRefunds: vi.fn().mockResolvedValue({ disposition: 'no_refund' }) }));
const { POST } = await import('@/app/api/webhooks/stripe-connect/route');
const { captureShadowReceipt, claimShadowWork, enrollShadowDeposit, finalizeShadowObservation, replayShadowReceipts, shadowDiagnostics, shadowUnattributedDiagnostics, importLegacyShadowCommand } = await import('./shadowStore');
const { observeShadowClaim, runShadowObservationBatch } = await import('./shadowObserver');
const url = process.env.CONCURRENCY_TEST_DATABASE_URL;
const required = process.env.D6_R1_CONCURRENCY_REQUIRED === 'true';
if (!url && required) {
  throw new Error('D6 R1 concurrency required: disposable target missing');
}
const target = url ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: url }) : null;
const suite = target ? describe.sequential : describe.skip;
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let serial = 0;
const signer = new Stripe('sk_test_placeholder');
const BASE = 'd6r1';
const REPAIR_TEST_COUNT = 21;
let executed = 0;
async function seed(salon = BASE, account = `acct_${salon}`) {
  serial += 1;
  const suffix = `${salon}_${serial}`;
  await db.insert(schema.salonSchema).values({ id: salon, slug: salon, name: salon }).onConflictDoNothing();
  await db.insert(schema.technicianSchema).values({ id: `tech_${salon}`, salonId: salon, name: 'Synthetic' }).onConflictDoNothing();
  await db.insert(schema.salonStripeAccountSchema).values({ id: `ssa_${salon}`, salonId: salon, stripeAccountId: account, livemode: false }).onConflictDoNothing();
  const start = new Date(Date.UTC(2099, 0, serial, 12));
  await db.insert(schema.appointmentSchema).values({ id: `appt_${suffix}`, salonId: salon, technicianId: `tech_${salon}`, clientPhone: '4165550100', clientName: 'Synthetic', startTime: start, endTime: new Date(start.getTime() + 3600000), status: 'confirmed', totalPrice: 6500, totalDurationMinutes: 60 });
  await db.insert(schema.appointmentDepositSchema).values({ id: `dep_${suffix}`, salonId: salon, appointmentId: `appt_${suffix}`, amountCents: 2500, currency: 'cad', status: 'paid', stripeAccountId: account, stripePaymentIntentId: `pi_${suffix}` });

  expect(await enrollShadowDeposit(salon, `dep_${suffix}`, false)).toBe(true);

  return { salon, suffix, id: `dep_${suffix}`, pi: `pi_${suffix}`, charge: `ch_${suffix}`, account };
}
function observation(d: Awaited<ReturnType<typeof seed>>, overrides: Partial<Observation> = {}): Observation {
  return { account: d.account, livemode: false, collection: { id: d.charge, paymentIntentId: d.pi, amount: 2500, currency: 'cad', paid: true, captured: true, amountCaptured: 2500, disputed: false, amountRefunded: 0 }, refunds: [], disputes: [], pagesComplete: true, disputePagesComplete: true, requestIds: ['req_scripted'], ...overrides };
}
function event(d: Awaited<ReturnType<typeof seed>>, type = 'refund.updated', id = 're_one') {
  return { id: `evt_${crypto.randomUUID().replaceAll('-', '')}`, type, account: d.account, livemode: false, created: 1786300000, api_version: '2024-06-20', object: 'event', data: { object: { id, object: type.startsWith('charge.dispute.') ? 'dispute' : 'refund', charge: d.charge, payment_intent: d.pi, status: 'pending', amount: 500, currency: 'cad' } } };
}
function signed(e: ReturnType<typeof event>) {
  const payload = JSON.stringify(e);
  return new Request('http://localhost/api/webhooks/stripe-connect', { method: 'POST', body: payload, headers: { 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret: 'ci-placeholder-not-a-secret' }) } }) as NextRequest;
}
async function capture(e: ReturnType<typeof event>) {
  await captureShadowReceipt({ eventId: e.id, eventType: e.type, account: e.account, livemode: e.livemode, providerCreated: e.created, apiVersion: e.api_version, projection: projectShadowEvent(e.type, e.data.object) });
}
async function state(id: string) {
  return (await db.execute(sql`SELECT * FROM deposit_shadow_state WHERE deposit_id=${id}`)).rows[0]!;
}
async function claim() {
  const [c] = await claimShadowWork(1, Date.now() + 30000);

  expect(c).toBeDefined();

  return c!;
}
async function claimDeposit(depositId: string) {
  await db.execute(sql`UPDATE deposit_shadow_state SET next_due_at=now()+interval '1 hour'
    WHERE deposit_id<>${depositId}`);
  const c = await claim();

  expect(c.deposit_id).toBe(depositId);

  return c;
}
async function due() {
  await db.execute(sql`UPDATE deposit_shadow_state SET next_due_at=now(),lease_until=NULL`);
}
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
async function receiptRow(eventId: string) {
  return (await db.execute(sql`SELECT * FROM deposit_shadow_receipt WHERE event_id=${eventId}`)).rows[0]!;
}
function provider(o: Observation): ShadowProvider {
  return {
    collection: async (_pi, ctx) => {
      expect(isInsideDepositsTransaction()).toBe(false);
      expect(ctx.account).toBe(o.account);
      expect(ctx.livemode).toBe(o.livemode);

      return { fact: o.collection, requestId: 'req_collection' };
    },
    refunds: async () => ({ data: o.refunds, hasMore: false, requestId: 'req_refunds' }),
    refund: async (id) => {
      const r = o.refunds.find(r => r.id === id);
      if (!r) {
        throw new Error('scripted_missing_refund');
      }
      return r;
    },
    disputes: async () => ({ data: o.disputes, hasMore: false, requestId: 'req_disputes' }),
  };
}
suite('D6 R1 inactive PostgreSQL acceptance', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing disposable target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 12 });
    const client = await pool.connect();
    try {
      await attestDisposableDatabaseSession(client, target, resolveDisposableDatabaseServerExpectation(target));
    } finally {
      client.release();
    }
    db = drizzle(pool, { schema });
    holder.db = db;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120000);

  beforeEach(async () => {
    executed += 1;
    vi.clearAllMocks();
    effects.apply.mockResolvedValue({ deposit: null });
    await db.execute(sql`TRUNCATE deposit_shadow_receipt,deposit_shadow_object,deposit_shadow_observation,
      deposit_shadow_attempt,deposit_shadow_command,deposit_shadow_state CASCADE`);
    // Only this suite's synthetic fixtures;
    // Existing named suites have independent fixtures.
    await db.execute(sql`DELETE FROM appointment_deposit WHERE salon_id LIKE 'd6r1%'`);
    await db.execute(sql`DELETE FROM appointment WHERE salon_id LIKE 'd6r1%'`);
    await db.execute(sql`DELETE FROM salon WHERE id LIKE 'd6r1%'`);
    await db.execute(sql`DELETE FROM stripe_webhook_event WHERE event_id LIKE 'evt_%'`);
  });

  afterAll(async () => {
    const filtered = process.argv.some(arg => arg === '-t' || arg.includes('testNamePattern') || arg.includes('--testName'));
    if (!filtered) {
      expect(executed).toBe(REPAIR_TEST_COUNT);
    }
    process.stdout.write(`D6_R1_REPAIR_POSTGRES_TESTS_EXECUTED=${executed} D6_R1_REPAIR_POSTGRES_TESTS_SKIPPED=0\n`);
    await pool?.end();
  });

  it('REVIEW deauthorization of latest binding cannot be masked by older local revoke', async () => {
    const d = await seed();
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${d.salon}`);
    await db.insert(schema.salonStripeAccountSchema).values({ id: 'ssa_review_rebound', salonId: d.salon, stripeAccountId: d.account, livemode: false });
    const c = await claim();
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='deauthorized' WHERE id='ssa_review_rebound'`);
    const result = await finalizeShadowObservation(c, observation(d));
    process.stdout.write(`REVIEW_REVOKED_HISTORY_RESULT=${result} CERTIFICATE=${JSON.stringify((await state(d.id)).certificate)}\n`);

    expect(result).toBe('stale');
    expect((await state(d.id)).certificate).toBeNull();
  });

  it('REVIEW contradictory duplicate refund must never replace owned object facts', async () => {
    const d = await seed();
    const valid = { id: 're_review_duplicate', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 };
    const o = observation(d, { refunds: [valid, { ...valid, chargeId: 'ch_foreign', paymentIntentId: 'pi_foreign' }] });
    o.collection.amountRefunded = 500;
    await observeShadowClaim(await claim(), provider(o));
    const facts = (await db.execute(sql`SELECT facts FROM deposit_shadow_object WHERE object_id='re_review_duplicate'`)).rows;
    process.stdout.write(`REVIEW_DUPLICATE_FACTS=${JSON.stringify(facts)}\n`);

    expect(facts.some(r => (r.facts as any).paymentIntentId === 'pi_foreign')).toBe(false);
  });

  it('REVIEW duplicate foreign or conflicting same-owner refunds remain raw-only evidence', async () => {
    for (const foreignFirst of [false, true]) {
      const d = await seed(`d6r1_duplicate_${foreignFirst ? 'foreign_first' : 'valid_first'}`);
      const valid = { id: `re_duplicate_${foreignFirst}`, chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 };
      const foreign = { ...valid, chargeId: 'ch_foreign_duplicate', paymentIntentId: 'pi_foreign_duplicate' };
      const o = observation(d, { refunds: foreignFirst ? [foreign, valid] : [valid, foreign] });
      o.collection.amountRefunded = 500;

      expect(await observeShadowClaim(await claim(), provider(o))).toBe('incomplete');

      const objects = await db.execute(sql`SELECT * FROM deposit_shadow_object WHERE deposit_id=${d.id}`);
      const raw = await db.execute(sql`SELECT evidence FROM deposit_shadow_observation WHERE deposit_id=${d.id}`);

      expect(objects.rows).toHaveLength(0);
      expect(JSON.stringify(raw.rows)).toContain('pi_foreign_duplicate');
      expect((await state(d.id)).certificate).toBeNull();
    }

    const sameOwner = await seed('d6r1_duplicate_same_owner');
    const first = { id: 're_duplicate_same_owner', chargeId: sameOwner.charge, paymentIntentId: sameOwner.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 };
    const conflicting = { ...first, amount: 600, status: 'failed' };
    const o = observation(sameOwner, { refunds: [first, conflicting] });
    o.collection.amountRefunded = 500;

    expect(await observeShadowClaim(await claimDeposit(sameOwner.id), provider(o))).toBe('incomplete');

    const objects = await db.execute(sql`SELECT * FROM deposit_shadow_object WHERE deposit_id=${sameOwner.id}`);
    const raw = await db.execute(sql`SELECT evidence FROM deposit_shadow_observation WHERE deposit_id=${sameOwner.id}`);

    expect(objects.rows).toHaveLength(0);
    expect(JSON.stringify(raw.rows)).toContain('re_duplicate_same_owner');
    expect((await state(sameOwner.id))).toMatchObject({ certificate: null, cursor: null });
  });

  it('REVIEW account reassignment cannot expose new tenants unattributed receipt', async () => {
    const a = await seed('d6r1_old');
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${a.salon}`);
    const b = await seed('d6r1_new', a.account);
    await db.execute(sql`DELETE FROM deposit_shadow_state WHERE deposit_id=${b.id}`);
    const e = event(b);
    await capture(e);
    const diag = await shadowDiagnostics(a.salon);
    process.stdout.write(`REVIEW_OLD_TENANT_RECEIPTS=${JSON.stringify(diag.receipts)}\n`);

    expect(diag.receipts.some(r => (r as { event_id: string }).event_id === e.id)).toBe(false);
  });

  it('REVIEW reassigned ambiguous receipts stay global while tenant diagnostics paginate only their own evidence', async () => {
    const a = await seed('d6r1_diagnostics_a');
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${a.salon}`);
    const b = await seed('d6r1_diagnostics_b', a.account);
    await db.execute(sql`DELETE FROM deposit_shadow_state WHERE deposit_id IN (${a.id},${b.id})`);
    const ambiguous = event(a, 'refund.updated', 're_ambiguous_diagnostic');
    ambiguous.data.object.payment_intent = 'pi_ambiguous_diagnostic';
    ambiguous.data.object.charge = 'ch_ambiguous_diagnostic';
    await capture(ambiguous);

    const valid = await seed('d6r1_diagnostics_valid');
    const attributable = event(valid, 'refund.updated', 're_valid_diagnostic');
    await capture(attributable);
    const [aDiagnostics, bDiagnostics, validDiagnostics, global] = await Promise.all([
      shadowDiagnostics(a.salon, '', 1),
      shadowDiagnostics(b.salon, '', 1),
      shadowDiagnostics(valid.salon, '', 1),
      shadowUnattributedDiagnostics('', 1),
    ]);

    expect(aDiagnostics.receiptCounts).toMatchObject({ total: 0, pending: 0 });
    expect(bDiagnostics.receiptCounts).toMatchObject({ total: 0, pending: 0 });
    expect(aDiagnostics.receipts).toEqual([]);
    expect(bDiagnostics.receipts).toEqual([]);
    expect(validDiagnostics.receipts).toHaveLength(1);
    expect(validDiagnostics.receipts[0]).toMatchObject({ event_id: attributable.id });
    expect(global.counts).toMatchObject({ total: 1 });
    expect(global.items).toHaveLength(1);
    expect(global.items[0]).toMatchObject({ event_id: ambiguous.id });
  });

  it('REVIEW replay lock failure cannot prevent unrelated tenant batch progress', async () => {
    const quiet = await seed('d6r1_quiet_review');
    const e = event(quiet);
    e.account = 'acct_review_busy';
    await capture(e);
    await db.execute(sql`UPDATE deposit_shadow_receipt SET next_due_at=now() WHERE event_id=${e.id}`);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended(\'d6r1:acct_review_busy\' || \'false\',0))');
    let failure: unknown;
    try {
      for (let round = 0; round < 2; round += 1) {
        try {
          await runShadowObservationBatch({ limit: 2, deadline: Date.now() + 10000, provider: provider(observation(quiet)) });
        } catch (error) {
          failure = error;
        }
      }
      const checked = (await state(quiet.id)).last_checked_at;
      process.stdout.write(`REVIEW_BATCH_LOCK_FAILURE=${String(failure)} QUIET_LAST_CHECKED=${checked}\n`);

      expect(checked).not.toBeNull();
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  }, 15000);

  it('REVIEW receipt contention preserves durable replay and resumes saved observation progress', async () => {
    const d = await seed('d6r1_contention_progress');
    const blocked = event(d);
    blocked.account = 'acct_contention_blocked';
    const unrelated = event(d);
    unrelated.account = 'acct_contention_free';
    await capture(blocked);
    await capture(unrelated);
    const blockedAttempts = (await receiptRow(blocked.id)).attempts as number;
    const unrelatedAttempts = (await receiptRow(unrelated.id)).attempts as number;
    await db.execute(sql`UPDATE deposit_shadow_receipt SET next_due_at=now()
      WHERE event_id IN (${blocked.id},${unrelated.id})`);
    const blocker = await pool.connect();
    let released = false;
    let paging = true;
    const refundCalls: Array<string | null> = [];
    const progressive: ShadowProvider = {
      ...provider(observation(d, { collection: { ...observation(d).collection, amountRefunded: 2000 } })),
      refunds: async (_charge, cursor) => {
        refundCalls.push(cursor);
        if (!paging) {
          return { data: [], hasMore: false, requestId: 'req_progress_done' };
        }
        const ordinal = cursor ? Number(cursor.split('_').at(-1)) + 1 : 0;
        return {
          data: [{ id: `re_progress_${ordinal}`, chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: ordinal }],
          hasMore: true,
          requestId: `req_progress_${ordinal}`,
        };
      },
    };
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended(\'d6r1:acct_contention_blocked\' || \'false\',0))');
      const started = Date.now();
      await runShadowObservationBatch({ limit: 2, deadline: started + 9000, provider: progressive });

      expect(Date.now() - started).toBeLessThan(9000);

      const pending = await receiptRow(blocked.id);
      const unrelatedProgress = await receiptRow(unrelated.id);

      expect(pending.completed_at).toBeNull();
      expect(pending.generation).toBeNull();
      expect(pending.attempts).toBeGreaterThan(blockedAttempts);
      expect(new Date(pending.next_due_at as string).getTime()).toBeGreaterThan(started);
      expect(unrelatedProgress.attempts).toBeGreaterThan(unrelatedAttempts);
      expect((await state(d.id)).cursor).not.toBeNull();

      await blocker.query('ROLLBACK');
      released = true;
      await db.execute(sql`UPDATE deposit_shadow_receipt SET next_due_at=now() WHERE event_id=${blocked.id}`);
      await replayShadowReceipts(2, Date.now() + 4000);

      expect((await receiptRow(blocked.id)).attempts).toBeGreaterThan(pending.attempts as number);

      paging = false;
      await due();
      await runShadowObservationBatch({ limit: 1, deadline: Date.now() + 9000, provider: progressive });

      expect(refundCalls).toContain('re_progress_3');
      expect((await state(d.id)).certificate).toMatchObject({ succeeded: 2000, financialAuthority: false });
    } finally {
      if (!released) {
        await blocker.query('ROLLBACK');
      }
      blocker.release();
    }
  }, 20000);

  it('REVIEW refunded historical row without provider id remains unresolved', async () => {
    const d = await seed();
    await db.execute(sql`UPDATE appointment_deposit SET status='refunded',refunded_at=now(),stripe_refund_id=NULL,refund_status=NULL,refund_requested_at=NULL WHERE id=${d.id}`);
    const imported = await importLegacyShadowCommand(d.salon, d.id, false);
    const result = await observeShadowClaim(await claim(), provider(observation(d)));
    process.stdout.write(`REVIEW_HISTORICAL_IMPORTED=${imported} RESULT=${result} CERTIFICATE=${JSON.stringify((await state(d.id)).certificate)}\n`);

    expect((await state(d.id)).certificate).toBeNull();
  });

  it.each([
    ['status-only', 'status=\'refunded\',refunded_at=NULL'],
    ['refunded_at-only', 'status=\'paid\',refunded_at=now()'],
  ])('REVIEW %s legacy marker preserves unknown provenance without inventing a refund', async (_label, marker) => {
    const d = await seed(`d6r1_marker_${_label.replaceAll('-', '').replaceAll('_', '')}`);
    await db.execute(sql.raw(`UPDATE appointment_deposit SET ${marker},stripe_refund_id=NULL,refund_status=NULL,refund_requested_at=NULL WHERE id='${d.id}'`));

    // Observation must retain the unknown legacy command before any later column cleanup.
    expect(await observeShadowClaim(await claim(), provider(observation(d)))).toBe('incomplete');
    expect((await state(d.id))).toMatchObject({ certificate: null, reason: 'legacy_operation_unknown' });

    const [raw] = (await db.execute(sql`SELECT evidence FROM deposit_shadow_observation WHERE deposit_id=${d.id} ORDER BY accepted_at`)).rows;
    const [command] = (await db.execute(sql`SELECT intended_cents,currency,evidence FROM deposit_shadow_command WHERE deposit_id=${d.id}`)).rows;
    const [attempt] = (await db.execute(sql`SELECT provider_refund_id,parameters_digest,idempotency_key,evidence FROM deposit_shadow_attempt WHERE command_id=${`legacy:${d.id}`}`)).rows;

    expect(JSON.stringify(raw!.evidence)).toContain(_label === 'status-only' ? '"depositStatus":"refunded"' : '"refundedAt"');
    expect(command).toMatchObject({ intended_cents: null, currency: 'cad' });
    expect(attempt).toMatchObject({ provider_refund_id: null, parameters_digest: null, idempotency_key: null });
    expect(JSON.stringify(command!.evidence)).not.toContain('amountCents');
    expect(JSON.stringify(attempt!.evidence)).not.toContain('idempotency');

    // Explicit import is a no-op on immutable evidence, then legacy cleanup cannot
    // erase the retained unresolved command or certify a clean provider snapshot.
    expect(await importLegacyShadowCommand(d.salon, d.id, false)).toBe(true);

    await db.execute(sql`UPDATE appointment_deposit SET status='paid',refunded_at=NULL,
      stripe_refund_id=NULL,refund_status=NULL,refund_requested_at=NULL WHERE id=${d.id}`);
    await due();

    expect(await observeShadowClaim(await claimDeposit(d.id), provider(observation(d)))).toBe('incomplete');
    expect((await state(d.id))).toMatchObject({ certificate: null, reason: 'legacy_operation_unknown' });
  });

  it('REVIEW a locally revoked sole binding remains observable without granting financial authority', async () => {
    const d = await seed('d6r1_revoked_local');
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${d.salon}`);

    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('accepted');
    expect((await state(d.id)).certificate).toMatchObject({ financialAuthority: false });
  });

  it('REVIEW foreign historical and live account bindings both stale the original tenant claim', async () => {
    const historical = await seed('d6r1_foreign_historical');
    const historicalOther = await seed('d6r1_foreign_historical_other');
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${historicalOther.salon}`);
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_foreign_historical',
      salonId: historicalOther.salon,
      stripeAccountId: historical.account,
      livemode: false,
      revokedAt: new Date(),
      revocationCause: 'revoked_local',
    });

    expect(await finalizeShadowObservation(await claimDeposit(historical.id), observation(historical))).toBe('stale');

    const live = await seed('d6r1_foreign_live');
    const liveOther = await seed('d6r1_foreign_live_other');
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${live.salon}`);
    await db.execute(sql`UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause='revoked_local' WHERE salon_id=${liveOther.salon}`);
    await db.insert(schema.salonStripeAccountSchema).values({
      id: 'ssa_foreign_live',
      salonId: liveOther.salon,
      stripeAccountId: live.account,
      livemode: false,
    });

    expect(await finalizeShadowObservation(await claimDeposit(live.id), observation(live))).toBe('stale');
  });

  it('REVIEW an independent binding transaction fences a waiting finalizer after commit', async () => {
    const d = await seed('d6r1_binding_race');
    const c = await claim();
    const binding = await pool.connect();
    let committed = false;
    try {
      await binding.query('BEGIN');
      await binding.query('UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause=\'revoked_local\' WHERE salon_id=$1', [d.salon]);
      await binding.query('INSERT INTO salon_stripe_account(id,salon_id,stripe_account_id,livemode) VALUES (\'ssa_binding_race_rebound\',$1,$2,false)', [d.salon, d.account]);
      await binding.query('UPDATE salon_stripe_account SET revoked_at=now(),revocation_cause=\'deauthorized\' WHERE id=\'ssa_binding_race_rebound\'');
      let settled = false;
      const finalizing = finalizeShadowObservation(c, observation(d)).then((result) => {
        settled = true;
        return result;
      });
      await sleep(125);

      expect(settled).toBe(false);

      await binding.query('COMMIT');
      committed = true;

      expect(await finalizing).toBe('stale');
      expect((await state(d.id)).certificate).toBeNull();
    } finally {
      if (!committed) {
        await binding.query('ROLLBACK');
      }
      binding.release();
    }
  }, 10000);

  it('REVIEW repeated shared-deadline batches must actually observe the quiet tenant', async () => {
    const a = await seed('d6r1_batch_noisy');
    const b = await seed('d6r1_batch_quiet');
    const calls: string[] = [];
    const scripted: ShadowProvider = {
      ...provider(observation(b)),
      collection: async (pi, ctx) => {
        calls.push(pi);
        if (pi === a.pi) {
          await new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
          throw new Error('observation_deadline');
        }
        return { fact: observation(b).collection, requestId: 'req_review_quiet' };
      },
    };
    for (let round = 0; round < 3; round += 1) {
      // Advance due eligibility equally to model successive scheduled invocations;
      // retain the production service history/fences/attempts and SQL return order.
      await due();
      const started = Date.now();
      await runShadowObservationBatch({ limit: 2, deadline: started + 2700, provider: scripted });

      expect(Date.now() - started).toBeLessThan(3400);
      expect((await state(b.id)).certificate).toMatchObject({ financialAuthority: false });
    }
    process.stdout.write(`REVIEW_BATCH_PROVIDER_CALLS=${JSON.stringify(calls)} QUIET=${b.pi}\n`);

    expect(calls).toContain(b.pi);
  }, 15000);

  it('REVIEW four slow tenants cannot starve a fifth quiet tenant across bounded batch rounds', async () => {
    const slow = await Promise.all(Array.from({ length: 4 }, (_, index) => seed(`d6r1_fair_slow_${index}`)));
    const quiet = await seed('d6r1_fair_zquiet');
    const calls: string[] = [];
    const scripted: ShadowProvider = {
      ...provider(observation(quiet)),
      collection: async (paymentIntentId, context) => {
        calls.push(paymentIntentId);
        if (slow.some(d => d.pi === paymentIntentId)) {
          await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }));
          throw new Error('observation_deadline');
        }
        return { fact: observation(quiet).collection, requestId: 'req_fair_quiet' };
      },
    };
    const elapsed: number[] = [];
    for (let round = 0; round < 2 && !calls.includes(quiet.pi); round += 1) {
      if (round > 0) {
        await due();
      }
      const started = Date.now();
      await runShadowObservationBatch({ limit: 4, deadline: started + 2700, provider: scripted });
      elapsed.push(Date.now() - started);
    }
    process.stdout.write(`REVIEW_FIVE_TENANT_FAIRNESS=${JSON.stringify({ calls, elapsed, quiet: quiet.pi })}\n`);

    expect(elapsed).toHaveLength(2);
    expect(elapsed.every(value => value <= 3400)).toBe(true);
    expect(calls).toContain(quiet.pi);
    expect((await state(quiet.id)).certificate).toMatchObject({ financialAuthority: false });
  }, 15000);

  it('REVIEW a delayed claim update rolls back before its batch budget can consume provider reads', async () => {
    const d = await seed('d6r1_claim_budget');
    const before = await state(d.id);
    const scripted = provider(observation(d));
    const collection = vi.fn(scripted.collection);
    scripted.collection = collection;
    await db.execute(sql`CREATE FUNCTION d6r1_claim_delay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.fence > OLD.fence THEN PERFORM pg_sleep(0.3); END IF;
        RETURN NEW;
      END;
    $$`);
    await db.execute(sql`CREATE TRIGGER d6r1_claim_delay_trigger BEFORE UPDATE ON deposit_shadow_state
      FOR EACH ROW EXECUTE FUNCTION d6r1_claim_delay()`);
    try {
      const result = await runShadowObservationBatch({ limit: 1, deadline: Date.now() + 2700, provider: scripted });
      const after = await state(d.id);

      expect(result).toMatchObject({ claimed: 0, results: [] });
      expect(collection).not.toHaveBeenCalled();
      expect(after.fence).toBe(before.fence);
      expect(after.last_claimed_at).toBeNull();
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS d6r1_claim_delay_trigger ON deposit_shadow_state`);
      await db.execute(sql`DROP FUNCTION IF EXISTS d6r1_claim_delay()`);
    }
  }, 10000);

  it('REVIEW two successful partial identities certify their full original total', async () => {
    const d = await seed();
    const o = observation(d, { refunds: [1000, 1500].map((amount, i) => ({ id: `re_full${i}`, chargeId: d.charge, paymentIntentId: d.pi, amount, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 })) });
    o.collection.amountRefunded = 2500;

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('accepted');
    expect((await state(d.id)).certificate).toMatchObject({ succeeded: 2500, reserved: 0, financialAuthority: false });
  });

  it('REVIEW failed external full refund plus replacement cannot erase unresolved intent', async () => {
    const d = await seed();
    const failed = { id: 're_failed_external', chargeId: d.charge, paymentIntentId: d.pi, amount: 2500, currency: 'cad', status: 'failed', failureReason: null, created: 1 };
    const o = observation(d, { refunds: [failed] });

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('incomplete');

    await due();
    o.refunds.push({ ...failed, id: 're_replacement_external', status: 'succeeded' });
    o.collection.amountRefunded = 2500;

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('incomplete');
    expect((await state(d.id)).certificate).toBeNull();

    const count = (await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object WHERE kind='refund'`)).rows[0]!.n;

    expect(count).toBe(2);
  });

  it('REVIEW cross-tenant object FK and immutable evidence constraints reject corruption', async () => {
    const a = await seed();
    const b = await seed('d6r1_foreign_constraints');

    await expect(db.execute(sql`INSERT INTO deposit_shadow_object(account,livemode,object_id,salon_id,deposit_id,kind,facts,version) VALUES (${a.account},false,'re_wrong_fk',${b.salon},${a.id},'refund','{}',1)`)).rejects.toThrow();

    await db.execute(sql`UPDATE appointment_deposit SET refund_status='requested',refund_status_changed_at=now(),refund_requested_at=now() WHERE id=${a.id}`);

    expect(await importLegacyShadowCommand(a.salon, a.id, false)).toBe(true);
    await expect(db.execute(sql`UPDATE deposit_shadow_attempt SET parameters='{}'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM deposit_shadow_command`)).rejects.toThrow();

    const e = event(a);
    await capture(e);

    await expect(db.execute(sql`UPDATE deposit_shadow_receipt SET projection='{}' WHERE event_id=${e.id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM deposit_shadow_receipt WHERE event_id=${e.id}`)).rejects.toThrow();
  });

  it('REVIEW quiet-only control completes within the same 2700ms batch deadline', async () => {
    const d = await seed('d6r1_quiet_control');
    const result = await runShadowObservationBatch({ limit: 2, deadline: Date.now() + 2700, provider: provider(observation(d)) });

    expect(result.results).toEqual(['accepted']);
    expect((await state(d.id)).certificate).not.toBeNull();
  });

  it('REVIEW signed charge and refund event aliases retain independent replayable evidence', async () => {
    const d = await seed();
    for (const type of ['charge.refunded', 'charge.refund.updated', 'refund.created']) {
      const e = event(d, type, type === 'charge.refunded' ? d.charge : 're_review_alias');
      if (type === 'charge.refunded') {
        e.data.object.object = 'charge';
        e.data.object.amount = 2500;
      }

      expect((await POST(signed(e))).status).toBe(200);
    }

    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_receipt WHERE completed_at IS NULL`)).rows[0]!.n).toBe(3);

    const o = observation(d, { refunds: [{ id: 're_review_alias', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 }] });
    o.collection.amountRefunded = 500;

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('accepted');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_receipt WHERE completed_at IS NOT NULL`)).rows[0]!.n).toBe(3);
    expect(effects.create).not.toHaveBeenCalled();
  });
});
