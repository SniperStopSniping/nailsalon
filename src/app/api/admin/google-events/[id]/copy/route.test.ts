import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const {
  deleteGoogleCalendarEventForAppointment,
  listGoogleCalendarEventsForSalon,
  requireAdminSalon,
  syncGoogleCalendarEventForAppointment,
} = vi.hoisted(() => ({
  deleteGoogleCalendarEventForAppointment: vi.fn(),
  listGoogleCalendarEventsForSalon: vi.fn(),
  requireAdminSalon: vi.fn(),
  syncGoogleCalendarEventForAppointment: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: false,
}));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment,
  listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment,
}));

/* eslint-disable import/first */
import { enqueueGoogleCalendarAppointmentMutation } from '@/libs/integrationOutbox';

import { POST } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_google_copy';
const OTHER_SALON_ID = 'salon_google_copy_other';
const APPOINTMENT_ID = 'appt_google_copy';
const EVENT_ID = 'gce_google_copy';
const EXISTING_JOB_ID = 'job_google_copy_existing';
const MUTATION_VERSION = new Date('2026-08-12T12:00:00.123Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const queryLog: string[] = [];

function queryIndex(table: string, operation: 'insert' | 'lock'): number {
  return queryLog.findIndex((query) => {
    const normalized = query.toLowerCase();
    return operation === 'insert'
      ? normalized.includes(`insert into "${table}"`)
      : normalized.includes(`from "${table}"`) && normalized.includes('for update');
  });
}

function request(body: unknown = { salonSlug: 'google-copy-salon' }) {
  return new Request(`http://localhost/api/admin/google-events/${EVENT_ID}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedConnection() {
  await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
    salonId: SALON_ID,
    encryptedRefreshToken: 'test-encrypted-refresh-token',
    destinationCalendarId: 'destination_calendar',
  });
}

async function seedLinkedEvent(overrides: {
  appointment?: Partial<typeof schema.appointmentSchema.$inferInsert>;
  event?: Partial<typeof schema.googleCalendarEventSchema.$inferInsert>;
} = {}) {
  await db.insert(schema.appointmentSchema).values({
    id: APPOINTMENT_ID,
    salonId: SALON_ID,
    clientPhone: '4165550164',
    clientName: 'Copy Fixture',
    startTime: new Date('2099-12-01T15:00:00.000Z'),
    endTime: new Date('2099-12-01T16:00:00.000Z'),
    status: 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 60,
    googleCalendarEventId: 'google_source_event',
    googleCalendarSyncStatus: 'synced',
    updatedAt: MUTATION_VERSION,
    ...overrides.appointment,
  });
  await db.insert(schema.googleCalendarEventSchema).values({
    id: EVENT_ID,
    salonId: SALON_ID,
    calendarId: 'inbound_calendar',
    googleEventId: 'google_source_event',
    appointmentId: APPOINTMENT_ID,
    sourceAccessRole: 'reader',
    syncMode: 'inbound_only',
    title: 'Imported appointment',
    startTime: new Date('2099-12-01T15:00:00.000Z'),
    endTime: new Date('2099-12-01T16:00:00.000Z'),
    durationMinutes: 60,
    reviewStatus: 'appointment',
    ...overrides.event,
  });
}

async function calendarJobs() {
  return db
    .select()
    .from(schema.integrationOutboxSchema)
    .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));
}

async function seedExistingCopyJob(
  status: 'pending' | 'failed' | 'cancelled' | 'completed',
  overrides: Partial<typeof schema.integrationOutboxSchema.$inferInsert> = {},
) {
  await db.insert(schema.integrationOutboxSchema).values({
    id: EXISTING_JOB_ID,
    salonId: SALON_ID,
    appointmentId: APPOINTMENT_ID,
    provider: 'google_calendar',
    operation: 'sync_appointment',
    dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:admin-copy:${EVENT_ID}`,
    payload: {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: MUTATION_VERSION.toISOString(),
      adminCopySourceEventId: EVENT_ID,
      adminCopyGeneration: 0,
      targetCalendarId: 'destination_calendar',
    },
    status,
    ...overrides,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, {
    schema,
    logger: {
      logQuery(query) {
        queryLog.push(query);
      },
    },
  });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Google Copy Salon',
      slug: 'google-copy-salon',
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Google Copy Salon',
      slug: 'other-google-copy-salon',
    },
  ]);
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  requireAdminSalon.mockResolvedValue({
    error: null,
    salon: { id: SALON_ID },
  });
  await db.delete(schema.integrationOutboxSchema);
  await db.delete(schema.googleCalendarEventSchema);
  await db.delete(schema.appointmentSchema);
  await db.delete(schema.salonGoogleCalendarConnectionSchema);
  await seedConnection();
  queryLog.length = 0;
});

afterEach(() => {
  expect(syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  expect(deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  expect(listGoogleCalendarEventsForSalon).not.toHaveBeenCalled();
});

afterAll(async () => {
  await client.close();
});

describe('admin Google event copy', () => {
  it('atomically persists one immutable copy job without calling Google inline', async () => {
    await seedLinkedEvent();
    queryLog.length = 0;

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();
    const jobs = await calendarJobs();
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const [source] = await db
      .select()
      .from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID));

    expect(response.status).toBe(202);
    expect(body.data).toEqual({ jobId: jobs[0]!.id, status: 'queued' });
    expect(jobs).toEqual([
      expect.objectContaining({
        salonId: SALON_ID,
        appointmentId: APPOINTMENT_ID,
        provider: 'google_calendar',
        operation: 'sync_appointment',
        status: 'pending',
        dedupeKey: `google:${SALON_ID}:${APPOINTMENT_ID}:sync:admin-copy:${EVENT_ID}`,
        payload: {
          appointmentId: APPOINTMENT_ID,
          salonId: SALON_ID,
          mutationVersion: MUTATION_VERSION.toISOString(),
          adminCopySourceEventId: EVENT_ID,
          adminCopyGeneration: 0,
          targetCalendarId: 'destination_calendar',
        },
      }),
    ]);
    expect(appointment).toMatchObject({
      googleCalendarEventId: 'google_source_event',
      googleCalendarSyncStatus: 'pending',
      updatedAt: MUTATION_VERSION,
    });
    expect(source).toMatchObject({
      appointmentId: APPOINTMENT_ID,
      syncMode: 'inbound_only',
    });

    const outboxInsert = queryIndex('integration_outbox', 'insert');
    const appointmentLock = queryIndex('appointment', 'lock');
    const sourceLock = queryIndex('google_calendar_event', 'lock');

    expect(outboxInsert).toBeGreaterThanOrEqual(0);
    expect(appointmentLock).toBeGreaterThan(outboxInsert);
    expect(sourceLock).toBeGreaterThan(appointmentLock);
  });

  it('makes a replay an explicit no-write success', async () => {
    await seedLinkedEvent();

    const first = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const firstBody = await first.json();
    const second = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const secondBody = await second.json();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondBody.data).toEqual({
      jobId: firstBody.data.jobId,
      status: 'already_queued',
    });
    expect(await calendarJobs()).toHaveLength(1);
  });

  it('serializes concurrent copy requests to one durable job', async () => {
    await seedLinkedEvent();

    const responses = await Promise.all([
      POST(request(), { params: Promise.resolve({ id: EVENT_ID }) }),
      POST(request(), { params: Promise.resolve({ id: EVENT_ID }) }),
    ]);
    const bodies = await Promise.all(responses.map(response => response.json()));

    expect(responses.map(response => response.status)).toEqual([202, 202]);
    expect(bodies.map(body => body.data.status).sort())
      .toEqual(['already_queued', 'queued']);

    const jobs = await calendarJobs();

    expect(jobs).toHaveLength(1);
    expect(bodies.map(body => body.data.jobId)).toEqual([jobs[0]!.id, jobs[0]!.id]);
  });

  it('atomically rearms a failed copy job with the exact same provider identity', async () => {
    await seedLinkedEvent({
      appointment: {
        googleCalendarSyncStatus: 'failed',
        googleCalendarSyncError: 'previous failure',
      },
    });
    await seedExistingCopyJob('failed', {
      attempts: 8,
      processedAt: new Date('2026-08-12T12:05:00.000Z'),
      lastError: 'previous failure',
    });
    queryLog.length = 0;

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();
    const jobs = await calendarJobs();
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(response.status).toBe(202);
    expect(body.data).toEqual({ jobId: EXISTING_JOB_ID, status: 'queued' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: EXISTING_JOB_ID,
      status: 'pending',
      attempts: 0,
      processedAt: null,
      lastError: null,
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: MUTATION_VERSION.toISOString(),
        adminCopySourceEventId: EVENT_ID,
        // Worker identity remains `${job.id}:admin-copy:0` after an ambiguous
        // failure, so Google insert replay converges on the same event ID.
        adminCopyGeneration: 0,
        targetCalendarId: 'destination_calendar',
      },
    });
    expect(appointment).toMatchObject({
      googleCalendarSyncStatus: 'pending',
      googleCalendarSyncError: null,
      updatedAt: MUTATION_VERSION,
    });

    const outboxLock = queryIndex('integration_outbox', 'lock');
    const appointmentLock = queryIndex('appointment', 'lock');
    const sourceLock = queryIndex('google_calendar_event', 'lock');

    expect(outboxLock).toBeGreaterThanOrEqual(0);
    expect(appointmentLock).toBeGreaterThan(outboxLock);
    expect(sourceLock).toBeGreaterThan(appointmentLock);
  });

  it('fails closed without mutating a cancelled copy job', async () => {
    const processedAt = new Date('2026-08-12T12:05:00.000Z');
    await seedLinkedEvent({
      appointment: {
        googleCalendarSyncStatus: 'failed',
        googleCalendarSyncError: 'cleanup required',
      },
    });
    await seedExistingCopyJob('cancelled', {
      attempts: 3,
      processedAt,
      lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
    });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();
    const jobs = await calendarJobs();
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    expect(response.status).toBe(409);
    expect(body.data).toEqual({ jobId: EXISTING_JOB_ID, status: 'failed' });
    expect(jobs).toEqual([
      expect.objectContaining({
        id: EXISTING_JOB_ID,
        status: 'cancelled',
        attempts: 3,
        processedAt,
        lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
        payload: expect.objectContaining({ adminCopyGeneration: 0 }),
      }),
    ]);
    expect(appointment).toMatchObject({
      googleCalendarSyncStatus: 'failed',
      googleCalendarSyncError: 'cleanup required',
      updatedAt: MUTATION_VERSION,
    });
  });

  it('terminalizes a speculative job when locked appointment revalidation loses', async () => {
    await seedLinkedEvent();
    const newerVersion = new Date(MUTATION_VERSION.getTime() + 1);
    await db.update(schema.appointmentSchema)
      .set({ updatedAt: newerVersion })
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

    const result = await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: MUTATION_VERSION,
      adminCopySourceEventId: EVENT_ID,
    }));

    expect(result).toMatchObject({
      inserted: false,
      rearmed: false,
      status: 'inconsistent',
    });
    expect(result.jobId).toEqual(expect.any(String));
    expect(await calendarJobs()).toEqual([
      expect.objectContaining({
        id: result.jobId,
        status: 'cancelled',
        lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
        payload: expect.objectContaining({ mutationVersion: null }),
      }),
    ]);
  });

  it('terminalizes a speculative job when the source changes after candidate resolution', async () => {
    await seedLinkedEvent();
    const [candidate] = await db.select({
      appointmentId: schema.googleCalendarEventSchema.appointmentId,
    }).from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID));
    await db.update(schema.googleCalendarEventSchema)
      .set({ syncMode: 'bidirectional' })
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID));

    const result = await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: candidate!.appointmentId!,
      salonId: SALON_ID,
      mutationVersion: MUTATION_VERSION,
      adminCopySourceEventId: EVENT_ID,
    }));

    expect(result).toMatchObject({
      inserted: false,
      rearmed: false,
      status: 'inconsistent',
    });
    expect(result.jobId).toEqual(expect.any(String));
    expect(await calendarJobs()).toEqual([
      expect.objectContaining({
        id: result.jobId,
        status: 'cancelled',
        lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
      }),
    ]);
  });

  it('reports a completed provider-disabled copy result as inconsistent without rearming it', async () => {
    const processedAt = new Date('2026-08-12T12:05:00.000Z');
    await seedLinkedEvent({
      appointment: {
        googleCalendarSyncStatus: 'not_synced',
        googleCalendarSyncError: null,
      },
    });
    await seedExistingCopyJob('completed', {
      attempts: 1,
      processedAt,
    });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();
    const jobs = await calendarJobs();
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const [source] = await db
      .select()
      .from(schema.googleCalendarEventSchema)
      .where(eq(schema.googleCalendarEventSchema.id, EVENT_ID));

    expect(response.status).toBe(409);
    expect(body.data).toEqual({
      jobId: EXISTING_JOB_ID,
      status: 'failed',
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: EXISTING_JOB_ID,
      status: 'completed',
      attempts: 1,
      processedAt,
    });
    expect(appointment).toMatchObject({
      googleCalendarEventId: 'google_source_event',
      googleCalendarSyncStatus: 'not_synced',
      updatedAt: MUTATION_VERSION,
    });
    expect(source).toMatchObject({
      syncMode: 'inbound_only',
      supersededByEventId: null,
    });
  });

  it('reports already_completed from the pinned mirror after the configured destination changes', async () => {
    const destinationEventId = 'google_destination_event';
    await seedLinkedEvent({
      appointment: {
        googleCalendarEventId: destinationEventId,
        googleCalendarSyncStatus: 'synced',
      },
      event: {
        appointmentId: null,
        syncMode: 'superseded',
        supersededByEventId: destinationEventId,
      },
    });
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'gce_google_copy_destination',
      salonId: SALON_ID,
      calendarId: 'destination_calendar',
      googleEventId: destinationEventId,
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'writer',
      syncMode: 'bidirectional',
      title: 'Copied appointment',
      startTime: new Date('2099-12-01T15:00:00.000Z'),
      endTime: new Date('2099-12-01T16:00:00.000Z'),
      durationMinutes: 60,
      reviewStatus: 'appointment',
    });
    await seedExistingCopyJob('completed', {
      attempts: 1,
      processedAt: new Date('2026-08-12T12:05:00.000Z'),
    });
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      destinationCalendarId: 'replacement_calendar',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      jobId: EXISTING_JOB_ID,
      status: 'already_completed',
    });
    expect(await calendarJobs()).toEqual([
      expect.objectContaining({
        id: EXISTING_JOB_ID,
        status: 'completed',
        attempts: 1,
      }),
    ]);
  });

  it('fails closed when completed copy identity exists in more than one calendar', async () => {
    const destinationEventId = 'google_destination_event';
    await seedLinkedEvent({
      appointment: {
        googleCalendarEventId: destinationEventId,
        googleCalendarSyncStatus: 'synced',
      },
      event: {
        appointmentId: null,
        syncMode: 'superseded',
        supersededByEventId: destinationEventId,
      },
    });
    await db.insert(schema.googleCalendarEventSchema).values([
      {
        id: 'gce_google_copy_destination_d1',
        salonId: SALON_ID,
        calendarId: 'destination_calendar',
        googleEventId: destinationEventId,
        appointmentId: APPOINTMENT_ID,
        sourceAccessRole: 'writer',
        syncMode: 'bidirectional',
        startTime: new Date('2099-12-01T15:00:00.000Z'),
        endTime: new Date('2099-12-01T16:00:00.000Z'),
        durationMinutes: 60,
        reviewStatus: 'appointment',
      },
      {
        id: 'gce_google_copy_destination_d2',
        salonId: SALON_ID,
        calendarId: 'replacement_calendar',
        googleEventId: destinationEventId,
        appointmentId: APPOINTMENT_ID,
        sourceAccessRole: 'writer',
        syncMode: 'bidirectional',
        startTime: new Date('2099-12-01T15:00:00.000Z'),
        endTime: new Date('2099-12-01T16:00:00.000Z'),
        durationMinutes: 60,
        reviewStatus: 'appointment',
      },
    ]);
    await seedExistingCopyJob('completed', {
      attempts: 1,
      processedAt: new Date('2026-08-12T12:05:00.000Z'),
    });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('The completed Google copy state is inconsistent');
    expect(await calendarJobs()).toEqual([
      expect.objectContaining({ id: EXISTING_JOB_ID, status: 'completed' }),
    ]);
  });

  it('rejects a linked appointment that is terminal without scheduling work', async () => {
    await seedLinkedEvent({ appointment: { status: 'cancelled' } });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(409);
    expect(await calendarJobs()).toEqual([]);
  });

  it('rejects an awaiting-payment hold without a job or provider call', async () => {
    await seedLinkedEvent({ appointment: { status: 'awaiting_payment' } });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'HOLD_LOCKED',
        message: 'Awaiting-payment deposit holds cannot be copied to Google Calendar',
      },
    });
    expect(await calendarJobs()).toEqual([]);
    expect(syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });

  it('fails closed under the helper lock if a hold races candidate resolution', async () => {
    await seedLinkedEvent({ appointment: { status: 'awaiting_payment' } });

    const result = await db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
      appointmentId: APPOINTMENT_ID,
      salonId: SALON_ID,
      mutationVersion: MUTATION_VERSION,
      adminCopySourceEventId: EVENT_ID,
    }));

    expect(result).toEqual(expect.objectContaining({
      inserted: false,
      rearmed: false,
      status: 'inconsistent',
    }));
    expect(await calendarJobs()).toEqual([
      expect.objectContaining({
        id: result.jobId,
        status: 'cancelled',
        lastError: 'ADMIN_COPY_PRECONDITION_CHANGED',
      }),
    ]);
    expect(syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
  });

  it('rejects a source that is not an inbound-only linked appointment', async () => {
    await seedLinkedEvent({ event: { syncMode: 'bidirectional' } });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(409);
    expect(await calendarJobs()).toEqual([]);
  });

  it('fails closed when the destination connection is absent', async () => {
    await seedLinkedEvent();
    await db.delete(schema.salonGoogleCalendarConnectionSchema);

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(409);
    expect(await calendarJobs()).toEqual([]);
  });

  it('fails closed when the destination connection is not active or degraded', async () => {
    await seedLinkedEvent();
    await db.update(schema.salonGoogleCalendarConnectionSchema)
      .set({ status: 'disconnected' })
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(409);
    expect(await calendarJobs()).toEqual([]);
  });

  it('permits a degraded destination connection to enqueue durable recovery work', async () => {
    await seedLinkedEvent();
    await db.update(schema.salonGoogleCalendarConnectionSchema)
      .set({ status: 'degraded' })
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data).toMatchObject({ status: 'queued' });
    expect(await calendarJobs()).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('tenant-scopes the source event lookup', async () => {
    await db.insert(schema.appointmentSchema).values({
      id: APPOINTMENT_ID,
      salonId: OTHER_SALON_ID,
      clientPhone: '4165550188',
      startTime: new Date('2099-12-02T15:00:00.000Z'),
      endTime: new Date('2099-12-02T16:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 5000,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.googleCalendarEventSchema).values({
      id: EVENT_ID,
      salonId: OTHER_SALON_ID,
      calendarId: 'other_calendar',
      googleEventId: 'other_google_event',
      appointmentId: APPOINTMENT_ID,
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
      title: 'Other tenant appointment',
      startTime: new Date('2099-12-02T15:00:00.000Z'),
      endTime: new Date('2099-12-02T16:00:00.000Z'),
      durationMinutes: 60,
      reviewStatus: 'appointment',
    });

    const response = await POST(request(), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(409);
    expect(await calendarJobs()).toEqual([]);
  });

  it('validates the request before authorization or database work', async () => {
    const response = await POST(request({ salonSlug: '' }), { params: Promise.resolve({ id: EVENT_ID }) });

    expect(response.status).toBe(400);
    expect(requireAdminSalon).not.toHaveBeenCalled();
    expect(await calendarJobs()).toEqual([]);
  });
});
