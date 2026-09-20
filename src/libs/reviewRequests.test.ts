import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: false,
}));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

const completion = new Date('2030-09-12T19:30:00.000Z');
const oldCompletion = new Date('2020-09-12T19:30:00.000Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

afterAll(async () => client.close());

async function seed(input: {
  status?: string;
  completedAt?: Date | null;
  phone?: string | null;
  googleReviewUrl?: string | null;
  automaticEnabled?: boolean;
  automationMode?: 'manual' | 'marked_completed' | 'scheduled_end' | null;
  enabledAt?: Date | null;
  suppressed?: boolean;
  clientId?: string;
  salonId?: string;
} = {}) {
  sequence += 1;
  const salonId = input.salonId ?? `review-salon-${sequence}`;
  const clientId = input.clientId ?? `review-client-${sequence}`;
  const appointmentId = `review-appt-${sequence}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    slug: salonId,
    name: `Review Salon ${sequence}`,
    settings: { communications: { sms: { enabled: true } }, booking: { timezone: 'America/Toronto' } } as never,
  });
  await db.insert(schema.salonClientSchema).values({
    id: clientId,
    salonId,
    fullName: 'Sarah Client',
    phone: input.phone === undefined ? `416555${String(1000 + sequence).padStart(4, '0')}` : input.phone ?? '',
    reviewRequestsSuppressed: input.suppressed ?? false,
  });
  if (input.phone !== null) {
    await db.insert(schema.communicationConsentSchema).values({
      id: `review-consent-${sequence}`,
      salonId,
      recipient: input.phone === undefined ? `416555${String(1000 + sequence).padStart(4, '0')}` : input.phone,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: 'granted',
      source: 'test',
      wordingVersion: 'test-v1',
    });
  }
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    salonClientId: clientId,
    clientName: 'Sarah Client',
    clientPhone: input.phone === undefined ? `416555${String(1000 + sequence).padStart(4, '0')}` : input.phone ?? '',
    startTime: new Date(completion.getTime() - 3_600_000),
    endTime: completion,
    status: input.status ?? 'completed',
    completedAt: input.completedAt === undefined ? completion : input.completedAt,
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: input.googleReviewUrl === undefined ? 'https://g.page/r/luster-review' : input.googleReviewUrl,
    automaticReviewRequests: input.automaticEnabled ?? true,
    reviewRequestAutomationMode: input.automationMode ?? null,
    reviewRequestsEnabledAt: input.enabledAt === undefined ? new Date('2030-09-01T00:00:00.000Z') : input.enabledAt,
    reviewRequestDelayMinutes: 60,
  });
  return { salonId, clientId, appointmentId };
}

async function rows(salonId: string) {
  return db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, salonId));
}

async function triggerRows(salonId: string) {
  return db.select().from(schema.reviewRequestTriggerSchema)
    .where(eq(schema.reviewRequestTriggerSchema.salonId, salonId));
}

async function laterAppointment(fixture: Awaited<ReturnType<typeof seed>>) {
  const [original] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
  const id = `${fixture.appointmentId}-later`;
  await db.insert(schema.appointmentSchema).values({ ...original!, id });
  return id;
}

describe('repeat-review coordinator preparation', () => {
  it('matches another client identity with the same normalized durable recipient', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest, getAppointmentReviewState } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [first] = await rows(fixture.salonId);
    await db.update(schema.communicationIntentSchema).set({ status: 'send_outcome_unknown' }).where(eq(schema.communicationIntentSchema.id, first!.intentId));
    const newClientId = `${fixture.clientId}-same-recipient`;
    await db.insert(schema.salonClientSchema).values({ id: newClientId, salonId: fixture.salonId, fullName: 'Reimported client', phone: `+1${first!.recipient}` });
    const nextId = await laterAppointment(fixture);
    await db.update(schema.appointmentSchema).set({ salonClientId: newClientId }).where(eq(schema.appointmentSchema.id, nextId));

    // Inspect the reader before any insert: a database unique constraint alone
    // cannot satisfy this identity assertion.
    expect(await getAppointmentReviewState(fixture.salonId, nextId)).toMatchObject({ status: 'not_eligible', canSendManually: false, reason: expect.stringContaining('uncertain outcome') });
  });

  it('does not use another salon\'s durable history for the same recipient', async () => {
    const firstSalon = await seed();
    const { scheduleReviewRequest, getAppointmentReviewState } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, firstSalon.salonId, firstSalon.appointmentId, false);
    const [request] = await rows(firstSalon.salonId);
    const secondSalon = await seed({ phone: request!.recipient });

    expect(await getAppointmentReviewState(secondSalon.salonId, secondSalon.appointmentId)).toMatchObject({ status: 'eligible' });

    await scheduleReviewRequest(db, secondSalon.salonId, secondSalon.appointmentId, false);

    expect(await rows(secondSalon.salonId)).toHaveLength(1);
    expect(await rows(firstSalon.salonId)).toHaveLength(1);
  });

  it('retains legacy same-appointment evidence after the booking is reassigned', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await db.insert(schema.clientCommunicationSchema).values({ id: `${fixture.clientId}-legacy`, salonId: fixture.salonId, salonClientId: fixture.clientId, appointmentId: fixture.appointmentId, kind: 'google_review', status: 'converted', markedSentAt: new Date() });
    const newClientId = `${fixture.clientId}-reassigned`;
    const phone = '4165559841';
    await db.insert(schema.salonClientSchema).values({ id: newClientId, salonId: fixture.salonId, fullName: 'Reassigned client', phone });
    await db.insert(schema.communicationConsentSchema).values({ id: `${newClientId}-consent`, salonId: fixture.salonId, recipient: phone, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' });
    await db.update(schema.appointmentSchema).set({ salonClientId: newClientId, clientPhone: phone }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    expect(await rows(fixture.salonId)).toHaveLength(0);
  });

  it('allows a later visit after 90 days once the separately gated lifetime indexes are retired', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [first] = await rows(fixture.salonId);
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: new Date(Date.now() - 91 * 86_400_000) }).where(eq(schema.communicationIntentSchema.id, first!.intentId));
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: 90 }).where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));
    const nextId = await laterAppointment(fixture);

    // The applied retirement migration permits a later visit; the shared
    // history coordinator still protects the original appointment and intent.
    await scheduleReviewRequest(db, fixture.salonId, nextId, false);
    const requests = await rows(fixture.salonId);

    expect(requests).toHaveLength(2);
    expect(requests.find(row => row.id === first!.id)).toMatchObject({ status: 'scheduled', appointmentId: fixture.appointmentId });
    expect(requests.find(row => row.appointmentId === nextId)).toBeDefined();
  });

  it('counts a recent accepted request even if its business row was canceled', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [first] = await rows(fixture.salonId);
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: new Date() }).where(eq(schema.communicationIntentSchema.id, first!.intentId));
    await db.update(schema.reviewRequestSchema).set({ status: 'cancelled' }).where(eq(schema.reviewRequestSchema.id, first!.id));
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: 90 }).where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));
    await scheduleReviewRequest(db, fixture.salonId, await laterAppointment(fixture), false);

    expect(await rows(fixture.salonId)).toHaveLength(1);
  });

  it('does not accelerate another appointment when the owner requests this visit manually', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    const [first] = await rows(fixture.salonId);
    const [before] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, first!.intentId));
    await scheduleReviewRequest(db, fixture.salonId, await laterAppointment(fixture), false);
    const [after] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, first!.intentId));

    expect(after!.availableAt).toEqual(before!.availableAt);
    expect(await rows(fixture.salonId)).toHaveLength(1);
  });

  it('does not accelerate the former recipient after an appointment is reassigned', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    const [first] = await rows(fixture.salonId);
    const [before] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, first!.intentId));
    const newClientId = `${fixture.clientId}-replacement`;
    const phone = '4165559876';
    await db.insert(schema.salonClientSchema).values({ id: newClientId, salonId: fixture.salonId, fullName: 'Different client', phone });
    await db.insert(schema.communicationConsentSchema).values({ id: `${newClientId}-consent`, salonId: fixture.salonId, recipient: phone, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' });
    await db.update(schema.appointmentSchema).set({ salonClientId: newClientId, clientPhone: phone }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [after] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, first!.intentId));

    expect(after!.availableAt).toEqual(before!.availableAt);
    expect(await rows(fixture.salonId)).toHaveLength(1);
  });

  it.each(['converted', 'dismissed', 'marked_sent'])('retains recent legacy send evidence after status becomes %s', async (status) => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: 90 }).where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));
    await db.insert(schema.clientCommunicationSchema).values({ id: `${fixture.clientId}-legacy`, salonId: fixture.salonId, salonClientId: fixture.clientId, kind: 'google_review', status, markedSentAt: new Date() });
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    expect(await rows(fixture.salonId)).toHaveLength(0);
  });

  it('fails closed for a legacy marked-sent row without a timestamp', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestRepeatCooldownDays: 90 }).where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));
    await db.insert(schema.clientCommunicationSchema).values({ id: `${fixture.clientId}-legacy`, salonId: fixture.salonId, salonClientId: fixture.clientId, kind: 'google_review', status: 'marked_sent', markedSentAt: null });
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    expect(await rows(fixture.salonId)).toHaveLength(0);
  });

  it('rechecks legacy history recorded after scheduling and before dispatch', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest, reviewRequestSendContext } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [first] = await rows(fixture.salonId);
    await db.insert(schema.clientCommunicationSchema).values({ id: `${fixture.clientId}-legacy`, salonId: fixture.salonId, salonClientId: fixture.clientId, kind: 'google_review', status: 'converted', markedSentAt: new Date() });

    expect(await reviewRequestSendContext(fixture.salonId, first!.intentId)).toBeNull();
  });
});

describe('review request production', () => {
  it('keeps the nullable preparation reader closed until kind-aware dispatch is implemented', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { recordCompletedReviewTrigger, materializeCompletedReviewTriggers, reviewRequestSendContext } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    await materializeCompletedReviewTriggers({ database: db, now: completion });
    const [request] = await rows(fixture.salonId);

    expect(request?.triggerId).toBeTruthy();
    expect(await reviewRequestSendContext(fixture.salonId, request!.intentId)).not.toBeNull();

    await db.update(schema.reviewRequestSchema).set({ completedAt: null }).where(eq(schema.reviewRequestSchema.id, request!.id));

    expect(await reviewRequestSendContext(fixture.salonId, request!.intentId)).toBeNull();
  });

  it('records an idempotent durable completion trigger without allocating a review request', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { recordCompletedReviewTrigger } = await import('./reviewRequests.server');

    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));

    expect(await rows(fixture.salonId)).toEqual([]);
    expect(await triggerRows(fixture.salonId)).toMatchObject([{
      salonId: fixture.salonId,
      appointmentId: fixture.appointmentId,
      kind: 'completed',
      triggerAt: completion,
      appointmentStartAt: new Date(completion.getTime() - 3_600_000),
      appointmentEndAt: completion,
      policyRevision: 0,
      scheduledFor: new Date('2030-09-12T20:30:00.000Z'),
      expiresAt: new Date('2030-09-13T20:30:00.000Z'),
      state: 'pending',
    }]);
  });

  it('records no completion trigger for manual or scheduled-end policies', async () => {
    const manual = await seed({ automaticEnabled: false });
    const scheduledEnd = await seed({ automationMode: 'scheduled_end' });
    const { recordCompletedReviewTrigger } = await import('./reviewRequests.server');

    for (const fixture of [manual, scheduledEnd]) {
      const [appointment] = await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
      await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));

      expect(await triggerRows(fixture.salonId)).toEqual([]);
    }
  });

  it('rolls its durable completion trigger back with the enclosing completion transaction', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { recordCompletedReviewTrigger } = await import('./reviewRequests.server');

    await expect(db.transaction(async (tx) => {
      await recordCompletedReviewTrigger(tx, appointment!, completion);
      throw new Error('ROLL_BACK_REVIEW_TRIGGER');
    })).rejects.toThrow('ROLL_BACK_REVIEW_TRIGGER');

    expect(await triggerRows(fixture.salonId)).toEqual([]);
  });

  it('materializes a due completion trigger into one existing review request and intent', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));

    const result = await materializeCompletedReviewTriggers({
      database: db,
      now: new Date('2030-09-12T20:30:00.000Z'),
    });

    expect(result.materialized).toBeGreaterThan(0);

    expect(await triggerRows(fixture.salonId)).toMatchObject([{ state: 'materialized' }]);
    expect(await rows(fixture.salonId)).toMatchObject([{
      salonId: fixture.salonId,
      appointmentId: fixture.appointmentId,
      source: 'automatic',
      triggerId: expect.any(String),
    }]);
  });

  it('shows this appointment\'s durable pending trigger before the worker creates an intent', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { getAppointmentReviewState, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));

    await expect(getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).resolves.toMatchObject({
      status: 'scheduled',
      scheduledFor: '2030-09-12T20:30:00.000Z',
    });
  });

  it('prefers this appointment\'s manual request over its pending automatic trigger', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { getAppointmentReviewState, materializeCompletedReviewTriggers, recordCompletedReviewTrigger, scheduleReviewRequest } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    const [request] = await rows(fixture.salonId);
    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, request!.intentId));

    expect(intent!.availableAt.getTime()).toBeLessThan(new Date('2030-09-12T20:30:00.000Z').getTime());
    expect(request).toMatchObject({ source: 'manual', appointmentId: fixture.appointmentId });

    await materializeCompletedReviewTriggers({ database: db, now: completion });
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: completion })
      .where(eq(schema.communicationIntentSchema.id, intent!.id));

    await expect(getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).resolves.toMatchObject({
      status: 'sent',
      sentAt: completion.toISOString(),
    });
  });

  it('fails closed before send when a linked trigger appointment snapshot changes', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger, reviewRequestSendContext } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    await materializeCompletedReviewTriggers({ database: db, now: completion });
    const [request] = await rows(fixture.salonId);

    await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toEqual(expect.objectContaining({ message: expect.any(String) }));

    await db.update(schema.appointmentSchema).set({ startTime: new Date(completion.getTime() - 7_200_000) })
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));

    await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toBeNull();
  });

  it.each([
    ['mode', { automaticReviewRequests: true, reviewRequestAutomationMode: 'manual' }],
    ['activation epoch', { reviewRequestsEnabledAt: new Date('2030-09-13T00:00:00.000Z') }],
    ['policy revision', { reviewRequestPolicyRevision: 1 }],
  ] as const)('fails closed before send when linked trigger %s changes', async (_name, update) => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger, reviewRequestSendContext } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));
    await materializeCompletedReviewTriggers({ database: db, now: completion });
    const [request] = await rows(fixture.salonId);
    await db.update(schema.salonRetentionSettingsSchema).set(update)
      .where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));

    await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toBeNull();
  });

  it('skips an expired completion trigger without refreshing its original due time', async () => {
    const fixture = await seed();
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { materializeCompletedReviewTriggers, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, completion));

    await materializeCompletedReviewTriggers({
      database: db,
      now: new Date('2030-09-13T20:30:00.000Z'),
    });

    expect(await triggerRows(fixture.salonId)).toMatchObject([{
      state: 'skipped',
      reasonCode: 'EXPIRED',
      scheduledFor: new Date('2030-09-12T20:30:00.000Z'),
    }]);
    expect(await rows(fixture.salonId)).toEqual([]);
  });

  it('schedules only a newly qualifying completed appointment from its actual completion time', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');

    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);

    const [request] = await rows(fixture.salonId);
    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

    expect(request).toMatchObject({ salonId: fixture.salonId, clientId: fixture.clientId, appointmentId: fixture.appointmentId, source: 'automatic', completedAt: completion, scheduledFor: new Date('2030-09-12T20:30:00.000Z') });
    expect(intent).toMatchObject({ eventType: 'review_request', channel: 'sms', status: 'pending', scheduledFor: new Date('2030-09-12T20:30:00.000Z') });
  });

  it.each([
    ['cancelled', completion, undefined, undefined, undefined, undefined, undefined],
    ['no_show', completion, undefined, undefined, undefined, undefined, undefined],
    ['completed', null, undefined, undefined, undefined, undefined, undefined],
    ['completed', completion, null, undefined, undefined, undefined, undefined],
    ['completed', completion, undefined, null, undefined, undefined, undefined],
    ['completed', completion, undefined, undefined, false, undefined, undefined],
    ['completed', completion, undefined, undefined, undefined, undefined, true],
  ] as const)('does not schedule ineligible appointments (%s)', async (status, completedAt, phone, googleReviewUrl, automaticEnabled, enabledAt, suppressed) => {
    const fixture = await seed({ status, completedAt, phone, googleReviewUrl, automaticEnabled, enabledAt, suppressed });
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);

    expect(await rows(fixture.salonId)).toEqual([]);
  });

  it('does not backfill a completion before the feature was enabled', async () => {
    const fixture = await seed({ completedAt: oldCompletion, enabledAt: new Date('2030-09-01T00:00:00.000Z') });
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);

    expect(await rows(fixture.salonId)).toEqual([]);
  });

  it('allows a manual request while automation is off, but never sends a second request', async () => {
    const fixture = await seed({ automaticEnabled: false, enabledAt: null });
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const requests = await rows(fixture.salonId);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source: 'manual', scheduledFor: expect.any(Date) });
  });

  it('uses the same one-request slot when an automatic request is followed by Send now', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    const requests = await rows(fixture.salonId);
    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, requests[0]!.intentId));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source: 'automatic' });
    expect(intent).toMatchObject({ status: 'pending', scheduledFor: expect.any(Date) });
  });

  it('uses tenant scoping and pending history across later appointment replays', async () => {
    const fixture = await seed();
    const secondAppointmentId = `${fixture.appointmentId}-second`;
    await db.insert(schema.appointmentSchema).values({
      id: secondAppointmentId,
      salonId: fixture.salonId,
      salonClientId: fixture.clientId,
      clientName: 'Sarah Client',
      clientPhone: `416555${String(1000 + sequence).padStart(4, '0')}`,
      startTime: new Date(completion.getTime() + 86_400_000),
      endTime: new Date(completion.getTime() + 90_000_000),
      status: 'completed',
      completedAt: new Date(completion.getTime() + 90_000_000),
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    // PGlite disables PostgreSQL locks. Actual concurrent callers and their
    // transaction/fence contract are covered by the real PostgreSQL suite.
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    await scheduleReviewRequest(db, fixture.salonId, secondAppointmentId);
    await scheduleReviewRequest(db, 'missing-salon', fixture.appointmentId);

    expect(await rows(fixture.salonId)).toHaveLength(1);
  });

  it('cancels pending automatic work when suppression or automation is turned off and fences old completions after unsuppression', async () => {
    const fixture = await seed({ completedAt: oldCompletion, enabledAt: new Date('2019-09-01T00:00:00.000Z') });
    const { scheduleReviewRequest, setReviewSuppression, saveReviewSettings } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    await setReviewSuppression(fixture.salonId, fixture.clientId, true);
    let [request] = await rows(fixture.salonId);
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

    expect(request!.status).toBe('cancelled');
    expect(intent!.status).toBe('canceled');

    await setReviewSuppression(fixture.salonId, fixture.clientId, false);
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);

    expect(await rows(fixture.salonId)).toHaveLength(1);

    const automationFixture = await seed();
    await scheduleReviewRequest(db, automationFixture.salonId, automationFixture.appointmentId);
    await saveReviewSettings(automationFixture.salonId, { googleReviewUrl: 'https://g.page/r/updated', automaticEnabled: false, delayMinutes: 60, messageTemplate: 'Hi {{firstName}} {{reviewLink}}' });
    [request] = await rows(automationFixture.salonId);

    expect(request!.status).toBe('cancelled');
  });

  it('does not revive an accepted or unknown review request through the manual path', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    const [request] = await rows(fixture.salonId);
    await db.update(schema.communicationIntentSchema).set({ status: 'send_outcome_unknown' })
      .where(eq(schema.communicationIntentSchema.id, request!.intentId));
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, request!.intentId));

    expect(intent!.status).toBe('send_outcome_unknown');
  });

  it('rechecks mutable eligibility before a provider send', async () => {
    const fixture = await seed();
    const { reviewRequestSendContext, scheduleReviewRequest, setReviewSuppression } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    const [request] = await rows(fixture.salonId);

    expect(await reviewRequestSendContext(fixture.salonId, request!.intentId)).toMatchObject({ message: expect.stringContaining('https://g.page/r/luster-review') });

    await setReviewSuppression(fixture.salonId, fixture.clientId, true);

    expect(await reviewRequestSendContext(fixture.salonId, request!.intentId)).toBeNull();

    const deletedFixture = await seed();
    await scheduleReviewRequest(db, deletedFixture.salonId, deletedFixture.appointmentId);
    const [deletedRequest] = await rows(deletedFixture.salonId);
    await db.update(schema.appointmentSchema).set({ deletedAt: new Date() })
      .where(eq(schema.appointmentSchema.id, deletedFixture.appointmentId));

    expect(await reviewRequestSendContext(deletedFixture.salonId, deletedRequest!.intentId)).toBeNull();
  });

  it('preserves a failed manual attempt as history and never creates a retry request', async () => {
    const fixture = await seed({ automaticEnabled: false, enabledAt: null });
    const { scheduleReviewRequest, getAppointmentReviewState } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    const [request] = await rows(fixture.salonId);
    await db.update(schema.communicationIntentSchema).set({ status: 'failed', lastError: 'PROVIDER_REJECTED' })
      .where(eq(schema.communicationIntentSchema.id, request!.intentId));
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);

    expect(await rows(fixture.salonId)).toHaveLength(1);
    await expect(getAppointmentReviewState(fixture.salonId, fixture.appointmentId))
      .resolves.toMatchObject({ status: 'failed' });
  });

  it('resolves a stored legacy default to compact copy without writing settings or changing custom copy', async () => {
    const fixture = await seed();
    const { getReviewSettings } = await import('./reviewRequests.server');
    const { DEFAULT_REVIEW_MESSAGE, LEGACY_DEFAULT_REVIEW_MESSAGE } = await import('./reviewRequests');
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestMessage: LEGACY_DEFAULT_REVIEW_MESSAGE })
      .where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));

    expect((await getReviewSettings(fixture.salonId)).messageTemplate).toBe(DEFAULT_REVIEW_MESSAGE);

    const [stored] = await db.select().from(schema.salonRetentionSettingsSchema).where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));

    expect(stored!.reviewRequestMessage).toBe(LEGACY_DEFAULT_REVIEW_MESSAGE);

    const custom = 'Hi {{firstName}}, your own review copy: {{reviewLink}}';
    await db.update(schema.salonRetentionSettingsSchema).set({ reviewRequestMessage: custom }).where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));

    expect((await getReviewSettings(fixture.salonId)).messageTemplate).toBe(custom);
  });

  it('removing the link disables automation and cancels pending requests without a legacy fallback', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest, saveReviewSettings, getReviewSettings } = await import('./reviewRequests.server');
    const { DEFAULT_REVIEW_MESSAGE } = await import('./reviewRequests');
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);
    await saveReviewSettings(fixture.salonId, { googleReviewUrl: null, automaticEnabled: true, delayMinutes: 60, messageTemplate: DEFAULT_REVIEW_MESSAGE });

    expect(await getReviewSettings(fixture.salonId)).toMatchObject({ googleReviewUrl: null, automaticEnabled: false });
    expect((await rows(fixture.salonId))[0]).toMatchObject({ status: 'cancelled' });
  });

  it('honors an existing manually marked-sent Google review', async () => {
    const fixture = await seed();
    const { scheduleReviewRequest, getAppointmentReviewState } = await import('./reviewRequests.server');
    await db.insert(schema.clientCommunicationSchema).values({ id: 'legacy-marked-review', salonId: fixture.salonId, salonClientId: fixture.clientId, kind: 'google_review', status: 'marked_sent', markedSentAt: new Date(), messageSnapshot: 'Previously sent review request' });
    await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId);

    expect(await rows(fixture.salonId)).toHaveLength(0);
    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'not_eligible', sentAt: null, canSendManually: false, reason: expect.stringContaining('marked sent by the owner') });
  });
});
