/**
 * Repeat-review admission needs real PostgreSQL transactions: PGlite has one
 * physical session and cannot prove the salon fence or interleaved writers.
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (!rawUrl && process.env.REVIEW_REPEAT_PG_REQUIRED === 'true') {
  throw new Error('Review repeat PostgreSQL gate requires an attested disposable target.');
}
const target = rawUrl ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl }) : null;

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
const holdEnqueue = vi.hoisted(() => ({ eventType: null as string | null, entered: null as null | ((pid: number) => void), release: null as null | Promise<void> }));
const enqueueRace = vi.hoisted(() => ({
  mode: null as null | 'manual-first' | 'review-first',
  manualStarted: null as null | (() => void),
  reviewStarted: null as null | (() => void),
  manualFinished: null as null | (() => void),
  reviewFinished: null as null | (() => void),
  waitForManual: null as null | Promise<void>,
  waitForReview: null as null | Promise<void>,
  waitForManualFinished: null as null | Promise<void>,
  waitForReviewFinished: null as null | Promise<void>,
}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
}, usesRuntimePostgres: true }));
vi.mock('@/libs/communicationIntent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/communicationIntent')>();
  return {
    ...actual,
    enqueueCommunicationIntent: async (input: Parameters<typeof actual.enqueueCommunicationIntent>[0]) => {
      if (!enqueueRace.mode) {
        const result = await actual.enqueueCommunicationIntent(input);
        if (holdEnqueue.eventType === input.eventType) {
          const pid = await input.database!.execute(sql`select pg_backend_pid() as pid`);
          const backendPid = Number(pid.rows[0]?.pid);
          if (!Number.isInteger(backendPid)) {
            throw new TypeError('Missing enqueue transaction backend PID');
          }
          holdEnqueue.entered?.(backendPid);
          await bounded(holdEnqueue.release!, 2500);
        }
        return result;
      }
      const review = input.eventType === 'review_request';
      if (review) {
        enqueueRace.reviewStarted?.();
        if (enqueueRace.mode === 'manual-first') {
          await bounded(enqueueRace.waitForManualFinished!, 2500);
        } else {
          await bounded(enqueueRace.waitForManual!, 2500);
        }
      } else {
        enqueueRace.manualStarted?.();
        if (enqueueRace.mode === 'review-first') {
          await bounded(enqueueRace.waitForReviewFinished!, 2500);
        } else {
          await bounded(enqueueRace.waitForReview!, 2500);
        }
      }
      const result = await actual.enqueueCommunicationIntent(input);
      if (review) {
        enqueueRace.reviewFinished?.();
      } else {
        enqueueRace.manualFinished?.();
      }
      return result;
    },
  };
});

const NOW = new Date('2030-09-19T16:00:00.000Z');
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
let executed = 0;

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Review test barrier timed out')), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReviewWaiter(pid: number) {
  const deadline = performance.now() + 800;
  while (performance.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(`
      select exists (select 1 from pg_stat_activity
        where datname = current_database()
          and application_name = current_setting('application_name')
          and $1 = any(pg_blocking_pids(pid))
          and query like '%pg_advisory_xact_lock%') as blocked
    `, [pid]);
    if (result.rows[0]?.blocked) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Manual review did not reach the held salon fence');
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function armLateEnqueueRace(mode: 'manual-first' | 'review-first') {
  const manualStarted = deferred();
  const reviewStarted = deferred();
  const manualFinished = deferred();
  const reviewFinished = deferred();
  Object.assign(enqueueRace, {
    mode,
    manualStarted: manualStarted.resolve,
    reviewStarted: reviewStarted.resolve,
    manualFinished: manualFinished.resolve,
    reviewFinished: reviewFinished.resolve,
    waitForManual: manualStarted.promise,
    waitForReview: reviewStarted.promise,
    waitForManualFinished: manualFinished.promise,
    waitForReviewFinished: reviewFinished.promise,
  });
}

function disarmLateEnqueueRace() {
  enqueueRace.manualStarted?.();
  enqueueRace.reviewStarted?.();
  enqueueRace.manualFinished?.();
  enqueueRace.reviewFinished?.();
  Object.assign(enqueueRace, {
    mode: null,
    manualStarted: null,
    reviewStarted: null,
    manualFinished: null,
    reviewFinished: null,
    waitForManual: null,
    waitForReview: null,
    waitForManualFinished: null,
    waitForReviewFinished: null,
  });
}

async function seed() {
  const seedNumber = ++sequence;
  const salonId = `repeat-pg-salon-${seedNumber}`;
  const clientId = `repeat-pg-client-${seedNumber}`;
  const otherClientId = `repeat-pg-other-client-${seedNumber}`;
  const recipient = `416555${String(8000 + seedNumber).padStart(4, '0')}`;
  const appointmentId = `repeat-pg-appointment-${seedNumber}`;
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Repeat PG', settings: { communications: { sms: { enabled: true } }, booking: { timezone: 'America/Toronto' } } as never });
  await db.insert(schema.salonClientSchema).values([
    { id: clientId, salonId, fullName: 'Ava', phone: recipient },
    { id: otherClientId, salonId, fullName: 'Bea', phone: `+1 ${recipient}` },
  ]);
  await db.insert(schema.communicationConsentSchema).values([
    { id: `repeat-consent-${seedNumber}-a`, salonId, recipient, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' },
    { id: `repeat-consent-${seedNumber}-b`, salonId, recipient: `+1 ${recipient}`, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' },
  ]);
  await db.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, salonClientId: otherClientId, clientName: 'Bea', clientPhone: `+1 ${recipient}`, startTime: new Date(NOW.getTime() - 3_600_000), endTime: NOW, completedAt: NOW, status: 'completed', totalPrice: 5000, totalDurationMinutes: 60 });
  await db.insert(schema.salonRetentionSettingsSchema).values({ salonId, googleReviewUrl: 'https://g.page/r/repeat', automaticReviewRequests: true, reviewRequestAutomationMode: 'marked_completed', reviewRequestsEnabledAt: new Date('2030-01-01T00:00:00.000Z'), reviewRequestDelayMinutes: 0, reviewRequestRepeatCooldownDays: 90 });
  return { salonId, clientId, otherClientId, appointmentId, recipient };
}

(target ? describe : describe.skip)('review repeat cooldown — attested PostgreSQL', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Missing attested disposable target');
    }
    pool = new pg.Pool({ connectionString: target.connectionString, max: 8 });
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
    await pool.query('TRUNCATE salon CASCADE; TRUNCATE sms_global_consent_event RESTART IDENTITY');
    sequence = 0;
    disarmLateEnqueueRace();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    executed += 1;
  });

  afterAll(async () => {
    await pool?.end();

    expect(executed).toBe(9);

    process.stdout.write('REVIEW_REPEAT_POSTGRES_TESTS_EXECUTED=9 REVIEW_REPEAT_POSTGRES_TESTS_SKIPPED=0\n');
  });

  it('runs only on the attested disposable database and observes its URL-owned application name', async () => {
    const row = await pool.query<{ application_name: string }>('select current_setting(\'application_name\') as application_name');

    expect(target?.databaseName).toBe('luster_e2e_ci_disposable');
    expect(row.rows[0]?.application_name).toBe(target?.applicationName);
  });

  it('admits the finite 90-day boundary, while an isolated legacy policy remains never-repeat', async () => {
    const fixture = await seed();
    const { queueClientReviewRequest } = await import('./reviewRequests.server');
    await queueClientReviewRequest({ salonId: fixture.salonId, clientId: fixture.clientId, message: 'Please review', requestId: 'first', now: NOW });
    const [first] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: new Date(NOW.getTime() - 90 * 86_400_000 + 1) }).where(eq(schema.communicationIntentSchema.id, first!.intentId));

    await expect(queueClientReviewRequest({ salonId: fixture.salonId, clientId: fixture.clientId, message: 'Too early', requestId: 'just-before', now: NOW })).rejects.toMatchObject({ code: 'REVIEW_ALREADY_REQUESTED' });

    await db.update(schema.communicationIntentSchema).set({ resolvedAt: new Date(NOW.getTime() - 90 * 86_400_000) }).where(eq(schema.communicationIntentSchema.id, first!.intentId));

    await expect(queueClientReviewRequest({ salonId: fixture.salonId, clientId: fixture.clientId, message: 'Please review again', requestId: 'boundary', now: NOW })).resolves.toMatchObject({ created: true });

    const legacy = await seed();
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: null }).where(eq(schema.salonRetentionSettingsSchema.salonId, legacy.salonId));
    await queueClientReviewRequest({ salonId: legacy.salonId, clientId: legacy.clientId, message: 'Legacy first', requestId: 'legacy-first', now: NOW });
    const [legacyRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, legacy.salonId));
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: new Date('2030-01-01T00:00:00.000Z') }).where(eq(schema.communicationIntentSchema.id, legacyRequest!.intentId));

    await expect(queueClientReviewRequest({ salonId: legacy.salonId, clientId: legacy.clientId, message: 'Never again', requestId: 'legacy-never', now: new Date('2040-09-19T16:00:00.000Z') })).rejects.toMatchObject({ code: 'REVIEW_ALREADY_REQUESTED' });
  });

  it.each(['manual-first', 'review-first'] as const)('serializes an actual completion trigger materializer and a manual review writer (%s)', async (order) => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, queueClientReviewRequest, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, NOW));
    const release = deferred();
    let enter!: (pid: number) => void;
    const entered = new Promise<number>((resolve) => {
      enter = resolve;
    });
    Object.assign(holdEnqueue, { eventType: 'review_request', entered: enter, release: release.promise });
    const manual = () => queueClientReviewRequest({ salonId: fixture.salonId, clientId: fixture.clientId, message: 'Review us', requestId: `manual-race-${order}`, now: NOW });
    const materialize = () => materializeCompletedReviewTriggers({ database: db, now: NOW });
    const first = order === 'manual-first' ? manual() : materialize();
    const tasks: Promise<unknown>[] = [first];
    // Attach rejection handling immediately; final assertions inspect outcomes.
    const firstResult = first.then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
    try {
      const pid = await bounded(entered, 2000);
      // Future enqueue calls must not re-enter the one-shot held transaction.
      holdEnqueue.eventType = null;
      if (order === 'manual-first') {
        expect(await materialize()).toMatchObject({ deferred: 1, materialized: 0 });

        release.resolve();

        expect(await firstResult).toMatchObject({ status: 'fulfilled', value: { created: true } });

        const [afterContention] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId));

        expect(afterContention!.state).toBe('pending');
        expect(await materializeCompletedReviewTriggers({ database: db, now: afterContention!.availableAt })).toMatchObject({ deferred: 1, materialized: 0 });

        const [afterPending] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId));

        expect(afterPending!.state).toBe('pending');
        expect(afterPending!.availableAt.getTime()).toBeGreaterThan(afterContention!.availableAt.getTime());
        expect(afterPending!.scheduledFor).toEqual(afterContention!.scheduledFor);
        expect(afterPending!.expiresAt).toEqual(afterContention!.expiresAt);

        await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: afterPending!.availableAt }).where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

        expect(await materializeCompletedReviewTriggers({ database: db, now: afterPending!.availableAt })).toMatchObject({ skipped: 1, materialized: 0 });
      } else {
        const second = manual();
        tasks.push(second);
        const secondResult = second.then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
        await waitForReviewWaiter(pid);
        release.resolve();

        expect(await firstResult).toMatchObject({ status: 'fulfilled', value: { materialized: 1 } });
        expect(await secondResult).toMatchObject({ status: 'rejected', reason: { code: 'REVIEW_ALREADY_REQUESTED' } });
      }
      const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
      const triggers = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId));
      const intents = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

      expect(requests).toHaveLength(1);
      expect(intents).toHaveLength(1);
      expect(requests[0]).toMatchObject({ source: order === 'manual-first' ? 'manual' : 'automatic', intentId: intents[0]!.id });
      expect(triggers[0]).toMatchObject(order === 'manual-first' ? { state: 'skipped', reasonCode: 'EXISTING_REQUEST' } : { state: 'materialized' });
    } finally {
      release.resolve();
      Object.assign(holdEnqueue, { eventType: null, entered: null, release: null });
      await Promise.allSettled(tasks);
    }
  });

  it.each(['manual-first', 'review-first'] as const)('rejects a late ordinary-SMS/Google cross-purpose action collision after both early reads (%s)', async (order) => {
    const fixture = await seed();
    const { queueClientSms } = await import('./clientMessaging');
    armLateEnqueueRace(order);
    const tasks = [
      queueClientSms({ salonId: fixture.salonId, clientId: fixture.clientId, message: 'Appointment update', requestId: `cross-${order}`, now: NOW }),
      queueClientSms({ salonId: fixture.salonId, clientId: fixture.otherClientId, purpose: 'google_review', message: 'Review us', requestId: `cross-${order}`, now: NOW }),
    ];
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await bounded(Promise.allSettled(tasks), 4000);
    } finally {
      disarmLateEnqueueRace();
      await Promise.allSettled(tasks);
    }

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')[0]).toMatchObject({ reason: { code: 'IDEMPOTENCY_CONFLICT' } });

    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    const intents = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

    expect(intents).toHaveLength(1);
    expect(intents[0]?.eventType).toBe(order === 'manual-first' ? 'manual_text' : 'review_request');

    if (order === 'review-first') {
      expect(requests[0]?.intentId).toBe(intents[0]!.id);
    }

    expect(requests).toHaveLength(intents[0]?.eventType === 'review_request' ? 1 : 0);
    expect(requests[0]?.clientId ?? fixture.clientId).toBe(intents[0]?.eventType === 'review_request' ? fixture.otherClientId : fixture.clientId);
  });

  it('keeps legacy marked-sent history, owner reports, STOP, and unknown outcomes blocking', async () => {
    const { queueClientReviewRequest } = await import('./reviewRequests.server');
    const ownerReported = await seed();
    await db.insert(schema.clientCommunicationSchema).values({
      id: `repeat-legacy-marked-${sequence}`,
      salonId: ownerReported.salonId,
      salonClientId: ownerReported.otherClientId,
      kind: 'google_review',
      status: 'marked_sent',
      markedSentAt: new Date(NOW.getTime() - 86400000),
      destinationSnapshot: ownerReported.recipient,
    });

    await expect(queueClientReviewRequest({ salonId: ownerReported.salonId, clientId: ownerReported.clientId, message: 'Blocked', requestId: 'owner-reported', now: NOW })).rejects.toMatchObject({ code: 'REVIEW_INELIGIBLE' });

    await db.update(schema.clientCommunicationSchema).set({ markedSentAt: new Date('2020-09-19T16:00:00.000Z') }).where(eq(schema.clientCommunicationSchema.salonId, ownerReported.salonId));
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: null }).where(eq(schema.salonRetentionSettingsSchema.salonId, ownerReported.salonId));

    await expect(queueClientReviewRequest({ salonId: ownerReported.salonId, clientId: ownerReported.clientId, message: 'Blocked forever', requestId: 'owner-never', now: NOW })).rejects.toMatchObject({ code: 'REVIEW_INELIGIBLE' });

    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: 90 }).where(eq(schema.salonRetentionSettingsSchema.salonId, ownerReported.salonId));

    await expect(queueClientReviewRequest({ salonId: ownerReported.salonId, clientId: ownerReported.clientId, message: 'Allowed again', requestId: 'owner-old', now: NOW })).resolves.toMatchObject({ created: true });

    const stopped = await seed();
    await db.insert(schema.smsGlobalConsentEventSchema).values({ id: `repeat-stop-${sequence}`, senderIdentity: 'luster_shared_v1', recipient: stopped.recipient, state: 'suppressed', source: 'operator', occurredAt: NOW });

    await expect(queueClientReviewRequest({ salonId: stopped.salonId, clientId: stopped.clientId, message: 'Blocked', requestId: 'stop', now: NOW })).rejects.toMatchObject({ code: 'REVIEW_INELIGIBLE' });

    const unknown = await seed();
    await queueClientReviewRequest({ salonId: unknown.salonId, clientId: unknown.clientId, message: 'First', requestId: 'unknown-first', now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, unknown.salonId));
    await db.update(schema.communicationIntentSchema).set({ status: 'send_outcome_unknown' }).where(eq(schema.communicationIntentSchema.id, request!.intentId));

    await expect(queueClientReviewRequest({ salonId: unknown.salonId, clientId: unknown.clientId, message: 'Second', requestId: 'unknown-second', now: NOW })).rejects.toMatchObject({ code: 'REVIEW_ALREADY_REQUESTED' });
  });

  it('keeps the same appointment protected after cooldown while admitting a later appointment', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [first] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(first).toBeDefined();

    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: new Date(NOW.getTime() - 91 * 86400000) }).where(eq(schema.communicationIntentSchema.id, first!.intentId));
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    expect(await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toHaveLength(1);

    const [original] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const laterId = `${fixture.appointmentId}-later`;
    await db.insert(schema.appointmentSchema).values({ ...original!, id: laterId, startTime: new Date(NOW.getTime() - 1800000), endTime: NOW, completedAt: NOW });
    await scheduleReviewRequest(db, fixture.salonId, laterId, false);
    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(requests).toHaveLength(2);
    expect(requests.filter(request => request.appointmentId === laterId)).toHaveLength(1);
  });

  it('records bounded fairness scanner plan evidence against a synthetic multi-salon backlog', async () => {
    const fixtures = await Promise.all([seed(), seed(), seed()]);
    const sizes = [1000, 73, 3];
    const capturedIds: string[] = [];
    for (const [index, fixture] of fixtures.entries()) {
      await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestAutomationMode: 'scheduled_end' })
        .where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));
      await pool.query(`
        insert into appointment (
          id, salon_id, salon_client_id, client_name, client_phone,
          start_time, end_time, created_at, status, total_price, total_duration_minutes
        )
        select
          $1 || '-' || series::text, $2, $3, 'Synthetic plan client', $4,
          ending - interval '1 hour', ending, ending - interval '1 day',
          'confirmed', 5000, 60
        from generate_series(1, $6) as series
        cross join lateral (select case when series % 3 = 0 then $5::timestamptz - interval '3 days' else $5::timestamptz - interval '1 hour' end as ending) times
      `, [`repeat-plan-${fixture.salonId}`, fixture.salonId, fixture.otherClientId, fixture.recipient, NOW.toISOString(), sizes[index]]);
      // Capture the original appointment and half the synthetic identities in
      // pending and skipped states; both must be excluded before fairness/LIMIT.
      const captured = await pool.query<{ appointment_id: string }>(`
        insert into review_request_trigger (
          id, salon_id, appointment_id, kind, trigger_at,
          appointment_start_at, appointment_end_at, policy_revision,
          state, scheduled_for, available_at, expires_at
        )
        select 'captured-' || id, salon_id, id, 'scheduled_end', end_time,
          start_time, end_time, 0,
          case when right(id, 1) in ('0', '4', '8') then 'skipped'::review_request_trigger_state else 'pending'::review_request_trigger_state end,
          end_time, end_time, end_time + interval '1 day'
        from appointment
        where salon_id = $1 and (id = $2 or id ~ '-[02468]$' or id ~ '-[0-9]*[02468]$')
        returning appointment_id
      `, [fixture.salonId, fixture.appointmentId]);
      capturedIds.push(...captured.rows.map(row => row.appointment_id));
    }
    await pool.query('ANALYZE appointment; ANALYZE salon_retention_settings; ANALYZE review_request_trigger; ANALYZE salon');
    const source = readFileSync(path.join(process.cwd(), 'src/libs/reviewRequests.server.ts'), 'utf8');
    const scanner = source.slice(source.indexOf('export async function scanScheduledEndReviewTriggers('), source.indexOf('export async function materializeCompletedReviewTriggers('));
    const rawQuery = scanner.match(/const rows = await transaction\.execute\(sql`([\s\S]*?)`\)/)?.[1];

    expect(rawQuery).toBeDefined();

    // Execute the production template itself. No independently maintained SQL
    // copy can silently diverge on one of the seven identity/filter clauses.
    const query = rawQuery!.replaceAll(/\$\{now\}/g, '$1::timestamptz').replaceAll(/\$\{limit\}/g, '50');

    expect(query).not.toContain('${');

    const selected = await pool.query<{ id: string; salonId: string }>(query, [NOW.toISOString()]);

    expect(selected.rows).toHaveLength(12);
    expect(fixtures.map(fixture => selected.rows.filter(row => row.salonId === fixture.salonId).length)).toEqual([5, 5, 2]);
    expect(selected.rows.some(row => capturedIds.includes(row.id))).toBe(false);

    const ends = await pool.query<{ id: string; end_time: Date }>('select id, end_time from appointment where id = any($1)', [selected.rows.map(row => row.id)]);
    const expiredFlags = selected.rows.map(row => ends.rows.find(appointment => appointment.id === row.id)!.end_time.getTime() <= NOW.getTime() - 86400000);

    expect(expiredFlags).toContain(true);
    expect(expiredFlags).toEqual([...expiredFlags].sort((a, b) => Number(a) - Number(b)));

    const result = await pool.query<{ 'QUERY PLAN': [{ 'Plan': Record<string, unknown>; 'Planning Time': number; 'Execution Time': number }] }>(`explain (analyze, buffers, format json) ${query}`, [NOW.toISOString()]);
    const plan = result.rows[0]?.['QUERY PLAN'][0];

    expect(plan?.Plan?.['Actual Rows']).toBe(12);

    await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
    await writeFile(path.join(process.cwd(), 'test-results/review-query-plan.json'), JSON.stringify({
      query: 'scheduled-end scanner fairness query: filters before LIMIT; per-salon turn <= 5; global limit 50',
      salons: fixtures.length,
      syntheticAppointments: sizes.reduce((sum, size) => sum + size, 0) + fixtures.length,
      capturedIdentities: capturedIds.length,
      evidenceScope: 'Bounded synthetic CI workload; not Production capacity proof',
      expectedRows: 12,
      plan: plan?.Plan,
      planningTimeMs: plan?.['Planning Time'],
      executionTimeMs: plan?.['Execution Time'],
    }, null, 2));
  });
});
