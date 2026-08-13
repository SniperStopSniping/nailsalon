import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueToken } from '@/libs/lusterSecurity';
import * as schema from '@/models/Schema';

import { getAppointmentManageDetail, runAppointmentManageMutation } from './appointmentManage';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const sendAppointmentOperationalEmailOnce = vi.hoisted(() => vi.fn());
const requireAppointmentManagerAccess = vi.hoisted(() => vi.fn());
const getGoogleCalendarBusyWindows = vi.hoisted(() => vi.fn(async () => []));
const sendSalonNotificationEmail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/libs/DB', () => ({
  usesRuntimePostgres: false,
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/clientLifecycleStabilization', () => ({
  sendAppointmentOperationalEmailOnce,
}));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess,
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  getGoogleCalendarBusyWindows,
}));
vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail,
}));

const SALON_ID = 'salon_manage_mutator';
const OTHER_SALON_ID = 'salon_manage_mutator_other';
const TECHNICIAN_ID = 'tech_manage_primary';
const OTHER_TECHNICIAN_ID = 'tech_manage_secondary';
const CROSS_SALON_TECHNICIAN_ID = 'tech_manage_cross_salon';
const SERVICE_ID = 'service_manage_manicure';
const REPLACEMENT_SERVICE_ID = 'service_manage_builder';
const CROSS_SALON_SERVICE_ID = 'service_manage_cross_salon';
const ADD_ON_ID = 'addon_manage_art';
const APPOINTMENT_ID = 'appointment_manage_mutator';
const INITIAL_START = new Date('2027-01-04T14:00:00.000Z');
const INITIAL_END = new Date(INITIAL_START.getTime() + 70 * 60_000);
const REMINDER_STATE = {
  dayBeforeReminderSentAt: new Date('2027-01-03T14:00:00.000Z'),
  dayBeforeReminderChannel: 'email',
  sameDayReminderSentAt: new Date('2027-01-04T11:00:00.000Z'),
  sameDayReminderChannel: 'sms',
};

const allDaySchedule = {
  sunday: { start: '08:00', end: '22:00' },
  monday: { start: '08:00', end: '22:00' },
  tuesday: { start: '08:00', end: '22:00' },
  wednesday: { start: '08:00', end: '22:00' },
  thursday: { start: '08:00', end: '22:00' },
  friday: { start: '08:00', end: '22:00' },
  saturday: { start: '08:00', end: '22:00' },
};

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedAppointment(
  overrides: Partial<typeof schema.appointmentSchema.$inferInsert> = {},
) {
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    technicianId: TECHNICIAN_ID,
    clientPhone: '4165550199',
    clientName: 'Mutation Fixture',
    startTime: INITIAL_START,
    endTime: INITIAL_END,
    status: 'confirmed',
    totalPrice: 5500,
    totalDurationMinutes: 70,
    basePriceCents: 4500,
    addOnsPriceCents: 1000,
    baseDurationMinutes: 60,
    addOnsDurationMinutes: 10,
    bufferMinutes: 10,
    blockedDurationMinutes: 80,
    subtotalBeforeDiscountCents: 5500,
    paymentStatus: 'paid',
    notes: 'keep appointment metadata',
    reviewFollowupSentAt: new Date('2026-12-31T15:00:00.000Z'),
    ...REMINDER_STATE,
    ...overrides,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: 'appointment_service_manage_original',
    appointmentId: APPOINTMENT_ID,
    serviceId: SERVICE_ID,
    priceAtBooking: 4500,
    durationAtBooking: 60,
    nameSnapshot: 'Classic Manicure',
    categorySnapshot: 'manicure',
    priceCentsSnapshot: 4500,
    durationMinutesSnapshot: 60,
  });
  await db.insert(schema.appointmentAddOnSchema).values({
    id: 'appointment_add_on_manage_original',
    appointmentId: APPOINTMENT_ID,
    addOnId: ADD_ON_ID,
    quantitySnapshot: 1,
    nameSnapshot: 'Nail Art',
    categorySnapshot: 'nail_art',
    pricingTypeSnapshot: 'fixed',
    unitPriceCentsSnapshot: 1000,
    durationMinutesSnapshot: 10,
    lineTotalCentsSnapshot: 1000,
    lineDurationMinutesSnapshot: 10,
  });
}

async function appointment() {
  const [row] = await db
    .select()
    .from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
  if (!row) {
    throw new Error('Missing appointment fixture');
  }
  return row;
}

async function staffRescheduleJobs() {
  const rows = await db
    .select()
    .from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));
  return rows.filter(row => row.operation === 'staff_reschedule_notification');
}

async function calendarMutationJobs() {
  const rows = await db
    .select()
    .from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));
  return rows.filter(row => row.operation === 'sync_appointment');
}

function expectedJob(
  previousStart: Date,
  previousEnd: Date,
  nextStart: Date,
  nextEnd: Date,
  mutationVersion: Date,
) {
  return {
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_ID,
    provider: 'email',
    operation: 'staff_reschedule_notification',
    dedupeKey: `email:${APPOINTMENT_ID}:staff_reschedule:${previousStart.toISOString()}:${nextStart.toISOString()}:${mutationVersion.toISOString()}`,
    payload: {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      previousStartTime: previousStart.toISOString(),
      previousEndTime: previousEnd.toISOString(),
      newStartTime: nextStart.toISOString(),
      newEndTime: nextEnd.toISOString(),
      mutationVersion: mutationVersion.toISOString(),
      timeZone: 'America/Toronto',
    },
  };
}

function reminders(row: Awaited<ReturnType<typeof appointment>>) {
  return {
    dayBeforeReminderSentAt: row.dayBeforeReminderSentAt,
    dayBeforeReminderChannel: row.dayBeforeReminderChannel,
    sameDayReminderSentAt: row.sameDayReminderSentAt,
    sameDayReminderChannel: row.sameDayReminderChannel,
  };
}

function mutate(args: Partial<Parameters<typeof runAppointmentManageMutation>[0]> = {}) {
  return runAppointmentManageMutation({
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    operation: 'move',
    canReassignTechnician: true,
    ...args,
  });
}

async function expectManageError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Mutation Test Salon',
      slug: 'mutation-test-salon',
      settings: {
        booking: {
          timezone: 'America/Toronto',
          slotIntervalMinutes: 15,
          bufferMinutes: 10,
        },
      },
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Mutation Salon',
      slug: 'other-mutation-test-salon',
    },
  ]);
  await db.insert(schema.serviceSchema).values([
    {
      id: SERVICE_ID,
      salonId: SALON_ID,
      name: 'Classic Manicure',
      category: 'manicure',
      price: 4500,
      durationMinutes: 60,
    },
    {
      id: REPLACEMENT_SERVICE_ID,
      salonId: SALON_ID,
      name: 'Builder Gel',
      category: 'builder_gel',
      price: 7000,
      durationMinutes: 90,
    },
    {
      id: CROSS_SALON_SERVICE_ID,
      salonId: OTHER_SALON_ID,
      name: 'Other Salon Service',
      category: 'manicure',
      price: 9900,
      durationMinutes: 60,
    },
  ]);
  await db.insert(schema.technicianSchema).values([
    {
      id: TECHNICIAN_ID,
      salonId: SALON_ID,
      name: 'Primary Technician',
      weeklySchedule: allDaySchedule,
    },
    {
      id: OTHER_TECHNICIAN_ID,
      salonId: SALON_ID,
      name: 'Secondary Technician',
      weeklySchedule: allDaySchedule,
    },
    {
      id: CROSS_SALON_TECHNICIAN_ID,
      salonId: OTHER_SALON_ID,
      name: 'Cross-salon Technician',
      weeklySchedule: allDaySchedule,
    },
  ]);
  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECHNICIAN_ID, serviceId: SERVICE_ID },
    { technicianId: TECHNICIAN_ID, serviceId: REPLACEMENT_SERVICE_ID },
    { technicianId: OTHER_TECHNICIAN_ID, serviceId: SERVICE_ID },
    { technicianId: OTHER_TECHNICIAN_ID, serviceId: REPLACEMENT_SERVICE_ID },
    { technicianId: CROSS_SALON_TECHNICIAN_ID, serviceId: CROSS_SALON_SERVICE_ID },
  ]);
  await db.insert(schema.addOnSchema).values({
    id: ADD_ON_ID,
    salonId: SALON_ID,
    slug: 'manage-nail-art',
    name: 'Nail Art',
    category: 'nail_art',
    pricingType: 'fixed',
    priceCents: 1000,
    durationMinutes: 10,
  });
  await db.insert(schema.serviceAddOnSchema).values({
    id: 'service_add_on_manage',
    salonId: SALON_ID,
    serviceId: REPLACEMENT_SERVICE_ID,
    addOnId: ADD_ON_ID,
  });
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.googleCalendarEventSchema);
  await db.delete(schema.appointmentSchema);
  await seedAppointment();
});

afterEach(() => {
  expect(sendAppointmentOperationalEmailOnce).not.toHaveBeenCalled();
});

afterAll(async () => {
  await client.close();
});

describe('real appointment management mutations', () => {
  it('defaults customer notification off while re-arming reminders for a move', async () => {
    const nextStart = new Date('2027-01-04T16:00:00.000Z');

    await mutate({ startTime: nextStart });

    const row = await appointment();

    expect(row.startTime).toEqual(nextStart);
    expect(reminders(row)).toEqual({
      dayBeforeReminderSentAt: null,
      dayBeforeReminderChannel: null,
      sameDayReminderSentAt: null,
      sameDayReminderChannel: null,
    });
    expect(row).toMatchObject({
      paymentStatus: 'paid',
      notes: 'keep appointment metadata',
      reviewFollowupSentAt: new Date('2026-12-31T15:00:00.000Z'),
      googleCalendarSyncStatus: 'pending',
    });
    expect(await staffRescheduleJobs()).toEqual([]);
    expect(await calendarMutationJobs()).toEqual([
      expect.objectContaining({
        salonId: SALON_ID,
        appointmentId: APPOINTMENT_ID,
        provider: 'google_calendar',
        operation: 'sync_appointment',
        dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:${row.updatedAt.toISOString()}`,
        payload: {
          appointmentId: APPOINTMENT_ID,
          salonId: SALON_ID,
          mutationVersion: row.updatedAt.toISOString(),
          providerEventLane: 'initial',
        },
      }),
    ]);
  });

  it('keeps one provider event lane across revisions of a linked Google event', async () => {
    const googleEventId = 'linked_google_event_lane';
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: googleEventId,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'linked_google_event_lane_mirror',
      salonId: SALON_ID,
      calendarId: 'linked_google_calendar',
      googleEventId,
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'writer',
      syncMode: 'bidirectional',
      startTime: INITIAL_START,
      endTime: INITIAL_END,
      durationMinutes: 70,
      reviewStatus: 'appointment',
    });

    await mutate({ startTime: new Date('2027-01-04T16:00:00.000Z') });
    await mutate({ startTime: new Date('2027-01-04T18:00:00.000Z') });

    const jobs = await calendarMutationJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs.map(job => job.payload)).toEqual([
      expect.objectContaining({
        googleCalendarEventId: googleEventId,
        providerEventLane: 'initial',
        targetCalendarId: 'linked_google_calendar',
      }),
      expect.objectContaining({
        googleCalendarEventId: googleEventId,
        providerEventLane: 'initial',
        targetCalendarId: 'linked_google_calendar',
      }),
    ]);
  });

  it('keeps every A-to-B-to-A-to-B intent distinct while deduping an identical replay', async () => {
    const firstStart = new Date('2027-01-04T16:00:00.000Z');
    const firstEnd = new Date(firstStart.getTime() + 70 * 60_000);

    await mutate({
      startTime: firstStart,
      notifyCustomerOnReschedule: true,
    });
    const firstCommitted = await appointment();
    const [firstJob] = await staffRescheduleJobs();

    expect(firstJob).toEqual(expect.objectContaining(expectedJob(
      INITIAL_START,
      INITIAL_END,
      firstStart,
      firstEnd,
      firstCommitted.updatedAt,
    )));

    await mutate({ startTime: firstStart, notifyCustomerOnReschedule: true });

    expect(await staffRescheduleJobs()).toHaveLength(1);
    expect((await staffRescheduleJobs())[0]).toEqual(firstJob);

    await mutate({
      startTime: INITIAL_START,
      notifyCustomerOnReschedule: true,
    });
    const secondCommitted = await appointment();

    expect(await staffRescheduleJobs()).toHaveLength(2);

    await mutate({
      startTime: firstStart,
      notifyCustomerOnReschedule: true,
    });
    const thirdCommitted = await appointment();
    const jobs = await staffRescheduleJobs();

    expect(jobs).toHaveLength(3);
    expect(jobs).toEqual(expect.arrayContaining([
      expect.objectContaining(expectedJob(
        INITIAL_START,
        INITIAL_END,
        firstStart,
        firstEnd,
        firstCommitted.updatedAt,
      )),
      expect.objectContaining(expectedJob(
        firstStart,
        firstEnd,
        INITIAL_START,
        INITIAL_END,
        secondCommitted.updatedAt,
      )),
      expect.objectContaining(expectedJob(
        INITIAL_START,
        INITIAL_END,
        firstStart,
        firstEnd,
        thirdCommitted.updatedAt,
      )),
    ]));
    expect(new Set(jobs.map(job => job.dedupeKey)).size).toBe(3);
    expect(new Set(jobs.map(job => (
      job.payload as { mutationVersion: string }
    ).mutationVersion)).size).toBe(3);
    expect(jobs.find(job => job.id === firstJob?.id)).toEqual(firstJob);

    const calendarJobs = await calendarMutationJobs();

    expect(calendarJobs).toHaveLength(3);
    expect(new Set(calendarJobs.map(job => job.dedupeKey)).size).toBe(3);
    expect(new Set(calendarJobs.map(job => (
      job.payload as { mutationVersion: string }
    ).mutationVersion))).toEqual(new Set([
      firstCommitted.updatedAt.toISOString(),
      secondCommitted.updatedAt.toISOString(),
      thirdCommitted.updatedAt.toISOString(),
    ]));
  });

  it('does not enqueue a same-time move', async () => {
    const before = await appointment();

    await mutate({
      startTime: INITIAL_START,
      notifyCustomerOnReschedule: true,
    });

    expect(await staffRescheduleJobs()).toEqual([]);
    expect(await calendarMutationJobs()).toEqual([]);
    expect((await appointment()).updatedAt).toEqual(before.updatedAt);
  });

  it('keeps one durable notification when the staff route retries the same move', async () => {
    requireAppointmentManagerAccess.mockImplementation(async () => ({
      ok: true,
      actorRole: 'staff',
      appointment: await appointment(),
    }));
    const { PATCH } = await import('@/app/api/appointments/[id]/manage/route');
    const request = () => new Request('http://localhost/api/appointments/test/manage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'move',
        startTime: '2027-01-04T16:00:00.000Z',
      }),
    });

    expect((await PATCH(request(), { params: { id: APPOINTMENT_ID } })).status).toBe(200);
    expect((await PATCH(request(), { params: { id: APPOINTMENT_ID } })).status).toBe(200);

    expect(await staffRescheduleJobs()).toHaveLength(1);
  });

  it('keeps the customer-managed route on its existing single-send path without an outbox job', async () => {
    const capability = createOpaqueToken();
    await db.insert(schema.appointmentAccessTokenSchema).values({
      id: 'token_customer_reschedule',
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      tokenHash: capability.tokenHash,
      expiresAt: new Date('2027-02-04T14:00:00.000Z'),
    });
    const { POST } = await import('@/app/api/public/appointments/manage/[token]/route');
    const request = () => new Request('http://localhost/api/public/appointments/manage/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reschedule',
        startTime: '2027-01-04T16:00:00.000Z',
      }),
    });
    const response = await POST(request(), { params: { token: capability.token } });
    const replay = await POST(request(), { params: { token: capability.token } });

    expect(response.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(sendAppointmentOperationalEmailOnce).toHaveBeenCalledTimes(1);
    expect(await staffRescheduleJobs()).toEqual([]);

    sendAppointmentOperationalEmailOnce.mockClear();
  });

  it('rolls back the outbox row with the appointment transaction', async () => {
    const rollbackDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return (callback: Parameters<typeof db.transaction>[0]) =>
            db.transaction(async (tx) => {
              await callback(tx);
              throw new Error('FORCED_ROLLBACK_AFTER_ENQUEUE');
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    holder.db = rollbackDb;

    try {
      await expect(mutate({
        startTime: new Date('2027-01-04T16:00:00.000Z'),
        notifyCustomerOnReschedule: true,
      })).rejects.toThrow('FORCED_ROLLBACK_AFTER_ENQUEUE');
    } finally {
      holder.db = db;
    }

    expect((await appointment()).startTime).toEqual(INITIAL_START);
    expect(await staffRescheduleJobs()).toEqual([]);
    expect(await calendarMutationJobs()).toEqual([]);
  });

  it('durably orders a provider-originated move behind any older provider work', async () => {
    const nextStart = new Date('2027-01-04T16:00:00.000Z');

    await mutate({ startTime: nextStart });

    expect((await appointment()).startTime).toEqual(nextStart);

    const [job] = await calendarMutationJobs();
    const stored = await appointment();

    expect(job).toMatchObject({
      appointmentId: APPOINTMENT_ID,
      operation: 'sync_appointment',
      provider: 'google_calendar',
      status: 'pending',
    });
    expect(job?.payload).toEqual(expect.objectContaining({
      appointmentId: APPOINTMENT_ID,
      mutationVersion: stored.updatedAt.toISOString(),
      salonId: SALON_ID,
    }));
  });

  it('directly moves to next available through the protected move and re-arms reminders', async () => {
    await mutate({
      operation: 'moveToNextAvailable',
      notifyCustomerOnReschedule: true,
    });

    const row = await appointment();

    expect(row.startTime.getTime()).toBeGreaterThan(INITIAL_START.getTime());
    expect(reminders(row)).toEqual({
      dayBeforeReminderSentAt: null,
      dayBeforeReminderChannel: null,
      sameDayReminderSentAt: null,
      sameDayReminderChannel: null,
    });
    expect(await staffRescheduleJobs()).toEqual([
      expect.objectContaining(expectedJob(
        INITIAL_START,
        INITIAL_END,
        row.startTime,
        row.endTime,
        row.updatedAt,
      )),
    ]);
    expect(await calendarMutationJobs()).toEqual([
      expect.objectContaining({
        dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:${row.updatedAt.toISOString()}`,
      }),
    ]);
  });

  it('preserves every reminder field when technician reassignment keeps the start time', async () => {
    await mutate({
      operation: 'reassignTechnician',
      technicianId: OTHER_TECHNICIAN_ID,
      notifyCustomerOnReschedule: true,
    });

    const row = await appointment();

    expect(row.technicianId).toBe(OTHER_TECHNICIAN_ID);
    expect(row.startTime).toEqual(INITIAL_START);
    expect(reminders(row)).toEqual(REMINDER_STATE);
    expect(await staffRescheduleJobs()).toEqual([]);
    expect(await calendarMutationJobs()).toEqual([
      expect.objectContaining({
        dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:${row.updatedAt.toISOString()}`,
      }),
    ]);
  });

  it('preserves reminder state for a same-start service change', async () => {
    await mutate({
      operation: 'changeService',
      baseServiceId: REPLACEMENT_SERVICE_ID,
      notifyCustomerOnReschedule: true,
    });

    const row = await appointment();

    expect(row.startTime).toEqual(INITIAL_START);
    expect(reminders(row)).toEqual(REMINDER_STATE);
    expect(await staffRescheduleJobs()).toEqual([]);
    expect(await calendarMutationJobs()).toEqual([
      expect.objectContaining({
        dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:${row.updatedAt.toISOString()}`,
      }),
    ]);
  });

  it('persists distinct revisions for sequential provider changes at one start time', async () => {
    await mutate({
      operation: 'reassignTechnician',
      technicianId: OTHER_TECHNICIAN_ID,
    });
    const technicianRevision = await appointment();

    await mutate({
      operation: 'changeService',
      baseServiceId: REPLACEMENT_SERVICE_ID,
    });
    const serviceRevision = await appointment();
    const serviceRows = await db
      .select()
      .from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, APPOINTMENT_ID));
    const jobs = await calendarMutationJobs();

    expect(technicianRevision).toMatchObject({
      startTime: INITIAL_START,
      technicianId: OTHER_TECHNICIAN_ID,
    });
    expect(serviceRevision).toMatchObject({
      startTime: INITIAL_START,
      endTime: new Date(INITIAL_START.getTime() + 100 * 60_000),
      technicianId: OTHER_TECHNICIAN_ID,
      totalDurationMinutes: 100,
      totalPrice: 8000,
    });
    expect(serviceRows).toEqual([
      expect.objectContaining({
        serviceId: REPLACEMENT_SERVICE_ID,
        durationAtBooking: 90,
        priceAtBooking: 7000,
      }),
    ]);
    expect(technicianRevision.updatedAt).not.toEqual(serviceRevision.updatedAt);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map(job => job.dedupeKey))).toEqual(new Set([
      `google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:${technicianRevision.updatedAt.toISOString()}`,
      `google:${SALON_ID}:${APPOINTMENT_ID}:sync:appointment-mutation:${serviceRevision.updatedAt.toISOString()}`,
    ]));
    expect(new Set(jobs.map(job => (
      job.payload as { mutationVersion: string }
    ).mutationVersion))).toEqual(new Set([
      technicianRevision.updatedAt.toISOString(),
      serviceRevision.updatedAt.toISOString(),
    ]));
  });

  it('atomically changes service lines and re-arms reminders for a time-changing service change', async () => {
    const nextStart = new Date('2027-01-04T17:00:00.000Z');

    await mutate({
      operation: 'changeService',
      baseServiceId: REPLACEMENT_SERVICE_ID,
      startTime: nextStart,
      notifyCustomerOnReschedule: true,
    });

    const row = await appointment();
    const serviceRows = await db
      .select()
      .from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, APPOINTMENT_ID));
    const addOnRows = await db
      .select()
      .from(schema.appointmentAddOnSchema)
      .where(eq(schema.appointmentAddOnSchema.appointmentId, APPOINTMENT_ID));

    expect(row).toMatchObject({
      startTime: nextStart,
      endTime: new Date(nextStart.getTime() + 100 * 60_000),
      totalPrice: 8000,
      totalDurationMinutes: 100,
      basePriceCents: 7000,
      addOnsPriceCents: 1000,
    });
    expect(reminders(row)).toEqual({
      dayBeforeReminderSentAt: null,
      dayBeforeReminderChannel: null,
      sameDayReminderSentAt: null,
      sameDayReminderChannel: null,
    });
    expect(serviceRows).toHaveLength(1);
    expect(serviceRows[0]).toMatchObject({
      serviceId: REPLACEMENT_SERVICE_ID,
      priceAtBooking: 7000,
      durationAtBooking: 90,
    });
    expect(addOnRows).toHaveLength(1);
    expect(addOnRows[0]).toMatchObject({
      addOnId: ADD_ON_ID,
      lineTotalCentsSnapshot: 1000,
      lineDurationMinutesSnapshot: 10,
    });
    expect(await staffRescheduleJobs()).toEqual([
      expect.objectContaining(expectedJob(
        INITIAL_START,
        INITIAL_END,
        nextStart,
        row.endTime,
        row.updatedAt,
      )),
    ]);
  });

  it('rolls back every service, add-on, and appointment write when a line insert fails', async () => {
    const conflictingUuid = '00000000-0000-4000-8000-000000000000';
    const original = await appointment();
    await db.insert(schema.appointmentSchema).values({
      id: 'appointment_manage_collision_owner',
      salonId: SALON_ID,
      technicianId: null,
      clientPhone: '4165550188',
      startTime: new Date('2027-01-05T14:00:00.000Z'),
      endTime: new Date('2027-01-05T15:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 4500,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.appointmentServicesSchema).values({
      id: `appt_service_${conflictingUuid}`,
      appointmentId: 'appointment_manage_collision_owner',
      serviceId: SERVICE_ID,
      priceAtBooking: 4500,
      durationAtBooking: 60,
    });
    const randomUuid = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue(conflictingUuid);

    try {
      await expect(mutate({
        operation: 'changeService',
        baseServiceId: REPLACEMENT_SERVICE_ID,
        startTime: new Date('2027-01-04T17:00:00.000Z'),
        notifyCustomerOnReschedule: true,
      })).rejects.toBeDefined();
    } finally {
      randomUuid.mockRestore();
    }

    const row = await appointment();
    const serviceRows = await db
      .select()
      .from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, APPOINTMENT_ID));
    const addOnRows = await db
      .select()
      .from(schema.appointmentAddOnSchema)
      .where(eq(schema.appointmentAddOnSchema.appointmentId, APPOINTMENT_ID));

    expect(row).toMatchObject({
      startTime: original.startTime,
      endTime: original.endTime,
      totalPrice: original.totalPrice,
      totalDurationMinutes: original.totalDurationMinutes,
    });
    expect(reminders(row)).toEqual(REMINDER_STATE);
    expect(serviceRows).toHaveLength(1);
    expect(serviceRows[0]!.serviceId).toBe(SERVICE_ID);
    expect(addOnRows).toHaveLength(1);
    expect(addOnRows[0]!.addOnId).toBe(ADD_ON_ID);
    expect(await staffRescheduleJobs()).toEqual([]);
  });

  it('rejects cross-salon technician and service targets without changing state', async () => {
    const original = await appointment();

    await expectManageError(mutate({
      startTime: new Date('2027-01-04T16:00:00.000Z'),
      technicianId: CROSS_SALON_TECHNICIAN_ID,
    }), 'TECHNICIAN_NOT_FOUND');
    await expectManageError(mutate({
      operation: 'changeService',
      baseServiceId: CROSS_SALON_SERVICE_ID,
    }), 'INVALID_BASE_SERVICE');

    const row = await appointment();
    const serviceRows = await db
      .select()
      .from(schema.appointmentServicesSchema)
      .where(eq(schema.appointmentServicesSchema.appointmentId, APPOINTMENT_ID));
    const addOnRows = await db
      .select()
      .from(schema.appointmentAddOnSchema)
      .where(eq(schema.appointmentAddOnSchema.appointmentId, APPOINTMENT_ID));

    expect(row.startTime).toEqual(original.startTime);
    expect(row.technicianId).toBe(original.technicianId);
    expect(reminders(row)).toEqual(REMINDER_STATE);
    expect(serviceRows).toHaveLength(1);
    expect(serviceRows[0]!.serviceId).toBe(SERVICE_ID);
    expect(addOnRows).toHaveLength(1);
    expect(addOnRows[0]!.addOnId).toBe(ADD_ON_ID);
  });

  it('rejects a technician target supplied by a non-admin mutation', async () => {
    await expectManageError(mutate({
      startTime: new Date('2027-01-04T16:00:00.000Z'),
      technicianId: OTHER_TECHNICIAN_ID,
      canReassignTechnician: false,
    }), 'FORBIDDEN');

    const row = await appointment();

    expect(row.technicianId).toBe(TECHNICIAN_ID);
    expect(row.startTime).toEqual(INITIAL_START);
    expect(reminders(row)).toEqual(REMINDER_STATE);
  });

  it.each([
    {
      label: 'locked',
      update: { lockedAt: new Date('2027-01-04T13:30:00.000Z') },
      code: 'APPOINTMENT_LOCKED',
    },
    {
      label: 'non-editable',
      update: { status: 'cancelled' },
      code: 'APPOINTMENT_NOT_EDITABLE',
    },
  ])('rejects authoritative $label state written after its initial load', async ({ update, code }) => {
    const mutation = mutate({ startTime: new Date('2027-01-04T16:00:00.000Z') });
    await db
      .update(schema.appointmentSchema)
      .set(update)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    await expectManageError(mutation, code);

    const row = await appointment();

    expect(row.startTime).toEqual(INITIAL_START);
    expect(reminders(row)).toEqual(REMINDER_STATE);
  });
});

/**
 * D4 §5.8 — THE HOLD GUARDS, made falsifiable (D4-REV-2).
 *
 * Fable's exact-head review deleted the `ensureEditable` hold refusal and this
 * whole file stayed green. Every mutating manage-token handler funnels through
 * that function, so its removal makes a hold editable — an unpaid slot
 * reservation becomes movable, re-serviceable and cancellable.
 */
describe('§5.8 — a deposit hold is not manageable', () => {
  const holdOperations: Array<[string, Partial<Parameters<typeof mutate>[0]>]> = [
    ['move', { operation: 'move', startTime: new Date(INITIAL_START.getTime() + 3_600_000) }],
    ['moveToNextAvailable', { operation: 'moveToNextAvailable' }],
    ['changeService', { operation: 'changeService', baseServiceId: REPLACEMENT_SERVICE_ID }],
    ['reassignTechnician', { operation: 'reassignTechnician', technicianId: OTHER_TECHNICIAN_ID }],
  ];

  it.each(holdOperations)(
    'ensureEditable refuses operation %s with HOLD_LOCKED',
    async (_label, args) => {
      await db
        .update(schema.appointmentSchema)
        .set({ status: 'awaiting_payment' })
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

      await expectManageError(mutate(args), 'HOLD_LOCKED');

      const row = await appointment();

      // Untouched: the refusal happens before any write.
      expect(row.status).toBe('awaiting_payment');
      expect(row.startTime).toEqual(INITIAL_START);
      expect(reminders(row)).toEqual(REMINDER_STATE);
    },
  );

  it('the refusal precedes the terminal/locked checks, so the code is HOLD_LOCKED', async () => {
    // A hold that is ALSO locked must still answer HOLD_LOCKED rather than
    // APPOINTMENT_LOCKED — otherwise this test could pass for the wrong reason.
    await db
      .update(schema.appointmentSchema)
      .set({ status: 'awaiting_payment', lockedAt: new Date() })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    await expectManageError(
      mutate({ operation: 'move', startTime: new Date(INITIAL_START.getTime() + 3_600_000) }),
      'HOLD_LOCKED',
    );
  });

  it('buildPermissions denies every mutating action on a hold', async () => {
    await db
      .update(schema.appointmentSchema)
      .set({ status: 'awaiting_payment' })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    const detail = await getAppointmentManageDetail({
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      canReassignTechnician: true,
      salonSlug: 'manage-mutator',
    });

    // buildPermissions is a DENY-LIST, so without an explicit hold arm a hold
    // reports canMove/canCancel/canChangeService/canReassignTechnician = true:
    // dead buttons whose handlers all 409, and a wrong canCancel waiting to
    // seed D6's permission matrix.
    expect(detail.permissions).toEqual({
      canMove: false,
      canChangeService: false,
      canCancel: false,
      canMarkCompleted: false,
      canStart: false,
      canConfirm: false,
      canMarkNoShow: false,
      canReassignTechnician: false,
    });
  });

  it('CONTROL: the same appointment while confirmed is manageable', async () => {
    // Without this the assertions above would pass against a permissions
    // function that denied everything unconditionally.
    const detail = await getAppointmentManageDetail({
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      canReassignTechnician: true,
      salonSlug: 'manage-mutator',
    });

    expect(detail.permissions.canMove).toBe(true);
    expect(detail.permissions.canCancel).toBe(true);
  });
});
