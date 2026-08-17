/**
 * Materialization proofs — Gate C1. The vectors that matter: one intent per
 * authoritative transition per channel under replay; mode-first SMS gating
 * (BYO callers never produce an SMS intent); email-only fallback for events
 * without a registered SMS template; reminder rules; in-tx supersession.
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

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

const settingsModule = () => import('./communicationSettings');
const materialization = () => import('./communicationMaterialization');

async function seedSalonAndAppointment(salonId: string, appointmentId: string) {
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  await db.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    clientName: 'Test Client',
    clientPhone: '4165550100',
    startTime: new Date('2026-09-10T18:00:00.000Z'),
    endTime: new Date('2026-09-10T19:00:00.000Z'),
    status: 'confirmed',
    totalPrice: 5500,
    totalDurationMinutes: 60,
  });
}

async function resolvedSettings(overrides?: object) {
  const { communicationSettingsSchema } = await settingsModule();
  return communicationSettingsSchema.parse({ sms: { enabled: true }, ...(overrides ?? {}) });
}

const intentsFor = (appointmentId: string) =>
  db.select().from(schema.communicationIntentSchema)
    .where(eq(schema.communicationIntentSchema.appointmentId, appointmentId));

// Mid-afternoon Toronto time: outside the default 21:00-09:00 quiet window.
const NOW = new Date('2026-09-01T16:00:00.000Z');

describe('materializeClientEvent — confirmation exactness', () => {
  it('creates exactly one intent per channel per transition, across replay', async () => {
    const { materializeClientEvent } = await materialization();
    await seedSalonAndAppointment('s_m1', 'appt_m1');
    const settings = await resolvedSettings();
    const input = {
      salonId: 's_m1',
      appointmentId: 'appt_m1',
      eventType: 'booking_confirmation' as const,
      transitionEventId: 'dep_123',
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      settings,
      timeZone: 'America/Toronto',
      appointmentStart: new Date('2026-09-10T18:00:00.000Z'),
      variables: { salonName: 's_m1' },
      smsEligible: true,
      now: NOW,
    };

    const first = await db.transaction(async tx => materializeClientEvent({ tx, ...input }));

    expect(first.map(r => r.channel).sort()).toEqual(['email', 'sms']);
    expect(first.every(r => r.created)).toBe(true);

    // Webhook replay / browser refresh / reaper retry: SAME transition id.
    const replay = await db.transaction(async tx => materializeClientEvent({ tx, ...input }));

    expect(replay.every(r => !r.created)).toBe(true);
    expect(await intentsFor('appt_m1')).toHaveLength(2);

    // A DIFFERENT transition (e.g. a later reschedule notice) is a new event
    // and must not be swallowed by the confirmation's dedupe.
    const reschedule = await db.transaction(async tx => materializeClientEvent({
      tx,
      ...input,
      eventType: 'appointment_rescheduled' as const,
      transitionEventId: '2026-09-02T10:00:00.000Z',
    }));

    // No SMS template registered for reschedule yet — email only.
    expect(reschedule.map(r => r.channel)).toEqual(['email']);
    expect(await intentsFor('appt_m1')).toHaveLength(3);
  });

  it('never produces an SMS intent for a BYO-mode caller (owner decision 2.2)', async () => {
    const { materializeClientEvent } = await materialization();
    await seedSalonAndAppointment('s_m2', 'appt_m2');
    const results = await db.transaction(async tx => materializeClientEvent({
      tx,
      salonId: 's_m2',
      appointmentId: 'appt_m2',
      eventType: 'booking_confirmation',
      transitionEventId: 'dep_byo',
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      settings: await resolvedSettings(),
      timeZone: 'America/Toronto',
      appointmentStart: new Date('2026-09-10T18:00:00.000Z'),
      variables: {},
      smsEligible: false, // BYO: legacy synchronous path owns SMS.
      now: NOW,
    }));

    expect(results.map(r => r.channel)).toEqual(['email']);
  });

  it('kill switch suppresses everything; email survives SMS master off', async () => {
    const { materializeClientEvent } = await materialization();
    await seedSalonAndAppointment('s_m3', 'appt_m3');
    const base = {
      salonId: 's_m3',
      appointmentId: 'appt_m3',
      eventType: 'booking_confirmation' as const,
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      timeZone: 'America/Toronto',
      appointmentStart: new Date('2026-09-10T18:00:00.000Z'),
      variables: {},
      smsEligible: true,
      now: NOW,
    };

    const killed = await db.transaction(async tx => materializeClientEvent({
      tx,
      ...base,
      transitionEventId: 't_kill',
      settings: await resolvedSettings({ killSwitch: true }),
    }));

    expect(killed).toEqual([]);

    const smsOff = await db.transaction(async tx => materializeClientEvent({
      tx,
      ...base,
      transitionEventId: 't_smsoff',
      settings: await resolvedSettings({ sms: { enabled: false } }),
    }));

    expect(smsOff.map(r => r.channel)).toEqual(['email']);
  });
});

describe('materializeReminders + supersession', () => {
  it('materializes the default 24h rule on both channels and supersedes in-tx on reschedule', async () => {
    const { materializeReminders, supersedeAppointmentCommunications } = await materialization();
    await seedSalonAndAppointment('s_m4', 'appt_m4');
    const settings = await resolvedSettings();
    const base = {
      salonId: 's_m4',
      appointmentId: 'appt_m4',
      appointmentStart: new Date('2026-09-10T18:00:00.000Z'),
      appointmentUpdatedAt: new Date('2026-09-01T12:00:00.000Z'),
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      settings,
      timeZone: 'America/Toronto',
      variables: {},
      smsEligible: true,
      now: NOW,
    };

    const first = await db.transaction(async tx => materializeReminders({ tx, ...base }));

    expect(first.materialized.map(r => r.channel).sort()).toEqual(['email', 'sms']);

    // Replay with identical inputs: same scheduling revision, same keys.
    const replay = await db.transaction(async tx => materializeReminders({ tx, ...base }));

    expect(replay.materialized.every(r => !r.created)).toBe(true);

    // Reschedule: supersede + rematerialize at the new start IN ONE TX.
    const result = await db.transaction(async (tx) => {
      const { canceled } = await supersedeAppointmentCommunications({
        tx,
        salonId: 's_m4',
        appointmentId: 'appt_m4',
        now: NOW,
      });
      const rematerialized = await materializeReminders({
        tx,
        ...base,
        appointmentStart: new Date('2026-09-12T18:00:00.000Z'),
        appointmentUpdatedAt: new Date('2026-09-01T13:00:00.000Z'),
      });
      return { canceled, rematerialized };
    });

    expect(result.canceled).toBe(2);
    expect(result.rematerialized.materialized).toHaveLength(2);
    expect(result.rematerialized.materialized.every(r => r.created)).toBe(true);

    const rows = await intentsFor('appt_m4');
    const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});

    expect(byStatus).toEqual({ canceled: 2, pending: 2 });
  });

  it('reschedule BACK to the original start still creates fresh intents (monotonic revision)', async () => {
    const { materializeReminders, supersedeAppointmentCommunications } = await materialization();
    await seedSalonAndAppointment('s_m5', 'appt_m5');
    const settings = await resolvedSettings();
    const start = new Date('2026-09-10T18:00:00.000Z');
    const base = {
      salonId: 's_m5',
      appointmentId: 'appt_m5',
      appointmentStart: start,
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      settings,
      timeZone: 'America/Toronto',
      variables: {},
      smsEligible: true,
      now: NOW,
    };

    await db.transaction(async tx =>
      materializeReminders({ tx, ...base, appointmentUpdatedAt: new Date('2026-09-01T12:00:00.000Z') }));
    // T1 -> T2
    await db.transaction(async (tx) => {
      await supersedeAppointmentCommunications({ tx, salonId: 's_m5', appointmentId: 'appt_m5', now: NOW });
      await materializeReminders({
        tx,
        ...base,
        appointmentStart: new Date('2026-09-12T18:00:00.000Z'),
        appointmentUpdatedAt: new Date('2026-09-01T13:00:00.000Z'),
      });
    });
    // T2 -> back to T1. Without the monotonic revision this would collide
    // with the CANCELED originals under ON CONFLICT DO NOTHING and the
    // client would silently never be reminded.
    const back = await db.transaction(async (tx) => {
      await supersedeAppointmentCommunications({ tx, salonId: 's_m5', appointmentId: 'appt_m5', now: NOW });
      return materializeReminders({
        tx,
        ...base,
        appointmentStart: start,
        appointmentUpdatedAt: new Date('2026-09-01T14:00:00.000Z'),
      });
    });

    expect(back.materialized).toHaveLength(2);
    expect(back.materialized.every(r => r.created)).toBe(true);
  });

  it('skips rules whose lead time already passed instead of firing late', async () => {
    const { materializeReminders } = await materialization();
    await seedSalonAndAppointment('s_m6', 'appt_m6');
    // Appointment ~2h away: the 24h rule's instant is in the past.
    const result = await db.transaction(async tx => materializeReminders({
      tx,
      salonId: 's_m6',
      appointmentId: 'appt_m6',
      appointmentStart: new Date('2026-09-01T18:00:00.000Z'),
      appointmentUpdatedAt: new Date('2026-09-01T12:00:00.000Z'),
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      settings: await resolvedSettings(),
      timeZone: 'America/Toronto',
      variables: {},
      smsEligible: true,
      now: new Date('2026-09-01T16:00:00.000Z'),
    }));

    expect(result.materialized).toEqual([]);
    expect(result.skipped.every(s => s.reason === 'REMINDER_TIME_PASSED')).toBe(true);
  });
});
