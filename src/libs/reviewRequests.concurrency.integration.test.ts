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

vi.mock('@/libs/Env', () => ({ Env: {
  COMMUNICATIONS_SMS_ENABLED: 'true',
  TWILIO_ACCOUNT_SID: 'AC11111111111111111111111111111111',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111',
  NEXT_PUBLIC_APP_URL: 'https://luster.test',
} }));
vi.mock('@/libs/communicationRateLimit.server', () => ({ checkSharedSendRateLimits: async () => ({ allowed: true }) }));
vi.mock('@/libs/platformCommunicationControl', () => ({ readCommunicationControlUncached: async () => ({ smsEnabled: true, disabledEventTypes: [] }) }));

const completion = new Date('2030-09-12T19:30:00.000Z');
let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
let executedCases = 0;

async function seed(input: {
  salonId?: string;
  clientId?: string;
  completedAt?: Date | null;
  mode?: 'manual' | 'marked_completed' | 'scheduled_end' | null;
  startTime?: Date;
  status?: 'cancelled' | 'completed' | 'confirmed' | 'in_progress' | 'no_show';
  suppressed?: boolean;
} = {}) {
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
    status: input.status ?? 'completed',
    completedAt: input.completedAt === undefined ? completion : input.completedAt,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: 'https://g.page/r/luster-review',
    automaticReviewRequests: true,
    reviewRequestAutomationMode: input.mode ?? null,
    reviewRequestsEnabledAt: new Date('2030-09-01T00:00:00.000Z'),
    reviewRequestDelayMinutes: 60,
  });
  return { salonId, clientId, appointmentId };
}

async function grantDispatchCredits(salonId: string) {
  const { appendLotGrant, lockCreditAccount } = await import('./billing/creditLedger');
  await db.transaction(async (transaction) => {
    await lockCreditAccount(transaction, salonId);
    await appendLotGrant(transaction, {
      salonId,
      bucket: 'purchased',
      amount: 10,
      expiresAt: null,
      idempotencyKey: `review-pg-dispatch-credit-${salonId}`,
      reason: 'test',
    });
  });
}

async function waitForDispatcherTx1IntentLock(holderPid: number) {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const waiting = await pool.query<{ count: string }>(`
      select count(*)::text as count
      from pg_stat_activity
      where application_name = 'review-request-automation-concurrency'
        and wait_event_type = 'Lock'
        -- The Drizzle query can be SELECT FOR UPDATE or an equivalent
        -- prepared statement, so establish the real row-lock dependency
        -- rather than depending on a renderer-specific SQL spelling.
        and query ~* 'communication_intent'
        and $1 = any(pg_blocking_pids(pid))
    `, [holderPid]);
    if (Number(waiting.rows[0]?.count ?? 0) > 0) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Dispatcher did not reach the held TX1 intent lock.');
}

async function waitForProviderOrEarlyDispatch(
  providerStarted: Promise<void>,
  dispatch: Promise<unknown>,
) {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      providerStarted,
      dispatch.then(
        outcome => Promise.reject(new Error(`Dispatcher settled before provider entry: ${String(outcome)}`)),
        error => Promise.reject(error),
      ),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Provider was not reached within the real-time watchdog.')), 5_000);
      }),
    ]);
  } finally {
    if (watchdog) {
      clearTimeout(watchdog);
    }
  }
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

  it('defers a locked scheduled-end appointment, then excludes cancellation and no-show changes', async () => {
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');

    for (const status of ['cancelled', 'no_show'] as const) {
      const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
      const appointmentHolder = await pool.connect();
      try {
        await appointmentHolder.query('begin');
        await appointmentHolder.query('select id from appointment where id = $1 for update', [fixture.appointmentId]);

        expect(await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 }))
          .toMatchObject({ deferred: 1, recorded: 0, phaseError: false });
      } finally {
        await appointmentHolder.query('rollback');
        appointmentHolder.release();
      }

      await db.update(schema.appointmentSchema).set({ status }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));

      expect(await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 }))
        .toMatchObject({ recorded: 0, deferred: 0, phaseError: false });
      expect(await db.select().from(schema.reviewRequestTriggerSchema)
        .where(eq(schema.reviewRequestTriggerSchema.appointmentId, fixture.appointmentId))).toEqual([]);
    }
  });

  it('defers behind a settings change fence, then re-reads manual mode before materializing', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');

    await expect(scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 }))
      .resolves.toMatchObject({ recorded: 1, phaseError: false });

    const settingsHolder = await pool.connect();
    const [before] = await db.select().from(schema.reviewRequestTriggerSchema)
      .where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId));
    const retryAt = new Date(completion.getTime() + 5 * 60_000);
    try {
      await settingsHolder.query('begin');
      await settingsHolder.query('select id from salon where id = $1 for update', [fixture.salonId]);
      await settingsHolder.query(
        `update salon_retention_settings
         set review_request_automation_mode = 'manual',
             review_request_policy_revision = review_request_policy_revision + 1
         where salon_id = $1`,
        [fixture.salonId],
      );

      expect(await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 }))
        .toMatchObject({ deferred: 1, materialized: 0, phaseError: false });

      const [deferred] = await db.select().from(schema.reviewRequestTriggerSchema)
        .where(eq(schema.reviewRequestTriggerSchema.id, before!.id));

      expect(deferred).toMatchObject({ scheduledFor: before!.scheduledFor, expiresAt: before!.expiresAt });
      expect(deferred!.availableAt).toEqual(retryAt);

      await settingsHolder.query('commit');
    } finally {
      await settingsHolder.query('rollback');
      settingsHolder.release();
    }

    expect(await materializeCompletedReviewTriggers({ database: db, now: retryAt, limit: 1 }))
      .toMatchObject({ skipped: 1, materialized: 0, phaseError: false });
    expect(await db.select().from(schema.reviewRequestSchema)
      .where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it('linearizes concurrent scheduled-end scanners to one captured identity', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    const outcomes = await Promise.all(Array.from({ length: 8 }, () =>
      scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 })));

    expect(outcomes.reduce((total, outcome) => total + outcome.recorded, 0)).toBe(1);
    expect(await db.select().from(schema.reviewRequestTriggerSchema)
      .where(eq(schema.reviewRequestTriggerSchema.appointmentId, fixture.appointmentId))).toHaveLength(1);
  });

  it('suppresses a claimed scheduled-end review when cancellation commits while TX1 is blocked', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await grantDispatchCredits(fixture.salonId);
    await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });
    const [intent] = await claimDueIntents({
      workerId: 'scheduled-end-cancel-race',
      batchLimit: 1,
      perSalonLimit: 1,
      now: new Date(completion.getTime() + 61 * 60_000),
    });

    expect(intent).toBeDefined();

    const intentHolder = await pool.connect();
    const providerSend = vi.fn(async () => ({ sid: 'SM_must_not_send' }));
    const sendTime = new Date(completion.getTime() + 61 * 60_000);
    let dispatch: Promise<Awaited<ReturnType<typeof dispatchClaimedIntent>>> | null = null;
    try {
      // `reviewRequestSendContext` reads the real clock at each dispatcher
      // boundary. Freeze Date only so this genuine PG race uses the same
      // business clock as the captured 2030 appointment while keeping real
      // timers and `performance.now()` for the lock-wait watchdog.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(sendTime);
      await intentHolder.query('begin');
      await intentHolder.query('select id from communication_intent where id = $1 for update', [intent!.id]);
      const holderPid = Number((await intentHolder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid);
      dispatch = dispatchClaimedIntent(intent!, providerSend, sendTime);

      await waitForDispatcherTx1IntentLock(holderPid);
      await db.update(schema.appointmentSchema).set({ status: 'cancelled' })
        .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
      await intentHolder.query('rollback');

      await expect(dispatch).resolves.toBe('suppressed');
    } finally {
      await intentHolder.query('rollback');
      intentHolder.release();
      await dispatch?.catch(() => undefined);
      vi.useRealTimers();
    }

    expect(providerSend).not.toHaveBeenCalled();

    const [storedIntent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, intent!.id));

    expect(storedIntent).toMatchObject({ status: 'suppressed', lastError: 'APPOINTMENT_NO_LONGER_ACTIVE' });
  }, 20_000);

  it('keeps the TX1 reservation settled when provider acceptance wins a later cancellation', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    const sendTime = new Date(completion.getTime() + 61 * 60_000);
    await grantDispatchCredits(fixture.salonId);
    await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });
    const [intent] = await claimDueIntents({
      workerId: 'scheduled-end-accept-race',
      batchLimit: 1,
      perSalonLimit: 1,
      now: sendTime,
    });

    expect(intent).toBeDefined();

    let providerEntered!: () => void;
    let releaseProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerSend = vi.fn(async () => {
      providerEntered();
      await providerGate;
      return { sid: 'SM_cancellation_lost_race' };
    });
    let dispatch: Promise<Awaited<ReturnType<typeof dispatchClaimedIntent>>> | null = null;
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(sendTime);
      dispatch = dispatchClaimedIntent(intent!, providerSend, sendTime);

      await waitForProviderOrEarlyDispatch(providerStarted, dispatch);
      const [sending] = await db.select().from(schema.communicationIntentSchema)
        .where(eq(schema.communicationIntentSchema.id, intent!.id));

      expect(sending).toMatchObject({ status: 'sending', creditReservationId: expect.any(String) });

      await db.update(schema.appointmentSchema).set({ status: 'cancelled' })
        .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
      releaseProvider();

      await expect(dispatch).resolves.toBe('sent');

      const [reservation] = await db.select().from(schema.smsCreditReservationSchema)
        .where(eq(schema.smsCreditReservationSchema.id, sending!.creditReservationId!));

      expect(reservation).toMatchObject({ status: 'settled', releasedAt: null, providerSid: 'SM_cancellation_lost_race' });
    } finally {
      releaseProvider?.();
      await dispatch?.catch(() => undefined);
      vi.useRealTimers();
    }

    expect(providerSend).toHaveBeenCalledOnce();
  }, 20_000);

  it('cancels a claimed obsolete review intent before dispatching its earlier-rescheduled replacement', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    const oldSendTime = new Date(completion.getTime() + 61 * 60_000);
    await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });
    const [oldIntent] = await claimDueIntents({
      workerId: 'scheduled-end-replacement-old',
      batchLimit: 1,
      perSalonLimit: 1,
      now: oldSendTime,
    });

    expect(oldIntent).toBeDefined();

    const earlierEnd = new Date(completion.getTime() - 30 * 60_000);
    await db.update(schema.appointmentSchema).set({
      startTime: new Date(earlierEnd.getTime() - 3_600_000),
      endTime: earlierEnd,
    }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });

    await expect(materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 }))
      .resolves.toMatchObject({ materialized: 1, deferred: 0, phaseError: false });

    const requests = await db.select().from(schema.reviewRequestSchema)
      .where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    const intents = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

    expect(requests.filter(row => row.status === 'cancelled')).toHaveLength(1);
    expect(requests.filter(row => row.status === 'scheduled')).toHaveLength(1);
    expect(intents.find(row => row.id === oldIntent!.id)).toMatchObject({ status: 'canceled', lastError: 'REVIEW_APPOINTMENT_SUPERSEDED' });
    expect(intents.filter(row => row.status === 'pending')).toHaveLength(1);

    const providerSend = vi.fn(async () => ({ sid: 'SM_obsolete_must_not_send' }));
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(oldSendTime);

      await expect(dispatchClaimedIntent(oldIntent!, providerSend, oldSendTime)).resolves.toBe('suppressed');
    } finally {
      vi.useRealTimers();
    }

    expect(providerSend).not.toHaveBeenCalled();
  }, 20_000);

  it('defers a replacement while the old TX1-winning send remains protected', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { claimDueIntents } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    const sendTime = new Date(completion.getTime() + 61 * 60_000);
    await grantDispatchCredits(fixture.salonId);
    await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });
    await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 });
    const [oldIntent] = await claimDueIntents({
      workerId: 'scheduled-end-replacement-sending',
      batchLimit: 1,
      perSalonLimit: 1,
      now: sendTime,
    });

    expect(oldIntent).toBeDefined();

    let providerEntered!: () => void;
    let releaseProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerSend = vi.fn(async () => {
      providerEntered();
      await providerGate;
      return { sid: 'SM_reschedule_sending' };
    });
    let dispatch: Promise<Awaited<ReturnType<typeof dispatchClaimedIntent>>> | null = null;
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(sendTime);
      dispatch = dispatchClaimedIntent(oldIntent!, providerSend, sendTime);
      await waitForProviderOrEarlyDispatch(providerStarted, dispatch);

      const [sending] = await db.select().from(schema.communicationIntentSchema)
        .where(eq(schema.communicationIntentSchema.id, oldIntent!.id));

      expect(sending).toMatchObject({ status: 'sending', creditReservationId: expect.any(String) });

      const earlierEnd = new Date(completion.getTime() - 30 * 60_000);
      await db.update(schema.appointmentSchema).set({
        startTime: new Date(earlierEnd.getTime() - 3_600_000),
        endTime: earlierEnd,
      }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
      await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });

      await expect(materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 }))
        .resolves.toMatchObject({ deferred: 1, materialized: 0, phaseError: false });

      const [oldAfterReplacement] = await db.select().from(schema.communicationIntentSchema)
        .where(eq(schema.communicationIntentSchema.id, oldIntent!.id));

      expect(oldAfterReplacement).toMatchObject({ status: 'sending', creditReservationId: sending!.creditReservationId });

      releaseProvider();

      await expect(dispatch).resolves.toBe('sent');

      const [reservation] = await db.select().from(schema.smsCreditReservationSchema)
        .where(eq(schema.smsCreditReservationSchema.id, sending!.creditReservationId!));

      expect(reservation).toMatchObject({ status: 'settled', releasedAt: null, providerSid: 'SM_reschedule_sending' });
    } finally {
      releaseProvider?.();
      await dispatch?.catch(() => undefined);
      vi.useRealTimers();
    }

    expect(providerSend).toHaveBeenCalledOnce();
  }, 20_000);

  it('rejects a scheduled-end trigger after rescheduling changes its captured identity', async () => {
    const fixture = await seed({ mode: 'scheduled_end', status: 'confirmed', completedAt: null });
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: completion, limit: 1 });

    await db.update(schema.appointmentSchema).set({
      startTime: new Date(completion.getTime() - 7_200_000),
      endTime: new Date(completion.getTime() - 600_000),
    }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));

    expect(await materializeCompletedReviewTriggers({ database: db, now: completion, limit: 1 }))
      .toMatchObject({ skipped: 1, materialized: 0, phaseError: false });
    expect(await db.select().from(schema.reviewRequestTriggerSchema)
      .where(eq(schema.reviewRequestTriggerSchema.appointmentId, fixture.appointmentId)))
      .toMatchObject([expect.objectContaining({ state: 'skipped', reasonCode: 'APPOINTMENT_CHANGED' })]);
    expect(await db.select().from(schema.reviewRequestSchema)
      .where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toEqual([]);
  });

  afterAll(() => {
    expect(executedCases).toBe(15);

    process.stdout.write('REVIEW_REQUEST_POSTGRES_TESTS_EXECUTED=15 REVIEW_REQUEST_POSTGRES_TESTS_SKIPPED=0\n');
  });
});
