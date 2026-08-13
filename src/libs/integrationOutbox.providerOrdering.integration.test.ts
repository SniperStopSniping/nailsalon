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
  listGoogleCalendarEventsForSalon: vi.fn(async () => []),
  syncGoogleCalendarEventForAppointment: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: false,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: async (work: (database: unknown) => unknown) => work(holder.db),
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  deleteGoogleCalendarEventForAppointment:
    boundaries.deleteGoogleCalendarEventForAppointment,
  getGoogleCalendarBusyWindows: boundaries.getGoogleCalendarBusyWindows,
  listGoogleCalendarEventsForSalon:
    boundaries.listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment:
    boundaries.syncGoogleCalendarEventForAppointment,
}));

/* eslint-disable import/first */
import { runAppointmentManageMutation } from '@/libs/appointmentManage';
import {
  enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarDeleteInTx,
  processIntegrationOutbox,
} from '@/libs/integrationOutbox';
/* eslint-enable import/first */

const SALON_ID = 'salon_provider_ordering';
const APPOINTMENT_ID = 'appt_provider_ordering';
const TECHNICIAN_ID = 'tech_provider_ordering';
const SERVICE_ID = 'service_provider_ordering';
const SOURCE_MIRROR_ID = 'gce_provider_ordering_source';
const SOURCE_CALENDAR_ID = 'calendar_provider_ordering_source';
const SOURCE_EVENT_ID = 'event_provider_ordering_source';
const DESTINATION_CALENDAR_ID = 'calendar_provider_ordering_destination';
const DESTINATION_EVENT_ID = 'event_provider_ordering_destination';
const RESTORED_EVENT_ID = 'event_provider_ordering_restored';
const START_A = new Date('2099-10-05T14:00:00.000Z');
const END_A = new Date('2099-10-05T15:00:00.000Z');
const START_B = new Date('2099-10-05T16:00:00.000Z');
const END_B = new Date('2099-10-05T17:00:00.000Z');

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

async function seedBaseAppointment(args: {
  sourceAccessRole: 'owner' | 'reader';
  syncMode: 'bidirectional' | 'inbound_only';
  status?: 'cancelled' | 'confirmed';
}) {
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Provider Ordering Salon',
    slug: 'provider-ordering',
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
    destinationCalendarId: DESTINATION_CALENDAR_ID,
    busyCalendarIds: [SOURCE_CALENDAR_ID],
    status: 'active',
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
    clientPhone: '4165550199',
    clientName: 'Provider Ordering Client',
    clientEmail: 'provider.ordering@example.invalid',
    startTime: START_A,
    endTime: END_A,
    status: args.status ?? 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    basePriceCents: 5000,
    baseDurationMinutes: 60,
    bufferMinutes: 0,
    blockedDurationMinutes: 60,
    googleCalendarEventId: SOURCE_EVENT_ID,
    googleCalendarSyncStatus: 'synced',
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: 'appointment_service_provider_ordering',
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
    id: SOURCE_MIRROR_ID,
    salonId: SALON_ID,
    calendarId: SOURCE_CALENDAR_ID,
    googleEventId: SOURCE_EVENT_ID,
    appointmentId: APPOINTMENT_ID,
    sourceAccessRole: args.sourceAccessRole,
    syncMode: args.syncMode,
    startTime: START_A,
    endTime: END_A,
    durationMinutes: 60,
    reviewStatus: 'appointment',
    googleStatus: 'confirmed',
  });
}

async function calendarJobs() {
  return db.select().from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID))
    .orderBy(asc(schema.integrationOutboxSchema.createdAt));
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.googleCalendarEventSchema);
  await db.delete(schema.appointmentServicesSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.technicianServicesSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.technicianSchema);
  await db.delete(schema.salonGoogleCalendarConnectionSchema);
  await db.delete(schema.salonSchema);
});

afterAll(async () => {
  await client.close();
});

describe('Google provider-result ordering', () => {
  it('adopts a paused admin copy and retargets a newer move so the move executes last', async () => {
    await seedBaseAppointment({
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
    });
    const [appointmentAtA] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: appointmentAtA!.updatedAt,
      adminCopySourceEventId: SOURCE_MIRROR_ID,
    }));

    let enterCopyProvider!: () => void;
    let releaseCopyProvider!: () => void;
    const copyProviderEntered = new Promise<void>((resolve) => {
      enterCopyProvider = resolve;
    });
    const copyProviderRelease = new Promise<void>((resolve) => {
      releaseCopyProvider = resolve;
    });
    const providerOrder: string[] = [];
    boundaries.syncGoogleCalendarEventForAppointment
      .mockImplementationOnce(async () => {
        providerOrder.push('copy-entered');
        enterCopyProvider();
        await copyProviderRelease;
        providerOrder.push('copy-finished');
        return {
          status: 'synced',
          eventId: DESTINATION_EVENT_ID,
          calendarId: DESTINATION_CALENDAR_ID,
        };
      })
      .mockImplementationOnce(async (input, options) => {
        providerOrder.push('move-finished');

        expect(input).toMatchObject({
          appointmentId: APPOINTMENT_ID,
          startTime: START_B,
          endTime: END_B,
          googleCalendarEventId: DESTINATION_EVENT_ID,
        });
        expect(options).toMatchObject({
          persistResult: false,
          targetCalendarId: DESTINATION_CALENDAR_ID,
        });

        return {
          status: 'synced',
          eventId: DESTINATION_EVENT_ID,
          calendarId: DESTINATION_CALENDAR_ID,
        };
      });

    const copyWorker = processIntegrationOutbox(1);
    await copyProviderEntered;
    await runAppointmentManageMutation({
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      operation: 'move',
      startTime: START_B,
      durationMinutes: 60,
      canReassignTechnician: false,
    });

    const jobsDuringCopy = await calendarJobs();

    expect(jobsDuringCopy.map(job => job.status).sort())
      .toEqual(['pending', 'processing']);

    const newerBeforeAdoption = jobsDuringCopy.find(job => job.status === 'pending')!;

    expect(newerBeforeAdoption.payload).toEqual(expect.objectContaining({
      targetCalendarId: SOURCE_CALENDAR_ID,
      googleCalendarEventId: SOURCE_EVENT_ID,
    }));

    releaseCopyProvider();

    await expect(copyWorker).resolves.toMatchObject({ scanned: 1, succeeded: 1 });

    const afterCopy = await calendarJobs();
    const newerAfterAdoption = afterCopy.find(job => job.status === 'pending')!;

    expect(newerAfterAdoption.payload).toEqual(expect.objectContaining({
      targetCalendarId: DESTINATION_CALENDAR_ID,
      googleCalendarEventId: DESTINATION_EVENT_ID,
    }));
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({
        startTime: START_B,
        endTime: END_B,
        googleCalendarEventId: DESTINATION_EVENT_ID,
        googleCalendarSyncStatus: 'pending',
      });

    await expect(processIntegrationOutbox(1)).resolves
      .toMatchObject({ scanned: 1, succeeded: 1 });
    expect(providerOrder).toEqual([
      'copy-entered',
      'copy-finished',
      'move-finished',
    ]);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({
        startTime: START_B,
        endTime: END_B,
        googleCalendarEventId: DESTINATION_EVENT_ID,
        googleCalendarSyncStatus: 'synced',
      });
    expect(await db.select().from(schema.googleCalendarEventSchema))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: SOURCE_MIRROR_ID,
          appointmentId: null,
          syncMode: 'superseded',
          supersededByEventId: DESTINATION_EVENT_ID,
        }),
        expect.objectContaining({
          appointmentId: APPOINTMENT_ID,
          calendarId: DESTINATION_CALENDAR_ID,
          googleEventId: DESTINATION_EVENT_ID,
          syncMode: 'bidirectional',
          deletedAt: null,
        }),
      ]));
    expect((await calendarJobs()).map(job => job.status))
      .toEqual(['completed', 'completed']);
  });

  it.each([
    { deleteKind: 'reconciliation' as const },
    { deleteKind: 'ordinary terminal' as const },
  ])('preserves the exact mirror after an old $deleteKind delete so a newer reactivation restores last', async ({
    deleteKind,
  }) => {
    await seedBaseAppointment({
      sourceAccessRole: 'owner',
      syncMode: 'bidirectional',
      status: 'cancelled',
    });

    if (deleteKind === 'reconciliation') {
      // Discovery queues the exact immutable terminal-mirror proof; provider
      // work begins only on the next pass because the scan preceded the insert.
      await expect(processIntegrationOutbox(1)).resolves.toMatchObject({
        scanned: 0,
        queuedCancelledEvents: 1,
      });
    } else {
      const [terminal] = await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await db.transaction(tx => enqueueGoogleCalendarDeleteInTx(tx, {
        appointmentId: terminal!.id,
        salonId: terminal!.salonId,
        mutationVersion: terminal!.updatedAt,
        googleCalendarEventId: SOURCE_EVENT_ID,
      }));
    }

    let enterDeleteProvider!: () => void;
    let releaseDeleteProvider!: () => void;
    const deleteProviderEntered = new Promise<void>((resolve) => {
      enterDeleteProvider = resolve;
    });
    const deleteProviderRelease = new Promise<void>((resolve) => {
      releaseDeleteProvider = resolve;
    });
    const providerOrder: string[] = [];
    boundaries.deleteGoogleCalendarEventForAppointment.mockImplementationOnce(async () => {
      providerOrder.push('delete-entered');
      enterDeleteProvider();
      await deleteProviderRelease;
      providerOrder.push('delete-finished');
      return {
        status: 'deleted',
        eventId: SOURCE_EVENT_ID,
        calendarId: SOURCE_CALENDAR_ID,
      };
    });
    boundaries.syncGoogleCalendarEventForAppointment.mockImplementationOnce(async (input, options) => {
      providerOrder.push('restore-finished');

      expect(input).toMatchObject({
        appointmentId: APPOINTMENT_ID,
        googleCalendarEventId: SOURCE_EVENT_ID,
      });
      expect(options).toMatchObject({
        persistResult: false,
        targetCalendarId: SOURCE_CALENDAR_ID,
      });

      return {
        status: 'synced',
        eventId: RESTORED_EVENT_ID,
        calendarId: SOURCE_CALENDAR_ID,
      };
    });

    const deleteWorker = processIntegrationOutbox(1);
    await deleteProviderEntered;
    const [terminalAppointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const reactivationVersion = new Date(terminalAppointment!.updatedAt.getTime() + 1);
    await db.transaction(async (tx) => {
      const [reactivated] = await tx.update(schema.appointmentSchema).set({
        status: 'confirmed',
        cancelReason: null,
        updatedAt: reactivationVersion,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)).returning();
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: reactivated!.id,
        salonId: reactivated!.salonId,
        mutationVersion: reactivated!.updatedAt,
      });
    });

    releaseDeleteProvider();

    await expect(deleteWorker).resolves.toMatchObject({ scanned: 1, succeeded: 1 });
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, SOURCE_MIRROR_ID)))[0])
      .toMatchObject({
        appointmentId: APPOINTMENT_ID,
        googleStatus: 'confirmed',
        syncMode: 'bidirectional',
        deletedAt: null,
      });
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({
        status: 'confirmed',
        googleCalendarSyncStatus: 'pending',
      });

    await expect(processIntegrationOutbox(1)).resolves
      .toMatchObject({ scanned: 1, succeeded: 1 });
    expect(providerOrder).toEqual([
      'delete-entered',
      'delete-finished',
      'restore-finished',
    ]);
    expect((await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0])
      .toMatchObject({
        status: 'confirmed',
        googleCalendarEventId: RESTORED_EVENT_ID,
        googleCalendarSyncStatus: 'synced',
      });
    expect(await db.select().from(schema.googleCalendarEventSchema))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: SOURCE_MIRROR_ID,
          appointmentId: null,
          syncMode: 'superseded',
          supersededByEventId: RESTORED_EVENT_ID,
        }),
        expect.objectContaining({
          appointmentId: APPOINTMENT_ID,
          calendarId: SOURCE_CALENDAR_ID,
          googleEventId: RESTORED_EVENT_ID,
          syncMode: 'bidirectional',
          deletedAt: null,
        }),
      ]));
    expect((await calendarJobs()).map(job => job.status))
      .toEqual(['completed', 'completed']);
  });
});
