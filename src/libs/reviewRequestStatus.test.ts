import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
}, usesRuntimePostgres: false }));
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;
const now = new Date('2030-09-12T20:00:00.000Z');
const end = new Date('2030-09-12T19:30:00.000Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});

afterEach(() => vi.useRealTimers());

afterAll(async () => client.close());

async function seed(mode: 'manual' | 'scheduled_end' | 'marked_completed' = 'manual', status = 'completed') {
  const suffix = ++sequence;
  const salonId = `status-salon-${suffix}`;
  const clientId = `status-client-${suffix}`;
  const appointmentId = `status-appt-${suffix}`;
  const phone = `416555${String(5000 + suffix)}`;
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Status Salon', settings: { communications: { sms: { enabled: true }, quietHours: { enabled: false, start: '21:00', end: '09:00' } }, booking: { timezone: 'America/Toronto' } } as never });
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Sarah', phone });
  await db.insert(schema.communicationConsentSchema).values({ id: `consent-${suffix}`, salonId, recipient: phone, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' });
  await db.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, salonClientId: clientId, clientName: 'Sarah', clientPhone: phone, startTime: new Date(end.getTime() - 3600000), endTime: end, createdAt: new Date(end.getTime() - 86400000), status, completedAt: status === 'completed' ? end : null, totalPrice: 5000, totalDurationMinutes: 60 });
  await db.insert(schema.salonRetentionSettingsSchema).values({ salonId, googleReviewUrl: 'https://g.page/r/luster-review', automaticReviewRequests: mode !== 'manual', reviewRequestAutomationMode: mode, reviewRequestDelayMinutes: 60, reviewRequestRepeatCooldownDays: 90, reviewRequestsEnabledAt: new Date(end.getTime() - 86400000) });
  return { salonId, clientId, appointmentId, phone };
}
async function request(fixture: Awaited<ReturnType<typeof seed>>) {
  const { scheduleReviewRequest } = await import('./reviewRequests.server');
  await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
  const [row] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
  return row!;
}

describe('owner review status and history', () => {
  it('explains manual-only without inventing an automatic schedule', async () => {
    const fixture = await seed();
    const { getAppointmentReviewState } = await import('./reviewRequests.server');

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'eligible', canSendManually: true, automationMode: 'manual', scheduledFor: null, reason: expect.stringContaining('automatic requests are off') });
  });

  it('distinguishes an upcoming end and an uncaptured trigger from scheduled work', async () => {
    const fixture = await seed('scheduled_end', 'confirmed');
    const { getAppointmentReviewState } = await import('./reviewRequests.server');
    vi.setSystemTime(new Date(end.getTime() - 1000));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'awaiting_trigger', canSendManually: false, scheduledFor: null, reason: expect.stringContaining('after the appointment ends') });

    vi.setSystemTime(now);

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'awaiting_trigger', reason: expect.stringContaining('next automatic review check') });
  });

  it('shows a recorded trigger, then immediately explains a no-show before cron', async () => {
    const fixture = await seed('scheduled_end', 'confirmed');
    const { getAppointmentReviewState, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now });

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'scheduled', source: 'automatic', scheduledFor: '2030-09-12T20:30:00.000Z', canSendManually: false });

    await db.update(schema.appointmentSchema).set({ status: 'no_show' }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'skipped', reason: 'The appointment was marked no-show.', canSendManually: false });
  });

  it('applies quiet hours to a durable trigger before materialization', async () => {
    const fixture = await seed('marked_completed');
    await db.update(schema.salonSchema).set({ settings: { communications: { sms: { enabled: true }, quietHours: { enabled: true, start: '16:00', end: '09:00' } }, booking: { timezone: 'America/Toronto' } } as never }).where(eq(schema.salonSchema.id, fixture.salonId));
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { getAppointmentReviewState, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, now));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'scheduled', scheduledFor: '2030-09-13T13:00:00.000Z' });
  });

  it('does not attribute an earlier visit’s send to the current appointment', async () => {
    const fixture = await seed();
    const row = await request(fixture);
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: now }).where(eq(schema.communicationIntentSchema.id, row.intentId));
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const laterId = `${fixture.appointmentId}-later`;
    await db.insert(schema.appointmentSchema).values({ ...appointment!, id: laterId });
    const { getAppointmentReviewState } = await import('./reviewRequests.server');

    expect(await getAppointmentReviewState(fixture.salonId, laterId)).toMatchObject({ status: 'not_eligible', sentAt: null, canSendManually: false, reason: expect.stringContaining('90-day') });
  });

  it('distinguishes provider acceptance, confirmed delivery, and uncertainty', async () => {
    const fixture = await seed();
    const row = await request(fixture);
    const { getAppointmentReviewState } = await import('./reviewRequests.server');
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: now }).where(eq(schema.communicationIntentSchema.id, row.intentId));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'sent', sentAt: now.toISOString(), canSendManually: false, reason: expect.stringContaining('not yet confirmed') });

    await db.insert(schema.notificationDeliverySchema).values({ id: `delivery-${row.id}`, salonId: fixture.salonId, intentId: row.intentId, channel: 'sms', purpose: 'review_request', dedupeKey: `delivery-${row.id}`, status: 'delivered', providerMessageId: 'SM_evidence' });

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'delivered', reason: expect.stringContaining('confirmed') });

    await db.update(schema.notificationDeliverySchema).set({ status: 'queued' }).where(eq(schema.notificationDeliverySchema.id, `delivery-${row.id}`));
    await db.update(schema.communicationIntentSchema).set({ status: 'pending', resolvedAt: null }).where(eq(schema.communicationIntentSchema.id, row.intentId));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'unknown', canSendManually: false });
  });

  it('preserves sent history after later cancellation but explains unsent cancellation', async () => {
    const fixture = await seed();
    const row = await request(fixture);
    const { getAppointmentReviewState } = await import('./reviewRequests.server');
    await db.update(schema.appointmentSchema).set({ status: 'cancelled' }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'skipped', reason: 'The appointment was cancelled or declined.' });

    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: now }).where(eq(schema.communicationIntentSchema.id, row.intentId));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'sent' });
  });

  it('labels legacy owner reports honestly in the matching appointment and client history', async () => {
    const fixture = await seed();
    await db.insert(schema.clientCommunicationSchema).values({ id: `legacy-${fixture.clientId}`, salonId: fixture.salonId, salonClientId: fixture.clientId, appointmentId: fixture.appointmentId, kind: 'google_review', status: 'marked_sent', markedSentAt: now, messageSnapshot: 'Owner message' });
    const { getAppointmentReviewState, getClientReviewOverview } = await import('./reviewRequests.server');

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'reported_sent', source: 'owner_reported', channel: 'owner_device', canSendManually: false });
    expect(await getClientReviewOverview(fixture.salonId, fixture.clientId)).toMatchObject({ reviewRequestsSuppressed: false, hasMore: false, history: [{ status: 'reported_sent', sentAt: now.toISOString(), reason: expect.stringContaining('cannot verify') }] });
  });

  it('shows manual client-only requests without inventing an appointment', async () => {
    const fixture = await seed();
    const { queueClientReviewRequest, getClientReviewOverview } = await import('./reviewRequests.server');
    await queueClientReviewRequest({ salonId: fixture.salonId, clientId: fixture.clientId, requestId: crypto.randomUUID(), message: 'Thank you. https://g.page/r/luster-review' });

    expect(await getClientReviewOverview(fixture.salonId, fixture.clientId)).toMatchObject({ history: [{ status: 'scheduled', source: 'manual', channel: 'sms', appointmentId: null, canSendManually: false }] });
  });

  it('never leaks another salon’s request through a supplied client or appointment ID', async () => {
    const a = await seed();
    const b = await seed();
    await request(a);
    const { getAppointmentReviewState, getClientReviewOverview } = await import('./reviewRequests.server');

    expect(await getAppointmentReviewState(b.salonId, a.appointmentId)).toMatchObject({ status: 'not_eligible', phone: null, message: null });
    await expect(getClientReviewOverview(b.salonId, a.clientId)).rejects.toThrow('CLIENT_UNAVAILABLE');
    expect((await getClientReviewOverview(b.salonId, b.clientId)).history).toEqual([]);
  });

  it('expires pending work without rewriting accepted history after the same deadline', async () => {
    const fixture = await seed();
    const row = await request(fixture);
    await db.update(schema.communicationIntentSchema).set({ scheduledFor: new Date(now.getTime() - 60000), notAfter: new Date(now.getTime() - 1) }).where(eq(schema.communicationIntentSchema.id, row.intentId));
    const { getAppointmentReviewState } = await import('./reviewRequests.server');

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'skipped', canSendManually: false, reason: 'The review request window has expired.' });

    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: end }).where(eq(schema.communicationIntentSchema.id, row.intentId));

    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'sent', sentAt: end.toISOString() });
  });

  it('shows a fresh trigger after a cancelled request and marks competing history consistently', async () => {
    const fixture = await seed('marked_completed');
    const row = await request(fixture);
    await db.update(schema.communicationIntentSchema).set({ status: 'canceled', resolvedAt: now }).where(eq(schema.communicationIntentSchema.id, row.intentId));
    await db.update(schema.reviewRequestSchema).set({ status: 'cancelled' }).where(eq(schema.reviewRequestSchema.id, row.id));
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    const { getClientReviewOverview, getAppointmentReviewState, recordCompletedReviewTrigger } = await import('./reviewRequests.server');
    await db.transaction(tx => recordCompletedReviewTrigger(tx, appointment!, now));
    const overview = await getClientReviewOverview(fixture.salonId, fixture.clientId);

    expect(overview.history).toHaveLength(2);
    expect(overview.history.some(item => item.status === 'scheduled' && item.source === 'automatic')).toBe(true);

    // Restore provider acceptance evidence: both views must stop describing the
    // pending trigger as a request that can be sent again.
    await db.update(schema.communicationIntentSchema).set({ status: 'sent', resolvedAt: end }).where(eq(schema.communicationIntentSchema.id, row.intentId));
    const blocked = await getClientReviewOverview(fixture.salonId, fixture.clientId);

    expect(blocked.history.find(item => item.source === 'automatic')).toMatchObject({ status: 'skipped', canSendManually: false, reason: expect.stringContaining('already exists') });
    expect(await getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).toMatchObject({ status: 'sent', canSendManually: false });
  });

  it('bounds displayed history and batches reads independently of historical appointment count', async () => {
    const fixture = await seed();
    const row = await request(fixture);
    await db.update(schema.communicationIntentSchema).set({ status: 'canceled', resolvedAt: now }).where(eq(schema.communicationIntentSchema.id, row.intentId));
    await db.update(schema.reviewRequestSchema).set({ status: 'cancelled' }).where(eq(schema.reviewRequestSchema.id, row.id));
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, row.intentId));
    const { getClientReviewOverview } = await import('./reviewRequests.server');
    const reads = vi.spyOn(db, 'select');
    await getClientReviewOverview(fixture.salonId, fixture.clientId);
    const baselineReads = reads.mock.calls.length;
    for (let index = 0; index < 20; index += 1) {
      const id = `${row.id}-${index}`;
      const intentId = `${row.intentId}-${index}`;
      await db.insert(schema.communicationIntentSchema).values({ ...intent!, id: intentId, dedupeKey: intentId, appointmentId: null });
      await db.insert(schema.reviewRequestSchema).values({ ...row, id, intentId, appointmentId: null, status: 'cancelled' });
    }
    reads.mockClear();
    const overview = await getClientReviewOverview(fixture.salonId, fixture.clientId);

    expect(overview).toMatchObject({ timeZone: 'America/Toronto', hasMore: true });
    expect(overview.history).toHaveLength(20);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(baselineReads);

    reads.mockRestore();
  });
});
