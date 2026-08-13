import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const boundaries = vi.hoisted(() => ({
  acquireGoogleCalendarEventPairMutationBarrierInTx: vi.fn(async () => true),
  listGoogleCalendarEventsForSalon: vi.fn(),
  listGoogleCalendarsForSalon: vi.fn(),
  logAppointmentChange: vi.fn(async () => {}),
  sendAppointmentOperationalEmailOnce: vi.fn(async () => ({
    status: 'sent',
    deliveryId: 'delivery_google_inbound',
  })),
  getAppointmentCalendarEventForSync: vi.fn(),
  inboundGoogleFeedbackIsSupersededInTx: vi.fn(async () => false),
  runAppointmentManageMutation: vi.fn(),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
  enqueueGoogleCalendarSnapshotInTx: vi.fn(async () => {}),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/googleCalendar', () => ({
  listGoogleCalendarEventsForSalon: boundaries.listGoogleCalendarEventsForSalon,
  listGoogleCalendarsForSalon: boundaries.listGoogleCalendarsForSalon,
}));

vi.mock('@/libs/appointmentAudit', () => ({
  logAppointmentChange: boundaries.logAppointmentChange,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  sendAppointmentOperationalEmailOnce:
    boundaries.sendAppointmentOperationalEmailOnce,
}));

vi.mock('@/libs/appointmentManage', () => ({
  AppointmentManageError: class AppointmentManageError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  getAppointmentCalendarEventForSync:
    boundaries.getAppointmentCalendarEventForSync,
  inboundGoogleFeedbackIsSupersededInTx:
    boundaries.inboundGoogleFeedbackIsSupersededInTx,
  runAppointmentManageMutation: boundaries.runAppointmentManageMutation,
}));

vi.mock('@/libs/integrationOutbox', () => ({
  acquireGoogleCalendarEventPairMutationBarrierInTx:
    boundaries.acquireGoogleCalendarEventPairMutationBarrierInTx,
  enqueueGoogleCalendarDeleteInTx:
    boundaries.enqueueGoogleCalendarDeleteInTx,
  enqueueGoogleCalendarSnapshotInTx:
    boundaries.enqueueGoogleCalendarSnapshotInTx,
}));

/* eslint-disable import/first */
import { processGoogleCalendarInboundSync } from './googleCalendarInbound';
/* eslint-enable import/first */

const SALON_ID = 'salon_google_inbound_sql';
const CLIENT_ID = 'client_google_inbound_sql';
const APPOINTMENT_ID = 'appt_google_inbound_sql';
const EVENT_ID = 'gce_google_inbound_sql';
const REMOTE_EVENT_ID = 'google_event_inbound_sql';
const CALENDAR_ID = 'calendar_google_inbound_sql';
const PHONE = '4165550147';
const START = new Date('2099-11-01T14:00:00.000Z');
const END = new Date('2099-11-01T15:00:00.000Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedInboundCancellationTarget() {
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Inbound SQL Salon',
    slug: 'inbound-sql-salon',
    settings: { booking: { timezone: 'America/Toronto' } },
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: PHONE,
    fullName: 'Inbound Client',
  });
  await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
    salonId: SALON_ID,
    encryptedRefreshToken: 'encrypted-test-token',
    destinationCalendarId: CALENDAR_ID,
    busyCalendarIds: [CALENDAR_ID],
    status: 'active',
    inboundSyncEnabled: true,
    inboundSyncedAt: new Date('2099-10-31T12:00:00.000Z'),
  });
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    salonClientId: CLIENT_ID,
    clientPhone: PHONE,
    clientName: 'Inbound Client',
    clientEmail: 'inbound@example.test',
    startTime: START,
    endTime: END,
    status: 'confirmed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    googleCalendarEventId: REMOTE_EVENT_ID,
    googleCalendarSyncStatus: 'synced',
  });
  await db.insert(schema.googleCalendarEventSchema).values({
    id: EVENT_ID,
    salonId: SALON_ID,
    calendarId: CALENDAR_ID,
    googleEventId: REMOTE_EVENT_ID,
    appointmentId: APPOINTMENT_ID,
    sourceAccessRole: 'owner',
    syncMode: 'bidirectional',
    title: 'Inbound Client appointment',
    startTime: START,
    endTime: END,
    durationMinutes: 60,
    reviewStatus: 'appointment',
    googleStatus: 'confirmed',
  });
}

function mockDeletedRemoteEvent() {
  boundaries.listGoogleCalendarsForSalon.mockResolvedValue([{
    id: CALENDAR_ID,
    summary: 'Primary calendar',
    primary: true,
    accessRole: 'owner',
  }]);
  boundaries.listGoogleCalendarEventsForSalon.mockResolvedValue([{
    id: REMOTE_EVENT_ID,
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
    updatedAt: new Date('2099-10-31T13:00:00.000Z'),
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
  }]);
}

async function readAppointment() {
  return (await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID)))[0];
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
  await db.delete(schema.googleCalendarEventSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonClientContactAliasSchema);
  await db.delete(schema.salonClientSchema);
  await db.delete(schema.salonGoogleCalendarConnectionSchema);
  await db.delete(schema.salonSchema);
  await seedInboundCancellationTarget();
  mockDeletedRemoteEvent();
});

afterAll(async () => {
  await client.close();
});

describe('Google Calendar inbound scope-clean ownership on real SQL', () => {
  it('preserves an admin-copy superseded source sentinel during inbound refresh', async () => {
    await db.update(schema.googleCalendarEventSchema).set({
      appointmentId: null,
      syncMode: 'superseded',
      supersededByEventId: 'google_copy_destination',
    }).where(eq(schema.googleCalendarEventSchema.id, EVENT_ID));
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValueOnce([{
      id: REMOTE_EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'confirmed',
      summary: 'Refreshed source event',
      description: 'Provider refresh',
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: START,
      endTime: END,
      updatedAt: new Date('2099-10-31T13:00:00.000Z'),
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
    }]);

    expect(await processGoogleCalendarInboundSync(25, SALON_ID)).toMatchObject({
      failedConnections: 0,
      importedEvents: 1,
    });
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID)))[0])
      .toEqual(expect.objectContaining({
        appointmentId: null,
        syncMode: 'superseded',
        supersededByEventId: 'google_copy_destination',
        title: 'Refreshed source event',
      }));
    expect(await readAppointment()).toEqual(expect.objectContaining({
      status: 'confirmed',
      googleCalendarEventId: REMOTE_EVENT_ID,
    }));
  });

  it('does not mutate a stored mirror when remote ownership metadata conflicts', async () => {
    boundaries.listGoogleCalendarEventsForSalon.mockResolvedValueOnce([{
      id: REMOTE_EVENT_ID,
      calendarId: CALENDAR_ID,
      status: 'confirmed',
      summary: 'Conflicting remote event',
      description: 'Must not land',
      location: null,
      recurringEventId: null,
      transparency: 'busy',
      isAllDay: false,
      startTime: new Date(START.getTime() + 60_000),
      endTime: new Date(END.getTime() + 60_000),
      updatedAt: new Date('2099-10-31T13:00:00.000Z'),
      appointmentId: 'different_appointment',
      salonId: SALON_ID,
    }]);
    const before = (await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID)))[0];

    expect(await processGoogleCalendarInboundSync(25, SALON_ID)).toMatchObject({
      failedConnections: 0,
      importedEvents: 0,
    });
    expect((await db.select().from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID)))[0]).toEqual(before);
    expect(await readAppointment()).toEqual(expect.objectContaining({
      status: 'confirmed',
      startTime: START,
    }));
  });
});
