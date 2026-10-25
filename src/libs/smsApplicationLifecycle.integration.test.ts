/**
 * Join the real tenant-scoped SMS queue, credit settlement, signed callbacks and
 * cost reconciliation against one disposable in-memory database. Only provider
 * transports and unrelated effects are replaced; domain helpers remain real.
 */
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  read: vi.fn(),
  env: {
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'external-fixture-fixed-test-token',
    TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111',
    COMMUNICATIONS_SMS_ENABLED: 'true',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1',
  },
}));
vi.mock('@/libs/DB', () => ({ get db() {
  return state.db;
}, usesRuntimePostgres: false }));
vi.mock('@/libs/Env', () => ({ Env: state.env }));
vi.mock('@/libs/communicationRateLimit.server', () => ({ checkSharedSendRateLimits: vi.fn(async () => ({ allowed: true })) }));
// Preserve real Twilio HMAC verification while replacing every SDK transport.
vi.mock('twilio', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('twilio') }>();
  const fake = Object.assign((account: string, token: string) => {
    if (account !== state.env.TWILIO_ACCOUNT_SID || token !== state.env.TWILIO_AUTH_TOKEN) {
      throw new Error('UNEXPECTED_PROVIDER_IDENTITY');
    }
    return { messages: (sid: string) => ({ fetch: () => state.read(sid) }) };
  }, { validateRequest: actual.default.validateRequest });
  return { ...actual, default: fake };
});
const unexpected = () => {
  throw new Error('UNEXPECTED_INTEGRATION_SIDE_EFFECT');
};
vi.mock('@/libs/email', () => ({ sendTransactionalEmail: () => unexpected(), sendTransactionalEmailDetailed: () => unexpected() }));
vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment: () => unexpected(),
  deterministicGoogleCalendarEventId: () => unexpected(),
  syncGoogleCalendarEventForAppointment: () => unexpected(),
  listGoogleCalendarEventsForSalon: () => unexpected(),
}));
vi.mock('@/libs/customerBookingEmail', () => ({ retryCustomerBookingConfirmationEmail: () => unexpected(), sendCustomerBookingConfirmationEmail: () => unexpected() }));
vi.mock('@/libs/clientLifecycleStabilization', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/clientLifecycleStabilization')>(),
  sendAppointmentOperationalEmailOnce: () => unexpected(),
}));
vi.mock('@/libs/appointmentManageLink', () => ({ mintAppointmentManageLink: () => unexpected() }));
vi.mock('@/libs/queries', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/queries')>(),
  updateSalonClientStats: () => unexpected(),
}));

function denyNetwork(): never {
  throw new Error('SMS_LIFECYCLE_NETWORK_FORBIDDEN');
}

let memory: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  // Guard the complete test, including a future accidental transport call.
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(denyNetwork);
  vi.spyOn(tls, 'connect').mockImplementation(denyNetwork);
  vi.spyOn(http, 'request').mockImplementation(denyNetwork);
  vi.spyOn(http, 'get').mockImplementation(denyNetwork);
  vi.spyOn(https, 'request').mockImplementation(denyNetwork);
  vi.spyOn(https, 'get').mockImplementation(denyNetwork);
  vi.stubGlobal('fetch', vi.fn(denyNetwork));
  memory = new PGlite(); // no URL, filesystem data directory, or external DB
  db = drizzle(memory, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  state.db = db;
}, 60000);

afterAll(async () => {
  try {
    if (memory) {
      await memory.close();
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

function signedRequest(url: string, params: Record<string, string>, valid = true) {
  if (new URL(url).hostname !== '127.0.0.1') {
    throw new Error('CALLBACK_MUST_BE_LOOPBACK');
  }
  const payload = url + Object.keys(params).sort().map(key => key + params[key]).join('');
  const signature = createHmac('sha1', valid ? state.env.TWILIO_AUTH_TOKEN : 'wrong-test-token').update(payload).digest('base64');
  return new Request(url, { method: 'POST', headers: { 'x-twilio-signature': signature, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
}

it('links scoped enqueue, debit, real signed callback, cost retry/replay and STOP without network', async () => {
  const run = randomUUID();
  const salonId = `external-${run}`;
  const otherSalonId = `other-${run}`;
  const clientId = `client-${run}`;
  const otherClientId = `other-client-${run}`;
  const phone = '4165550100'; // synthetic fixture only; transport always denied
  const sid = `SM${randomUUID().replaceAll('-', '')}`;
  const now = new Date();
  const settings = { communications: { sms: { enabled: true }, quietHours: { enabled: false, start: '21:00', end: '09:00' } } } as schema.Salon['settings'];
  await db.insert(schema.salonSchema).values([
    { id: salonId, slug: salonId, name: 'Synthetic SMS', settings },
    { id: otherSalonId, slug: otherSalonId, name: 'Synthetic Other', settings },
  ]);
  await db.insert(schema.salonClientSchema).values([
    { id: clientId, salonId, phone, fullName: 'Synthetic Client' },
    { id: otherClientId, salonId: otherSalonId, phone, fullName: 'Synthetic Other' },
  ]);
  await db.insert(schema.communicationConsentSchema).values({ id: randomUUID(), salonId, recipient: phone, channel: 'sms', purpose: 'salon_promotions', status: 'granted', wordingVersion: 'fixture-v1', source: 'test', grantedAt: now });
  const { appendLotGrant, lockCreditAccount } = await import('@/libs/billing/creditLedger');
  await db.transaction(async (tx) => {
    await lockCreditAccount(tx, salonId);
    await appendLotGrant(tx, { salonId, bucket: 'purchased', amount: 10, expiresAt: null, idempotencyKey: `grant-${run}`, reason: 'isolated-test' });
  });
  await db.execute(sql`UPDATE platform_communication_control SET sms_enabled = true WHERE id = 'singleton'`);
  (await import('@/libs/platformCommunicationControl')).__clearCommunicationControlCache();
  const { queueClientSms, retryClientSms } = await import('@/libs/clientMessaging');
  const input = { salonId, clientId, requestId: randomUUID(), message: 'Your appointment details are ready.', now };

  await expect(queueClientSms({ ...input, clientId: otherClientId })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });

  const queued = await queueClientSms(input);

  expect(await queueClientSms(input)).toEqual({ intentId: queued.intentId, created: false });

  const { claimDueIntents } = await import('@/libs/communicationIntent');
  const claimed = await claimDueIntents({ workerId: `worker-${run}`, batchLimit: 1, perSalonLimit: 1, now });

  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({ id: queued.intentId, salonId, recipient: phone });

  const providerSend = vi.fn(async (_input: { to: string }) => ({ sid }));
  const { dispatchClaimedIntent } = await import('@/libs/communicationDispatcher');

  expect(await dispatchClaimedIntent(claimed[0]!, providerSend, now)).toBe('sent');
  expect(providerSend).toHaveBeenCalledOnce();
  expect(providerSend).toHaveBeenCalledWith(expect.objectContaining({ to: `+1${phone}`, messagingServiceSid: state.env.TWILIO_MESSAGING_SERVICE_SID }));

  const [delivery] = await db.select().from(schema.notificationDeliverySchema).where(eq(schema.notificationDeliverySchema.intentId, queued.intentId));

  expect(delivery).toMatchObject({ salonId, providerMessageId: sid, settlementState: 'settled' });
  expect(delivery!.creditReservationId).toBeTruthy();

  const [reservation] = await db.select().from(schema.smsCreditReservationSchema).where(eq(schema.smsCreditReservationSchema.id, delivery!.creditReservationId!));

  expect(reservation).toMatchObject({ salonId, status: 'settled' });

  const ledgerBefore = (await db.execute(sql`SELECT * FROM sms_credit_ledger ORDER BY id`)).rows;
  const debitRows = ledgerBefore.filter(row => row.entry_type === 'debit');

  expect(debitRows).toHaveLength(1);
  expect(debitRows[0]).toMatchObject({ salon_id: salonId, amount: -delivery!.segmentCount! });

  const { POST: statusPost } = await import('@/app/api/integrations/twilio/status/route');
  const statusUrl = `http://127.0.0.1/api/integrations/twilio/status?deliveryId=${delivery!.id}`;
  const statusParams = { AccountSid: state.env.TWILIO_ACCOUNT_SID, MessageSid: sid, MessageStatus: 'delivered', To: providerSend.mock.calls[0]![0].to, MessagingServiceSid: state.env.TWILIO_MESSAGING_SERVICE_SID };
  const beforeInvalid = (await db.select().from(schema.notificationDeliverySchema)).map(row => JSON.stringify(row));

  expect((await statusPost(signedRequest(statusUrl, statusParams, false))).status).toBe(403);
  expect((await db.select().from(schema.notificationDeliverySchema)).map(row => JSON.stringify(row))).toEqual(beforeInvalid);
  expect((await db.select().from(schema.integrationOutboxSchema))).toHaveLength(0);

  // A genuine signature cannot replace required tenant-bound recipient identity.
  const missingRecipientParams = Object.fromEntries(Object.entries(statusParams).filter(([key]) => key !== 'To'));

  expect((await statusPost(signedRequest(statusUrl, missingRecipientParams))).status).toBe(403);
  expect((await db.select().from(schema.notificationDeliverySchema)).map(row => JSON.stringify(row))).toEqual(beforeInvalid);
  expect((await db.select().from(schema.integrationOutboxSchema))).toHaveLength(0);
  expect((await db.execute(sql`SELECT * FROM sms_credit_ledger ORDER BY id`)).rows).toEqual(ledgerBefore);
  expect((await statusPost(signedRequest(statusUrl, statusParams))).status).toBe(204);
  expect((await statusPost(signedRequest(statusUrl, statusParams))).status).toBe(204);

  const jobs = await db.select().from(schema.integrationOutboxSchema);

  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ salonId, provider: 'twilio' });

  const { processIntegrationOutbox, setTwilioCostFetcher } = await import('@/libs/integrationOutbox');
  setTwilioCostFetcher(null); // exercise production reader with SDK transport stub
  const actuals = { sid, accountSid: state.env.TWILIO_ACCOUNT_SID, messagingServiceSid: state.env.TWILIO_MESSAGING_SERVICE_SID, numSegments: String(delivery!.segmentCount), price: '-0.0079', priceUnit: 'usd' };
  state.read.mockResolvedValueOnce({ ...actuals, price: null, priceUnit: null }).mockResolvedValue(actuals);
  async function makeJobDue() {
    await db.update(schema.integrationOutboxSchema).set({ availableAt: new Date(Date.now() - 60000) }).where(eq(schema.integrationOutboxSchema.id, jobs[0]!.id));
  }
  await makeJobDue();
  await processIntegrationOutbox(); // entire DB is synthetic and contains exactly one job
  let [job] = await db.select().from(schema.integrationOutboxSchema);

  expect(job).toMatchObject({ status: 'retry', lastError: 'PROVIDER_ACTUALS_UNAVAILABLE' });

  await makeJobDue();
  await processIntegrationOutbox();
  [job] = await db.select().from(schema.integrationOutboxSchema);

  expect(job).toMatchObject({ status: 'completed', attempts: 2 });

  const [reconciled] = await db.select().from(schema.notificationDeliverySchema).where(eq(schema.notificationDeliverySchema.id, delivery!.id));

  expect(reconciled).toMatchObject({ status: 'delivered', providerMessageId: sid, providerPriceRaw: '-0.0079', providerCurrency: 'USD', providerSegments: delivery!.segmentCount });
  expect(reconciled!.reconciledAt).toBeTruthy();
  expect((await statusPost(signedRequest(statusUrl, statusParams))).status).toBe(204);

  await processIntegrationOutbox();

  expect(state.read).toHaveBeenCalledTimes(2);
  expect((await db.select().from(schema.integrationOutboxSchema))).toHaveLength(1);
  expect((await db.execute(sql`SELECT * FROM sms_credit_ledger ORDER BY id`)).rows).toEqual(ledgerBefore);
  await expect(retryClientSms({ salonId, clientId, intentId: queued.intentId, now })).rejects.toMatchObject({ code: 'RETRY_UNSAFE' });

  const { POST: inboundPost } = await import('@/app/api/integrations/twilio/inbound/route');
  const stop = { AccountSid: state.env.TWILIO_ACCOUNT_SID, MessageSid: `SM${randomUUID().replaceAll('-', '')}`, From: `+1${phone}`, To: '+14165559999', Body: 'STOP', MessagingServiceSid: state.env.TWILIO_MESSAGING_SERVICE_SID };

  expect((await inboundPost(signedRequest('http://127.0.0.1/api/integrations/twilio/inbound', stop))).status).toBe(200);

  // queueClientSms deliberately records intent; the dispatcher enforces fresh STOP.
  const next = await queueClientSms({ ...input, requestId: randomUUID() });
  const nextClaimed = await claimDueIntents({ workerId: `after-stop-${run}`, batchLimit: 1, perSalonLimit: 1, now });

  expect(nextClaimed).toHaveLength(1);
  expect(nextClaimed[0]!.id).toBe(next.intentId);

  const forbiddenSend = vi.fn(async () => {
    throw new Error('STOP_SEND_FORBIDDEN');
  });

  expect(await dispatchClaimedIntent(nextClaimed[0]!, forbiddenSend, now)).toBe('suppressed');
  expect(forbiddenSend).not.toHaveBeenCalled();
  expect((await db.execute(sql`SELECT * FROM sms_credit_ledger ORDER BY id`)).rows).toEqual(ledgerBefore);
  expect((await db.select().from(schema.communicationIntentSchema)).filter(row => row.salonId === otherSalonId)).toHaveLength(0);
  expect((await db.select().from(schema.notificationDeliverySchema)).filter(row => row.salonId === otherSalonId)).toHaveLength(0);
}, 30_000);
