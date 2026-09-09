import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({
  db: null as unknown,
  getSalonBySlug: vi.fn(),
  requireAdmin: vi.fn(),
  logAuditEvent: vi.fn(),
}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
vi.mock('@/libs/adminAuth', () => ({ requireAdmin: holder.requireAdmin }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: holder.getSalonBySlug, getSalonById: vi.fn(async () => null) }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: holder.logAuditEvent }));
vi.mock('@/libs/integrationHealth', () => ({
  getSalonSmsReadiness: vi.fn(async () => ({ senderMode: 'shared_luster', automaticEnabled: false, manualAvailable: false, blockingReason: 'GLOBAL_SMS_DISABLED' })),
}));
vi.mock('@/libs/Env', () => ({ Env: {
  TWILIO_ACCOUNT_SID: 'test-account',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_MESSAGING_SERVICE_SID: 'test-service',
  RESEND_API_KEY: undefined,
  RESEND_FROM_EMAIL: undefined,
} }));
vi.mock('@/libs/stripeConnect/readiness', () => ({ refreshAccountReadiness: vi.fn() }));

/* eslint-disable import/first */
import { resolveBookingNotificationCapabilities } from '@/libs/bookingNotificationSettings';

import { PATCH } from './route';
/* eslint-enable import/first */

const SALON = 'sms-settings-owner';
const OTHER = 'sms-settings-other';
const notifications = {
  newBooking: { ownerEnabled: true, technicianEnabled: false, ownerChannel: 'sms', technicianChannel: 'email' },
} satisfies NonNullable<SalonSettings['notifications']>;
const communications = {
  sms: { enabled: false },
  email: { enabled: false },
  killSwitch: false,
  quietHours: { enabled: true, start: '20:00', end: '08:00' },
  events: { appointment_reminder: { enabled: false, channels: 'sms' } },
  reminders: { rules: [] },
} satisfies NonNullable<SalonSettings['communications']>;
let client: PGlite;
let database: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  database = drizzle(client, { schema });
  holder.db = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await database.insert(schema.salonSchema).values([SALON, OTHER].map(id => ({
    id,
    slug: id,
    name: 'SMS preference fixture',
    plan: 'free' as const,
    features: { marketing: { smsReminders: false } },
    smsRemindersEnabled: false,
  })));
});

beforeEach(async () => {
  vi.clearAllMocks();
  holder.requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'test-owner' } });
  holder.logAuditEvent.mockResolvedValue(undefined);
  await database.update(schema.salonSchema).set({ settings: {
    communications,
    modules: { smsReminders: false, analyticsDashboard: true },
    notifications,
    booking: { timezone: 'America/Toronto' },
  } });
});

afterAll(async () => {
  await client.close();
});

async function salonSnapshot(id = SALON) {
  const [salon] = await database.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, id));
  return salon!;
}

async function patch(body: unknown, id = SALON, snapshot?: Awaited<ReturnType<typeof salonSnapshot>>) {
  holder.getSalonBySlug.mockResolvedValueOnce(snapshot ?? await salonSnapshot(id));
  return PATCH(new Request(`http://localhost/api/admin/salon/settings?salonSlug=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('explicit canonical SMS preference reconciles the legacy module', () => {
  it.each([true, false])('saves SMS=%s atomically without changing notification choices or activating delivery', async (enabled) => {
    await database.update(schema.salonSchema).set({ settings: sql`jsonb_set(jsonb_set(${schema.salonSchema.settings}, '{modules,smsReminders}', ${JSON.stringify(!enabled)}::jsonb), '{communications,sms,enabled}', ${JSON.stringify(!enabled)}::jsonb)` })
      .where(eq(schema.salonSchema.id, SALON));
    const response = await patch({ communications: { sms: { enabled } } });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sms: { automaticEnabled: false, blockingReason: 'GLOBAL_SMS_DISABLED' }, communications: { sms: { enabled } } });

    const salon = await salonSnapshot();

    expect(salon.settings).toMatchObject({
      modules: { smsReminders: enabled, analyticsDashboard: true },
      communications: { ...communications, sms: { enabled } },
      notifications,
    });
    expect(resolveBookingNotificationCapabilities({ features: salon.features, settings: salon.settings }).smsChannelAvailable).toBe(enabled);
    expect(salon.smsRemindersEnabled).toBe(false);
    expect(salon.features?.marketing?.smsReminders).toBe(false);
    expect((await salonSnapshot(OTHER)).settings?.modules?.smsReminders).toBe(false);
    expect(await database.select().from(schema.communicationIntentSchema)).toEqual([]);
    expect(await database.select().from(schema.communicationConsentSchema)).toEqual([]);
    expect(holder.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ after: expect.objectContaining({ modules: { smsReminders: enabled } }) }) }));
  });

  it.each([
    ['another settings section', { merchandising: { showServiceImages: false } }, 200],
    ['another communication field', { communications: { quietHours: { enabled: false, start: '20:00', end: '08:00' } } }, 200],
    ['an invalid empty SMS patch', { communications: { sms: {} } }, 400],
  ])('preserves owner-off when saving %s', async (_label, body, status) => {
    const response = await patch(body);

    expect(response.status).toBe(status);
    expect((await salonSnapshot()).settings).toMatchObject({ modules: { smsReminders: false }, communications: { sms: { enabled: false } } });
  });

  it('creates a missing legacy module object only after an explicit SMS choice', async () => {
    await database.update(schema.salonSchema).set({ settings: { communications } })
      .where(eq(schema.salonSchema.id, SALON));
    const response = await patch({ communications: { sms: { enabled: false } } });

    expect(response.status).toBe(200);
    expect((await salonSnapshot()).settings).toMatchObject({ modules: { smsReminders: false }, communications: { sms: { enabled: false } } });
  });

  it('preserves concurrent sibling module edits instead of replaying a stale modules object', async () => {
    const staleSnapshot = await salonSnapshot();
    await database.update(schema.salonSchema).set({ settings: sql`jsonb_set(${schema.salonSchema.settings}, '{modules,analyticsDashboard}', 'false'::jsonb)` })
      .where(eq(schema.salonSchema.id, SALON));
    const response = await patch({ communications: { sms: { enabled: true } } }, SALON, staleSnapshot);

    expect(response.status).toBe(200);
    expect((await salonSnapshot()).settings?.modules).toMatchObject({ smsReminders: true, analyticsDashboard: false });
  });

  it('denies a foreign salon change before writing either preference', async () => {
    holder.requireAdmin.mockResolvedValueOnce({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const before = await salonSnapshot(OTHER);
    const response = await patch({ communications: { sms: { enabled: true } } }, OTHER);

    expect(response.status).toBe(403);
    expect(holder.requireAdmin).toHaveBeenCalledWith(OTHER);
    expect((await salonSnapshot(OTHER)).settings).toEqual(before.settings);
    expect(holder.logAuditEvent).not.toHaveBeenCalled();
  });
});
