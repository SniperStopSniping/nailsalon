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
    reviewRequestsEnabledAt: input.enabledAt === undefined ? new Date('2030-09-01T00:00:00.000Z') : input.enabledAt,
    reviewRequestDelayMinutes: 60,
  });
  return { salonId, clientId, appointmentId };
}

async function rows(salonId: string) {
  return db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, salonId));
}

describe('review request production', () => {
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

  it('uses tenant scoping and the unique slot across concurrent appointment completion replays', async () => {
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
    await Promise.all([
      scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId),
      scheduleReviewRequest(db, fixture.salonId, secondAppointmentId),
      scheduleReviewRequest(db, 'missing-salon', fixture.appointmentId),
    ]);

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
    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'sent', message: 'Previously sent review request' });
  });
});
