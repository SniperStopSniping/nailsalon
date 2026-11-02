import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import type { DanielaConfig } from './config';
import { BOOKING_COOLDOWN_MS } from './policy';
import { acquireWorker, claimSend, finishSend, importContacts, queueCampaign, recordInbound, recordStatus, releaseWorker, scrubOldBodies } from './store';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const config: DanielaConfig = {
  mode: 'live',
  salonId: 'isla-private-test',
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'synthetic-auth',
  fromNumber: '+14165550101',
  publicOrigin: 'https://example.test',
  greeting: 'Synthetic greeting',
  bookingMessage: 'Synthetic booking link',
  promoMessage: 'Synthetic promotion',
  blockedPhones: [],
  preferredPhones: [],
  sheets: [{ spreadsheetId: 'main', tab: 'Sheet1', role: 'primary' }, { spreadsheetId: 'copy', tab: 'CRM', role: 'inbound' }],
  telegramChatId: '1',
  campaignEnabled: true,
};
const now = new Date('2026-10-26T15:00:00Z');
const phone = '+14165550100';
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let seq = 0;
const inbound = (body = 'Hello', from = phone) => ({ kind: 'sms' as const, providerSid: `SM${String(++seq).padStart(32, '0')}`, from, body });
const row = (p = phone, extra = {}) => ({ phone: p, blocked: false, optedOut: false, campaignEligible: true, rowOrder: 2, lastBookingAt: null, promoAttemptedAt: null, promoAcceptedAt: null, lastInboundAt: null, lastMessage: null, lastInboundSid: null, ...extra });

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values([
    { id: config.salonId, slug: 'isla-nail-studio', name: 'Synthetic Isla' },
    { id: 'other-private-test', slug: 'other-private-test', name: 'Other salon' },
  ]);
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.danielaSendSchema);
  await db.delete(schema.danielaInboundSchema);
  await db.delete(schema.danielaContactSchema);
  await db.delete(schema.danielaAutomationStateSchema);
  await importContacts(config, [], now);
});

afterAll(async () => client?.close());

it('deduplicates a repeated provider event and holds distinct repeats behind the pending booking reply', async () => {
  const event = inbound();

  expect(await recordInbound(config, event, now)).toBe('queued');
  expect(await recordInbound(config, event, now)).toBe('duplicate');
  expect(await recordInbound(config, inbound(), now)).toBe('cooldown');
  expect(await db.select().from(schema.danielaSendSchema)).toHaveLength(1);
});

it('uses exactly seven days from accepted send, including the boundary', async () => {
  await recordInbound(config, inbound(), now);
  const send = (await claimSend(config, now))!;
  await finishSend(config, send, { sid: `SM${'f'.repeat(32)}` }, now);

  expect(await recordInbound(config, inbound(), new Date(now.getTime() + BOOKING_COOLDOWN_MS - 1))).toBe('cooldown');
  expect(await recordInbound(config, inbound(), new Date(now.getTime() + BOOKING_COOLDOWN_MS))).toBe('queued');
});

it('handles anonymous calls without attempting SMS', async () => {
  expect(await recordInbound(config, { ...inbound('', 'anonymous'), kind: 'call' }, now)).toBe('invalid_number');
  expect(await db.select().from(schema.danielaSendSchema)).toHaveLength(0);
});

it('applies STOP before a pending send, never books or cancels an appointment, and START does not grant marketing eligibility', async () => {
  await recordInbound(config, inbound(), now);

  expect(await recordInbound(config, inbound('CANCEL'), now)).toBe('stop');
  expect(await claimSend(config, now)).toBeNull();
  expect(await recordInbound(config, inbound('START'), now)).toBe('start');

  const [contact] = await db.select().from(schema.danielaContactSchema);

  expect(contact).toMatchObject({ providerOptOut: false, campaignEligible: false });
  expect(await recordInbound(config, inbound(), now)).toBe('queued');
});

it('preserves a fresh STOP across repeated imports and lets an actual START restore the provider preference', async () => {
  await recordInbound(config, inbound('STOP'), now);
  await importContacts(config, [row()], now);

  expect(await recordInbound(config, inbound(), now)).toBe('blocked');

  await recordInbound(config, inbound('START'), now);
  await importContacts(config, [row(phone, { optedOut: true })], now);

  expect(await recordInbound(config, inbound(), now)).toBe('queued');
});

it('does not automatically resend unknown provider outcomes, even after seven days', async () => {
  await recordInbound(config, inbound(), now);
  const send = (await claimSend(config, now))!;
  await finishSend(config, send, { unknown: true }, now);

  expect(await claimSend(config, now)).toBeNull();
  expect(await recordInbound(config, inbound(), new Date(now.getTime() + 8 * 86400_000))).toBe('cooldown');
});

it('parks interrupted sending as unknown instead of making it pending', async () => {
  await recordInbound(config, inbound(), now);
  await claimSend(config, now);
  await claimSend(config, new Date(now.getTime() + 121_000));
  const [send] = await db.select().from(schema.danielaSendSchema);

  expect(send!.state).toBe('unknown');
});

it('accepts signed callback evidence before the sender finishes and never regresses a delivered status', async () => {
  await recordInbound(config, inbound(), now);
  const send = (await claimSend(config, now))!;
  const params = { To: phone, From: config.fromNumber, MessageSid: `SM${'d'.repeat(32)}`, MessageStatus: 'delivered' };

  expect(await recordStatus(config, send.id, params, now)).toBe(true);

  await finishSend(config, send, { unknown: true }, now);
  await recordStatus(config, send.id, { ...params, MessageStatus: 'queued' }, now);
  const [stored] = await db.select().from(schema.danielaSendSchema);

  expect(stored).toMatchObject({ state: 'delivered', providerSid: params.MessageSid });
});

it('rejects cross-recipient callbacks and unsent intent adoption', async () => {
  await recordInbound(config, inbound(), now);
  const [send] = await db.select().from(schema.danielaSendSchema);
  const params = { To: phone, From: config.fromNumber, MessageSid: `SM${'e'.repeat(32)}`, MessageStatus: 'delivered' };

  expect(await recordStatus(config, send!.id, params, now)).toBe(false);

  await claimSend(config, now);

  expect(await recordStatus(config, send!.id, { ...params, To: '+14165550199' }, now)).toBe(false);
});

it('preserves existing campaign attempt markers and admits only one recipient per Toronto slot', async () => {
  await importContacts(config, [row(phone, { promoAttemptedAt: new Date(0) }), row('+14165550102', { rowOrder: 3 }), row('+14165550103', { rowOrder: 4 })], now);

  expect(await queueCampaign(config, now)).toBe(true);
  expect(await queueCampaign(config, now)).toBe(false);

  const [send] = await db.select().from(schema.danielaSendSchema);

  expect(send).toMatchObject({ phone: '+14165550102', purpose: 'promo' });
});

it('preserves campaign attempts after rejection rather than restarting from the first row', async () => {
  await importContacts(config, [row()], now);
  await queueCampaign(config, now);
  const send = (await claimSend(config, now))!;
  await finishSend(config, send, { errorCode: '21211' }, now);
  const next = new Date(now.getTime() + 30 * 60_000);
  await importContacts(config, [row()], next);

  expect(await queueCampaign(config, next)).toBe(false);
});

it('honors preferred recipients but never bypasses blocked phones', async () => {
  await importContacts(config, [row(), row('+14165550102', { rowOrder: 20 })], now);
  const preferred = { ...config, preferredPhones: ['+14165550102'], blockedPhones: ['+14165550102'] };
  await queueCampaign(preferred, now);

  expect((await db.select().from(schema.danielaSendSchema))[0]!.phone).toBe(phone);
});

it('requires fresh Sheets state before campaigning and removes eligibility when a row disappears', async () => {
  await importContacts(config, [row()], now);

  expect(await queueCampaign(config, new Date(now.getTime() + 30 * 60_000))).toBe(false);

  await importContacts(config, [], now);

  expect(await queueCampaign(config, now)).toBe(false);
});

it('does not dispatch a stale booking link', async () => {
  await recordInbound(config, inbound(), now);

  expect(await claimSend(config, new Date(now.getTime() + 16 * 60_000))).toBeNull();
  expect((await db.select().from(schema.danielaSendSchema))[0]!.state).toBe('suppressed');
});

it('keeps shadow work from consuming campaign attempts or making provider calls', async () => {
  const shadow = { ...config, mode: 'shadow' as const };
  await importContacts(shadow, [row()], now);
  await queueCampaign(shadow, now);

  expect(await claimSend(shadow, now)).toBeNull();

  const [contact] = await db.select().from(schema.danielaContactSchema);

  expect(contact!.promoAttemptedAt).toBeNull();
  expect((await db.select().from(schema.danielaSendSchema))[0]!.state).toBe('shadow');
});

it('refuses another salon even if its id is put in the configuration', async () => {
  await expect(importContacts({ ...config, salonId: 'other-private-test' }, [row()], now)).rejects.toThrow('DANIELA_SALON_NOT_AVAILABLE');
});

it('requires an import before any live inbound event', async () => {
  await db.delete(schema.danielaAutomationStateSchema);

  await expect(recordInbound(config, inbound(), now)).rejects.toThrow('DANIELA_MIGRATION_REQUIRED');
});

it('leases scheduled work and prevents a stale worker from releasing the current lease', async () => {
  expect(await acquireWorker(config, 'first', now)).toBe(true);
  expect(await acquireWorker(config, 'second', now)).toBe(false);
  expect(await acquireWorker(config, 'second', new Date(now.getTime() + 151000))).toBe(true);

  await releaseWorker(config, 'first');

  expect(await acquireWorker(config, 'third', new Date(now.getTime() + 152000))).toBe(false);
});

it('scrubs old message bodies while keeping opt-outs and provider event dedupe', async () => {
  await recordInbound(config, inbound('STOP'), now);
  await scrubOldBodies(config, new Date(now.getTime() + 91 * 86400_000));
  const [event] = await db.select().from(schema.danielaInboundSchema);
  const [contact] = await db.select().from(schema.danielaContactSchema);

  expect(event!.body).toBeNull();
  expect(contact).toMatchObject({ lastMessage: null, providerOptOut: true });
});

it('cascades private customer data when its salon is deleted', async () => {
  await recordInbound(config, inbound(), now);
  await db.delete(schema.salonSchema).where(eq(schema.salonSchema.id, config.salonId));

  expect(await db.select().from(schema.danielaSendSchema)).toHaveLength(0);
  expect(await db.select().from(schema.danielaInboundSchema)).toHaveLength(0);

  await db.insert(schema.salonSchema).values({ id: config.salonId, slug: 'isla-nail-studio', name: 'Synthetic Isla' });
});

it('does not enroll an inbound-only lead in the promotion when Sheets mirrors that contact', async () => {
  await recordInbound(config, inbound(), now);
  await importContacts(config, [row()], now);

  expect(await queueCampaign(config, now)).toBe(false);
});
