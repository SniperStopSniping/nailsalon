/**
 * Genuine review-automation races against an attested disposable PostgreSQL
 * pool. PGlite has one physical session and cannot prove advisory/row locks.
 *
 * CONCURRENCY_TEST_DATABASE_URL=postgres://... \
 * LUSTER_DISPOSABLE_DATABASE=true \
 * npx vitest run src/libs/reviewRequests.concurrency.integration.test.ts
 */
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (!rawUrl && process.env.REVIEW_REQUEST_AUTOMATION_PG_REQUIRED === 'true') {
  throw new Error('Review automation PostgreSQL gate requires an attested disposable target.');
}
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: true,
}));

const completion = new Date('2030-09-12T19:30:00.000Z');
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
let executedCases = 0;

async function seed(input: { salonId?: string; clientId?: string; startTime?: Date; suppressed?: boolean } = {}) {
  sequence += 1;
  const salonId = input.salonId ?? `review-pg-salon-${sequence}`;
  const clientId = input.clientId ?? `review-pg-client-${sequence}`;
  const appointmentId = `review-pg-appointment-${sequence}`;
  const phone = `416555${String(1000 + sequence).padStart(4, '0')}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    slug: salonId,
    name: `Review PG ${sequence}`,
    settings: { communications: { sms: { enabled: true } }, booking: { timezone: 'America/Toronto' } } as never,
  }).onConflictDoNothing();
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Sarah Client', phone, reviewRequestsSuppressed: input.suppressed ?? false });
  await db.insert(schema.communicationConsentSchema).values({
    id: `review-pg-consent-${sequence}`,
    salonId,
    recipient: phone,
    channel: 'sms',
    purpose: 'appointment_transactional',
    status: 'granted',
    source: 'test',
    wordingVersion: 'test-v1',
  });
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    salonClientId: clientId,
    clientName: 'Sarah Client',
    clientPhone: phone,
    startTime: input.startTime ?? new Date(completion.getTime() - 3_600_000),
    endTime: completion,
    status: 'completed',
    completedAt: completion,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: 'https://g.page/r/luster-review',
    automaticReviewRequests: true,
    reviewRequestsEnabledAt: new Date('2030-09-01T00:00:00.000Z'),
    reviewRequestDelayMinutes: 60,
  });
  return { salonId, clientId, appointmentId };
}

(target ? describe : describe.skip)('review request automation — attested PostgreSQL races', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing attested disposable target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 12, application_name: 'review-request-automation-concurrency' });
    const connection = await pool.connect();
    try {
      await attestDisposableDatabaseSession(connection, target, resolveDisposableDatabaseServerExpectation(target));
    } finally {
      connection.release();
    }
    db = drizzle(pool, { schema });
    holder.db = db;
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 30_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE salon CASCADE; TRUNCATE sms_global_consent_event RESTART IDENTITY;');
    sequence = 0;
  });

  afterEach(() => {
    executedCases += 1;
  });

  afterAll(async () => pool?.end());

  it('executes only after disposable-session attestation', () => {
    expect(target?.databaseName).toBe('luster_e2e_ci_disposable');
  });

  it('rolls back with completion and deduplicates concurrent producer replays', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { recordCompletedReviewTrigger } = await import('./reviewRequests.server');

    await expect(db.transaction(async (tx) => {
      await recordCompletedReviewTrigger(tx, appointment!, completion);
      throw new Error('ROLLBACK');
    })).rejects.toThrow('ROLLBACK');
    expect(await db.select().from(schema.reviewRequestTriggerSchema)).toEqual([]);

    await Promise.all([db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion)), db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion))]);

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toHaveLength(1);
  });

  it('linearizes two materializers and a simultaneous manual request to one request/intent', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { lockSalonReviewMutation, materializeCompletedReviewTriggers, recordCompletedReviewTrigger, scheduleReviewRequest } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    await Promise.all([
      materializeCompletedReviewTriggers({ database: db, now: completion }),
      materializeCompletedReviewTriggers({ database: db, now: completion }),
      db.transaction(async (tx) => {
        await lockSalonReviewMutation(tx, fixture.salonId);
        await scheduleReviewRequest(tx, fixture.salonId, fixture.appointmentId, false);
      }),
    ]);
    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(requests).toHaveLength(1);
    expect(await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, fixture.salonId))).toHaveLength(1);
  });

  it('defers behind a held salon review fence, then materializes after release', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`review-mutation:${fixture.salonId}`]);
      const blocked = await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });

      expect(blocked.deferred).toBe(1);
      expect(await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toHaveLength(0);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });

    expect(await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toHaveLength(1);
  });

  it('skips rescheduled and suppressed triggers, and processes independent salons fairly', async () => {
    const first = await seed();
    const second = await seed();
    const [firstAppointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, first.appointmentId));
    const [secondAppointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, second.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger, setReviewSuppression } = await import('./reviewRequests.server');
    await Promise.all([db.transaction(tx => recordCompletedReviewTrigger(tx, firstAppointment!, completion)), db.transaction(tx => recordCompletedReviewTrigger(tx, secondAppointment!, completion))]);
    await db.update(schema.appointmentSchema).set({ startTime: new Date(completion.getTime() - 7_200_000) }).where(eq(schema.appointmentSchema.id, first.appointmentId));
    await setReviewSuppression(second.salonId, second.clientId, true);
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });
    const triggers = await db.select().from(schema.reviewRequestTriggerSchema).where(and(eq(schema.reviewRequestTriggerSchema.state, 'skipped'), eq(schema.reviewRequestTriggerSchema.kind, 'completed')));

    expect(triggers.map(row => row.reasonCode).sort()).toEqual(['APPOINTMENT_CHANGED', 'CLIENT_SUPPRESSED']);
  });

  it('defers on an appointment NOWAIT collision without retiming due or expiry', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    const [before] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId));
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from appointment where id = $1 for update', [fixture.appointmentId]);

      expect((await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 })).deferred).toBe(1);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    const [after] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.id, before!.id));

    expect(after).toMatchObject({ scheduledFor: before!.scheduledFor, expiresAt: before!.expiresAt });
    expect(after!.availableAt.getTime()).toBeGreaterThan(completion.getTime());
  });

  it('backs off a missing client link without retiming due or expiry', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    const [before] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId));
    await db.update(schema.appointmentSchema).set({ salonClientId: null }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));

    expect((await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 })).deferred).toBe(1);

    const [after] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.id, before!.id));

    expect(after).toMatchObject({ state: 'pending', scheduledFor: before!.scheduledFor, expiresAt: before!.expiresAt });
    expect(after!.availableAt.getTime()).toBeGreaterThan(completion.getTime());
  });

  afterAll(() => {
    expect(executedCases).toBe(7);

    process.stdout.write('REVIEW_REQUEST_POSTGRES_TESTS_EXECUTED=7 REVIEW_REQUEST_POSTGRES_TESTS_SKIPPED=0\n');
  });
});
