/**
 * Dispatcher claim/lease/linearization integrity under GENUINE concurrency.
 *
 * PGlite runs on a single connection, so it cannot prove the claim CTE,
 * the claimed→sending CAS, or the STOP linearization hold under a real
 * race. This suite drives the real pipeline against a throwaway
 * PostgreSQL server over a real connection pool.
 *
 * Opt-in and refuses to run against anything that is not an explicitly
 * local/CI throwaway database — the project's "tests never touch a real
 * database" guarantee is preserved.
 *
 *   docker run -d --name luster-qa-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=qa \
 *     -e POSTGRES_DB=luster_qa -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa@127.0.0.1:55432/luster_qa \
 *     npx vitest run src/libs/communicationDispatcher.concurrency.integration.test.ts
 */
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  COMMUNICATIONS_SMS_ENABLED: 'true' as string | undefined,
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111' as string | undefined,
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000' as string | undefined,
  TWILIO_AUTH_TOKEN: 'token' as string | undefined,
  LUSTER_SMS_SENDER_IDENTITY: undefined as string | undefined,
  SMS_PILOT_ENABLED: undefined as string | undefined,
  SMS_PILOT_SALON_ALLOWLIST: undefined as string | undefined,
  LUSTER_SHORT_LINK_ORIGIN: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined as number | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

vi.mock('@/libs/communicationRateLimit.server', () => ({
  checkSharedSendRateLimits: vi.fn(async () => ({ allowed: true })),
}));

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedUrl: URL | null = null;
try {
  parsedUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedUrl = null;
}
const parsedDb = parsedUrl ? decodeURIComponent(parsedUrl.pathname).replace(/^\//, '') : '';
const disposableConfirmed
  = process.env.COMMUNICATIONS_DISPATCH_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (parsedDb === 'luster_qa' && parsedUrl?.username === 'qa');
const isLocalThrowaway
  = parsedUrl !== null
  && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  && parsedDb.length > 0
  && disposableConfirmed
  && !RAW_URL.includes('neon.tech');

const suite = isLocalThrowaway ? describe : describe.skip;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-08-17T12:00:00.000Z');

suite('dispatcher — real-lock concurrency matrix', () => {
  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: RAW_URL,
      max: 30,
      application_name: 'gate-b-dispatch-concurrency-test',
    });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE salon CASCADE;
      TRUNCATE sms_global_consent_event RESTART IDENTITY;
      UPDATE platform_communication_control SET sms_enabled = true WHERE id = 'singleton';
    `);
    const { __clearCommunicationControlCache } = await import('./platformCommunicationControl');
    __clearCommunicationControlCache();
  });

  afterAll(async () => {
    await pool?.end();
  });

  let seq = 0;

  async function seedSalon(): Promise<{ salonId: string; recipient: string }> {
    seq += 1;
    const salonId = `cs_${seq}`;
    const recipient = `416555${String(2000 + seq)}`;
    await db.insert(schema.salonSchema).values({ id: salonId, name: `C${seq}`, slug: `conc-${seq}` });
    await db.insert(schema.communicationConsentSchema).values({
      id: `cc_${salonId}`,
      salonId,
      recipient,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: 'granted',
      wordingVersion: 'test-v1',
      source: 'test',
      grantedAt: NOW,
    });
    const { appendLotGrant, lockCreditAccount } = await import('./billing/creditLedger');
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, salonId);
      await appendLotGrant(tx, {
        salonId,
        bucket: 'purchased',
        amount: 20,
        expiresAt: null,
        idempotencyKey: `seed_${salonId}`,
        reason: 'seed',
      });
    });
    return { salonId, recipient };
  }

  async function enqueue(salonId: string, recipient: string, key?: string) {
    const { enqueueCommunicationIntent } = await import('./communicationIntent');
    return enqueueCommunicationIntent({
      salonId,
      channel: 'sms',
      eventType: 'booking_confirmation',
      audience: 'client',
      dedupeKey: key ?? `conc:${salonId}:${crypto.randomUUID()}`,
      recipient,
      destinationCountry: 'CA',
      templateKey: 'client_booking_confirmation_shortlink',
      templateVersion: 'v1',
      variables: { startTime: 'Wed Aug 26, 12:30 PM', manageUrl: 'https://islanailsalon.com/a/AbCdEfGhIjKlMnOpQrStUv' },
      schedulingRevision: 'rev1',
      scheduledFor: new Date(Date.now() - 1000),
      notAfter: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
  }

  it('ten workers race on one due intent: exactly one claim, one provider call', async () => {
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { salonId, recipient } = await seedSalon();
    await enqueue(salonId, recipient);

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      claimDueIntents({ workerId: `w${i}`, batchLimit: 10, perSalonLimit: 1 })));
    const claimed = results.flat();

    expect(claimed).toHaveLength(1);

    const providerSend = vi.fn(async () => ({ sid: `SM_conc_${seq}` }));
    await dispatchClaimedIntent(claimed[0]!, providerSend);

    expect(providerSend).toHaveBeenCalledTimes(1);

    const debits = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = $1 AND amount < 0`,
      [salonId],
    );

    expect(debits.rows[0].n).toBe(1);
  });

  it('per-salon in-flight cap holds under a claim storm: one salon never has two live claims', async () => {
    const { claimDueIntents } = await import('./communicationIntent');
    const { salonId, recipient } = await seedSalon();
    await Promise.all(Array.from({ length: 5 }, () => enqueue(salonId, recipient)));

    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      claimDueIntents({ workerId: `storm${i}`, batchLimit: 10, perSalonLimit: 1 })));
    const claimed = results.flat().filter(row => row.salonId === salonId);

    // The NOT EXISTS in-flight guard + status CAS admit at most one claim for
    // the salon; racing workers may interleave to zero-or-one, never two.
    expect(claimed.length).toBeLessThanOrEqual(1);

    const live = await pool.query(
      `SELECT COUNT(*)::int AS n FROM communication_intent WHERE salon_id = $1 AND status IN ('claimed','sending')`,
      [salonId],
    );

    expect(live.rows[0].n).toBeLessThanOrEqual(1);

    const ids = new Set(claimed.map(row => row.id));

    expect(ids.size).toBe(claimed.length);
  });

  it('concurrent dispatch of the SAME claimed intent: the claimed→sending CAS admits exactly one provider call', async () => {
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { salonId, recipient } = await seedSalon();
    await enqueue(salonId, recipient);
    const [intent] = await claimDueIntents({ workerId: 'dup', batchLimit: 1, perSalonLimit: 1 });

    expect(intent).toBeDefined();

    const providerSend = vi.fn(async () => ({ sid: `SM_dup_${seq}` }));
    const outcomes = await Promise.all([
      dispatchClaimedIntent(intent!, providerSend),
      dispatchClaimedIntent(intent!, providerSend),
    ]);

    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(outcomes.filter(outcome => outcome === 'sent')).toHaveLength(1);

    const debits = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = $1 AND amount < 0`,
      [salonId],
    );

    expect(debits.rows[0].n).toBe(1);
  });

  it('expired SENDING lease under concurrent recovery: send_outcome_unknown exactly once, never reclaimed', async () => {
    const { claimDueIntents, recoverExpiredLeases } = await import('./communicationIntent');
    const { salonId, recipient } = await seedSalon();
    await enqueue(salonId, recipient);
    const [intent] = await claimDueIntents({ workerId: 'crash', batchLimit: 1, perSalonLimit: 1 });
    await pool.query(
      `UPDATE communication_intent SET status = 'sending', lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [intent!.id],
    );

    const recoveries = await Promise.all(Array.from({ length: 5 }, () => recoverExpiredLeases()));
    const totalUnknown = recoveries.reduce((sum, r) => sum + r.unknownOutcome, 0);

    expect(totalUnknown).toBe(1);

    const row = await pool.query(`SELECT status FROM communication_intent WHERE id = $1`, [intent!.id]);

    expect(row.rows[0].status).toBe('send_outcome_unknown');

    // A crashed-mid-send intent must never re-enter the claim pool.
    const reclaimed = await claimDueIntents({ workerId: 'after', batchLimit: 10, perSalonLimit: 1 });

    expect(reclaimed.filter(r => r.id === intent!.id)).toHaveLength(0);
  });

  it('STOP racing a dispatch linearizes: at most one acceptance, and the NEXT send is always suppressed', async () => {
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { appendGlobalConsentEvent } = await import('./smsConsentShared');
    const { salonId, recipient } = await seedSalon();
    await enqueue(salonId, recipient, `stop-race:${salonId}:1`);
    const [intent] = await claimDueIntents({ workerId: 'race', batchLimit: 1, perSalonLimit: 1 });
    const providerSend = vi.fn(async () => ({ sid: `SM_race_${seq}` }));

    const [outcome] = await Promise.all([
      dispatchClaimedIntent(intent!, providerSend),
      appendGlobalConsentEvent({
        senderIdentity: 'luster_shared_v1',
        recipient,
        state: 'suppressed',
        keywordClassification: 'stop',
        source: 'twilio_inbound',
      }),
    ]);

    // Honest linearization (§10.8a): either the STOP won (released, provider
    // never called) or the acceptance won (exactly one call, message stands).
    if (outcome === 'suppressed') {
      expect(providerSend).not.toHaveBeenCalled();
    } else {
      expect(outcome).toBe('sent');
      expect(providerSend).toHaveBeenCalledTimes(1);
    }

    // Whichever side won, every SUBSEQUENT send to the recipient suppresses.
    await enqueue(salonId, recipient, `stop-race:${salonId}:2`);
    const [next] = await claimDueIntents({ workerId: 'after-stop', batchLimit: 1, perSalonLimit: 1 });

    expect(next).toBeDefined();

    const nextSend = vi.fn(async () => ({ sid: 'SM_never' }));

    expect(await dispatchClaimedIntent(next!, nextSend)).toBe('suppressed');
    expect(nextSend).not.toHaveBeenCalled();
  });
});
