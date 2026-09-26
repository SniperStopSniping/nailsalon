import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';

import * as schema from '@/models/Schema';

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 30_000);

afterAll(async () => client.close());

it('backfills active test profiles across salons without replacing unchecked or STOP choices', async () => {
  await database.insert(schema.salonSchema).values([
    { id: 'backfill-a', slug: 'backfill-a', name: 'A' },
    { id: 'backfill-b', slug: 'backfill-b', name: 'B' },
  ]);
  await database.insert(schema.salonClientSchema).values([
    { id: 'allowed-a', salonId: 'backfill-a', phone: '4165550100' },
    { id: 'blocked-b', salonId: 'backfill-b', phone: '4165550100' },
    { id: 'stopped-a', salonId: 'backfill-a', phone: '4165550101' },
    { id: 'archived-a', salonId: 'backfill-a', phone: '4165550102', archivedAt: new Date() },
    { id: 'unrecorded-a', salonId: 'backfill-a', phone: '4165550103' },
    { id: 'globally-stopped-a', salonId: 'backfill-a', phone: '4165550104' },
    { id: 'restored-a', salonId: 'backfill-a', phone: '4165550105' },
    { id: 're-enabled-a', salonId: 'backfill-a', phone: '4165550106' },
  ]);
  await database.insert(schema.communicationConsentSchema).values([
    { id: 'prior-reminder-a', salonId: 'backfill-a', recipient: '4165550100', channel: 'sms', purpose: 'appointment_reminders', status: 'granted', wordingVersion: 'booking-sms-reminders-v1', source: 'public_booking' },
    { id: 'unchecked-b', salonId: 'backfill-b', recipient: '4165550100', channel: 'sms', purpose: 'appointment_reminders', status: 'revoked', wordingVersion: 'booking-sms-reminders-v1', source: 'public_booking', metadata: { selection: 'explicit_off' } },
    { id: 'provider-stop-a', salonId: 'backfill-a', recipient: '4165550101', channel: 'sms', purpose: 'appointment_transactional', status: 'revoked', wordingVersion: 'STOP', source: 'twilio_inbound' },
    { id: 'old-stop-a', salonId: 'backfill-a', recipient: '4165550105', channel: 'sms', purpose: 'appointment_transactional', status: 'revoked', wordingVersion: 'STOP', source: 'twilio_inbound', createdAt: new Date('2025-01-01T00:00:00Z') },
    { id: 'later-start-a', salonId: 'backfill-a', recipient: '4165550105', channel: 'sms', purpose: 'appointment_transactional', status: 'granted', wordingVersion: 'START', source: 'twilio_inbound', createdAt: new Date('2025-02-01T00:00:00Z') },
    { id: 'old-uncheck-a', salonId: 'backfill-a', recipient: '4165550106', channel: 'sms', purpose: 'appointment_reminders', status: 'revoked', wordingVersion: 'booking-sms-reminders-v1', source: 'public_booking', metadata: { selection: 'explicit_off' }, createdAt: new Date('2025-01-01T00:00:00Z') },
    { id: 'later-recheck-a', salonId: 'backfill-a', recipient: '4165550106', channel: 'sms', purpose: 'appointment_reminders', status: 'granted', wordingVersion: 'booking-sms-reminders-v1', source: 'public_booking', metadata: { selection: 'explicit_on' }, createdAt: new Date('2025-02-01T00:00:00Z') },
  ]);
  await database.insert(schema.smsGlobalConsentEventSchema).values({ id: 'global-stop', senderIdentity: 'shared-test', recipient: '4165550104', state: 'suppressed', source: 'operator' });

  const sqlText = readFileSync(path.join(process.cwd(), 'migrations/0093_existing_test_client_text_defaults.sql'), 'utf8');
  await client.exec(sqlText);
  await client.exec(sqlText);

  const rows = await database.select().from(schema.communicationConsentSchema);
  const forClient = (salonId: string, recipient: string) => rows.filter(row => row.salonId === salonId && row.recipient === recipient);

  expect(forClient('backfill-a', '4165550100').map(row => row.purpose).sort()).toEqual(['appointment_reminders', 'appointment_transactional', 'salon_promotions']);
  expect(forClient('backfill-a', '4165550100').filter(row => row.source === 'test_client_default_backfill')).toEqual(expect.arrayContaining([
    expect.objectContaining({ purpose: 'appointment_transactional', status: 'granted', metadata: expect.objectContaining({ selectionWasExplicit: false }) }),
    expect.objectContaining({ purpose: 'salon_promotions', status: 'granted' }),
  ]));
  expect(forClient('backfill-b', '4165550100')).toHaveLength(1);
  expect(forClient('backfill-a', '4165550101')).toHaveLength(1);
  expect(forClient('backfill-a', '4165550102')).toHaveLength(0);
  expect(forClient('backfill-a', '4165550103').map(row => row.purpose).sort()).toEqual(['appointment_reminders', 'appointment_transactional', 'salon_promotions']);
  // The shared-sender STOP log remains authoritative at send time, even when
  // this test default is present. The migration cannot know the runtime sender
  // identity (which may be overridden by environment configuration).
  expect(forClient('backfill-a', '4165550104').map(row => row.purpose).sort()).toEqual(['appointment_reminders', 'appointment_transactional', 'salon_promotions']);
  expect(forClient('backfill-a', '4165550105').map(row => row.purpose).sort()).toEqual(['appointment_reminders', 'appointment_transactional', 'appointment_transactional', 'salon_promotions']);
  expect(forClient('backfill-a', '4165550106').map(row => row.purpose).sort()).toEqual(['appointment_reminders', 'appointment_reminders', 'appointment_transactional', 'salon_promotions']);

  expect(await database.select().from(schema.communicationConsentSchema).where(and(eq(schema.communicationConsentSchema.salonId, 'backfill-a'), eq(schema.communicationConsentSchema.source, 'test_client_default_backfill')))).toHaveLength(12);
}, 30_000);
