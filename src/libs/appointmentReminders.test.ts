/**
 * Canonical reminder reconciliation for shared and connected senders. This suite
 * proves the rule-based reconciler on PGlite: first-pass materialization,
 * the in-sync fast path (a second pass writes nothing), drift
 * rematerialization when quiet hours change, and the orphan sweep for
 * cancelled appointments.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  LUSTER_ROOT_DOMAIN: 'lusterbooking.com',
  NEXT_PUBLIC_APP_URL: 'https://lusterbooking.com',
  TENANT_SUBDOMAINS_ENABLED: undefined,
  COMMUNICATIONS_SMS_ENABLED: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// The BYO legs and their helpers must never run for shared-mode candidates —
// failing mocks prove it.
vi.mock('@/libs/SMS', () => ({
  sendAppointmentReminder: vi.fn(async () => {
    throw new Error('LEGACY_SMS_LEG_MUST_NOT_RUN');
  }),
}));
vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames: vi.fn(async () => []),
}));
vi.mock('@/libs/salonStatus', () => ({
  isSmsEnabled: vi.fn(async () => false),
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

const NOW = new Date('2026-09-01T16:00:00.000Z');
const START = new Date('2026-09-02T18:00:00.000Z'); // ~26h out: 24h rule is future

async function seed(salonId: string, appointmentId: string, communications?: object) {
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: `Salon ${salonId}`,
    slug: salonId,
    settings: {
      booking: { timezone: 'America/Toronto' },
      ...(communications !== undefined ? { communications } : {}),
    } as never,
  });
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    clientName: 'Client',
    clientPhone: '4165550100',
    clientEmail: 'client@example.com',
    startTime: START,
    endTime: new Date(START.getTime() + 3600_000),
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
}

const liveReminderIntents = (appointmentId: string) =>
  db.select().from(schema.communicationIntentSchema)
    .where(eq(schema.communicationIntentSchema.appointmentId, appointmentId));

describe('shared-mode reminder reconciliation', () => {
  it('materializes rule-based intents on first pass, then the in-sync fast path writes nothing', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_rec1', 'appt_rec1');

    const first = await processAppointmentReminders({ now: NOW });

    // Default settings: SMS master disabled, email on → the 24h default rule
    // materializes exactly one EMAIL intent. No BYO leg ran (failing mocks).
    expect(first.intentsMaterialized).toBe(1);

    const rows = await liveReminderIntents('appt_rec1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'email',
      eventType: 'appointment_reminder',
      status: 'pending',
      recipient: 'client@example.com',
    });
    // The manage link is a real capability URL, not a placeholder.
    expect((rows[0]!.variables as Record<string, string>).manageUrl).toContain('/manage/');

    const second = await processAppointmentReminders({ now: NOW });

    expect(second.intentsMaterialized).toBe(0);
    expect(second.intentsCanceledStale).toBe(0);
    expect(await liveReminderIntents('appt_rec1')).toHaveLength(1);
  });

  it('a quiet-hours change cancels the stale plan and rematerializes', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_rec2', 'appt_rec2');
    await processAppointmentReminders({ now: NOW });

    // Owner moves quiet hours so the reminder instant (18:00Z = 14:00 EDT)
    // now falls inside them → the shifted plan carries a new scheduling
    // revision, superseding the original intent.
    await db.update(schema.salonSchema)
      .set({
        settings: {
          booking: { timezone: 'America/Toronto' },
          communications: { quietHours: { enabled: true, start: '13:00', end: '15:00' } },
        } as never,
      })
      .where(eq(schema.salonSchema.id, 's_rec2'));

    const result = await processAppointmentReminders({ now: NOW });

    expect(result.intentsCanceledStale).toBe(1);
    expect(result.intentsMaterialized).toBe(1);

    const rows = await liveReminderIntents('appt_rec2');
    const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});

    expect(byStatus).toEqual({ canceled: 1, pending: 1 });
  });

  it('the orphan sweep cancels live reminders for appointments cancelled between passes', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_rec3', 'appt_rec3');
    await processAppointmentReminders({ now: NOW });

    await db.update(schema.appointmentSchema)
      .set({ status: 'cancelled' })
      .where(eq(schema.appointmentSchema.id, 'appt_rec3'));

    const result = await processAppointmentReminders({ now: NOW });

    expect(result.orphanIntentsCanceled).toBe(1);

    const rows = await liveReminderIntents('appt_rec3');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('canceled');
    expect(rows[0]!.lastError).toBe('APPOINTMENT_NO_LONGER_ACTIVE');
  });

  it('the salon kill switch yields no intents at all', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_rec4', 'appt_rec4', { killSwitch: true });

    const result = await processAppointmentReminders({ now: NOW });

    expect(result.intentsMaterialized).toBe(0);
    expect(await liveReminderIntents('appt_rec4')).toHaveLength(0);
  });
});

describe('durable reminder safety', () => {
  it('preserves an unsent reminder after its scheduled time passes', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_due', 'appt_due', { sms: { enabled: true } });
    await processAppointmentReminders({ now: NOW });
    const before = await liveReminderIntents('appt_due');

    expect(before).toHaveLength(2);

    await processAppointmentReminders({ now: new Date('2026-09-01T18:15:00Z') });
    const after = await liveReminderIntents('appt_due');

    expect(after.map(row => row.id).sort()).toEqual(before.map(row => row.id).sort());
    expect(after.every(row => row.status === 'pending')).toBe(true);
  });

  it('uses the configured rule for a connected Twilio salon without synchronous provider calls', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_byo', 'appt_byo', { sms: { enabled: true }, reminders: { rules: [{ id: 'before-1day', enabled: true, channels: 'sms', offsetMinutes: 1440 }] } });
    await db.insert(schema.salonTwilioConnectionSchema).values({ salonId: 's_byo', status: 'active', connectAccountSid: 'ACtest', phoneNumber: '+14165550099' });
    await processAppointmentReminders({ now: NOW });
    const rows = await liveReminderIntents('appt_byo');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'sms', status: 'pending', scheduledFor: new Date('2026-09-01T18:00:00Z') });
  });

  it.each(['cancelled', 'completed', 'no_show'])('does not schedule %s appointments', async (status) => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed(`s_${status}`, `appt_${status}`, { sms: { enabled: true } });
    await db.update(schema.appointmentSchema).set({ status }).where(eq(schema.appointmentSchema.id, `appt_${status}`));
    await processAppointmentReminders({ now: NOW });

    expect(await liveReminderIntents(`appt_${status}`)).toHaveLength(0);
  });

  it('cancels old reminders when an appointment becomes an unapproved request', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_request', 'appt_request', { sms: { enabled: true } });
    await processAppointmentReminders({ now: NOW });
    await db.update(schema.appointmentSchema).set({ status: 'pending', requestExpiresAt: new Date('2026-09-02T16:00:00Z') }).where(eq(schema.appointmentSchema.id, 'appt_request'));
    await processAppointmentReminders({ now: NOW });
    const rows = await liveReminderIntents('appt_request');

    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status === 'canceled')).toBe(true);
  });

  it('refuses a candidate moved between scan and reconciliation', async () => {
    const { processAppointmentReminders } = await import('./appointmentReminders');
    await seed('s_race', 'appt_race', { sms: { enabled: true } });
    await processAppointmentReminders({ now: NOW, beforeDeliveryGuard: async () => {
      await db.update(schema.appointmentSchema).set({ startTime: new Date('2026-09-04T18:00:00Z'), updatedAt: new Date('2026-09-01T16:01:00Z') }).where(eq(schema.appointmentSchema.id, 'appt_race'));
    } });

    expect(await liveReminderIntents('appt_race')).toHaveLength(0);
  });
});
