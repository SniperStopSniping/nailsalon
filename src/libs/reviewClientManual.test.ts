import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
}, usesRuntimePostgres: false }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let number = 0;
const now = new Date('2030-09-10T17:00:00.000Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

afterAll(async () => client.close());

async function seed() {
  number += 1;
  const salonId = `manual-review-salon-${number}`;
  const clientId = `manual-review-client-${number}`;
  const phone = `416555${String(1000 + number).padStart(4, '0')}`;
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Manual Review', settings: { communications: { sms: { enabled: true } }, booking: { timezone: 'America/Toronto' } } as never });
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Ava Client', phone });
  await db.insert(schema.communicationConsentSchema).values({
    id: `manual-review-consent-${number}`,
    salonId,
    recipient: phone,
    channel: 'sms',
    purpose: 'appointment_transactional',
    status: 'granted',
    source: 'test',
    wordingVersion: 'test-v1',
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: 'https://g.page/r/test/review',
    automaticReviewRequests: true,
    reviewRequestDelayMinutes: 60,
    reviewRequestsEnabledAt: new Date('2030-09-01T00:00:00.000Z'),
  });
  const appointmentId = `manual-review-appt-${number}`;
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    salonClientId: clientId,
    clientName: 'Ava Client',
    clientPhone: phone,
    startTime: new Date('2030-09-10T15:00:00.000Z'),
    endTime: new Date('2030-09-10T16:00:00.000Z'),
    status: 'completed',
    completedAt: new Date('2030-09-10T16:00:00.000Z'),
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  return { salonId, clientId, phone, appointmentId };
}

describe('manual client Google review requests (PGlite)', () => {
  it('keeps a custom appointmentless request durable and replays it before mutable phone or sender checks', async () => {
    const fixture = await seed();
    const { queueClientReviewRequest } = await import('./reviewRequests.server');
    const request = { ...fixture, message: 'Ava, would you share a Google review?', requestId: crypto.randomUUID(), now };
    const first = await queueClientReviewRequest(request);
    const [review] = await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.intentId, first.intentId));
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, first.intentId));

    expect(review).toMatchObject({ source: 'manual', appointmentId: null, completedAt: null, triggerId: null });
    expect(intent).toMatchObject({ eventType: 'review_request', appointmentId: null, variables: expect.objectContaining({ message: request.message, reviewRequestPurpose: 'client_google_review' }) });

    await db.update(schema.salonClientSchema).set({ phone: '4165559999', reviewRequestsSuppressed: true }).where(eq(schema.salonClientSchema.id, fixture.clientId));

    await expect(queueClientReviewRequest({ ...request, availability: { available: false, code: 'SENDER_NOT_READY', message: 'Unavailable' } }))
      .resolves.toEqual({ intentId: first.intentId, created: false });
    await expect(queueClientReviewRequest({ ...request, message: 'Changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('fails closed for an unavailable client and does not create a review row', async () => {
    const fixture = await seed();
    await db.update(schema.salonClientSchema).set({ reviewRequestsSuppressed: true }).where(eq(schema.salonClientSchema.id, fixture.clientId));
    const { queueClientReviewRequest } = await import('./reviewRequests.server');

    await expect(queueClientReviewRequest({ ...fixture, message: 'Review?', requestId: crypto.randomUUID(), now }))
      .rejects.toMatchObject({ code: 'REVIEW_INELIGIBLE' });
    expect(await db.select().from(schema.reviewRequestSchema).where(eq(schema.reviewRequestSchema.salonId, fixture.salonId))).toEqual([]);
  });

  it('does not cross tenants and fails closed for STOP or a missing review link', async () => {
    const fixture = await seed();
    const foreign = await seed();
    const { queueClientReviewRequest } = await import('./reviewRequests.server');
    const request = { salonId: fixture.salonId, clientId: fixture.clientId, message: 'Review?', requestId: crypto.randomUUID(), now };

    await expect(queueClientReviewRequest({ ...request, clientId: foreign.clientId })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });

    await db.update(schema.communicationConsentSchema).set({ status: 'revoked' })
      .where(eq(schema.communicationConsentSchema.salonId, fixture.salonId));

    await expect(queueClientReviewRequest(request)).rejects.toMatchObject({ code: 'REVIEW_INELIGIBLE' });

    await db.update(schema.communicationConsentSchema).set({ status: 'granted' })
      .where(eq(schema.communicationConsentSchema.salonId, fixture.salonId));
    await db.update(schema.salonRetentionSettingsSchema).set({ googleReviewUrl: null })
      .where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));

    await expect(queueClientReviewRequest({ ...request, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'REVIEW_INELIGIBLE' });
  });

  it('keeps automatic and client-manual pending reservations mutually exclusive for one identity', async () => {
    const automatic = await seed();
    const { queueClientReviewRequest, scheduleReviewRequest } = await import('./reviewRequests.server');
    await scheduleReviewRequest(db, automatic.salonId, automatic.appointmentId, true);

    await expect(queueClientReviewRequest({
      salonId: automatic.salonId,
      clientId: automatic.clientId,
      message: 'Please leave a review',
      requestId: crypto.randomUUID(),
      now,
    })).rejects.toMatchObject({ code: 'REVIEW_ALREADY_REQUESTED' });

    const manual = await seed();
    await queueClientReviewRequest({
      salonId: manual.salonId,
      clientId: manual.clientId,
      message: 'Please leave a review',
      requestId: crypto.randomUUID(),
      now,
    });
    await scheduleReviewRequest(db, manual.salonId, manual.appointmentId, true);

    expect(await db.select().from(schema.reviewRequestSchema)
      .where(eq(schema.reviewRequestSchema.salonId, manual.salonId))).toHaveLength(1);
  });
});
