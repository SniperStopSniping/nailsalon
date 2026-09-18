import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({ Env: { LUSTER_SMS_SENDER_IDENTITY: 'test-sender' } }));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let sequence = 0;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
  await database.insert(schema.salonSchema).values([
    { id: 'prefs-a', slug: 'prefs-a', name: 'A' },
    { id: 'prefs-b', slug: 'prefs-b', name: 'B' },
  ]);
}, 30000);

afterAll(async () => client.close());

async function preference(phone: string, status: 'granted' | 'revoked', overrides: Record<string, unknown> = {}) {
  sequence += 1;
  await database.insert(schema.communicationConsentSchema).values({
    id: `pref-${sequence}`,
    salonId: 'prefs-a',
    recipient: phone,
    channel: 'sms',
    purpose: 'appointment_reminders',
    status,
    source: 'public_booking',
    wordingVersion: 'booking-sms-reminders-v1',
    createdAt: new Date(1900000000000 + sequence * 1000),
    metadata: { selection: status === 'granted' ? 'default_on' : 'explicit_off', appointmentId: 'appt-a' },
    ...overrides,
  });
}

describe('appointment reminder preference reader', () => {
  it('normalizes phone, preserves selection provenance, and never reads another tenant', async () => {
    const { getAppointmentSmsPreference } = await import('./bookingSmsConsent.server');
    await preference('4165550101', 'granted');

    expect(await getAppointmentSmsPreference('prefs-a', '+1 (416) 555-0101')).toEqual({ state: 'enabled', selection: 'default_on' });
    expect(await getAppointmentSmsPreference('prefs-b', '4165550101')).toMatchObject({ state: 'unrecorded' });
  });

  it('latest explicit disabled suppresses an earlier grant and preserves historical legacy grants', async () => {
    const { getAppointmentSmsPreference, isAppointmentSmsEligible } = await import('./bookingSmsConsent.server');
    await preference('4165550102', 'granted', { purpose: 'appointment_transactional', metadata: {} });

    expect(await isAppointmentSmsEligible({ salonId: 'prefs-a', phone: '4165550102', appointmentId: 'historical' })).toBe(true);

    await preference('4165550102', 'revoked');

    expect(await getAppointmentSmsPreference('prefs-a', '4165550102')).toMatchObject({ state: 'customer_disabled', selection: 'explicit_off' });
    expect(await isAppointmentSmsEligible({ salonId: 'prefs-a', phone: '4165550102', appointmentId: 'historical' })).toBe(false);
  });

  it('keeps shared STOP authoritative even after a later booking grant', async () => {
    const { getAppointmentSmsPreference, isAppointmentSmsEligible } = await import('./bookingSmsConsent.server');
    await database.insert(schema.smsGlobalConsentEventSchema).values({ id: 'stop-shared', senderIdentity: 'test-sender', recipient: '4165550103', state: 'suppressed', source: 'twilio_inbound' });
    await preference('4165550103', 'granted');

    expect(await getAppointmentSmsPreference('prefs-a', '4165550103')).toMatchObject({ state: 'opted_out' });
    expect(await isAppointmentSmsEligible({ salonId: 'prefs-a', phone: '4165550103', appointmentId: 'appt-a' })).toBe(false);
  });

  it('keeps provider STOP separate from later checkbox submissions', async () => {
    const { getAppointmentSmsPreference } = await import('./bookingSmsConsent.server');
    await preference('4165550104', 'revoked', { purpose: 'appointment_transactional', source: 'twilio_inbound' });
    await preference('4165550104', 'granted');

    expect(await getAppointmentSmsPreference('prefs-a', '4165550104')).toMatchObject({ state: 'opted_out' });
  });

  it('cannot re-enable a disabled booking by creating another booking', async () => {
    const { isAppointmentSmsEligible, getAppointmentSmsDeliveryPreference } = await import('./bookingSmsConsent.server');
    await preference('4165550105', 'revoked', { metadata: { appointmentId: 'disabled-booking', bookingSmsMode: 'disabled' } });
    await preference('4165550105', 'granted', { metadata: { appointmentId: 'new-booking', selection: 'default_on' } });

    expect(await isAppointmentSmsEligible({ salonId: 'prefs-a', phone: '4165550105', appointmentId: 'disabled-booking' })).toBe(false);
    expect(await getAppointmentSmsDeliveryPreference({ salonId: 'prefs-a', phone: '4165550105', appointmentId: 'disabled-booking' })).toMatchObject({ state: 'salon_disabled' });
    expect(await isAppointmentSmsEligible({ salonId: 'prefs-a', phone: '4165550105', appointmentId: 'new-booking' })).toBe(true);
  });
});
