import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { runAppointmentManageMutation } from './appointmentManage';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
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
    endTime: new Date(INITIAL_START.getTime() + 70 * 60_000),
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
  await db.delete(schema.appointmentSchema);
  await seedAppointment();
});

afterAll(async () => {
  await client.close();
});

describe('real appointment management mutations', () => {
  it('re-arms exactly the time-derived reminders when a move changes start time', async () => {
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
    });
  });

  it('directly moves to next available through the protected move and re-arms reminders', async () => {
    await mutate({ operation: 'moveToNextAvailable' });

    const row = await appointment();

    expect(row.startTime.getTime()).toBeGreaterThan(INITIAL_START.getTime());
    expect(reminders(row)).toEqual({
      dayBeforeReminderSentAt: null,
      dayBeforeReminderChannel: null,
      sameDayReminderSentAt: null,
      sameDayReminderChannel: null,
    });
  });

  it('preserves every reminder field when technician reassignment keeps the start time', async () => {
    await mutate({
      operation: 'reassignTechnician',
      technicianId: OTHER_TECHNICIAN_ID,
    });

    const row = await appointment();

    expect(row.technicianId).toBe(OTHER_TECHNICIAN_ID);
    expect(row.startTime).toEqual(INITIAL_START);
    expect(reminders(row)).toEqual(REMINDER_STATE);
  });

  it('preserves reminder state for a same-start service change', async () => {
    await mutate({
      operation: 'changeService',
      baseServiceId: REPLACEMENT_SERVICE_ID,
    });

    const row = await appointment();

    expect(row.startTime).toEqual(INITIAL_START);
    expect(reminders(row)).toEqual(REMINDER_STATE);
  });

  it('atomically changes service lines and re-arms reminders for a time-changing service change', async () => {
    const nextStart = new Date('2027-01-04T17:00:00.000Z');

    await mutate({
      operation: 'changeService',
      baseServiceId: REPLACEMENT_SERVICE_ID,
      startTime: nextStart,
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
