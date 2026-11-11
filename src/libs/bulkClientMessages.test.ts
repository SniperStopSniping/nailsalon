import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type BulkMessageDraft, matchesBulkMessageFilter } from '@/libs/bulkClientMessages';
import type { SmsOperationalHealth } from '@/libs/textingStatus';
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
const now = new Date('2030-11-11T16:00:00Z');
const sms = { manualAvailable: true, availableCredits: 1000, blockingReason: null, detail: '' } as SmsOperationalHealth;
let sequence = 0;

async function seed() {
  sequence += 1;
  const salonId = `bulk-salon-${sequence}`;
  const ids = ['old', 'recent', 'new', 'blocked', 'booked', 'optout', 'duplicate', 'archived', 'merged'].map(name => `${salonId}-${name}`);
  await db.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Isla Test', settings: { booking: { timezone: 'America/Toronto' }, communications: { sms: { enabled: true } } } as never });
  await db.insert(schema.salonClientSchema).values(ids.map((id, index) => ({ id, salonId, fullName: ['Ava Old', 'Bea Recent', 'Cam New', 'Dee Blocked', 'Eve Booked', 'Fay Optout', 'Gina Duplicate', 'Hana Archived', 'Ivy Merged'][index], phone: index === 6 ? '+14165551000' : `416555${1000 + index}`, isBlocked: index === 3, archivedAt: index === 7 ? now : null })));
  for (const [index, days] of [[8, 30], [1, 7], [3, 35], [4, 28], [5, 33]] as const) {
    const ended = new Date(now.getTime() - days * 86400000);
    await db.insert(schema.appointmentSchema).values({ id: `${ids[index]}-visit`, salonId, salonClientId: ids[index]!, clientPhone: `416555${1000 + index}`, status: 'completed', completedAt: ended, startTime: new Date(ended.getTime() - 3600000), endTime: ended, totalPrice: 5000, totalDurationMinutes: 60 });
  }
  // Reproduce historical merges; new merge creation is intentionally retired.
  await db.execute(sql`ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition`);
  try {
    await db.update(schema.salonClientSchema).set({ mergedIntoClientId: ids[0]! }).where(eq(schema.salonClientSchema.id, ids[8]!));
  } finally {
    await db.execute(sql`ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition`);
  }
  await db.insert(schema.appointmentSchema).values({ id: `${salonId}-future`, salonId, salonClientId: ids[4]!, clientPhone: '4165551004', status: 'confirmed', startTime: new Date(now.getTime() + 86400000), endTime: new Date(now.getTime() + 90000000), totalPrice: 5000, totalDurationMinutes: 60 });
  await db.insert(schema.communicationConsentSchema).values({ id: `${salonId}-stop`, salonId, channel: 'sms', recipient: '4165551005', purpose: 'appointment_transactional', status: 'revoked', source: 'twilio_inbound', wordingVersion: 'test' });
  return { salonId, ids };
}

const draft = (ids: string[], filter: BulkMessageDraft['filter'] = { minWeeks: 3, excludeUpcoming: true }): BulkMessageDraft => ({ salonSlug: 'test', clientIds: ids, message: 'We would love to see you again! Book your visit.', filter });

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 30000);

afterAll(async () => client.close());

describe('bulk client messages', () => {
  it('uses completed history including merged records and excludes unsafe recipients', async () => {
    const { getBulkMessageClients, previewBulkClientMessage } = await import('./bulkClientMessages.server');
    const { salonId, ids } = await seed();
    const clients = await getBulkMessageClients(salonId, now);

    expect(clients).toHaveLength(7);
    expect(clients.find(row => row.id === ids[0])?.lastCompletedAt).toBe(new Date(now.getTime() - 30 * 86400000).toISOString());
    expect(clients.find(row => row.id === ids[3])?.eligible).toBe(false);
    expect(clients.find(row => row.id === ids[5])?.eligible).toBe(false);

    const preview = await previewBulkClientMessage(salonId, draft(ids.slice(0, 7)), now);

    expect(preview.recipients.map(row => row.id)).toEqual([ids[0]]);
    expect(preview.skipped).toBe(6);
    expect(preview.body).toContain('Isla Test via Luster:');
    expect(preview.body).toContain('Reply STOP to opt out.');
    expect(await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, salonId))).toHaveLength(0);
  });

  it('selects all or individuals, deduplicates mobile numbers, and binds replays to the exact reviewed send', async () => {
    const { previewBulkClientMessage, queueBulkClientMessage } = await import('./bulkClientMessages.server');
    const { salonId, ids } = await seed();
    const input = draft([ids[0]!, ids[1]!, ids[2]!, ids[6]!], { minWeeks: null, excludeUpcoming: false });
    const preview = await previewBulkClientMessage(salonId, input, now);

    expect(preview.recipients).toHaveLength(3);

    const request = { ...input, salonId, now, sms, requestId: crypto.randomUUID(), previewFingerprint: preview.fingerprint };
    const [first, second] = await Promise.all([queueBulkClientMessage(request), queueBulkClientMessage(request)]);

    expect(first.queued).toBe(3);
    expect(first.messages.map(row => row.id)).toEqual(second.messages.map(row => row.id));
    expect(await queueBulkClientMessage({ ...request, sms: { ...sms, manualAvailable: false } })).toEqual(first);
    await expect(queueBulkClientMessage({ ...request, message: 'Different message' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(queueBulkClientMessage({ ...request, clientIds: [ids[0]!] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, salonId))).toHaveLength(3);
  });

  it('requires another review after a block or opt-out and never partially queues a changed audience', async () => {
    const { previewBulkClientMessage, queueBulkClientMessage } = await import('./bulkClientMessages.server');
    const { salonId, ids } = await seed();
    const input = draft([ids[0]!, ids[1]!], { minWeeks: null, excludeUpcoming: false });
    const preview = await previewBulkClientMessage(salonId, input, now);
    await db.update(schema.salonClientSchema).set({ isBlocked: true }).where(eq(schema.salonClientSchema.id, ids[1]!));

    await expect(queueBulkClientMessage({ ...input, salonId, now, sms, requestId: crypto.randomUUID(), previewFingerprint: preview.fingerprint })).rejects.toMatchObject({ code: 'AUDIENCE_CHANGED' });
    expect(await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, salonId))).toHaveLength(0);
  });

  it('rejects cross-salon selections and insufficient credits before committing any intents', async () => {
    const { previewBulkClientMessage, queueBulkClientMessage } = await import('./bulkClientMessages.server');
    const own = await seed();
    const other = await seed();
    const input = draft([own.ids[0]!]);
    const preview = await previewBulkClientMessage(own.salonId, input, now);
    const request = { ...input, salonId: own.salonId, now, sms, requestId: crypto.randomUUID(), previewFingerprint: preview.fingerprint };

    await expect(queueBulkClientMessage({ ...request, clientIds: [own.ids[0]!, other.ids[0]!] })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(queueBulkClientMessage({ ...request, sms: { ...sms, availableCredits: 0 } })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, own.salonId))).toHaveLength(0);
  });

  it('dispatches a bulk intent through the existing credit ledger and suppresses a newly booked client', async () => {
    const { getBulkMessageReceipt, previewBulkClientMessage, queueBulkClientMessage } = await import('./bulkClientMessages.server');
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const { salonId, ids } = await seed();
    const input = draft([ids[0]!]);
    const preview = await previewBulkClientMessage(salonId, input, now);
    const queued = await queueBulkClientMessage({ ...input, salonId, now, sms, requestId: crypto.randomUUID(), previewFingerprint: preview.fingerprint });
    await db.insert(schema.smsCreditLedgerSchema).values({ id: `${salonId}-credit`, salonId, entryType: 'grant', bucket: 'purchased', amount: 100, idempotencyKey: `${salonId}-grant`, reason: 'isolated-test' });
    const [intent] = await db.update(schema.communicationIntentSchema).set({ status: 'claimed', attempts: 1 }).where(eq(schema.communicationIntentSchema.id, queued.messages[0]!.id)).returning();
    const provider = vi.fn().mockResolvedValue({ sid: 'SM11111111111111111111111111111111' });

    expect(await dispatchClaimedIntent(intent!, provider, now)).toBe('sent');
    expect(provider).toHaveBeenCalledOnce();

    const [delivery] = await db.select().from(schema.notificationDeliverySchema).where(eq(schema.notificationDeliverySchema.intentId, intent!.id));

    expect(delivery?.settlementState).toBe('settled');

    await db.update(schema.notificationDeliverySchema).set({ status: 'delivered' }).where(eq(schema.notificationDeliverySchema.id, delivery!.id));

    expect((await getBulkMessageReceipt(salonId, queued.requestId)).messages[0]?.status).toBe('delivered');

    const another = await queueBulkClientMessage({ ...input, salonId, now, sms, requestId: crypto.randomUUID(), previewFingerprint: preview.fingerprint });
    const [next] = await db.update(schema.communicationIntentSchema).set({ status: 'claimed', attempts: 1 }).where(eq(schema.communicationIntentSchema.id, another.messages[0]!.id)).returning();
    await db.insert(schema.appointmentSchema).values({ id: `${salonId}-new-booking`, salonId, salonClientId: ids[0]!, clientPhone: '4165551000', status: 'confirmed', startTime: new Date(now.getTime() + 86400000), endTime: new Date(now.getTime() + 90000000), totalPrice: 5000, totalDurationMinutes: 60 });

    expect(await dispatchClaimedIntent(next!, provider, now)).toBe('suppressed');
    expect(provider).toHaveBeenCalledOnce();
  });

  it('compares three full calendar weeks across daylight saving and excludes clients without completed visits', () => {
    const base = { id: 'c', fullName: 'Client', phone: '4165550000', lastCompletedAt: '2026-10-21T22:00:00Z', hasUpcomingAppointment: false, eligible: true, unavailableReason: null };
    const filter = { minWeeks: 3, excludeUpcoming: true };

    expect(matchesBulkMessageFilter(base, filter, new Date('2026-11-11T15:00:00Z'), 'America/Toronto')).toBe(true);
    expect(matchesBulkMessageFilter({ ...base, lastCompletedAt: '2026-10-22T14:00:00Z' }, filter, new Date('2026-11-11T15:00:00Z'), 'America/Toronto')).toBe(false);
    expect(matchesBulkMessageFilter({ ...base, lastCompletedAt: null }, filter, now, 'America/Toronto')).toBe(false);
  });
});
