/** Genuine PostgreSQL duplicate-observation race; never connects without an explicit disposable loopback target. */
import { isIP } from 'node:net';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: { BILLING_IDENTITY_HMAC_SECRET: undefined, BILLING_IDENTITY_HMAC_VERSION: undefined } }));
vi.mock('@/libs/stripe', () => ({ stripe: { checkout: { sessions: { retrieve: vi.fn() } } } }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

function parseDisposableTarget(raw: string | undefined) {
  try {
    const target = raw ? new URL(raw) : null;
    if (target === null || !['postgres:', 'postgresql:'].includes(target.protocol)
      || target.hostname !== '127.0.0.1' || target.username !== 'qa' || target.password !== ''
      || target.search !== '' || target.hash !== '' || !/^\d+$/.test(target.port)
      || Number(target.port) < 1 || Number(target.port) > 65535
      || !/^\/luster_refund_[a-z0-9_]+$/.test(target.pathname)) {
      return null;
    }
    return { host: '127.0.0.1', port: Number(target.port), user: 'qa', database: target.pathname.slice(1), password: '', ssl: false as const };
  } catch {
    return null;
  }
}
function parseExpectedServerAddress(value: string) {
  const [first, second] = value.split('.').map(Number);
  return isIP(value) === 4 && (first === 127 || first === 10
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
    || (first === 192 && second === 168))
    ? value
    : null;
}
const expectedServerAddress = parseExpectedServerAddress(process.env.SMS_REFUND_EXPECTED_SERVER_ADDRESS ?? '127.0.0.1');
if (expectedServerAddress === null) {
  throw new Error('UNSAFE_SMS_REFUND_EXPECTED_SERVER_ADDRESS');
}

it.each(['8.8.8.8', '0.0.0.0', '169.254.169.254', '::1', 'example.invalid'])('refuses unsafe expected server identity %s', (unsafe) => {
  expect(parseExpectedServerAddress(unsafe)).toBeNull();
});

const raw = process.env.CONCURRENCY_TEST_DATABASE_URL;
const target = parseDisposableTarget(raw);
const safe = target !== null && process.env.SMS_REFUND_DISPOSABLE_DATABASE_CONFIRMED === 'true';
if (raw && !safe) {
  throw new Error('UNSAFE_SMS_REFUND_DATABASE_TARGET');
}
const suite = safe ? describe : describe.skip;

it.each([
  'postgres://qa@127.0.0.1:55432/luster_refund_test?host=remote.invalid',
  'postgres://qa@127.0.0.1:55432/luster_refund_test?user=another',
  'postgres://qa@127.0.0.1:55432/luster_refund_test?sslcert=/tmp/unused',
  'postgres://qa@127.0.0.1:55432/luster_refund_test#fragment',
  'https://qa@127.0.0.1:55432/luster_refund_test',
  'postgres://qa@127.0.0.1/luster_refund_test',
  'postgres://qa:password@127.0.0.1:55432/luster_refund_test',
  'postgres://qa@127.0.0.1:55432/not_disposable',
])('refuses ambiguous or overriding disposable target %s', (unsafe) => {
  expect(parseDisposableTarget(unsafe)).toBeNull();
});

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let executed = 0;
suite('zero-debit refund — genuine purchase/account-lock concurrency', () => {
  beforeAll(async () => {
    if (target === null) {
      throw new Error('DISPOSABLE_TARGET_REQUIRED');
    }
    pool = new pg.Pool({ ...target, password: () => '', max: 5, application_name: 'sms-zero-refund-disposable-test', connectionTimeoutMillis: 3000 });
    const identity = await pool.query<{ database: string; username: string; address: string; port: number }>('SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port');

    expect(identity.rows).toEqual([{ database: target.database, username: target.user, address: expectedServerAddress, port: target.port }]);

    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
  });

  afterAll(async () => {
    await pool?.end();

    expect(executed).toBe(1);

    process.stdout.write(`SMS_ZERO_REFUND_POSTGRES_TESTS_EXECUTED=${executed} SMS_ZERO_REFUND_POSTGRES_TESTS_SKIPPED=0\n`);
  });

  it('four concurrent duplicate/cross-event observations persist one audit and first projection without financial changes', async () => {
    executed += 1;
    await db.insert(schema.salonSchema).values({ id: 's_zero_race', name: 'Synthetic zero refund race', slug: 'synthetic-zero-refund-race' });
    await db.insert(schema.smsTopupPurchaseSchema).values({ id: 'tp_zero_race', salonId: 's_zero_race', credits: 100, amountCents: 2000, topupOfferKey: 'topup_100_paid_2026_08', status: 'paid', stripeCheckoutSessionId: 'cs_zero_race', stripePaymentIntentId: 'pi_zero_race' });
    await db.transaction(async tx => (await import('./creditGrants')).fulfillTopupPurchase(tx, { topupPurchaseId: 'tp_zero_race' }));
    const reservations = await import('./creditReservation');
    const held = await reservations.reserveSmsCredits({ salonId: 's_zero_race', dedupeKey: 'spend_zero_race', segments: 100 });
    if (!held.ok) {
      throw new Error('FIXTURE_RESERVATION_FAILED');
    }
    await reservations.settleReservationOnAccept({ reservationId: held.reservationId, providerSid: 'SM_SYNTHETIC_ZERO_RACE' });
    const beforeLedger = await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, 's_zero_race'));
    const beforeAccount = await db.select().from(schema.smsCreditAccountSchema).where(eq(schema.smsCreditAccountSchema.salonId, 's_zero_race'));
    // Holding the canonical first transaction open guarantees the other pool
    // connections contend on its purchase row, rather than merely run serially.
    let unlock!: () => void;
    let locked!: () => void;
    const lockReached = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const first = db.transaction(async (tx) => {
      const result = await (await import('./creditGrants')).reverseTopup(tx, { topupPurchaseId: 'tp_zero_race', kind: 'refund', stripeRef: 're_zero_race_first', cumulativeRefundedCents: 1000, now: new Date('2026-10-26T12:00:00Z') });
      locked();
      await release;
      return result;
    });
    await lockReached;
    const { applyTopupChargeRefunded } = await import('./topupFulfillment');
    const duplicates = Array.from({ length: 3 }, (_, i) => applyTopupChargeRefunded({ paymentIntentId: 'pi_zero_race', refundId: `re_zero_race_duplicate_${i}`, cumulativeRefundedCents: 1000, now: new Date('2026-10-26T13:00:00Z') }));
    let blocked = 0;
    try {
      const deadline = Date.now() + 3000;
      while (blocked < 3 && Date.now() < deadline) {
        const waiting = await pool.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 'sms-zero-refund-disposable-test' AND wait_event_type = 'Lock'`);
        blocked = Number(waiting.rows[0]!.count);
        if (blocked < 3) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    } finally {
      unlock();
    }

    expect(blocked).toBe(3);

    const results = await Promise.all([first, ...duplicates]);

    expect(results).toEqual(Array.from({ length: 4 }, () => ({ reversed: 0, shortfall: 50, anomaly: null })));

    const audits = await db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, 'tp_zero_race'));
    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema).where(eq(schema.smsTopupPurchaseSchema.id, 'tp_zero_race'));

    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ cumulativeRefundedCents: 1000, targetCredits: 50, reversedCredits: 0, shortfall: 50 });
    expect(purchase).toMatchObject({ status: 'partially_reversed', stripeRefundId: 're_zero_race_first', refundedAt: new Date('2026-10-26T12:00:00Z') });
    expect(await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, 's_zero_race'))).toEqual(beforeLedger);
    expect(await db.select().from(schema.smsCreditAccountSchema).where(eq(schema.smsCreditAccountSchema.salonId, 's_zero_race'))).toEqual(beforeAccount);
    expect(beforeLedger.reduce((sum, row) => sum + row.amount, 0)).toBe(0);
  });
});
