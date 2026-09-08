import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
const env = vi.hoisted(() => ({
  COMMUNICATIONS_SMS_ENABLED: 'true' as string | undefined,
  TWILIO_ACCOUNT_SID: 'AC11111111111111111111111111111111',
  TWILIO_AUTH_TOKEN: 'test-token' as string | undefined,
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111',
  SMS_PILOT_ENABLED: undefined as string | undefined,
  SMS_PILOT_SALON_ALLOWLIST: '',
  NEXT_PUBLIC_APP_URL: 'https://sms-test.example.invalid' as string | undefined,
}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/Env', () => ({ Env: env }));
vi.mock('@/libs/stripeConnect/readiness', () => ({ EXPECTED_LIVEMODE: { ok: true, livemode: false }, deriveConnectStatus: vi.fn(), toBinding: vi.fn() }));

let database: ReturnType<typeof drizzle<typeof schema>>;
const { getSalonSmsReadiness } = await import('./integrationHealth');
const { __clearCommunicationControlCache } = await import('./platformCommunicationControl');

beforeAll(async () => {
  database = drizzle(new PGlite(), { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = database;
  await database.insert(schema.salonSchema).values([
    { id: 'health-a', name: 'Health A', slug: 'health-a', smsRemindersEnabled: true, settings: { communications: { sms: { enabled: true } } } },
    { id: 'health-b', name: 'Health B', slug: 'health-b', smsRemindersEnabled: true },
  ]);
  await database.insert(schema.smsCreditAccountSchema).values({ salonId: 'health-a' });
  await database.insert(schema.smsCreditLedgerSchema).values({
    id: 'health-credits',
    salonId: 'health-a',
    entryType: 'grant',
    bucket: 'purchased',
    amount: 42,
    idempotencyKey: 'health-grant',
    reason: 'Isolated SMS health fixture',
  });
});

beforeEach(async () => {
  env.COMMUNICATIONS_SMS_ENABLED = 'true';
  env.TWILIO_AUTH_TOKEN = 'test-token';
  env.SMS_PILOT_ENABLED = undefined;
  env.SMS_PILOT_SALON_ALLOWLIST = '';
  env.NEXT_PUBLIC_APP_URL = 'https://sms-test.example.invalid';
  vi.stubEnv('CRON_SECRET', 'test-only-worker-secret');
  vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
  await database.insert(schema.platformCommunicationControlSchema).values({ id: 'singleton', smsEnabled: true })
    .onConflictDoUpdate({ target: schema.platformCommunicationControlSchema.id, set: { smsEnabled: true } });
  await database.update(schema.salonSchema).set({ settings: { communications: { sms: { enabled: true } } } }).where(eq(schema.salonSchema.id, 'health-a'));
  await database.delete(schema.salonTwilioConnectionSchema);
  __clearCommunicationControlCache();
});

afterAll(() => vi.unstubAllEnvs());

describe('operational salon SMS health', () => {
  it('shows the shared sender ready without a BYO phone number and uses only the salon balance', async () => {
    expect(await getSalonSmsReadiness('health-a')).toMatchObject({
      providerReady: true,
      senderMode: 'shared_luster',
      manualAvailable: true,
      automaticEnabled: true,
      remindersEnabled: true,
      availableCredits: 42,
    });
    expect(await getSalonSmsReadiness('health-b')).toMatchObject({
      availableCredits: 0,
      manualAvailable: false,
      blockingReason: 'SMS_DISABLED',
    });
  });

  it('does not report ready when provider credentials are missing', async () => {
    env.TWILIO_AUTH_TOKEN = undefined;

    expect(await getSalonSmsReadiness('health-a')).toMatchObject({ providerReady: false, manualAvailable: false, blockingReason: 'SENDER_NOT_READY' });
  });

  it('reports platform disable, unavailable worker, salon pause and credits honestly', async () => {
    env.COMMUNICATIONS_SMS_ENABLED = undefined;

    expect((await getSalonSmsReadiness('health-a')).blockingReason).toBe('GLOBAL_SMS_DISABLED');

    env.COMMUNICATIONS_SMS_ENABLED = 'true';
    vi.stubEnv('CRON_SECRET', '');

    expect((await getSalonSmsReadiness('health-a')).blockingReason).toBe('WORKER_NOT_CONFIGURED');

    vi.stubEnv('CRON_SECRET', 'worker');
    await database.update(schema.salonSchema).set({ settings: { communications: { sms: { enabled: true }, killSwitch: true } } }).where(eq(schema.salonSchema.id, 'health-a'));

    expect((await getSalonSmsReadiness('health-a')).blockingReason).toBe('COMMUNICATIONS_PAUSED');

    await database.update(schema.salonSchema).set({ settings: { communications: { sms: { enabled: true } } } }).where(eq(schema.salonSchema.id, 'health-b'));

    expect((await getSalonSmsReadiness('health-b')).blockingReason).toBe('NO_CREDITS');
  });

  it('preserves a BYO sender identity and legacy master without charging shared credits', async () => {
    await database.insert(schema.salonTwilioConnectionSchema).values({
      salonId: 'health-b',
      status: 'active',
      connectAccountSid: 'AC22222222222222222222222222222222',
      phoneNumber: '+14165550199',
    });
    await database.update(schema.salonSchema).set({ settings: null }).where(eq(schema.salonSchema.id, 'health-b'));
    env.COMMUNICATIONS_SMS_ENABLED = undefined;

    expect(await getSalonSmsReadiness('health-b')).toMatchObject({ senderMode: 'connected_byo', providerReady: true, manualAvailable: true, phoneNumber: '+14165550199', availableCredits: null });
    expect((await getSalonSmsReadiness('health-a')).phoneNumber).toBeNull();
  });

  it('keeps provider capability available while the owner SMS master is off', async () => {
    await database.update(schema.salonSchema).set({ settings: { communications: { sms: { enabled: false } } } }).where(eq(schema.salonSchema.id, 'health-a'));

    expect(await getSalonSmsReadiness('health-a')).toMatchObject({ providerReady: true, smsEnabled: false, manualAvailable: false, blockingReason: 'SMS_DISABLED' });
  });

  it('reports missing callback and shared limiter configuration before claiming readiness', async () => {
    env.NEXT_PUBLIC_APP_URL = undefined;

    expect(await getSalonSmsReadiness('health-a')).toMatchObject({ providerReady: false, manualAvailable: false, blockingReason: 'CALLBACK_NOT_CONFIGURED' });

    env.NEXT_PUBLIC_APP_URL = 'https://sms-test.example.invalid';
    vi.stubEnv('REDIS_URL', '');

    expect(await getSalonSmsReadiness('health-a')).toMatchObject({ manualAvailable: false, blockingReason: 'RATE_LIMITER_NOT_CONFIGURED' });
  });
});
