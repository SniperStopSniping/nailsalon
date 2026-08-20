/**
 * Luster L1 PR5 — C. Decline via the existing cancel route.
 *
 * `declined_by_salon` is only valid for a pending row with a non-null
 * `request_expires_at`; `request_expired` is finalizer-only and must never
 * be settable by any HTTP caller. Every existing cancel side effect
 * (notifications, reward release, Google Calendar delete enqueue) is
 * exercised through the SAME code path as an ordinary cancellation — this
 * suite only proves the NEW eligibility guards and that a legitimate
 * decline still commits.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  access: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: vi.fn(async () => holder.access),
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationConfirmation: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled: vi.fn(async () => {}),
}));

vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: vi.fn(async () => ({ status: 'skipped' })),
}));

vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames: vi.fn(async () => []),
  getSalonById: vi.fn(async () => null),
  getTechnicianById: vi.fn(async () => null),
  updateSalonClientStats: vi.fn(async () => {}),
}));

/* eslint-disable import/first */
import { PATCH } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_decline_reason';
const TECH_ID = 'tech_decline_reason';
const CLIENT_ID = 'client_decline_reason';
const APPT_ID = 'appt_decline_reason';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

const START = new Date('2099-09-01T14:00:00.000Z');
const END = new Date('2099-09-01T15:00:00.000Z');

function accessFor(status: string, requestExpiresAt: Date | null, cancelReason: string | null = null) {
  return {
    ok: true,
    actorRole: 'admin',
    salon: { id: SALON_ID, slug: 'decline-reason-salon', name: 'Decline Reason' },
    appointment: {
      id: APPT_ID,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      salonClientId: CLIENT_ID,
      clientPhone: '4165550000',
      clientName: 'Decline Client',
      clientEmail: null,
      startTime: START,
      endTime: END,
      status,
      cancelReason,
      requestExpiresAt,
      canvasState: 'waiting',
      googleCalendarEventId: null,
      notes: null,
      totalPrice: 4500,
      totalDurationMinutes: 60,
      updatedAt: new Date(),
    },
  };
}

function patchRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/appointments/${APPT_ID}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedAppointment(status: string, requestExpiresAt: Date | null, cancelReason: string | null = null) {
  await db.insert(schema.appointmentSchema).values({
    id: APPT_ID,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    salonClientId: CLIENT_ID,
    clientPhone: '4165550000',
    clientName: 'Decline Client',
    startTime: START,
    endTime: END,
    status,
    cancelReason,
    requestExpiresAt,
    confirmationModeSnapshot: requestExpiresAt !== null ? 'request_approval' : null,
    canvasState: 'waiting',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    invoiceCurrency: 'CAD',
  });
}

async function readBack() {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, APPT_ID));
  return appointment;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Decline Reason Salon',
    slug: 'decline-reason-salon',
    ownerEmail: 'owner@example.com',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Approval Tech',
  });
  await db.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: '4165550000',
  });
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/appointments/:id/cancel — request-lifecycle reason guards', () => {
  it('declines a pending explicit request-approval booking', async () => {
    const requestExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await seedAppointment('pending', requestExpiresAt);
    holder.access = accessFor('pending', requestExpiresAt);

    const response = await PATCH(patchRequest({ cancelReason: 'declined_by_salon' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(200);

    const after = await readBack();

    expect(after?.status).toBe('cancelled');
    expect(after?.cancelReason).toBe('declined_by_salon');
  });

  it('rejects declined_by_salon on a legacy pending row (NULL requestExpiresAt) — nothing to decline', async () => {
    await seedAppointment('pending', null);
    holder.access = accessFor('pending', null);

    const response = await PATCH(patchRequest({ cancelReason: 'declined_by_salon' }), {
      params: { id: APPT_ID },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect((await readBack())?.status).toBe('pending');
  });

  it('rejects declined_by_salon on a confirmed appointment', async () => {
    await seedAppointment('confirmed', null);
    holder.access = accessFor('confirmed', null);

    const response = await PATCH(patchRequest({ cancelReason: 'declined_by_salon' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(400);
    expect((await readBack())?.status).toBe('confirmed');
  });

  it('rejects request_expired outright — the finalizer\'s exclusive vocabulary, never client-settable', async () => {
    const requestExpiresAt = new Date(Date.now() - 60 * 60 * 1000);
    await seedAppointment('pending', requestExpiresAt);
    holder.access = accessFor('pending', requestExpiresAt);

    const response = await PATCH(patchRequest({ cancelReason: 'request_expired' }), {
      params: { id: APPT_ID },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect((await readBack())?.status).toBe('pending');
  });

  it('an idempotent replay of an already-declined row succeeds without re-checking eligibility (the row is no longer pending)', async () => {
    const requestExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await seedAppointment('cancelled', requestExpiresAt, 'declined_by_salon');
    holder.access = accessFor('cancelled', requestExpiresAt, 'declined_by_salon');

    const response = await PATCH(patchRequest({ cancelReason: 'declined_by_salon' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(200);
    expect((await readBack())?.cancelReason).toBe('declined_by_salon');
  });

  it('CONTROL: ordinary client_request cancellation of a legacy pending row still works unchanged', async () => {
    await seedAppointment('pending', null);
    holder.access = accessFor('pending', null);

    const response = await PATCH(patchRequest({ cancelReason: 'client_request' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(200);

    const after = await readBack();

    expect(after?.status).toBe('cancelled');
    expect(after?.cancelReason).toBe('client_request');
  });
});
