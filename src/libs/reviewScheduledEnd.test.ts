import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
}, usesRuntimePostgres: false }));

const NOW = new Date('2030-09-12T19:30:00.000Z');
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(async () => {
  // A fairness/budget test intentionally leaves work pending. It must not
  // consume a later test's scan batch or real-time admission budget.
  await client.exec('TRUNCATE salon CASCADE; TRUNCATE sms_global_consent_event RESTART IDENTITY;');
  sequence = 0;
});

afterAll(async () => client.close());

async function seed(input: { mode?: 'scheduled_end' | 'manual' | null; status?: string; completedAt?: Date | null; start?: Date; end?: Date; enabledAt?: Date; createdAt?: Date } = {}) {
  sequence += 1;
  const salonId = `scheduled-end-salon-${sequence}`;
  const clientId = `scheduled-end-client-${sequence}`;
  const appointmentId = `scheduled-end-appointment-${sequence}`;
  const phone = `416555${String(1000 + sequence).padStart(4, '0')}`;
  const end = input.end ?? NOW;
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: salonId, settings: { communications: { sms: { enabled: true } }, booking: { timezone: 'America/Toronto' } } as never });
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Sarah', phone });
  await db.insert(schema.communicationConsentSchema).values({ id: `consent-${sequence}`, salonId, recipient: phone, channel: 'sms', purpose: 'appointment_transactional', status: 'granted', source: 'test', wordingVersion: 'test' });
  await db.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, salonClientId: clientId, clientName: 'Sarah', clientPhone: phone, startTime: input.start ?? new Date(end.getTime() - 3_600_000), endTime: end, createdAt: input.createdAt ?? new Date(end.getTime() - 86_400_000), status: input.status ?? 'confirmed', completedAt: input.completedAt ?? null, totalPrice: 5000, totalDurationMinutes: 60 });
  await db.insert(schema.salonRetentionSettingsSchema).values({ salonId, googleReviewUrl: 'https://g.page/r/test', automaticReviewRequests: true, reviewRequestAutomationMode: input.mode === undefined ? 'scheduled_end' : input.mode, reviewRequestsEnabledAt: input.enabledAt ?? new Date('2030-09-01T00:00:00Z'), reviewRequestDelayMinutes: 60 });
  return { salonId, clientId, appointmentId, phone };
}

async function seedAppointmentForSalon(fixture: Awaited<ReturnType<typeof seed>>) {
  sequence += 1;
  const appointmentId = `scheduled-end-appointment-${sequence}`;
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId: fixture.salonId,
    salonClientId: fixture.clientId,
    clientName: 'Sarah',
    clientPhone: fixture.phone,
    startTime: new Date(NOW.getTime() - 3_600_000),
    endTime: NOW,
    createdAt: new Date(NOW.getTime() - 86_400_000),
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  return appointmentId;
}

describe('scheduled-end review automation', () => {
  it.each(['confirmed', 'in_progress', 'completed'])('records and materializes %s without a completion timestamp', async (status) => {
    const fixture = await seed({ status, completedAt: null });
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(request).toMatchObject({ appointmentId: fixture.appointmentId, completedAt: null });
  });

  it('reports a materialized scheduled-end request as scheduled without an ineligible completion reason', async () => {
    const fixture = await seed({ status: 'confirmed', completedAt: null });
    const { getAppointmentReviewState, materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
    try {
      await expect(getAppointmentReviewState(fixture.salonId, fixture.appointmentId)).resolves.toMatchObject({
        status: 'scheduled',
        reason: 'Eligibility is checked again before sending.',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['manual', null] as const)('does not scan %s/legacy policy', async (mode) => {
    const fixture = await seed({ mode });
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it.each(['pending', 'awaiting_payment', 'cancelled', 'declined', 'no_show'])('excludes invalid status %s', async (status) => {
    const fixture = await seed({ status });
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it.each([
    ['end before start', { start: new Date(NOW.getTime() + 1), end: NOW }],
    ['created after end', { createdAt: new Date(NOW.getTime() + 1) }],
  ])('does not backfill invalid %s appointments', async (_name, input) => {
    const fixture = await seed(input);
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it('does not record an end that predates activation', async () => {
    const fixture = await seed({ enabledAt: new Date(NOW.getTime() + 1) });
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it.each(['cancelled', 'no_show'])('a captured end request fails pre-send after %s', async (status) => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, reviewRequestSendContext, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.update(schema.appointmentSchema).set({ status }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));

    await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toBeNull();
  });

  it('fails pre-send after either captured schedule snapshot changes', async () => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, reviewRequestSendContext, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.update(schema.appointmentSchema).set({ startTime: new Date(NOW.getTime() - 2 * 3_600_000) })
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
    try {
      await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a captured end request valid when later marked completed without changing the end', async () => {
    const fixture = await seed({ status: 'confirmed' });
    const { materializeCompletedReviewTriggers, reviewRequestSendContext, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.update(schema.appointmentSchema).set({ status: 'completed', completedAt: new Date(NOW.getTime() + 1) }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
    try {
      await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toEqual(expect.objectContaining({ message: expect.any(String) }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not authorize a scheduled-end request before its captured end', async () => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, reviewRequestSendContext, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() - 1));
    try {
      await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not recreate an already captured end identity on a later scan', async () => {
    const fixture = await seed();
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await scanScheduledEndReviewTriggers({ database: db, now: new Date(NOW.getTime() + 300_000) });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toHaveLength(1);
  });

  it('does not let 51 already captured identities starve a newly due end', async () => {
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    for (let index = 0; index < 51; index += 1) {
      const fixture = await seed();
      await scanScheduledEndReviewTriggers({ database: db, now: NOW });

      expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toHaveLength(1);
    }
    const fresh = await seed();
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fresh.salonId))).toHaveLength(1);
  }, 30_000);

  it('captures at most five uncaptured appointments for one salon in a scan', async () => {
    const fixture = await seed();
    await Promise.all(Array.from({ length: 5 }, () => seedAppointmentForSalon(fixture)));
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toHaveLength(5);
  });

  it('records an already-expired uncaptured end once as skipped', async () => {
    const oldEnd = new Date(NOW.getTime() - 26 * 60 * 60_000);
    const fixture = await seed({ end: oldEnd, start: new Date(oldEnd.getTime() - 3_600_000) });
    const { scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });

    expect(await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, fixture.salonId))).toMatchObject([{ state: 'skipped', reasonCode: 'EXPIRED' }]);
  });

  it('fails closed when a request is attached to a trigger from another salon', async () => {
    const first = await seed();
    const second = await seed();
    const { materializeCompletedReviewTriggers, reviewRequestSendContext, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, first.salonId));
    const [otherTrigger] = await db.select().from(schema.reviewRequestTriggerSchema).where(eq(schema.reviewRequestTriggerSchema.salonId, second.salonId));
    const [otherRequest] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, second.salonId));
    await db.update(schema.reviewRequestSchema).set({
      completedAt: NOW,
      triggerId: null,
    }).where(eq(schema.reviewRequestSchema.id, otherRequest!.id));
    await db.update(schema.reviewRequestSchema).set({ triggerId: otherTrigger!.id }).where(eq(schema.reviewRequestSchema.id, request!.id));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
    try {
      await expect(reviewRequestSendContext(first.salonId, request!.intentId)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when a linked scheduled-end trigger has the wrong kind', async () => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, reviewRequestSendContext, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.update(schema.reviewRequestTriggerSchema).set({ kind: 'completed' }).where(eq(schema.reviewRequestTriggerSchema.id, request!.triggerId!));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
    try {
      await expect(reviewRequestSendContext(fixture.salonId, request!.intentId)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending end-request reservation and materializes one replacement after an earlier reschedule', async () => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const earlierEnd = new Date(NOW.getTime() + 15 * 60_000);
    await db.update(schema.appointmentSchema).set({
      startTime: new Date(earlierEnd.getTime() - 3_600_000),
      endTime: earlierEnd,
    }).where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scanScheduledEndReviewTriggers({ database: db, now: earlierEnd });
    await materializeCompletedReviewTriggers({ database: db, now: earlierEnd });

    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    const intents = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, fixture.salonId));

    expect(requests).toHaveLength(2);
    expect(requests.filter(row => row.status === 'cancelled')).toHaveLength(1);
    expect(requests.filter(row => row.status === 'scheduled')).toHaveLength(1);
    expect(intents.filter(row => row.status === 'canceled')).toHaveLength(1);
    expect(intents.filter(row => row.status === 'pending')).toHaveLength(1);
  });

  it.each(['send_outcome_unknown', 'sending'] as const)('does not release a %s reservation during reschedule', async (status) => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.update(schema.communicationIntentSchema).set({ status }).where(eq(schema.communicationIntentSchema.id, request!.intentId));
    const earlierEnd = new Date(NOW.getTime() + 15 * 60_000);
    await db.update(schema.appointmentSchema).set({ startTime: new Date(earlierEnd.getTime() - 3_600_000), endTime: earlierEnd })
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scanScheduledEndReviewTriggers({ database: db, now: earlierEnd });
    await materializeCompletedReviewTriggers({ database: db, now: earlierEnd });
    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('scheduled');
  });

  it('does not release a pending reservation that has provider evidence', async () => {
    const fixture = await seed();
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } = await import('./reviewRequests.server');
    await scanScheduledEndReviewTriggers({ database: db, now: NOW });
    await materializeCompletedReviewTriggers({ database: db, now: NOW });
    const [request] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));
    await db.insert(schema.notificationDeliverySchema).values({
      id: `delivery-${fixture.appointmentId}`,
      salonId: fixture.salonId,
      appointmentId: fixture.appointmentId,
      channel: 'sms',
      purpose: 'review_request',
      dedupeKey: `delivery-${fixture.appointmentId}`,
      intentId: request!.intentId,
      providerMessageId: 'SM-provider-evidence',
      status: 'queued',
    });
    const earlierEnd = new Date(NOW.getTime() + 15 * 60_000);
    await db.update(schema.appointmentSchema).set({ startTime: new Date(earlierEnd.getTime() - 3_600_000), endTime: earlierEnd })
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scanScheduledEndReviewTriggers({ database: db, now: earlierEnd });
    await materializeCompletedReviewTriggers({ database: db, now: earlierEnd });
    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('scheduled');
  });

  it('leaves an unlinked manual request intact when an appointment is rescheduled', async () => {
    const fixture = await seed({ mode: 'manual', status: 'completed', completedAt: NOW });
    const { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers, scheduleReviewRequest } = await import('./reviewRequests.server');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000));
    try {
      await scheduleReviewRequest(db, fixture.salonId, fixture.appointmentId, false);
    } finally {
      vi.useRealTimers();
    }
    const earlierEnd = new Date(NOW.getTime() + 15 * 60_000);
    await db.update(schema.appointmentSchema).set({ startTime: new Date(earlierEnd.getTime() - 3_600_000), endTime: earlierEnd })
      .where(eq(schema.appointmentSchema.id, fixture.appointmentId));
    await scanScheduledEndReviewTriggers({ database: db, now: earlierEnd });
    await materializeCompletedReviewTriggers({ database: db, now: earlierEnd });
    const requests = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source: 'manual', status: 'scheduled', triggerId: null });
  });
});
