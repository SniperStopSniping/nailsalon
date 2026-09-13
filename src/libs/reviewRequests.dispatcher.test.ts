import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({ Env: {
  COMMUNICATIONS_SMS_ENABLED: 'true',
  TWILIO_ACCOUNT_SID: 'AC11111111111111111111111111111111',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111',
  NEXT_PUBLIC_APP_URL: 'https://luster.test',
} }));
vi.mock('@/libs/communicationRateLimit.server', () => ({ checkSharedSendRateLimits: async () => ({ allowed: true }) }));
vi.mock('@/libs/platformCommunicationControl', () => ({ readCommunicationControlUncached: async () => ({ smsEnabled: true, disabledEventTypes: [] }) }));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => client.close());

async function seedReview(input: { credits?: boolean } = {}) {
  sequence += 1;
  const salonId = `review-dispatch-salon-${sequence}`;
  const clientId = `review-dispatch-client-${sequence}`;
  const appointmentId = `review-dispatch-appt-${sequence}`;
  const recipient = `416555${String(2000 + sequence).padStart(4, '0')}`;
  const completedAt = new Date('2030-09-12T19:30:00.000Z');
  await db.insert(schema.salonSchema).values({
    id: salonId,
    slug: salonId,
    name: 'Dispatch Review Salon',
    settings: {
      communications: {
        sms: { enabled: true },
        quietHours: { enabled: false, start: '21:00', end: '09:00' },
      },
      booking: { timezone: 'America/Toronto' },
    } as never,
  });
  await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Sarah Client', phone: recipient });
  await db.insert(schema.communicationConsentSchema).values({
    id: `review-dispatch-consent-${sequence}`,
    salonId,
    recipient,
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
    clientPhone: recipient,
    startTime: new Date(completedAt.getTime() - 3_600_000),
    endTime: completedAt,
    completedAt,
    status: 'completed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.salonRetentionSettingsSchema).values({
    salonId,
    googleReviewUrl: 'https://g.page/r/luster-dispatch',
    automaticReviewRequests: false,
    reviewRequestDelayMinutes: 60,
  });
  const { appendLotGrant, lockCreditAccount } = await import('./billing/creditLedger');
  if (input.credits !== false) {
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, salonId);
      await appendLotGrant(tx, {
        salonId,
        bucket: 'purchased',
        amount: 10,
        expiresAt: null,
        idempotencyKey: `review-dispatch-credit-${sequence}`,
        reason: 'test',
      });
    });
  }
  const { scheduleReviewRequest } = await import('./reviewRequests.server');
  await scheduleReviewRequest(db, salonId, appointmentId, false);
  const [request] = await db.select().from(schema.reviewRequestSchema)
    .where(eq(schema.reviewRequestSchema.salonId, salonId));
  return { salonId, clientId, appointmentId, recipient, request: request! };
}

async function claim(intentId: string) {
  const { claimDueIntents } = await import('./communicationIntent');
  const claimed = await claimDueIntents({
    workerId: `review-worker-${sequence}`,
    batchLimit: 10,
    perSalonLimit: 1,
    now: new Date(Date.now() + 60_000),
  });
  const intent = claimed.find(row => row.id === intentId);

  expect(intent).toBeDefined();

  return intent!;
}

describe('review requests through the dispatcher', () => {
  it('uses the current Google link at send time and persists the accepted SMS snapshot', async () => {
    const fixture = await seedReview();
    const intent = await claim(fixture.request.intentId);
    await db.update(schema.salonRetentionSettingsSchema).set({ googleReviewUrl: 'https://g.page/r/luster-dispatch-updated' })
      .where(eq(schema.salonRetentionSettingsSchema.salonId, fixture.salonId));
    const provider = vi.fn(async () => ({ sid: 'SM_review_sent' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, new Date())).toBe('sent');
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      to: `+1${fixture.recipient}`,
      body: expect.stringContaining('https://g.page/r/luster-dispatch-updated'),
    }));

    const [stored] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, fixture.request.intentId));

    expect(stored).toMatchObject({
      status: 'sent',
      eventType: 'review_request',
      bodySnapshot: expect.stringContaining('https://g.page/r/luster-dispatch-updated'),
    });
  });

  it('does not resend a review request recovered from a possibly accepted provider call', async () => {
    const fixture = await seedReview();
    const claimed = await claim(fixture.request.intentId);
    const { recoverExpiredLeases } = await import('./communicationIntent');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    await db.update(schema.communicationIntentSchema).set({
      status: 'sending',
      leaseExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
    }).where(eq(schema.communicationIntentSchema.id, claimed.id));

    await recoverExpiredLeases(new Date('2035-01-01T00:00:00.000Z'));
    const [unknown] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, claimed.id));

    expect(unknown!.status).toBe('send_outcome_unknown');
    expect(await dispatchClaimedIntent(unknown!, vi.fn(async () => ({ sid: 'SM_must_not_send' })), new Date())).toBe('failed');
  });

  it('suppresses a scheduled review before provider delivery when the client opts out', async () => {
    const fixture = await seedReview();
    const intent = await claim(fixture.request.intentId);
    await db.update(schema.salonClientSchema).set({ reviewRequestsSuppressed: true })
      .where(and(eq(schema.salonClientSchema.id, fixture.clientId), eq(schema.salonClientSchema.salonId, fixture.salonId)));
    const provider = vi.fn(async () => ({ sid: 'SM_must_not_send' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, new Date())).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();
  });

  it('suppresses a scheduled review when transactional consent is revoked before delivery', async () => {
    const fixture = await seedReview();
    const intent = await claim(fixture.request.intentId);
    await db.insert(schema.communicationConsentSchema).values({
      id: `review-dispatch-revoked-${sequence}`,
      salonId: fixture.salonId,
      recipient: fixture.recipient,
      channel: 'sms',
      purpose: 'appointment_transactional',
      status: 'revoked',
      source: 'test',
      wordingVersion: 'test-v1',
      revokedAt: new Date('2040-01-01T00:00:00.000Z'),
      createdAt: new Date('2040-01-01T00:00:00.000Z'),
    });
    const provider = vi.fn(async () => ({ sid: 'SM_must_not_send' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, new Date())).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();
  });

  it('suppresses a scheduled review when a shared-sender STOP arrives before delivery', async () => {
    const fixture = await seedReview();
    const intent = await claim(fixture.request.intentId);
    await db.insert(schema.smsGlobalConsentEventSchema).values({
      id: `review-dispatch-stop-${sequence}`,
      senderIdentity: 'luster_shared_v1',
      recipient: fixture.recipient,
      state: 'suppressed',
      source: 'twilio_inbound',
      occurredAt: new Date(),
    });
    const provider = vi.fn(async () => ({ sid: 'SM_must_not_send' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, new Date())).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps a no-credit review request scheduled with an honest status', async () => {
    const fixture = await seedReview({ credits: false });
    const intent = await claim(fixture.request.intentId);
    const provider = vi.fn(async () => ({ sid: 'SM_must_not_send' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { getAppointmentReviewState } = await import('./reviewRequests.server');

    expect(await dispatchClaimedIntent(intent, provider, new Date())).toBe('blocked_no_credit');
    expect(provider).not.toHaveBeenCalled();
    await expect(getAppointmentReviewState(fixture.salonId, fixture.appointmentId))
      .resolves.toMatchObject({ status: 'scheduled', reason: 'Add SMS credits to send this review request.' });
  });

  it('records a provider rejection as failed instead of claiming the review was sent', async () => {
    const fixture = await seedReview();
    const intent = await claim(fixture.request.intentId);
    const provider = vi.fn(async () => {
      throw new Error('PROVIDER_REJECTED');
    });
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { getAppointmentReviewState } = await import('./reviewRequests.server');

    expect(await dispatchClaimedIntent(intent, provider, new Date())).toBe('failed');
    await expect(getAppointmentReviewState(fixture.salonId, fixture.appointmentId))
      .resolves.toMatchObject({ status: 'failed', reason: 'The review request could not be sent. It will not be retried automatically.' });
  });
});
