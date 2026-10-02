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
  it('defaults active old and new client profiles on for all text purposes within their salon', async () => {
    const { getClientSmsPurposeEligibility } = await import('./clientSmsEligibility.server');
    await database.insert(schema.salonClientSchema).values([
      { id: 'default-profile-a', salonId: 'prefs-a', phone: '4165550190' },
      { id: 'formatted-old-profile-a', salonId: 'prefs-a', phone: '+1 (416) 555-0193' },
    ]);

    for (const purpose of ['appointment_reminders', 'appointment_transactional', 'salon_promotions'] as const) {
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550190', purpose })).toMatchObject({ state: 'enabled', selection: 'default_on' });
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-b', phone: '4165550190', purpose })).toMatchObject({ state: 'unrecorded' });
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550193', purpose })).toMatchObject({ state: 'enabled' });
    }
  });

  it('treats an old untouched default-off as a default, while retaining explicit refusal for every purpose', async () => {
    const { getClientSmsPurposeEligibility } = await import('./clientSmsEligibility.server');
    await database.insert(schema.salonClientSchema).values({ id: 'old-default-off-a', salonId: 'prefs-a', phone: '4165550191' });
    await preference('4165550191', 'revoked', { metadata: { selection: 'default_off', selectionWasExplicit: false } });

    for (const purpose of ['appointment_reminders', 'appointment_transactional', 'salon_promotions'] as const) {
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550191', purpose })).toMatchObject({ state: 'enabled' });
    }

    await preference('4165550191', 'revoked', { metadata: { selection: 'explicit_off', selectionWasExplicit: true } });
    for (const purpose of ['appointment_reminders', 'appointment_transactional', 'salon_promotions'] as const) {
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550191', purpose })).toMatchObject({ state: 'customer_disabled' });
    }
  });

  it('preserves STOP across all purposes even for default-eligible clients', async () => {
    const { getClientSmsPurposeEligibility } = await import('./clientSmsEligibility.server');
    await database.insert(schema.salonClientSchema).values({ id: 'stopped-default-a', salonId: 'prefs-a', phone: '4165550192' });
    await database.insert(schema.smsGlobalConsentEventSchema).values({ id: 'stop-default-a', senderIdentity: 'test-sender', recipient: '4165550192', state: 'suppressed', source: 'twilio_inbound' });

    for (const purpose of ['appointment_reminders', 'appointment_transactional', 'salon_promotions'] as const) {
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550192', purpose })).toMatchObject({ state: 'opted_out' });
    }
  });

  it('keeps a later legacy transactional refusal across reminders and promotions', async () => {
    const { getClientSmsPurposeEligibility } = await import('./clientSmsEligibility.server');
    await database.insert(schema.salonClientSchema).values({ id: 'legacy-refused-a', salonId: 'prefs-a', phone: '4165550189' });
    await preference('4165550189', 'granted');
    await preference('4165550189', 'revoked', { purpose: 'appointment_transactional', metadata: {} });

    for (const purpose of ['appointment_reminders', 'appointment_transactional', 'salon_promotions'] as const) {
      expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550189', purpose })).toMatchObject({ state: 'customer_disabled' });
    }
  });

  it('keeps v3 appointment and promotional choices independent, including the unselected promotional default', async () => {
    const { getClientSmsPurposeEligibility, getClientSmsPurposeEligibilityBatch } = await import('./clientSmsEligibility.server');
    await database.insert(schema.salonClientSchema).values([
      { id: 'separated-granted-a', salonId: 'prefs-a', phone: '4165550187' },
      { id: 'separated-default-off-a', salonId: 'prefs-a', phone: '4165550186' },
    ]);
    await preference('4165550187', 'revoked', {
      wordingVersion: 'booking-sms-separated-v3',
      metadata: { selection: 'explicit_off', selectionWasExplicit: true },
    });
    await preference('4165550187', 'revoked', {
      purpose: 'appointment_transactional',
      wordingVersion: 'booking-sms-separated-v3',
      metadata: { selection: 'explicit_off', selectionWasExplicit: true },
    });
    await preference('4165550187', 'granted', {
      purpose: 'salon_promotions',
      wordingVersion: 'booking-sms-separated-v3',
      metadata: { selection: 'explicit_on', selectionWasExplicit: true, promotionsGranted: true },
    });
    await preference('4165550186', 'revoked', {
      purpose: 'salon_promotions',
      wordingVersion: 'booking-sms-separated-v3',
      metadata: { selection: 'default_off', selectionWasExplicit: false, promotionsGranted: false },
    });
    await preference('4165550186', 'granted', {
      wordingVersion: 'booking-sms-reminders-v1',
      metadata: { selection: 'explicit_on', selectionWasExplicit: true },
    });

    expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550187', purpose: 'appointment_reminders' })).toMatchObject({ state: 'customer_disabled' });
    expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550187', purpose: 'appointment_transactional' })).toMatchObject({ state: 'customer_disabled' });
    expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550187', purpose: 'salon_promotions' })).toMatchObject({ state: 'enabled', selection: 'explicit_on' });
    expect(await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone: '4165550186', purpose: 'salon_promotions' })).toMatchObject({ state: 'customer_disabled', selection: 'default_off' });

    const batch = await getClientSmsPurposeEligibilityBatch({ salonId: 'prefs-a', phones: ['4165550187', '4165550186'], purpose: 'salon_promotions' });

    expect(batch).toEqual(new Map([['4165550187', true], ['4165550186', false]]));
  });

  it('batches promotional and appointment eligibility with the same result as individual send checks', async () => {
    const { getClientSmsPurposeEligibilityBatch, getClientSmsPurposeEligibility } = await import('./clientSmsEligibility.server');
    await database.insert(schema.salonClientSchema).values([
      { id: 'batch-default-a', salonId: 'prefs-a', phone: '4165550194' },
      { id: 'batch-refused-a', salonId: 'prefs-a', phone: '4165550195' },
      { id: 'batch-stopped-a', salonId: 'prefs-a', phone: '4165550196' },
      { id: 'batch-other-b', salonId: 'prefs-b', phone: '4165550197' },
    ]);
    await preference('4165550195', 'revoked', { metadata: { selection: 'explicit_off', selectionWasExplicit: true } });
    await database.insert(schema.smsGlobalConsentEventSchema).values({ id: 'batch-stop', senderIdentity: 'test-sender', recipient: '4165550196', state: 'suppressed', source: 'twilio_inbound' });

    const phones = ['4165550194', '4165550195', '4165550196', '4165550197'];
    for (const purpose of ['salon_promotions', 'appointment_transactional'] as const) {
      const batch = await getClientSmsPurposeEligibilityBatch({ salonId: 'prefs-a', phones, purpose });

      for (const phone of phones) {
        const individual = await getClientSmsPurposeEligibility({ salonId: 'prefs-a', phone, purpose });

        expect(batch.get(phone)).toBe(individual.state === 'enabled');
      }
    }
  });

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
