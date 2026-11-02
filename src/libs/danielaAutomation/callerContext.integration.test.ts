import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { getCallerContext } from './callerContext.server';
import type { DanielaConfig } from './config';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const config: DanielaConfig = {
  mode: 'live',
  salonId: 'alert-isla',
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'synthetic',
  fromNumber: '+14165550101',
  publicOrigin: 'https://example.test',
  greeting: 'Test',
  bookingMessage: 'Test',
  promoMessage: 'Test',
  blockedPhones: [],
  preferredPhones: [],
  sheets: [{ spreadsheetId: 'main', tab: 'Sheet1', role: 'primary' }, { spreadsheetId: 'inbound', tab: 'CRM', role: 'inbound' }],
  telegramChatId: '1',
  campaignEnabled: false,
};
const now = new Date('2030-05-01T12:00:00Z');
const phone = '+14165550100';
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values([
    { id: config.salonId, slug: 'isla-nail-studio', name: 'Synthetic Isla' },
    { id: 'alert-other', slug: 'alert-other', name: 'Other salon' },
  ]);
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.serviceSchema);
  await db.update(schema.salonSchema).set({ isActive: true, deletedAt: null }).where(eq(schema.salonSchema.id, config.salonId));
});

afterAll(async () => client?.close());

const profile = (id = 'caller', salonId = config.salonId, savedPhone = '4165550100', fullName: string | null = 'Synthetic Alice') => db.insert(schema.salonClientSchema).values({ id, salonId, phone: savedPhone, fullName });
const booking = (id: string, extra: Partial<typeof schema.appointmentSchema.$inferInsert> = {}) => {
  const startTime = extra.startTime ?? new Date(now.getTime() + 86400_000);
  return db.insert(schema.appointmentSchema).values({
    id,
    salonId: config.salonId,
    salonClientId: 'caller',
    clientPhone: '4165550100',
    clientName: 'Booking name',
    startTime,
    endTime: new Date(startTime.getTime() + 3600_000),
    status: 'confirmed',
    totalPrice: 3500,
    totalDurationMinutes: 60,
    ...extra,
  });
};

it('finds the same-salon client and upcoming service snapshot without changing booking data', async () => {
  await profile();
  await booking('next');
  await db.insert(schema.serviceSchema).values({ id: 'service', salonId: config.salonId, name: 'Renamed service', price: 3500, durationMinutes: 60, category: 'manicure' });
  await db.insert(schema.appointmentServicesSchema).values({ id: 'item', appointmentId: 'next', serviceId: 'service', priceAtBooking: 3500, durationAtBooking: 60, nameSnapshot: 'Booked manicure' });
  const before = await db.select().from(schema.appointmentSchema);

  expect(await getCallerContext(config, phone, now)).toMatchObject({
    match: 'matched',
    name: 'Synthetic Alice',
    nextAppointment: { startTime: new Date(now.getTime() + 86400_000), status: 'confirmed', services: ['Booked manicure'] },
  });
  expect(await db.select().from(schema.appointmentSchema)).toEqual(before);
});

it('never borrows a name or appointment from another salon with the same phone', async () => {
  await profile();
  await profile('other-client', 'alert-other', '4165550100', 'Other private name');
  await booking('other-next', { salonId: 'alert-other', salonClientId: 'other-client', startTime: new Date(now.getTime() + 3600_000) });

  expect(await getCallerContext(config, phone, now)).toEqual({ match: 'matched', name: 'Synthetic Alice', nextAppointment: null });
});

it('does not identify a caller from an other-salon-only client record', async () => {
  await profile('other-client', 'alert-other', '4165550100', 'Other private name');

  expect(await getCallerContext(config, phone, now)).toEqual({ match: 'not_found', name: null, nextAppointment: null });
  expect(await getCallerContext({ ...config, salonId: 'alert-other' }, phone, now)).toEqual({ match: 'unavailable', name: null, nextAppointment: null });
});

it('selects the next pending or confirmed visit and ignores cancelled, deleted, held and past visits', async () => {
  await profile();
  await booking('cancelled', { status: 'cancelled', startTime: new Date(now.getTime() + 1000) });
  await booking('deleted', { deletedAt: now, startTime: new Date(now.getTime() + 2000) });
  await booking('held', { status: 'awaiting_payment', depositHoldExpiresAt: new Date(now.getTime() + 60000), startTime: new Date(now.getTime() + 3000) });
  await booking('past', { startTime: new Date(now.getTime() - 3600_000) });
  await booking('pending', { status: 'pending', startTime: new Date(now.getTime() + 3600_000) });
  await booking('later');

  expect((await getCallerContext(config, phone, now)).nextAppointment).toMatchObject({ status: 'pending', startTime: new Date(now.getTime() + 3600_000) });
});

it('honors stable booking ownership even when another client has a matching historical phone snapshot', async () => {
  await profile();
  await profile('different-client', config.salonId, '4165550102', 'Different client');
  await booking('different-owner', { salonClientId: 'different-client', clientPhone: '4165550100' });

  expect((await getCallerContext(config, phone, now)).nextAppointment).toBeNull();
});

it('can link a same-salon unlinked legacy booking by its formatted phone, without matching by shared email', async () => {
  await profile('caller', config.salonId, '4165550100', null);
  await booking('legacy', { salonClientId: null, clientPhone: '+1 (416) 555-0100', clientName: 'Legacy booking name' });

  expect(await getCallerContext(config, phone, now)).toMatchObject({ match: 'matched', name: 'Legacy booking name', nextAppointment: { status: 'confirmed' } });
});

it('does not attach client details when a current phone and another client alias disagree', async () => {
  await profile();
  await profile('alias-client', config.salonId, '4165550102', 'Private alias client');
  await db.insert(schema.salonClientContactAliasSchema).values({ salonId: config.salonId, salonClientId: 'alias-client', kind: 'phone', normalizedValue: '4165550100' });

  expect(await getCallerContext(config, phone, now)).toEqual({ match: 'ambiguous', name: null, nextAppointment: null });
});

it('does not identify a caller solely from an old phone alias after the client changed numbers', async () => {
  await profile('caller', config.salonId, '4165550102');
  await db.insert(schema.salonClientContactAliasSchema).values({ salonId: config.salonId, salonClientId: 'caller', kind: 'phone', normalizedValue: '4165550100' });

  expect(await getCallerContext(config, phone, now)).toEqual({ match: 'not_found', name: null, nextAppointment: null });
});

it('never enriches archived clients or a disabled Isla salon', async () => {
  await profile();
  await db.update(schema.salonClientSchema).set({ archivedAt: now }).where(eq(schema.salonClientSchema.id, 'caller'));

  expect((await getCallerContext(config, phone, now)).match).not.toBe('matched');

  await db.update(schema.salonSchema).set({ isActive: false }).where(eq(schema.salonSchema.id, config.salonId));

  expect(await getCallerContext(config, phone, now)).toEqual({ match: 'unavailable', name: null, nextAppointment: null });
});

it('does not reveal a different salon service name through an inconsistent legacy service link', async () => {
  await profile();
  await booking('next');
  await db.insert(schema.serviceSchema).values({ id: 'foreign-service', salonId: 'alert-other', name: 'Other private service', price: 3500, durationMinutes: 60, category: 'manicure' });
  await db.insert(schema.appointmentServicesSchema).values({ id: 'foreign-item', appointmentId: 'next', serviceId: 'foreign-service', priceAtBooking: 3500, durationAtBooking: 60 });

  expect((await getCallerContext(config, phone, now)).nextAppointment?.services).toEqual([]);
});
