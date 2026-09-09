/**
 * Materialization proofs — Gate C1. The vectors that matter: one intent per
 * authoritative transition per channel under replay; configured SMS gating;
 * reminder rules; in-tx supersession; a disposable salon lifecycle journey.
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

    expect(reschedule.map(r => r.channel).sort()).toEqual(['email', 'sms']);
    expect(await intentsFor('appt_m1')).toHaveLength(4);
  });

  it('never produces an SMS intent when the caller is not SMS eligible', async () => {
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
      smsEligible: false,
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

    expect((await intentsFor('appt_m4')).every(row => row.variables.reminderLeadMinutes === '1440')).toBe(true);

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

  it('preserves each rule lead time for history even when quiet hours move the send', async () => {
    const { materializeReminders } = await materialization();
    await seedSalonAndAppointment('s_lead_times', 'appt_lead_times');
    const settings = await resolvedSettings({
      reminders: { rules: [
        { id: 'day_before', offsetMinutes: 1440, channels: 'both', enabled: true },
        { id: 'hour_before', offsetMinutes: 60, channels: 'both', enabled: true },
      ] },
    });
    await db.transaction(async tx => materializeReminders({
      tx,
      salonId: 's_lead_times',
      appointmentId: 'appt_lead_times',
      appointmentStart: new Date('2026-09-10T13:30:00.000Z'),
      appointmentUpdatedAt: NOW,
      clientPhone: '4165550100',
      clientEmail: 'client@example.com',
      settings,
      timeZone: 'America/Toronto',
      variables: { salonName: 'Fixture', reminderLeadMinutes: '999' },
      smsEligible: true,
      now: NOW,
    }));
    const rows = await intentsFor('appt_lead_times');

    expect(rows).toHaveLength(4);

    for (const row of rows) {
      expect(row.variables).toMatchObject({
        salonName: 'Fixture',
        reminderLeadMinutes: row.ruleId === 'day_before' ? '1440' : '60',
      });
    }
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

describe('owner reminder action idempotency', () => {
  it('reuses one reminder for repeat clicks and one new reminder for an explicit resend key', async () => {
    const { queueAppointmentReminder } = await materialization();
    await seedSalonAndAppointment('s_manual_reminder', 'appt_manual_reminder');
    await db.update(schema.salonSchema).set({ settings: {
      communications: { sms: { enabled: true }, email: { enabled: false }, quietHours: { enabled: false, start: '21:00', end: '09:00' } },
    } as never }).where(eq(schema.salonSchema.id, 's_manual_reminder'));
    const input = {
      salonId: 's_manual_reminder',
      appointmentId: 'appt_manual_reminder',
      phone: '4165550100',
      manageUrl: 'https://app.test/manage/private',
      now: NOW,
    };
    const original = await queueAppointmentReminder(input);
    const repeatClick = await queueAppointmentReminder(input);

    expect(repeatClick).toMatchObject({ intentId: original.intentId, created: false });

    const resend = await queueAppointmentReminder({ ...input, requestId: 'explicit-resend-1' });
    const networkRetry = await queueAppointmentReminder({ ...input, requestId: 'explicit-resend-1' });

    expect(resend.created).toBe(true);
    expect(resend.intentId).not.toBe(original.intentId);
    expect(networkRetry).toMatchObject({ intentId: resend.intentId, created: false });
    expect(await intentsFor('appt_manual_reminder')).toHaveLength(2);
  });
});

describe('disposable salon communications journey', () => {
  it.each(['expiring', 'salon_review'])('records %s requests, approval, manual texting, reschedule and cancellation with coherent history', async (mode) => {
    const { materializeAppointmentLifecycle } = await materialization();
    const { queueClientSms, getClientSmsHistory } = await import('./clientMessaging');
    const { COMMUNICATION_TEMPLATES } = await import('./communicationTemplates');
    await seedSalonAndAppointment(`s_journey_${mode}`, `appt_journey_${mode}`);
    await db.update(schema.salonSchema).set({ settings: {
      booking: { timezone: 'America/Toronto' },
      communications: { sms: { enabled: true }, email: { enabled: false }, quietHours: { enabled: false, start: '21:00', end: '09:00' } },
    } as never }).where(eq(schema.salonSchema.id, `s_journey_${mode}`));
    await db.insert(schema.salonClientSchema).values({ id: `client_journey_${mode}`, salonId: `s_journey_${mode}`, phone: '4165550100', fullName: 'Test Client' });
    const [pending] = await db.update(schema.appointmentSchema).set({
      salonClientId: `client_journey_${mode}`,
      status: 'pending',
      requestExpiresAt: mode === 'expiring' ? new Date('2026-09-02T20:00:00Z') : null,
      confirmationModeSnapshot: 'request_approval',
      updatedAt: NOW,
    }).where(eq(schema.appointmentSchema.id, `appt_journey_${mode}`)).returning();
    const receipt = await db.transaction(tx => materializeAppointmentLifecycle({ tx, appointment: pending!, eventType: 'booking_request_received', transitionEventId: 'direct', now: NOW }));

    expect(receipt).toHaveLength(1);

    let rows = await intentsFor(`appt_journey_${mode}`);

    expect(rows.map(row => row.eventType)).toEqual(['booking_request_received']);
    expect(COMMUNICATION_TEMPLATES[rows[0]!.templateKey]!.render(rows[0]!.variables)).toContain('Request pending:');
    expect(COMMUNICATION_TEMPLATES[rows[0]!.templateKey]!.render(rows[0]!.variables)).not.toContain('Confirmed');

    const approvedAt = new Date(NOW.getTime() + 60_000);
    const [confirmed] = await db.update(schema.appointmentSchema).set({ status: 'confirmed', updatedAt: approvedAt })
      .where(eq(schema.appointmentSchema.id, `appt_journey_${mode}`)).returning();
    await db.transaction(tx => materializeAppointmentLifecycle({ tx, appointment: confirmed!, eventType: 'booking_request_approved', supersede: true, now: approvedAt }));
    rows = await intentsFor(`appt_journey_${mode}`);

    expect(rows.find(row => row.eventType === 'booking_request_received')!.status).toBe('canceled');

    const approved = rows.find(row => row.eventType === 'booking_request_approved')!;

    expect(COMMUNICATION_TEMPLATES[approved.templateKey]!.render(approved.variables)).toContain('Confirmed for');

    const originalReminder = rows.find(row => row.eventType === 'appointment_reminder')!;

    expect(originalReminder.scheduledFor.toISOString()).toBe('2026-09-09T18:00:00.000Z');

    const manualInput = { salonId: `s_journey_${mode}`, clientId: `client_journey_${mode}`, appointmentId: `appt_journey_${mode}`, message: 'We look forward to seeing you.', requestId: 'journey-owner-click', now: approvedAt };
    const manual = await queueClientSms(manualInput);
    const replay = await queueClientSms(manualInput);

    expect(replay).toMatchObject({ intentId: manual.intentId, created: false });

    await db.update(schema.salonClientSchema).set({ phone: '4165550198' }).where(eq(schema.salonClientSchema.id, `client_journey_${mode}`));
    const movedAt = new Date(NOW.getTime() + 120_000);
    const [moved] = await db.update(schema.appointmentSchema).set({ startTime: new Date('2026-09-11T18:00:00Z'), endTime: new Date('2026-09-11T19:00:00Z'), updatedAt: movedAt })
      .where(eq(schema.appointmentSchema.id, `appt_journey_${mode}`)).returning();
    await db.transaction(tx => materializeAppointmentLifecycle({ tx, appointment: moved!, eventType: 'appointment_rescheduled', supersede: true, now: movedAt }));
    rows = await intentsFor(`appt_journey_${mode}`);

    expect(rows.find(row => row.id === originalReminder.id)!.status).toBe('canceled');
    expect(rows.find(row => row.eventType === 'appointment_rescheduled')).toMatchObject({ recipient: '4165550198', status: 'pending' });
    expect(rows.find(row => row.eventType === 'appointment_reminder' && row.status === 'pending')).toMatchObject({ recipient: '4165550198', startRevision: '2026-09-11T18:00:00.000Z' });
    expect(rows.find(row => row.id === manual.intentId)!.status).toBe('pending');

    const cancelledAt = new Date(NOW.getTime() + 180_000);
    const [cancelled] = await db.update(schema.appointmentSchema).set({ status: 'cancelled', cancelReason: 'client_request', updatedAt: cancelledAt })
      .where(eq(schema.appointmentSchema.id, `appt_journey_${mode}`)).returning();
    await db.transaction(tx => materializeAppointmentLifecycle({ tx, appointment: cancelled!, eventType: 'appointment_cancelled', supersede: true, now: cancelledAt }));
    rows = await intentsFor(`appt_journey_${mode}`);

    expect(rows.filter(row => row.eventType === 'appointment_reminder' && row.status !== 'canceled')).toHaveLength(0);
    expect(rows.find(row => row.eventType === 'appointment_cancelled')).toMatchObject({ status: 'pending', recipient: '4165550198' });
    expect(rows.filter(row => row.eventType === 'manual_text')).toHaveLength(1);

    const history = await getClientSmsHistory({ salonId: `s_journey_${mode}`, clientId: `client_journey_${mode}`, appointmentId: `appt_journey_${mode}` });

    expect(history).toHaveLength(rows.length);
    expect(history.some(row => row.message?.includes('look forward'))).toBe(true);
  });
});
