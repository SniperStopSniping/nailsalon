import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DatabaseSessionHandle } from '@/libs/DB';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/Env')>();
  return { Env: { ...actual.Env, BILLING_IDENTITY_HMAC_SECRET: 'founding-local-test-key', BILLING_IDENTITY_HMAC_VERSION: 1, BILLING_STARTER_IDENTITY_READY: 'true' } };
});

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let target: URL | null = null;
try {
  target = rawUrl ? new URL(rawUrl) : null;
} catch {
  target = null;
}
const targetName = target?.pathname.slice(1);
const approved = process.env.CORE_LIFETIME_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  && target !== null
  && ['127.0.0.1', 'localhost'].includes(target.hostname)
  && ((targetName === 'luster_founding_claim_disposable' && target.username === 'founding_claim_qa')
    || (targetName === 'sms_credit_ci' && target.username === 'sms_credit_ci'));
const suite = approved ? describe : describe.skip;
const OPEN_DATE = new Date('2026-10-07T12:00:00Z');
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let executed = 0;

suite('founding lifetime — real PostgreSQL ownership and replay', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: rawUrl, max: 20, application_name: 'luster-founding-claim-test' });
    const { rows } = await pool.query('SELECT current_database() AS name, current_user AS owner, host(inet_server_addr()) AS address');

    expect(rows[0]).toMatchObject({ name: targetName, owner: target!.username });

    if (targetName === 'luster_founding_claim_disposable') {
      expect(['127.0.0.1', '::1']).toContain(rows[0].address);
    }
    database = drizzle(pool, { schema });
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = database;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();

    expect(executed).toBe(7);

    process.stdout.write(`FOUNDING_CORE_POSTGRES_TESTS_EXECUTED=${executed} FOUNDING_CORE_POSTGRES_TESTS_SKIPPED=0\n`);
  });

  async function fixture() {
    const suffix = crypto.randomUUID();
    const adminId = `fl_admin_${suffix}`;
    const salonId = `fl_salon_${suffix}`;
    const siteId = crypto.randomUUID();
    const identity = { clerkUserId: `user_fl_${suffix}`, email: `fl_${suffix}@example.test`, name: 'Founding fixture owner', phoneE164: `+1416${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}` };
    await database.insert(schema.adminUserSchema).values({ id: adminId, clerkUserId: identity.clerkUserId, email: identity.email });
    await database.insert(schema.salonSchema).values({ id: salonId, name: 'Founding fixture salon', slug: salonId });
    await database.insert(schema.adminSalonMembershipSchema).values({ adminId, salonId, role: 'owner' });
    await database.insert(schema.onboardingSiteSchema).values({ id: siteId, salonId, createdByAdminId: adminId, stylePresetId: 'modern', palettePresetId: 'luster_berry' });
    return { adminId, salonId, siteId, identity };
  }

  async function claim(f: Awaited<ReturnType<typeof fixture>>, key: string, now = OPEN_DATE) {
    const { saveOnboardingPlanIntent } = await import('@/features/onboarding-v1-integration/persistence.server');
    return saveOnboardingPlanIntent(f.identity, { siteId: f.siteId, intent: 'founding_interest', idempotencyKey: key }, database as unknown as DatabaseSessionHandle, now);
  }

  async function claims(salonId: string) {
    return database.select().from(schema.foundingLifetimeClaimSchema).where(eq(schema.foundingLifetimeClaimSchema.salonId, salonId));
  }

  it('twelve simultaneous retries create one lifetime claim and one 100-text grant', async () => {
    executed += 1;
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 12 }, () => claim(f, 'same-retry-key')));

    expect(new Set(results.map(r => r.coreAccess?.claimedAt)).size).toBe(1);
    expect(results.every(r => r.coreAccess?.status === 'active')).toBe(true);
    expect(await claims(f.salonId)).toHaveLength(1);

    const lots = await database.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, f.salonId));

    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ amount: 100, bucket: 'starter' });
  });

  it('different retry keys converge and a later reload keeps lifetime rights after the deadline', async () => {
    executed += 1;
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => claim(f, `retry-${i}`)));
    const replay = await claim(f, 'after-cutoff', new Date('2030-01-01T00:00:00Z'));

    expect(replay.coreAccess).toEqual(results[0]!.coreAccess);
    expect(await claims(f.salonId)).toHaveLength(1);

    const { getFoundingLifetimeAccess } = await import('./foundingLifetime.server');

    expect(await getFoundingLifetimeAccess(f.salonId)).toEqual(replay.coreAccess);
  });

  it('denies a different owner and an admin-only member without writing a claim', async () => {
    executed += 1;
    const owner = await fixture();
    const other = await fixture();

    await expect(claim({ ...owner, identity: other.identity }, 'cross-owner')).rejects.toMatchObject({ code: 'SITE_NOT_FOUND' });

    await database.insert(schema.adminSalonMembershipSchema).values({ adminId: other.adminId, salonId: owner.salonId, role: 'admin' });

    await expect(claim({ ...owner, identity: other.identity }, 'admin-only')).rejects.toMatchObject({ code: 'SITE_NOT_FOUND' });
    expect(await claims(owner.salonId)).toHaveLength(0);
  });

  it('rechecks owner membership after a concurrent revocation releases its lock', async () => {
    executed += 1;
    const f = await fixture();
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('UPDATE admin_salon_membership SET role = \'admin\' WHERE admin_id = $1 AND salon_id = $2', [f.adminId, f.salonId]);
      const pending = claim(f, 'revoked-owner').then(value => ({ value, error: null }), error => ({ value: null, error }));
      await vi.waitFor(async () => {
        const { rows } = await pool.query('SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name = \'luster-founding-claim-test\' AND wait_event_type = \'Lock\'');

        expect(rows[0].waiting).toBeGreaterThan(0);
      }, { timeout: 5_000 });
      await blocker.query('COMMIT');

      expect((await pending).error).toMatchObject({ code: 'SITE_NOT_FOUND' });
      expect(await claims(f.salonId)).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });

  it('serializes conflicting legacy and founding intents on the same request key', async () => {
    executed += 1;
    const f = await fixture();
    const { saveOnboardingPlanIntent } = await import('@/features/onboarding-v1-integration/persistence.server');
    const results = await Promise.allSettled([
      claim(f, 'conflicting-key'),
      saveOnboardingPlanIntent(f.identity, { siteId: f.siteId, intent: 'free', idempotencyKey: 'conflicting-key' }, database as unknown as DatabaseSessionHandle, OPEN_DATE),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);

    const failure = results.find(r => r.status === 'rejected');

    expect(failure?.status === 'rejected' && failure.reason).toMatchObject({ code: 'PLAN_INTENT_IDEMPOTENCY_CONFLICT' });

    const [site] = await database.select().from(schema.onboardingSiteSchema).where(eq(schema.onboardingSiteSchema.id, f.siteId));

    expect(await claims(f.salonId)).toHaveLength(site?.planIntent === 'founding_interest' ? 1 : 0);
  });

  it('preserves purchased texts, meters later SMS normally and still permits an optional top-up', async () => {
    executed += 1;
    const f = await fixture();
    const { appendLotGrant, computeAvailableBalance, lockCreditAccount } = await import('./creditLedger');
    await database.transaction(async (tx) => {
      await lockCreditAccount(tx, f.salonId);
      await appendLotGrant(tx, { salonId: f.salonId, bucket: 'purchased', amount: 250, expiresAt: null, idempotencyKey: `fixture-purchase-${f.salonId}`, reason: 'isolated_fixture' });
    });
    await claim(f, 'preserve-purchased');
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    const reservation = await reserveSmsCredits({ salonId: f.salonId, dedupeKey: `fixture-sms-${f.salonId}`, segments: 3 });
    if (!reservation.ok) {
      throw new Error('Expected funded reservation.');
    }
    await settleReservationOnAccept({ reservationId: reservation.reservationId, providerSid: `SM_fixture_${f.salonId}` });
    const balance = await database.transaction(tx => computeAvailableBalance(tx, f.salonId, new Date()));

    expect(balance.available).toBe(347);

    const { beginCheckoutAttempt } = await import('./checkoutAttempts');
    const attempt = await database.transaction(tx => beginCheckoutAttempt(tx, { salonId: f.salonId, purpose: 'sms_topup', topupOfferKey: 'fixture-topup' }));

    expect(attempt.ok).toBe(true);
    expect(await database.select().from(schema.billingSubscriptionSchema).where(eq(schema.billingSubscriptionSchema.salonId, f.salonId))).toHaveLength(0);
  });

  it('refuses an expired new claim without writing intent, pricing rights or credits', async () => {
    executed += 1;
    const f = await fixture();

    await expect(claim(f, 'expired-new', new Date('2027-01-02T05:00:00Z'))).rejects.toMatchObject({ code: 'FOUNDING_OFFER_CLOSED' });
    expect(await claims(f.salonId)).toHaveLength(0);
    expect(await database.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, f.salonId))).toHaveLength(0);

    const [site] = await database.select().from(schema.onboardingSiteSchema).where(eq(schema.onboardingSiteSchema.id, f.siteId));

    expect(site?.planIntent).toBeNull();
  });
});
