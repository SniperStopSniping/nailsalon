import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({ Env: {
  TWILIO_ACCOUNT_SID: 'AC11111111111111111111111111111111',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111',
  COMMUNICATIONS_SMS_ENABLED: 'true',
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
const now = new Date('2030-09-10T17:00:00Z');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values([
    { id: 'sms-salon', slug: 'sms-salon', name: 'Test Salon', settings: { communications: { sms: { enabled: true } } } as any },
    { id: 'other-salon', slug: 'other-salon', name: 'Other Salon' },
  ]);
  await db.insert(schema.salonClientSchema).values([
    { id: 'sms-client', salonId: 'sms-salon', phone: '4165550100', fullName: 'Test Client' },
    { id: 'other-client', salonId: 'other-salon', phone: '4165550100', fullName: 'Other Client' },
    { id: 'invalid-client', salonId: 'sms-salon', phone: 'not-a-phone' },
  ]);
  await db.insert(schema.appointmentSchema).values([
    { id: 'sms-appt', salonId: 'sms-salon', salonClientId: 'sms-client', clientName: 'Test', clientPhone: '4165550100', startTime: new Date('2030-09-11T18:00:00Z'), endTime: new Date('2030-09-11T19:00:00Z'), status: 'confirmed', totalPrice: 5000, totalDurationMinutes: 60 },
    { id: 'other-appt', salonId: 'other-salon', salonClientId: 'other-client', clientName: 'Test', clientPhone: '4165550100', startTime: new Date('2030-09-11T18:00:00Z'), endTime: new Date('2030-09-11T19:00:00Z'), status: 'confirmed', totalPrice: 5000, totalDurationMinutes: 60 },
  ]);
}, 30000);

afterAll(async () => client.close());

function input(overrides: Record<string, unknown> = {}) {
  return { salonId: 'sms-salon', clientId: 'sms-client', appointmentId: 'sms-appt', requestId: crypto.randomUUID(), message: 'Please use your booking link to make changes.', now, ...overrides };
}

describe('durable manual client texting', () => {
  it('dispatches a queued manual text through the shared sender with consent and credits', async () => {
    const { queueClientSms } = await import('./clientMessaging');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    await db.insert(schema.communicationConsentSchema).values({
      id: 'consent-manual',
      salonId: 'sms-salon',
      channel: 'sms',
      purpose: 'appointment_transactional',
      recipient: '4165550100',
      status: 'granted',
      source: 'booking',
      wordingVersion: 'test-v1',
    });
    await db.insert(schema.smsCreditLedgerSchema).values({
      id: 'manual-credit-lot',
      salonId: 'sms-salon',
      entryType: 'grant',
      bucket: 'purchased',
      amount: 100,
      idempotencyKey: 'manual-test-grant',
      reason: 'isolated-test',
    });
    const queued = await queueClientSms(input());
    const [intent] = await db.update(schema.communicationIntentSchema).set({ status: 'claimed', attempts: 1 })
      .where(eq(schema.communicationIntentSchema.id, queued.intentId)).returning();
    const provider = vi.fn().mockResolvedValue({ sid: 'SM11111111111111111111111111111111' });

    expect(await dispatchClaimedIntent(intent!, provider, now)).toBe('sent');
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ to: '+14165550100', body: expect.stringContaining('Test Salon via Luster:') }));

    const [delivery] = await db.select().from(schema.notificationDeliverySchema).where(eq(schema.notificationDeliverySchema.intentId, queued.intentId));

    expect(delivery).toMatchObject({ providerMessageId: 'SM11111111111111111111111111111111', settlementState: 'settled' });
  });

  it('observes the original request after credits run out instead of creating another message', async () => {
    const { queueClientSms } = await import('./clientMessaging');
    const request = input();
    const first = await queueClientSms(request);

    expect(await queueClientSms({ ...request, availability: { available: false, code: 'NO_CREDITS', message: 'No credits.' } }))
      .toEqual({ intentId: first.intentId, created: false });
    await expect(queueClientSms({ ...input(), availability: { available: false, code: 'SENDER_NOT_READY', message: 'Texting is not set up yet.' } }))
      .rejects.toMatchObject({ code: 'SENDER_NOT_READY', status: 409 });
  });

  it('queues one message for repeated and concurrent clicks, using the current scoped client contact', async () => {
    const { queueClientSms, getClientSmsHistory } = await import('./clientMessaging');
    const request = input();
    const results = await Promise.all([queueClientSms(request), queueClientSms(request)]);

    expect(results[0]!.intentId).toBe(results[1]!.intentId);
    expect(results.filter(result => result.created)).toHaveLength(1);

    const [row] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, results[0]!.intentId));

    expect(row).toMatchObject({ salonId: 'sms-salon', appointmentId: 'sms-appt', recipient: '4165550100', eventType: 'manual_text', status: 'pending', variables: { clientId: 'sms-client', message: request.message } });
    expect(await getClientSmsHistory({ salonId: 'other-salon', clientId: 'other-client' })).toEqual([]);
    await expect(queueClientSms({ ...request, message: 'Different body' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('keeps one action and its history when the client number changes after a lost response', async () => {
    const { queueClientSms, getClientSmsHistory } = await import('./clientMessaging');
    await db.insert(schema.salonClientSchema).values([
      { id: 'edited-client', salonId: 'sms-salon', phone: '4165550120' },
    ]);
    const request = input({ clientId: 'edited-client', appointmentId: undefined });
    const first = await queueClientSms(request);
    await db.update(schema.salonClientSchema).set({ phone: '4165550121' })
      .where(eq(schema.salonClientSchema.id, 'edited-client'));

    expect(await queueClientSms(request)).toEqual({ intentId: first.intentId, created: false });
    expect(await getClientSmsHistory({ salonId: 'sms-salon', clientId: 'edited-client' }))
      .toEqual([expect.objectContaining({ id: first.intentId })]);
  });

  it('denies a client or appointment in another tenant even with the same phone', async () => {
    const { queueClientSms, getClientSmsHistory } = await import('./clientMessaging');

    await expect(queueClientSms(input({ clientId: 'other-client' }))).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(queueClientSms(input({ appointmentId: 'other-appt' }))).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
    await expect(getClientSmsHistory({ salonId: 'other-salon', clientId: 'sms-client' })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
  });

  it('rejects an invalid number without creating an intent', async () => {
    const { queueClientSms } = await import('./clientMessaging');

    await expect(queueClientSms(input({ clientId: 'invalid-client', appointmentId: undefined }))).rejects.toMatchObject({ code: 'INVALID_CLIENT_PHONE' });
  });

  it('defers a manual message to the salon-local end of quiet hours', async () => {
    const { queueClientSms } = await import('./clientMessaging');
    const result = await queueClientSms(input({ now: new Date('2030-09-11T02:00:00Z') }));
    const [row] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, result.intentId));

    expect(row!.scheduledFor.toISOString()).toBe('2030-09-11T13:00:00.000Z');
  });

  it('retries a proven rejection on the same intent and delivery but fences accepted or uncertain results', async () => {
    const { queueClientSms, retryClientSms, getClientSmsHistory } = await import('./clientMessaging');
    const result = await queueClientSms(input());
    const deliveryId = `delivery-${result.intentId}`;
    await db.insert(schema.notificationDeliverySchema).values({ id: deliveryId, salonId: 'sms-salon', appointmentId: 'sms-appt', channel: 'sms', purpose: 'manual_text', dedupeKey: deliveryId, status: 'failed', retryable: true, settlementState: 'not_applicable', intentId: result.intentId });
    await db.update(schema.communicationIntentSchema).set({ status: 'failed', deliveryId, lastError: 'PROVIDER_SYNC_REJECT' }).where(eq(schema.communicationIntentSchema.id, result.intentId));

    expect((await getClientSmsHistory({ salonId: 'sms-salon', clientId: 'sms-client' })).find(row => row.id === result.intentId)).toMatchObject({ status: 'failed', canRetry: true });

    await retryClientSms({ salonId: 'sms-salon', clientId: 'sms-client', intentId: result.intentId, now });
    const [row] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, result.intentId));

    expect(row).toMatchObject({ status: 'pending', deliveryId });

    await db.update(schema.communicationIntentSchema).set({ status: 'send_outcome_unknown' }).where(eq(schema.communicationIntentSchema.id, result.intentId));

    await expect(retryClientSms({ salonId: 'sms-salon', clientId: 'sms-client', intentId: result.intentId, now })).rejects.toMatchObject({ code: 'RETRY_UNSAFE' });

    await db.update(schema.communicationIntentSchema).set({ status: 'sent' }).where(eq(schema.communicationIntentSchema.id, result.intentId));
    await db.update(schema.notificationDeliverySchema).set({ status: 'undelivered', providerMessageId: 'SM-test' }).where(eq(schema.notificationDeliverySchema.id, deliveryId));

    expect((await getClientSmsHistory({ salonId: 'sms-salon', clientId: 'sms-client' })).find(item => item.id === result.intentId)).toMatchObject({ status: 'undelivered', canRetry: false });
    await expect(retryClientSms({ salonId: 'other-salon', clientId: 'other-client', intentId: result.intentId, now })).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
  });
});
