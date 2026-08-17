/**
 * Email lane proofs — Gate C1 (blueprint H1 minimal lane). Email is not SMS:
 * no credits, no consent gates, no rate limiting. What must hold: an email
 * intent dispatches through the injected send function with a REAL delivery
 * row (the intent's delivery FK is enforced), failures record on both the
 * intent and the delivery, an unwired lane fails closed, and the SMS lane's
 * behavior is untouched.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import type { EmailSendFn } from './communicationDispatcher';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  COMMUNICATIONS_SMS_ENABLED: undefined as string | undefined,
  TWILIO_MESSAGING_SERVICE_SID: undefined,
  TWILIO_ACCOUNT_SID: undefined,
  TWILIO_AUTH_TOKEN: undefined,
  LUSTER_SMS_SENDER_IDENTITY: undefined,
  SMS_PILOT_ENABLED: undefined,
  SMS_PILOT_SALON_ALLOWLIST: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

vi.mock('@/libs/communicationRateLimit.server', () => ({
  checkSharedSendRateLimits: vi.fn(async () => ({ allowed: true })),
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id });
}

async function enqueueEmailIntent(salonId: string, dedupeKey: string, templateKey = 'email_booking_confirmation') {
  const { enqueueCommunicationIntent } = await import('./communicationIntent');
  return enqueueCommunicationIntent({
    salonId,
    channel: 'email',
    eventType: 'booking_confirmation',
    audience: 'client',
    dedupeKey,
    recipient: 'client@example.com',
    templateKey,
    templateVersion: 'v1',
    variables: { salonName: 'Test Salon', startTime: 'Wed Aug 26, 12:30 PM' },
    schedulingRevision: 'rev1',
    scheduledFor: new Date('2026-09-01T12:00:00.000Z'),
    notAfter: new Date('2026-09-02T12:00:00.000Z'),
  });
}

const NOW = new Date('2026-09-01T16:00:00.000Z');
const failingProviderSend = vi.fn(async () => {
  throw new Error('SMS_LANE_MUST_NOT_BE_CALLED');
});

describe('dispatcher email lane', () => {
  it('dispatches an email intent through the injected sender with a real delivery row', async () => {
    const { processDueCommunications } = await import('./communicationDispatcher');
    await seedSalon('s_e1');
    const { intentId } = await enqueueEmailIntent('s_e1', 'e1:confirm:email');
    const emailSend = vi.fn<EmailSendFn>(async () => ({ delivered: true }));

    const summary = await processDueCommunications({
      workerId: 'w_email',
      providerSend: failingProviderSend,
      emailSend,
      now: NOW,
    });

    expect(summary.sent).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend.mock.calls[0]![0]).toMatchObject({
      intentId,
      recipient: 'client@example.com',
      subject: 'Booking confirmed — Test Salon',
    });
    expect(failingProviderSend).not.toHaveBeenCalled();

    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, intentId));

    expect(intent!.status).toBe('sent');
    expect(intent!.deliveryId).not.toBeNull();

    const [delivery] = await db.select().from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.id, intent!.deliveryId!));

    expect(delivery).toMatchObject({ channel: 'email', status: 'sent', intentId });
  });

  it('fails closed with EMAIL_LANE_NOT_WIRED when no sender is injected', async () => {
    const { processDueCommunications } = await import('./communicationDispatcher');
    await seedSalon('s_e2');
    const { intentId } = await enqueueEmailIntent('s_e2', 'e2:confirm:email');

    const summary = await processDueCommunications({
      workerId: 'w_email',
      providerSend: failingProviderSend,
      now: NOW,
    });

    expect(summary.failed).toBe(1);

    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, intentId));

    expect(intent).toMatchObject({ status: 'failed', lastError: 'EMAIL_LANE_NOT_WIRED' });
  });

  it('records a send failure on both the intent and the delivery row', async () => {
    const { processDueCommunications } = await import('./communicationDispatcher');
    await seedSalon('s_e3');
    const { intentId } = await enqueueEmailIntent('s_e3', 'e3:confirm:email');
    const emailSend = vi.fn<EmailSendFn>(async () => {
      throw new Error('RESEND_DOWN');
    });

    const summary = await processDueCommunications({
      workerId: 'w_email',
      providerSend: failingProviderSend,
      emailSend,
      now: NOW,
    });

    expect(summary.failed).toBe(1);

    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, intentId));

    expect(intent).toMatchObject({ status: 'failed', lastError: 'RESEND_DOWN' });

    const [delivery] = await db.select().from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.intentId, intentId));

    expect(delivery).toMatchObject({ status: 'failed', errorMessage: 'RESEND_DOWN' });
  });

  it('fails an unknown email template key without calling the sender', async () => {
    const { processDueCommunications } = await import('./communicationDispatcher');
    await seedSalon('s_e4');
    const { intentId } = await enqueueEmailIntent('s_e4', 'e4:confirm:email', 'email_not_a_template');
    const emailSend = vi.fn<EmailSendFn>(async () => ({ delivered: true }));

    await processDueCommunications({
      workerId: 'w_email',
      providerSend: failingProviderSend,
      emailSend,
      now: NOW,
    });

    expect(emailSend).not.toHaveBeenCalled();

    const [intent] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, intentId));

    expect(intent).toMatchObject({ status: 'failed', lastError: 'TEMPLATE_UNKNOWN' });
  });
});
