import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const boundaries = vi.hoisted(() => ({
  deleteGoogleCalendarEventForAppointment: vi.fn(),
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  listGoogleCalendarEventsForSalon: vi.fn(),
  listGoogleCalendarsForSalon: vi.fn(),
  logAppointmentChange: vi.fn(async () => undefined),
  sendAppointmentOperationalEmailOnce: vi.fn(async () => ({
    status: 'sent',
    deliveryId: 'delivery_inbound_ordering',
  })),
  syncGoogleCalendarEventForAppointment: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  usesRuntimePostgres: false,
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  deleteGoogleCalendarEventForAppointment:
    boundaries.deleteGoogleCalendarEventForAppointment,
  getGoogleCalendarBusyWindows: boundaries.getGoogleCalendarBusyWindows,
  listGoogleCalendarEventsForSalon: boundaries.listGoogleCalendarEventsForSalon,
  listGoogleCalendarsForSalon: boundaries.listGoogleCalendarsForSalon,
  syncGoogleCalendarEventForAppointment:
    boundaries.syncGoogleCalendarEventForAppointment,
}));
vi.mock('@/libs/appointmentAudit', () => ({
  logAppointmentChange: boundaries.logAppointmentChange,
}));
vi.mock('@/libs/clientLifecycleStabilization', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/clientLifecycleStabilization')>()),
  sendAppointmentOperationalEmailOnce:
    boundaries.sendAppointmentOperationalEmailOnce,
}));

/* eslint-disable import/first */
import {
  enqueueGoogleCalendarAppointmentMutation,
  processIntegrationOutbox,
} from '@/libs/integrationOutbox';

import { processGoogleCalendarInboundSync } from './googleCalendarInbound';
/* eslint-enable import/first */

const SALON_ID = 'salon_inbound_ordering';
const APPOINTMENT_ID = 'appt_inbound_ordering';
const TECHNICIAN_ID = 'tech_inbound_ordering';
const SERVICE_ID = 'service_inbound_ordering';
const CALENDAR_ID = 'calendar_inbound_ordering';
const EVENT_ID = 'event_inbound_ordering';
const START_A = new Date('2099-09-07T14:00:00.000Z');
const END_A = new Date('2099-09-07T15:00:00.000Z');
const START_B = new Date('2099-09-07T16:00:00.000Z');
const END_B = new Date('2099-09-07T17:00:00.000Z');

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

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.googleCalendarEventSchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.technicianServicesSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.technicianSchema);
  await db.delete(schema.salonGoogleCalendarConnectionSchema);
  await db.delete(schema.salonSchema);

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Inbound Ordering Salon',
    slug: 'inbound-ordering',
    settings: {
      booking: {
        timezone: 'America/Toronto',
        slotIntervalMinutes: 15,
        bufferMinutes: 0,
      },
    },
  });
  await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
    salonId: SALON_ID,
    encryptedRefreshToken: 'encrypted-test-token',
    destinationCalendarId: CALENDAR_ID,
    busyCalendarIds: [CALENDAR_ID],
    status: 'active',
    inboundSyncEnabled: true,
    inboundSyncedAt: new Date('2099-09-07T12:00:00.000Z'),
  });
  await db.insert(schema.technicianSchema).values({
    id: TECHNICIAN_ID,
    salonId: SALON_ID,
    name: 'Taylor',
    weeklySchedule: allDaySchedule,
  });
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'Manicure',
    category: 'manicure',
    price: 5000,
    durationMinutes: 60,
  });
  await db.insert(schema.technicianServicesSchema).values({
    technicianId: TECHNICIAN_ID,
    serviceId: SERVICE_ID,
  });
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    technicianId: TECHNICIAN_ID,
    clientPhone: '4165550173',
    clientName: 'Inbound Client',
    clientEmail: 'inbound.ordering@example.invalid',
    startTime: START_A,
    endTime: END_A,
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    basePriceCents: 5000,
    baseDurationMinutes: 60,
    bufferMinutes: 0,
    blockedDurationMinutes: 60,
    googleCalendarEventId: EVENT_ID,
    googleCalendarSyncStatus: 'synced',
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: 'appointment_service_inbound_ordering',
    appointmentId: APPOINTMENT_ID,
    serviceId: SERVICE_ID,
    priceAtBooking: 5000,
    durationAtBooking: 60,
    nameSnapshot: 'Manicure',
    categorySnapshot: 'manicure',
    priceCentsSnapshot: 5000,
    durationMinutesSnapshot: 60,
  });
  await db.insert(schema.googleCalendarEventSchema).values({
    id: 'gce_inbound_ordering',
    salonId: SALON_ID,
    calendarId: CALENDAR_ID,
    googleEventId: EVENT_ID,
    appointmentId: APPOINTMENT_ID,
    sourceAccessRole: 'owner',
    syncMode: 'bidirectional',
    startTime: START_A,
    endTime: END_A,
    durationMinutes: 60,
    reviewStatus: 'appointment',
    googleStatus: 'confirmed',
  });

  boundaries.listGoogleCalendarsForSalon.mockResolvedValue([{
    id: CALENDAR_ID,
    summary: 'Primary',
    primary: true,
    accessRole: 'owner',
  }]);
  boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
    id: EVENT_ID,
    calendarId: CALENDAR_ID,
    status: 'confirmed',
    summary: 'Inbound Client appointment',
    description: null,
    location: null,
    recurringEventId: null,
    transparency: 'busy',
    isAllDay: false,
    startTime: START_B,
    endTime: END_B,
    updatedAt: new Date('2099-09-07T13:00:00.000Z'),
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    attendees: [],
  }]);
  boundaries.syncGoogleCalendarEventForAppointment.mockResolvedValue({
    status: 'synced',
    eventId: EVENT_ID,
    calendarId: CALENDAR_ID,
  });
  boundaries.deleteGoogleCalendarEventForAppointment.mockResolvedValue({
    status: 'deleted',
    eventId: EVENT_ID,
    calendarId: CALENDAR_ID,
  });
});

afterAll(async () => {
  await client.close();
});

describe('Google inbound move ordering', () => {
  it('rejects stale outbound feedback after a newer local move commits', async () => {
    const [before] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const localRevision = new Date(before!.updatedAt.getTime() + 1);
    await db.transaction(async (tx) => {
      const [moved] = await tx.update(schema.appointmentSchema).set({
        startTime: START_B,
        endTime: END_B,
        updatedAt: localRevision,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: moved!.id,
        salonId: moved!.salonId,
        mutationVersion: moved!.updatedAt,
      });
    });
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'confirmed',
      summary: 'Stale outbound A',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: START_A,
      endTime: END_A,
      updatedAt: new Date('2099-09-07T13:05:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: before!.updatedAt.toISOString(),
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID)).toMatchObject({
      movedAppointments: 0,
      conflicts: 0,
    });
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]).toMatchObject({
      startTime: START_B,
      endTime: END_B,
      updatedAt: localRevision,
    });
    expect(await db.select().from(schema.integrationOutboxSchema)).toHaveLength(1);
  });

  it('accepts a manual remote edit that preserves the current mutation marker', async () => {
    const [current] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const bookkeepingRevision = new Date(current!.updatedAt.getTime() + 1);
    await db.update(schema.appointmentSchema).set({
      sameDayReminderSentAt: bookkeepingRevision,
      updatedAt: bookkeepingRevision,
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'confirmed',
      summary: 'Manual Google move',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: START_B,
      endTime: END_B,
      updatedAt: new Date('2099-09-07T13:06:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: current!.updatedAt.toISOString(),
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID)).toMatchObject({
      movedAppointments: 1,
      conflicts: 0,
    });
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]).toMatchObject({
      startTime: START_B,
      endTime: END_B,
      googleCalendarSyncStatus: 'pending',
    });
  });

  it('rejects markerless feedback while a newer local intent is runnable', async () => {
    const [current] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const localRevision = new Date(current!.updatedAt.getTime() + 1);
    await db.transaction(async (tx) => {
      const [moved] = await tx.update(schema.appointmentSchema).set({
        startTime: START_B,
        endTime: END_B,
        updatedAt: localRevision,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: moved!.id,
        salonId: moved!.salonId,
        mutationVersion: moved!.updatedAt,
      });
    });
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'confirmed',
      summary: 'Markerless stale provider state',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: START_A,
      endTime: END_A,
      updatedAt: new Date('2099-09-07T13:06:30.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID)).toMatchObject({
      movedAppointments: 0,
      conflicts: 0,
    });
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({ startTime: START_B, endTime: END_B });
  });

  it('canonicalizes a lost-response first-create job from primary to the exact mirror pair', async () => {
    await db.delete(schema.googleCalendarEventSchema);
    await db.update(schema.appointmentSchema).set({
      googleCalendarEventId: null,
      googleCalendarSyncStatus: 'not_synced',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointment!.updatedAt,
    }));
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'gce_primary_alias_lost_response',
      salonId: SALON_ID,
      calendarId: 'primary',
      googleEventId: EVENT_ID,
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'owner',
      syncMode: 'bidirectional',
      startTime: START_A,
      endTime: END_A,
      durationMinutes: 60,
      reviewStatus: 'appointment',
      googleStatus: 'confirmed',
    });
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'confirmed',
      summary: 'Accepted create',
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: START_A,
      endTime: END_A,
      updatedAt: new Date('2099-09-07T13:07:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointment!.updatedAt.toISOString(),
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID)).toMatchObject({
      failedConnections: 0,
    });
    expect(await db.select().from(schema.googleCalendarEventSchema)).toEqual([
      expect.objectContaining({
        id: 'gce_primary_alias_lost_response',
        calendarId: CALENDAR_ID,
        googleEventId: EVENT_ID,
      }),
    ]);
    expect((await db.select().from(schema.integrationOutboxSchema))[0]?.payload)
      .toEqual(expect.objectContaining({
        targetCalendarId: CALENDAR_ID,
        googleCalendarEventId: EVENT_ID,
      }));
  });

  it('does not turn markerless provider feedback into B while A is processing', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointmentAtA!.updatedAt,
    }));

    let inboundRan = false;
    const firstWorker = await processIntegrationOutbox(1, {
      beforeGoogleProviderDispatch: async () => {
        if (inboundRan) {
          return;
        }
        inboundRan = true;
        const inbound = await processGoogleCalendarInboundSync(1, SALON_ID);

        expect(inbound).toMatchObject({ movedAppointments: 0, conflicts: 0 });
      },
    });

    expect(firstWorker).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(boundaries.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);

    const afterInbound = (await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]!;
    const jobsAfterInbound = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID))
      .orderBy(asc(schema.integrationOutboxSchema.createdAt));

    expect(afterInbound).toMatchObject({
      startTime: START_A,
      endTime: END_A,
      googleCalendarSyncStatus: 'synced',
    });
    expect(jobsAfterInbound.filter(job => job.provider === 'google_calendar'))
      .toHaveLength(1);
    expect(jobsAfterInbound.map(job => job.status)).toEqual(['completed']);
    expect(boundaries.syncGoogleCalendarEventForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        startTime: START_A,
        endTime: END_A,
        googleCalendarEventId: EVENT_ID,
      }),
      expect.objectContaining({
        persistResult: false,
        targetCalendarId: CALENDAR_ID,
      }),
    );

    const finalAppointment = (await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]!;

    expect(finalAppointment).toMatchObject({
      startTime: START_A,
      endTime: END_A,
      googleCalendarEventId: EVENT_ID,
      googleCalendarSyncStatus: 'synced',
    });
  });

  it('does not accept a markerless cancellation while an upsert is processing', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointmentAtA!.updatedAt,
    }));
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: null,
      endTime: null,
      updatedAt: new Date('2099-09-07T13:30:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      attendees: [],
    }]);

    let inboundRan = false;

    expect(await processIntegrationOutbox(1, {
      beforeGoogleProviderDispatch: async () => {
        if (inboundRan) {
          return;
        }
        inboundRan = true;

        expect(await processGoogleCalendarInboundSync(1, SALON_ID))
          .toMatchObject({ cancelledAppointments: 0, failedConnections: 0 });
      },
    })).toMatchObject({ scanned: 1, succeeded: 1 });

    expect(boundaries.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);

    const afterInbound = (await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]!;

    expect(afterInbound).toMatchObject({
      status: 'confirmed',
      googleCalendarEventId: EVENT_ID,
      googleCalendarSyncStatus: 'synced',
    });

    const jobs = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID))
      .orderBy(asc(schema.integrationOutboxSchema.createdAt));

    expect(jobs.map(job => [job.operation, job.status]))
      .toEqual([['sync_appointment', 'completed']]);
    expect(boundaries.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });

  it('rejects a markerless tombstone while an old upsert is already running', async () => {
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointmentAtA!.updatedAt,
    }));
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: null,
      endTime: null,
      updatedAt: new Date('2099-09-07T13:45:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      attendees: [],
    }]);
    let enterProvider!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      enterProvider = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerOrder: string[] = [];
    let remoteState: 'original' | 'upserted' | 'deleted' = 'original';
    boundaries.syncGoogleCalendarEventForAppointment.mockImplementationOnce(async () => {
      providerOrder.push('upsert-entered');
      enterProvider();
      await providerRelease;
      remoteState = 'upserted';
      providerOrder.push('upsert-finished');
      return { status: 'synced', eventId: EVENT_ID, calendarId: CALENDAR_ID };
    });
    boundaries.deleteGoogleCalendarEventForAppointment.mockImplementationOnce(async () => {
      remoteState = 'deleted';
      providerOrder.push('delete-finished');
      return { status: 'deleted', eventId: EVENT_ID, calendarId: CALENDAR_ID };
    });

    const oldWorker = processIntegrationOutbox(1);
    await providerEntered;

    expect(await processGoogleCalendarInboundSync(1, SALON_ID))
      .toMatchObject({ cancelledAppointments: 0, failedConnections: 0 });

    const whileOldRuns = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));

    expect(whileOldRuns.map(job => [job.operation, job.status]))
      .toEqual([['sync_appointment', 'processing']]);

    releaseProvider();

    expect(await oldWorker).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(remoteState).toBe('upserted');
    expect(providerOrder).toEqual([
      'upsert-entered',
      'upsert-finished',
    ]);
    expect(remoteState).toBe('upserted');
    expect(boundaries.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(boundaries.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({
        status: 'confirmed',
        googleCalendarEventId: EVENT_ID,
        googleCalendarSyncStatus: 'synced',
      });

    const finalJobs = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID))
      .orderBy(asc(schema.integrationOutboxSchema.createdAt));

    expect(finalJobs.map(job => [job.operation, job.status]))
      .toEqual([['sync_appointment', 'completed']]);
  });

  it('uses the exact stored link when a cancelled Google tombstone omits private metadata', async () => {
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: null,
      endTime: null,
      updatedAt: new Date('2099-09-07T13:50:00.000Z'),
      appointmentId: null,
      salonId: null,
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID))
      .toMatchObject({ cancelledAppointments: 1, failedConnections: 0 });
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({
        status: 'cancelled',
        googleCalendarEventId: null,
        googleCalendarSyncStatus: 'deleted',
      });

    const [barrier] = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));

    expect(barrier).toMatchObject({
      provider: 'google_calendar',
      operation: 'delete_event',
      status: 'pending',
      payload: expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        googleCalendarEventId: EVENT_ID,
        targetCalendarId: CALENDAR_ID,
        authoritativeTerminalDelete: true,
      }),
    });
  });

  it('reloads the locked appointment and orders cancellation after a move committed since the scan', async () => {
    const [appointmentBeforeScan] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: null,
      endTime: null,
      updatedAt: new Date('2099-09-07T13:55:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointmentBeforeScan!.updatedAt.toISOString(),
      attendees: [],
    }]);
    let movedRevision: Date | null = null;

    expect(await processGoogleCalendarInboundSync(1, SALON_ID, {
      beforeCancellationTransaction: async () => {
        const [current] = await db.select().from(schema.appointmentSchema)
          .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
        movedRevision = new Date(current!.updatedAt.getTime() + 60_000);
        await db.transaction(async (tx) => {
          const [moved] = await tx.update(schema.appointmentSchema).set({
            startTime: START_B,
            endTime: END_B,
            updatedAt: movedRevision!,
          }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
          await enqueueGoogleCalendarAppointmentMutation(tx, {
            appointmentId: moved!.id,
            salonId: moved!.salonId,
            mutationVersion: moved!.updatedAt,
          });
        });
      },
    })).toMatchObject({ cancelledAppointments: 0, failedConnections: 0 });

    const [terminal] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(terminal).toMatchObject({
      status: 'confirmed',
      startTime: START_B,
      endTime: END_B,
      googleCalendarEventId: EVENT_ID,
      googleCalendarSyncStatus: 'pending',
    });
    expect(terminal!.updatedAt).toEqual(movedRevision);

    const jobs = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));
    const moveIntent = jobs.find(job => job.operation === 'sync_appointment');

    expect(moveIntent?.payload).toEqual(expect.objectContaining({
      mutationVersion: movedRevision!.toISOString(),
    }));
    expect(jobs).toHaveLength(1);
    expect(await processIntegrationOutbox(1)).toMatchObject({ scanned: 1, succeeded: 1 });
    expect(boundaries.syncGoogleCalendarEventForAppointment).toHaveBeenCalledTimes(1);
    expect(boundaries.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });

  it('preserves the mirror when reactivation commits after a terminal scan', async () => {
    const [terminal] = await db.update(schema.appointmentSchema).set({
      status: 'cancelled',
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: null,
      endTime: null,
      updatedAt: new Date('2099-09-07T13:57:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: terminal!.updatedAt.toISOString(),
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID, {
      beforeCancellationTransaction: async () => {
        const reactivationRevision = new Date(terminal!.updatedAt.getTime() + 1);
        await db.transaction(async (tx) => {
          const [reactivated] = await tx.update(schema.appointmentSchema).set({
            status: 'confirmed',
            updatedAt: reactivationRevision,
          }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
          await enqueueGoogleCalendarAppointmentMutation(tx, {
            appointmentId: reactivated!.id,
            salonId: reactivated!.salonId,
            mutationVersion: reactivated!.updatedAt,
          });
        });
      },
    })).toMatchObject({ cancelledAppointments: 0, failedConnections: 0 });

    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({ status: 'confirmed', googleCalendarEventId: EVENT_ID });
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_inbound_ordering')))[0])
      .toMatchObject({ appointmentId: APPOINTMENT_ID, deletedAt: null });
    expect((await db.select().from(schema.integrationOutboxSchema))[0])
      .toMatchObject({ operation: 'sync_appointment', status: 'pending' });
  });

  it('does not cancel from a stale inbound source after admin copy detaches it', async () => {
    const destinationEventId = 'event_inbound_ordering_copy';
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'cancelled',
      summary: null,
      description: null,
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: null,
      endTime: null,
      updatedAt: new Date('2099-09-07T13:58:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      attendees: [],
    }]);

    expect(await processGoogleCalendarInboundSync(1, SALON_ID, {
      beforeCancellationTransaction: async () => {
        await db.transaction(async (tx) => {
          await tx.insert(schema.googleCalendarEventSchema).values({
            id: 'gce_inbound_ordering_copy',
            salonId: SALON_ID,
            calendarId: CALENDAR_ID,
            googleEventId: destinationEventId,
            appointmentId: APPOINTMENT_ID,
            sourceAccessRole: 'owner',
            syncMode: 'bidirectional',
            startTime: START_A,
            endTime: END_A,
            durationMinutes: 60,
            reviewStatus: 'appointment',
            googleStatus: 'confirmed',
          });
          await tx.update(schema.googleCalendarEventSchema).set({
            appointmentId: null,
            syncMode: 'superseded',
            supersededByEventId: destinationEventId,
          }).where(eq(schema.googleCalendarEventSchema.id, 'gce_inbound_ordering'));
          await tx.update(schema.appointmentSchema).set({
            googleCalendarEventId: destinationEventId,
            googleCalendarSyncStatus: 'synced',
          }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
        });
      },
    })).toMatchObject({ cancelledAppointments: 0, failedConnections: 0 });

    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0]).toMatchObject({
      status: 'confirmed',
      googleCalendarEventId: destinationEventId,
      googleCalendarSyncStatus: 'synced',
    });
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, 'gce_inbound_ordering')))[0])
      .toMatchObject({
        appointmentId: null,
        syncMode: 'superseded',
        supersededByEventId: destinationEventId,
        googleStatus: 'confirmed',
        deletedAt: null,
      });
    expect(await db.select().from(schema.integrationOutboxSchema)).toHaveLength(0);
    expect(boundaries.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });
});
