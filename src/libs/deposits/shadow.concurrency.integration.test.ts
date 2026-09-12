import { readFileSync } from 'node:fs';
import path from 'node:path';

import { eq, getTableColumns, getTableName, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NextRequest } from 'next/server';
import pg from 'pg';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { depositsTransaction, isInsideDepositsTransaction } from './depositsTransaction';
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
const { POST } = await import('@/app/api/webhooks/stripe-connect/route');
const { captureShadowReceipt, claimShadowWork, enrollShadowDeposit, finalizeShadowObservation, replayShadowReceipts, shadowDiagnostics, importLegacyShadowCommand } = await import('./shadowStore');
const { observeShadowClaim } = await import('./shadowObserver');
const { claimWebhookEvent, finalizeWebhookEvent } = await import('@/libs/stripeConnect/webhookEvents');
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
let executed = 0;
async function seed(salon = BASE) {
  serial += 1;
  const suffix = `${salon}_${serial}`;
  await db.insert(schema.salonSchema).values({ id: salon, slug: salon, name: salon }).onConflictDoNothing();
  await db.insert(schema.technicianSchema).values({ id: `tech_${salon}`, salonId: salon, name: 'Synthetic' }).onConflictDoNothing();
  await db.insert(schema.salonStripeAccountSchema).values({ id: `ssa_${salon}`, salonId: salon, stripeAccountId: `acct_${salon}`, livemode: false }).onConflictDoNothing();
  const start = new Date(Date.UTC(2099, 0, serial, 12));
  await db.insert(schema.appointmentSchema).values({ id: `appt_${suffix}`, salonId: salon, technicianId: `tech_${salon}`, clientPhone: '4165550100', clientName: 'Synthetic', startTime: start, endTime: new Date(start.getTime() + 3600000), status: 'confirmed', totalPrice: 6500, totalDurationMinutes: 60 });
  await db.insert(schema.appointmentDepositSchema).values({ id: `dep_${suffix}`, salonId: salon, appointmentId: `appt_${suffix}`, amountCents: 2500, currency: 'cad', status: 'paid', stripeAccountId: `acct_${salon}`, stripePaymentIntentId: `pi_${suffix}` });

  expect(await enrollShadowDeposit(salon, `dep_${suffix}`, false)).toBe(true);

  return { salon, suffix, id: `dep_${suffix}`, pi: `pi_${suffix}`, charge: `ch_${suffix}`, account: `acct_${salon}` };
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
async function due() {
  await db.execute(sql`UPDATE deposit_shadow_state SET next_due_at=now(),lease_until=NULL`);
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
    process.stdout.write(`D6_R1_POSTGRES_TESTS_EXECUTED=${executed} D6_R1_POSTGRES_TESTS_SKIPPED=0\n`);
    await pool?.end();
  });

  it('T01/T25 signed receipt survives legacy crash and replay after retry horizon', async () => {
    const d = await seed();
    const e = event(d);
    effects.apply.mockRejectedValueOnce(new Error('scripted crash after receipt'));

    expect((await POST(signed(e))).status).toBe(500);

    const stored = (await db.execute(sql`SELECT * FROM deposit_shadow_receipt WHERE event_id=${e.id}`)).rows[0]!;

    expect(stored).toBeDefined();
    expect(stored.completed_at).toBeNull();
    expect(stored.projection).toMatchObject({ objectId: 're_one' });

    await db.execute(sql`UPDATE stripe_webhook_event SET status='processed',processed_at=now(),payment_intent_id=NULL,raw_payload=NULL`);
    const c = await claim();
    const o = observation(d);
    o.refunds = [{ id: 're_one', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'pending', failureReason: null, created: 1 }];

    expect(await observeShadowClaim(c, provider(o))).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('refund_pending');
    expect((await db.execute(sql`SELECT completed_at FROM deposit_shadow_receipt WHERE event_id=${e.id}`)).rows[0]!.completed_at).not.toBeNull();
    expect(effects.create).not.toHaveBeenCalled();
  });

  it('T01 pause, duplicate and shadow-first completion never claim the legacy consumer', async () => {
    const d = await seed();
    const e = event(d);
    await capture(e);
    await capture(e);
    const c = await claim();
    const o = observation(d);
    o.refunds = [{ id: 're_one', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 }];
    o.collection.amountRefunded = 500;

    expect(await finalizeShadowObservation(c, o)).toBe('accepted');

    const legacy = await claimWebhookEvent({ eventId: e.id, type: e.type, account: e.account, livemode: false });

    expect(legacy.claimed).toBe(true);

    if (legacy.claimed) {
      await finalizeWebhookEvent({ id: legacy.id, attempts: legacy.attempts, status: 'processed', outcome: 'refunded' });
    }

    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_receipt`)).rows[0]!.n).toBe(1);
    expect((await state(d.id)).certificate).toMatchObject({ financialAuthority: false, succeeded: 500 });
  });

  it('T01/17 invalid signature writes nothing; duplicate mode/account conflict rejects', async () => {
    const d = await seed();
    const e = event(d);
    const bad = new Request('http://localhost/api/webhooks/stripe-connect', { method: 'POST', body: JSON.stringify(e), headers: { 'stripe-signature': 'bad' } }) as NextRequest;

    expect((await POST(bad)).status).toBe(400);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_receipt`)).rows[0]!.n).toBe(0);

    await capture(e);

    await expect(capture({ ...e, livemode: true })).rejects.toThrow('shadow_receipt_identity_conflict');
    await expect(capture({ ...e, account: 'acct_foreign' })).rejects.toThrow('shadow_receipt_identity_conflict');
  });

  it('T03 old fence cannot replace newer observation after lease reclaim', async () => {
    const d = await seed();

    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('accepted');

    await due();
    const old = await claim();
    await due();
    const fresh = await claim();

    expect(fresh.fence).toBeGreaterThan(old.fence);
    expect(await finalizeShadowObservation(fresh, observation(d))).toBe('accepted');
    expect(await finalizeShadowObservation(old, observation(d, { pagesComplete: false }))).toBe('stale');
    expect((await state(d.id)).certificate).toMatchObject({ version: 2 });
  });

  it('T03 receipt during provider read and legacy financial drift reject clean finalization', async () => {
    const d = await seed();
    const c = await claim();
    await capture(event(d));

    expect(await finalizeShadowObservation(c, observation(d))).toBe('stale');
    expect((await state(d.id)).certificate).toBeNull();

    const next = await claim();
    await db.update(schema.appointmentDepositSchema).set({ externalRefundObservedCents: 300 }).where(eq(schema.appointmentDepositSchema.id, d.id));

    expect(await finalizeShadowObservation(next, observation(d))).toBe('stale');
    expect((await state(d.id)).certificate).toBeNull();
  });

  it('T03 independent simultaneous claim connections never own the same live lease', async () => {
    await seed();
    const [a, b] = await Promise.all([claimShadowWork(1, Date.now() + 30000), claimShadowWork(1, Date.now() + 30000)]);

    expect(a.length + b.length).toBe(1);
  });

  it('T02 noisy tenant exceeds batch; leased prefix, unchanged and unresolved cohorts all progress', async () => {
    const all = [];
    for (let i = 0; i < 12; i += 1) {
      all.push(await seed());
    }
    for (let i = 0; i < 3; i += 1) {
      all.push(await seed('d6r1_quiet'));
    }
    await db.execute(sql`UPDATE deposit_shadow_state SET lease_until=now()+interval '1 hour' WHERE deposit_id=${all[0]!.id}`);
    const seen = new Set<string>();
    const first = await claimShadowWork(3, Date.now() + 30000);

    expect(first.some(c => c.salon_id === 'd6r1_quiet')).toBe(true);

    for (const c of first) {
      seen.add(c.deposit_id);
      await finalizeShadowObservation(c, observation(all.find(d => d.id === c.deposit_id)!));
    }
    for (let round = 0; round < 8; round += 1) {
      for (const c of await claimShadowWork(3, Date.now() + 30000)) {
        seen.add(c.deposit_id);
        await finalizeShadowObservation(c, observation(all.find(d => d.id === c.deposit_id)!, { pagesComplete: round % 2 === 0 }));
      }
    }

    expect(seen.size).toBe(14);
    expect(seen.has(all[0]!.id)).toBe(false);

    for (const id of seen) {
      expect(new Date((await state(id)).next_due_at as string).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('T05 full multi-refund evidence counts every successful ID and preserves unresolved states', async () => {
    const d = await seed();
    const o = observation(d);
    o.refunds = ['succeeded', 'succeeded', 'requires_action', 'failed', 'canceled'].map((status, i) => ({
      id: `re_multi${i}`,
      chargeId: d.charge,
      paymentIntentId: d.pi,
      amount: 200,
      currency: 'cad',
      status,
      failureReason: null,
      created: 1,
    }));
    o.collection.amountRefunded = 400;

    expect(await finalizeShadowObservation(await claim(), o)).toBe('incomplete');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object WHERE kind='refund'`)).rows[0]!.n).toBe(5);
    expect((await state(d.id)).certificate).toBeNull();

    await due();
    o.refunds = [];
    o.collection.amountRefunded = 0;

    expect(await finalizeShadowObservation(await claim(), o)).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('known_evidence_missing');
  });

  it('T05/T25 signed identities and previously seen dispute can never disappear into a clean certificate', async () => {
    const d = await seed();
    await capture(event(d, 'charge.dispute.created', 'dp_one'));

    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('known_evidence_missing');

    await due();
    const o = observation(d);
    o.disputes = [{ id: 'dp_one', chargeId: d.charge, paymentIntentId: d.pi, amount: 1000, currency: 'cad', status: 'closed', provisionalDebit: 1000, reimbursedPrincipal: null, restoredPrincipal: null, fees: 1500 }];

    expect(await finalizeShadowObservation(await claim(), o)).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('dispute_principal_unresolved');

    await due();

    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('incomplete');
    expect((await state(d.id)).certificate).toBeNull();
  });

  it('T17 identity conflict stays quarantined even when a later dispute also blocks', async () => {
    const d = await seed();
    const o = observation(d);
    o.refunds = [{ id: 're_foreign', chargeId: d.charge, paymentIntentId: 'pi_foreign', amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 }];
    o.collection.disputed = true;

    expect(await finalizeShadowObservation(await claim(), o)).toBe('incomplete');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object`)).rows[0]!.n).toBe(0);
    expect((await state(d.id)).certificate).toBeNull();
    expect(await enrollShadowDeposit('d6r1_wrong', d.id, false)).toBe(false);
    expect(await enrollShadowDeposit(d.salon, d.id, true)).toBe(false);
  });

  it('T18 mandatory observation failure rolls back certificate, receipt and object progress', async () => {
    const d = await seed();
    const c = await claim();
    await db.execute(sql`CREATE FUNCTION d6r1_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'scripted audit failure';
END $$`);
    await db.execute(sql`CREATE TRIGGER d6r1_fail BEFORE INSERT ON deposit_shadow_observation FOR EACH ROW EXECUTE FUNCTION d6r1_fail_audit()`);
    try {
      await expect(finalizeShadowObservation(c, observation(d))).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER d6r1_fail ON deposit_shadow_observation`);
      await db.execute(sql`DROP FUNCTION d6r1_fail_audit()`);
    }

    expect((await state(d.id)).version).toBe(0);
    expect((await state(d.id)).certificate).toBeNull();
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object`)).rows[0]!.n).toBe(0);
  });

  it('T09/21 shadow evidence coexists with unchanged legacy money and survives live row deletion', async () => {
    const d = await seed();
    const before = (await db.execute(sql`SELECT to_jsonb(d) AS row FROM appointment_deposit d WHERE id=${d.id}`)).rows[0]!.row;

    expect(await observeShadowClaim(await claim(), provider(observation(d)))).toBe('accepted');
    expect((await db.execute(sql`SELECT to_jsonb(d) AS row FROM appointment_deposit d WHERE id=${d.id}`)).rows[0]!.row).toEqual(before);

    await db.delete(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.id, d.id));

    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_observation`)).rows[0]!.n).toBe(1);
    expect((await shadowDiagnostics(d.salon)).items[0]).toMatchObject({ original_recorded_amount_cents: '2500', recorded_currency: 'cad', amount_source: 'accepted_collection' });
    await expect(db.execute(sql`UPDATE deposit_shadow_state SET engine='repair_v1' WHERE deposit_id=${d.id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM deposit_shadow_observation`)).rejects.toThrow();
    expect(effects.create).not.toHaveBeenCalled();
  });

  it('T20 unattributed receipts remain visible and replay when trusted enrollment appears', async () => {
    const d = await seed();
    await db.execute(sql`DELETE FROM deposit_shadow_state WHERE deposit_id=${d.id}`);
    const e = event(d);
    await capture(e);
    const diagnostics = await shadowDiagnostics(d.salon);

    expect(diagnostics.receiptCounts).toMatchObject({ total: 1, pending: 1 });
    expect(diagnostics.receipts).toHaveLength(1);
    expect(await enrollShadowDeposit(d.salon, d.id, false)).toBe(true);

    await db.execute(sql`UPDATE deposit_shadow_receipt SET next_due_at=now()`);

    await replayShadowReceipts();

    expect((await state(d.id)).generation).toBe(1);

    const usd = await seed(d.salon);

    // Current application principal is CAD-only; retain that guard in diagnostic fixtures.
    await expect(db.execute(sql`UPDATE appointment_deposit SET currency='usd' WHERE id=${usd.id}`)).rejects.toThrow('appointment_deposit_currency_cad');

    const unknown = await seed(d.salon);
    await db.execute(sql`DELETE FROM appointment_deposit WHERE id=${unknown.id}`);
    const foreign = await seed('d6r1_other_diagnostics');
    const scoped = await shadowDiagnostics(d.salon, '', 1);

    expect(scoped.items).toHaveLength(1);
    expect(scoped.principalByCurrency).toEqual(expect.arrayContaining([
      expect.objectContaining({ recorded_currency: 'cad', original_recorded_amount_cents: '5000', unknown_amounts: 0 }),
      expect.objectContaining({ recorded_currency: null, original_recorded_amount_cents: null, unknown_amounts: 1 }),
    ]));
    expect(scoped.counts).toMatchObject({ total: 3 });

    const all = await shadowDiagnostics(d.salon);

    expect(all.items).not.toContainEqual(expect.objectContaining({ deposit_id: foreign.id }));
    expect(all.items).toContainEqual(expect.objectContaining({ deposit_id: unknown.id, amount_source: 'unknown', original_recorded_amount_cents: null }));
    expect(all.items).toContainEqual(expect.objectContaining({ deposit_id: d.id, action_owner: 'implementation_reviewer', next_safe_step: 'inspect_retained_evidence_no_financial_action' }));
    expect(all.receipts[0]).toMatchObject({ reported_amount_cents: '500', reported_currency: 'cad', amount_source: 'signed_receipt_unverified_principal' });
  });

  it('T09 legacy command import preserves unknown body and stable epoch without dispatch', async () => {
    const d = await seed();
    await db.update(schema.appointmentDepositSchema).set({ refundStatus: 'requested', refundRequestedAt: new Date(), refundStatusChangedAt: new Date() }).where(eq(schema.appointmentDepositSchema.id, d.id));

    expect(await importLegacyShadowCommand(d.salon, d.id, false)).toBe(true);
    expect(await importLegacyShadowCommand(d.salon, d.id, false)).toBe(true);

    const attempts = (await db.execute(sql`SELECT * FROM deposit_shadow_attempt`)).rows;

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ parameters: null, idempotency_key: null, intended_cents: null, dispatch_knowledge: 'unknown' });
    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('legacy_operation_unknown');
    expect(effects.create).not.toHaveBeenCalled();
  });

  it('T25 every dispute event family records independently and invalidates', async () => {
    const d = await seed();

    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('accepted');

    for (const family of ['created', 'updated', 'closed', 'funds_withdrawn', 'funds_reinstated']) {
      const e = event(d, `charge.dispute.${family}`, 'dp_lifecycle');

      expect((await POST(signed(e))).status).toBe(200);
      expect((await state(d.id)).certificate).toBeNull();
    }

    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_receipt`)).rows[0]!.n).toBe(5);
  });

  it('T05 uncaptured principal, duplicate refunds and unsupported status cannot certify', async () => {
    const d = await seed();
    const uncaptured = observation(d);
    uncaptured.collection.captured = false;

    expect(await finalizeShadowObservation(await claim(), uncaptured)).toBe('incomplete');
    expect((await state(d.id)).certificate).toBeNull();

    await due();
    const partial = observation(d);
    partial.collection.amountCaptured = 1000;

    expect(await finalizeShadowObservation(await claim(), partial)).toBe('incomplete');

    await due();
    const future = observation(d);
    future.refunds = [{ id: 're_future', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'new_provider_state', failureReason: null, created: 1 }];

    expect(await finalizeShadowObservation(await claim(), future)).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('unsupported_refund_status');
  });

  it('T17 deauthorization during read rejects original-account finalization', async () => {
    const d = await seed();
    const c = await claim();
    await db.update(schema.salonStripeAccountSchema).set({ revokedAt: new Date(), revocationCause: 'deauthorized' }).where(eq(schema.salonStripeAccountSchema.salonId, d.salon));

    expect(await finalizeShadowObservation(c, observation(d))).toBe('stale');
    expect((await state(d.id)).certificate).toBeNull();
  });

  it('T18 receipt persistence failure happens before legacy dispatch or acknowledgement', async () => {
    const d = await seed();
    await db.execute(sql`CREATE FUNCTION d6r1_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'scripted receipt failure';
END $$`);
    await db.execute(sql`CREATE TRIGGER d6r1_fail BEFORE INSERT ON deposit_shadow_receipt FOR EACH ROW EXECUTE FUNCTION d6r1_fail_receipt()`);
    try {
      await expect(POST(signed(event(d)))).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER d6r1_fail ON deposit_shadow_receipt`);
      await db.execute(sql`DROP FUNCTION d6r1_fail_receipt()`);
    }

    expect(effects.apply).not.toHaveBeenCalled();
    expect((await state(d.id)).generation).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM stripe_webhook_event`)).rows[0]!.n).toBe(0);
  });

  it('T05/T10 pagination checkpoints resume across batches and scan unrelated dispute pages fairly', async () => {
    const d = await seed();
    const o = observation(d);
    o.refunds = Array.from({ length: 8 }, (_, i) => ({ id: `re_page${i}`, chargeId: d.charge, paymentIntentId: d.pi, amount: 100, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 }));
    o.collection.amountRefunded = 800;
    const transport = provider(o);
    const cursors: Array<string | null> = [];
    transport.refunds = async (_charge, cursor) => {
      cursors.push(cursor);
      const index = cursor ? Number(cursor.replace('re_page', '')) + 1 : 0;
      return { data: [o.refunds[index]!], hasMore: index < 7, requestId: `req_page${index}` };
    };
    let disputePages = 0;
    transport.disputes = async (_charge, cursor) => {
      disputePages += 1;
      const index = cursor ? Number(cursor.replace('dp_unrelated', '')) + 1 : 0;
      return { data: [{ id: `dp_unrelated${index}`, chargeId: 'ch_other', paymentIntentId: null, amount: 100, currency: 'cad', status: 'lost', provisionalDebit: null, reimbursedPrincipal: null, restoredPrincipal: null, fees: null }], hasMore: index < 5, requestId: null };
    };

    expect(await observeShadowClaim(await claim(), transport)).toBe('incomplete');

    const checkpoint = (await state(d.id)).cursor as {
      refundCursor: string;
      cycleId: string;
    };

    expect(checkpoint.refundCursor).toBe('re_page3');
    expect((await state(d.id)).certificate).toBeNull();

    for (let pass = 0; pass < 3; pass += 1) {
      await due();
      await observeShadowClaim(await claim(), transport);
    }

    expect((await state(d.id)).certificate).toMatchObject({ succeeded: 800, cycleId: checkpoint.cycleId });
    expect((await state(d.id)).cursor).toBeNull();
    expect(cursors).toEqual([null, 're_page0', 're_page1', 're_page2', 're_page3', 're_page4', 're_page5', 're_page6']);
    expect(disputePages).toBe(6);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object WHERE kind='dispute'`)).rows[0]!.n).toBe(0);
  });

  it('T10 interrupted page preserves checkpoint and zero provider locks for resumption', async () => {
    const d = await seed();
    const o = observation(d);
    const transport = provider(o);
    let stopped = true;
    transport.refunds = async (_charge, cursor) => {
      const independent = await pool.connect();
      try {
        await independent.query('BEGIN');
        await independent.query('SELECT id FROM appointment_deposit WHERE id=$1 FOR UPDATE NOWAIT', [d.id]);
        await independent.query('ROLLBACK');
      } finally {
        independent.release();
      }
      if (cursor === 're_checkpoint' && stopped) {
        throw new Error('scripted connection loss');
      }
      if (!cursor) {
        return { data: [{ id: 're_checkpoint', chargeId: d.charge, paymentIntentId: d.pi, amount: 100, currency: 'cad', status: 'pending', failureReason: null, created: 1 }], hasMore: true, requestId: null };
      }
      return { data: [], hasMore: false, requestId: null };
    };

    expect(await observeShadowClaim(await claim(), transport)).toBe('incomplete');
    expect((await state(d.id)).cursor).toMatchObject({ refundCursor: 're_checkpoint' });

    stopped = false;
    await due();

    expect(await observeShadowClaim(await claim(), transport)).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('refund_pending');
    expect((await state(d.id)).cursor).toBeNull();
  });

  it('T03 reversed real worker read completion rejects obsolete response', async () => {
    const d = await seed();
    const old = await claim();
    const transport = provider(observation(d));
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.collection = async () => {
      entered();
      await gate;
      return { fact: observation(d).collection, requestId: null };
    };
    const slow = observeShadowClaim(old, transport);
    await started;
    await due();

    expect(await observeShadowClaim(await claim(), provider(observation(d)))).toBe('accepted');

    release();

    expect(await slow).toBe('stale');
    expect((await state(d.id)).certificate).toMatchObject({ version: 1 });
  });

  it('T21 migration interruption rollback, historical coexistence and column census', async () => {
    const d = await seed();
    const before = (await db.execute(sql`SELECT to_jsonb(d) AS row FROM appointment_deposit d WHERE id=${d.id}`)).rows[0]!.row;
    const migration = readFileSync(path.join(process.cwd(), 'migrations/0076_deposit_shadow_evidence.sql'), 'utf8');
    await db.execute(sql`DROP TABLE deposit_shadow_receipt,deposit_shadow_attempt,deposit_shadow_command,
      deposit_shadow_object,deposit_shadow_observation,deposit_shadow_state CASCADE`);
    await db.execute(sql`DROP FUNCTION deposit_shadow_receipt_immutable_header(),deposit_shadow_forbid_update(),deposit_shadow_object_scope_immutable()`);
    try {
      await expect(depositsTransaction(db, async (tx) => {
        await tx.execute(sql.raw(migration.split('--> statement-breakpoint').slice(0, 5).join(';')));
        throw new Error('scripted migration interruption');
      })).rejects.toThrow('scripted migration interruption');
      expect((await db.execute(sql`SELECT to_regclass('deposit_shadow_state') AS t`)).rows[0]!.t).toBeNull();
      // Unknown/missing shadow schema must fail before legacy dispatch; unrelated account receipts still work.
      await expect(POST(signed(event(d)))).rejects.toThrow();
      expect(effects.apply).not.toHaveBeenCalled();

      const unrelated = event(d, 'payout.created', 'po_unrelated');

      expect((await POST(signed(unrelated))).status).toBe(200);
    } finally {
      await depositsTransaction(db, tx => tx.execute(sql.raw(migration)));
    }

    expect((await db.execute(sql`SELECT to_jsonb(d) AS row FROM appointment_deposit d WHERE id=${d.id}`)).rows[0]!.row).toEqual(before);
    await expect(depositsTransaction(db, tx => tx.execute(sql.raw(migration)))).rejects.toThrow();

    const tables = [schema.depositShadowStateSchema, schema.depositShadowReceiptSchema, schema.depositShadowCommandSchema, schema.depositShadowAttemptSchema, schema.depositShadowObjectSchema, schema.depositShadowObservationSchema];
    for (const table of tables) {
      const name = getTableName(table);
      const columns = (await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${name}`)).rows.map(r => r.column_name).sort();

      expect(columns).toEqual(Object.values(getTableColumns(table)).map(c => c.name).sort());
    }

    expect(effects.create).not.toHaveBeenCalled();
  });

  it('T01/T25 pre-enrollment and charge-only receipts block first certification despite deferred replay', async () => {
    const d = await seed();
    await db.execute(sql`DELETE FROM deposit_shadow_state WHERE deposit_id=${d.id}`);
    const e = event(d, 'charge.dispute.created', 'dp_preexisting');
    // The immutable charge identity is sufficient; no PI or tenant metadata is supplied.
    delete (e.data.object as { payment_intent?: string }).payment_intent;
    await capture(e);

    expect(await enrollShadowDeposit(d.salon, d.id, false)).toBe(true);
    expect(await replayShadowReceipts()).toBe(0);
    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('stale');
    expect((await state(d.id)).certificate).toBeNull();
    expect(await finalizeShadowObservation(await claim(), observation(d))).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('known_evidence_missing');
  });

  it('T05 known refund omitted from listing cannot certify on resumed exact retrieval', async () => {
    const d = await seed();
    await capture(event(d));
    const o = observation(d);
    o.collection.amountRefunded = 500;
    const transport = provider(o);
    transport.refund = async () => ({ id: 're_one', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 });
    for (let pass = 0; pass < 2; pass += 1) {
      await due();

      expect(await observeShadowClaim(await claim(), transport)).toBe('incomplete');
      expect((await state(d.id)).certificate).toBeNull();
    }
  });

  it('T01 pause keeps durable independent receipts and local replay needs no provider redelivery', async () => {
    const { Env } = await import('@/libs/Env');
    const mutableEnv = Env as { DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED: string | undefined };
    const previous = mutableEnv.DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED;
    const d = await seed();
    try {
      mutableEnv.DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED = 'false';

      expect((await POST(signed(event(d)))).status).toBe(200);
      expect(effects.apply).not.toHaveBeenCalled();
    } finally {
      mutableEnv.DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED = previous;
    }
    const o = observation(d);
    o.refunds = [{ id: 're_one', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 }];
    o.collection.amountRefunded = 500;

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('accepted');
    expect((await db.execute(sql`SELECT status FROM stripe_webhook_event`)).rows[0]!.status).toBe('failed_retryable');
    expect((await state(d.id)).certificate).toMatchObject({ succeeded: 500 });
  });

  it('T25 named dispute failures retain unresolved refund and charge evidence', async () => {
    const d = await seed();
    for (const failureReason of ['charge_for_pending_refund_disputed', 'charge_disputed', 'refund_disputed_payment']) {
      const e = event(d, 'refund.failed', `re_${failureReason}`);
      Object.assign(e.data.object, { failure_reason: failureReason, status: 'failed' });
      await capture(e);
    }
    const o = observation(d);
    o.refunds = ['charge_for_pending_refund_disputed', 'charge_disputed', 'refund_disputed_payment'].map(failureReason => ({
      id: `re_${failureReason}`,
      chargeId: d.charge,
      paymentIntentId: d.pi,
      amount: 500,
      currency: 'cad',
      status: 'failed',
      failureReason,
      created: 1,
    }));

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('incomplete');
    expect((await state(d.id)).reason).toBe('dispute_related_refund');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object`)).rows[0]!.n).toBe(4);
    expect(effects.create).not.toHaveBeenCalled();
  });

  it('T03 older pending receipt cannot regress current success; verified later failure remains evidence', async () => {
    const d = await seed();
    const o = observation(d);
    o.refunds = [{ id: 're_one', chargeId: d.charge, paymentIntentId: d.pi, amount: 500, currency: 'cad', status: 'succeeded', failureReason: null, created: 1 }];
    o.collection.amountRefunded = 500;

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('accepted');

    await capture(event(d));

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('accepted');
    expect((await state(d.id)).certificate).toMatchObject({ succeeded: 500 });

    await due();
    o.refunds[0]!.status = 'failed';
    o.collection.amountRefunded = 0;

    expect(await observeShadowClaim(await claim(), provider(o))).toBe('incomplete');
    expect((await state(d.id)).certificate).toBeNull();
    expect((await db.execute(sql`SELECT facts->>'status' AS status FROM deposit_shadow_object WHERE kind='refund'`)).rows[0]!.status).toBe('failed');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_observation`)).rows[0]!.n).toBe(3);
  });

  it('T03 charge-only receipt serialized with first charge certification on independent connections', async () => {
    const d = await seed();
    const c = await claim();
    const gate = await pool.connect();
    await gate.query('BEGIN');
    await gate.query('SELECT pg_advisory_xact_lock(991234)');
    await db.execute(sql`CREATE FUNCTION d6r1_pause_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='unattributed' THEN PERFORM pg_advisory_xact_lock(991234); END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER d6r1_pause AFTER UPDATE ON deposit_shadow_receipt FOR EACH ROW EXECUTE FUNCTION d6r1_pause_receipt()`);
    const e = event(d, 'charge.dispute.created', 'dp_race');
    delete (e.data.object as { payment_intent?: string }).payment_intent;
    const capturePromise = capture(e);
    try {
      // Wait for the capture connection to hold its account evidence lock and block after unattributed routing, before commit.
      let reached = false;
      for (let spin = 0; spin < 100; spin += 1) {
        const waiting = await gate.query('SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND objid=991234 AND NOT granted');
        if (waiting.rowCount) {
          reached = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2));
      }

      expect(reached).toBe(true);

      const finishing = finalizeShadowObservation(c, observation(d));
      let finalizeBlocked = false;
      let finalizeDone = false;
      void finishing.then(() => {
        finalizeDone = true;
      });
      for (let spin = 0; spin < 100; spin += 1) {
        if (finalizeDone) {
          break;
        }
        const waiting = await gate.query('SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND NOT granted AND objid<>991234');
        if (waiting.rowCount) {
          finalizeBlocked = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2));
      }

      expect((await state(d.id)).certificate).toBeNull();
      expect(finalizeBlocked).toBe(true);

      await gate.query('ROLLBACK');
      await capturePromise;

      expect(await finishing).toBe('stale');
      expect((await state(d.id)).certificate).toBeNull();
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      await db.execute(sql`DROP TRIGGER d6r1_pause ON deposit_shadow_receipt`);
      await db.execute(sql`DROP FUNCTION d6r1_pause_receipt()`);
    }
  });

  it('T05 capped refund or dispute pages never publish a complete certificate', async () => {
    const d = await seed();
    await finalizeShadowObservation(await claim(), observation(d, { pagesComplete: false }));

    expect((await state(d.id)).certificate).toBeNull();

    await due();
    await finalizeShadowObservation(await claim(), observation(d, { disputePagesComplete: false }));

    expect((await state(d.id)).certificate).toBeNull();
  });

  it('T17 provider account and mode mismatch cannot publish facts or certificate', async () => {
    const d = await seed();
    await finalizeShadowObservation(await claim(), observation(d, { account: 'acct_foreign' }));

    expect((await state(d.id)).certificate).toBeNull();
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_object`)).rows[0]!.n).toBe(0);

    await due();
    await finalizeShadowObservation(await claim(), observation(d, { livemode: true }));

    expect((await state(d.id)).certificate).toBeNull();
  });

  it('T09/21 actual purge and group reset preserve shadow evidence without changing legacy decisions', async () => {
    const { purgeSalonData, purgeSalonGroups, assertNoUnsettledDeposits } = await import('@/libs/salonPurge');
    const d = await seed();
    await observeShadowClaim(await claim(), provider(observation(d)));

    await expect(depositsTransaction(db, tx => assertNoUnsettledDeposits(tx, d.salon))).rejects.toThrow();

    // A synthetic old legacy terminal is outside the existing 30-day operational window.
    // The legacy fixture writer changes this, never the shadow observer.
    await db.update(schema.appointmentDepositSchema).set({ status: 'refunded', refundStatus: 'succeeded', refundStatusChangedAt: new Date('2020-01-01'), refundedAt: new Date('2020-01-01'), stripeRefundId: 're_legacy_retention', refundAmountCents: 2500 }).where(eq(schema.appointmentDepositSchema.id, d.id));
    await depositsTransaction(db, tx => assertNoUnsettledDeposits(tx, d.salon));
    await depositsTransaction(db, tx => purgeSalonGroups(tx, d.salon, ['appointments']));

    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_observation`)).rows[0]!.n).toBe(1);

    await depositsTransaction(db, tx => purgeSalonData(tx, d.salon));

    expect((await db.execute(sql`SELECT count(*)::int AS n FROM deposit_shadow_observation`)).rows[0]!.n).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM salon WHERE id=${d.salon}`)).rows[0]!.n).toBe(0);
  });

  it('T02 continuous multi-class noisy backlog cannot starve quiet tenants or discovery', async () => {
    const work = [];
    for (const workClass of ['receipt', 'unresolved', 'discovery']) {
      for (let i = 0; i < 4; i += 1) {
        const d = await seed();
        await db.execute(sql`UPDATE deposit_shadow_state SET work_class=${workClass} WHERE deposit_id=${d.id}`);
        work.push({ ...d, workClass });
      }
    }
    const quiet = await seed('d6r1_quiet');
    const seenClasses = new Set<string>();
    let quietSeen = false;
    for (let round = 0; round < 5; round += 1) {
      const c = await claim();
      if (c.deposit_id === quiet.id) {
        quietSeen = true;
      } else {
        seenClasses.add(work.find(d => d.id === c.deposit_id)!.workClass);
      }
      await finalizeShadowObservation(c, null, 'provider_read_unavailable');
      // Simulate a perpetually noisy account with new dirty work every invocation.
      await db.execute(sql`UPDATE deposit_shadow_state SET next_due_at='2000-01-01' WHERE salon_id=${BASE}`);
    }

    expect(quietSeen).toBe(true);
    expect([...seenClasses].sort()).toEqual(['discovery', 'receipt', 'unresolved']);
  });
});
