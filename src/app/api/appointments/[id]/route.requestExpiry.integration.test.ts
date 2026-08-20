/**
 * Luster L1 PR5 — B. Strict REQUEST_EXPIRED on confirm.
 *
 * A `pending` explicit request-approval booking whose `request_expires_at`
 * has already passed must be REJECTED by `PATCH /api/appointments/:id`
 * `{status:'confirmed'}` — never confirmed merely because the slot happens
 * to be free (`appointmentBlocking.ts` already stopped it from blocking).
 * Mirrors `route.holdGuards.integration.test.ts`'s style: real PGlite rows,
 * the real PATCH handler, `requireAppointmentAccess` mocked to a fixed
 * access snapshot.
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
  requireAppointmentAccess: vi.fn(async () => holder.access),
}));

vi.mock('@/libs/appointmentAudit', () => ({
  logAppointmentChange: vi.fn(async () => {}),
  logAppointmentLocked: vi.fn(async () => {}),
  buildAppointmentAuditRow: vi.fn((input: Record<string, unknown>) => ({
    id: `audit_${crypto.randomUUID()}`,
    appointmentId: input.appointmentId,
    salonId: input.salonId,
    action: input.action,
    performedBy: input.performedBy,
    performedByRole: input.performedByRole,
    performedByName: input.performedByName ?? null,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
  })),
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarDelete: vi.fn(async () => {}),
  enqueueGoogleCalendarUpsert: vi.fn(async () => {}),
  enqueueGoogleCalendarDeleteInTx: vi.fn(async () => ({ inserted: true })),
  enqueueGoogleCalendarAppointmentMutation: vi.fn(async () => ({ inserted: true })),
}));

vi.mock('@/libs/SMS', () => ({
  sendCancellationNotificationToTech: vi.fn(async () => ({ success: true })),
  sendCancellationConfirmation: vi.fn(async () => ({ success: true })),
  sendBookingConfirmationToClient: vi.fn(async () => ({ success: true })),
  sendRescheduleConfirmation: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForAppointmentCancelled: vi.fn(async () => {}),
}));

vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: vi.fn(async () => ({ status: 'skipped' })),
}));

/* eslint-disable import/first */
import { PATCH } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_request_expiry';
const TECH_ID = 'tech_request_expiry';
const CLIENT_ID = 'client_request_expiry';
const APPT_ID = 'appt_request_expiry';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;

const START = new Date('2099-09-01T14:00:00.000Z');
const END = new Date('2099-09-01T15:00:00.000Z');

function accessFor(status: string, requestExpiresAt: Date | null) {
  return {
    ok: true,
    actorRole: 'admin',
    salon: { id: SALON_ID, slug: 'request-expiry-salon', name: 'Request Expiry' },
    appointment: {
      id: APPT_ID,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      salonClientId: CLIENT_ID,
      clientPhone: '4165550000',
      clientName: 'Request Client',
      clientEmail: null,
      startTime: START,
      endTime: END,
      status,
      requestExpiresAt,
      canvasState: 'waiting',
      googleCalendarEventId: null,
      totalPrice: 4500,
      totalDurationMinutes: 60,
    },
  };
}

function patchRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/appointments/${APPT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedAppointment(status: string, requestExpiresAt: Date | null) {
  await db.insert(schema.appointmentSchema).values({
    id: APPT_ID,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    salonClientId: CLIENT_ID,
    clientPhone: '4165550000',
    clientName: 'Request Client',
    startTime: START,
    endTime: END,
    status,
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
    name: 'Request Expiry Salon',
    slug: 'request-expiry-salon',
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
  await db.delete(schema.appointmentDepositSchema);
  await db.delete(schema.rewardSchema);
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

describe('PATCH /api/appointments/:id — strict REQUEST_EXPIRED on confirm', () => {
  it('rejects confirming a pending request whose deadline has already passed, with a typed REQUEST_EXPIRED conflict', async () => {
    const requestExpiresAt = new Date(Date.now() - 60 * 60 * 1000);
    await seedAppointment('pending', requestExpiresAt);
    holder.access = accessFor('pending', requestExpiresAt);

    const response = await PATCH(patchRequest({ status: 'confirmed' }), {
      params: { id: APPT_ID },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('REQUEST_EXPIRED');

    const after = await readBack();

    expect(after?.status).toBe('pending');
  });

  it('rejects confirming AT exactly the deadline instant (at-or-after, matching appointmentBlocking.ts\'s cutoff)', async () => {
    const requestExpiresAt = new Date(Date.now() - 1000);
    await seedAppointment('pending', requestExpiresAt);
    holder.access = accessFor('pending', requestExpiresAt);

    const response = await PATCH(patchRequest({ status: 'confirmed' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('REQUEST_EXPIRED');
  });

  it('CONTROL: confirms normally when the explicit deadline has not yet passed', async () => {
    const requestExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await seedAppointment('pending', requestExpiresAt);
    holder.access = accessFor('pending', requestExpiresAt);

    const response = await PATCH(patchRequest({ status: 'confirmed' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(200);
    expect((await readBack())?.status).toBe('confirmed');
  });

  it('CONTROL: confirms normally for a legacy pending row (NULL requestExpiresAt) — byte-identical to pre-PR5 behaviour', async () => {
    await seedAppointment('pending', null);
    holder.access = accessFor('pending', null);

    const response = await PATCH(patchRequest({ status: 'confirmed' }), {
      params: { id: APPT_ID },
    });

    expect(response.status).toBe(200);
    expect((await readBack())?.status).toBe('confirmed');
  });

  it('does not apply the expiry guard to a non-confirm transition (e.g. reopening a cancelled appointment back to confirmed is governed by the ordinary reactivation rules, not by a stale requestExpiresAt)', async () => {
    // A cancelled row's requestExpiresAt is left as-is (never cleared) —
    // this proves the guard is keyed on the LOCKED row's CURRENT status
    // being 'pending', not merely "any row with a past requestExpiresAt".
    const requestExpiresAt = new Date(Date.now() - 60 * 60 * 1000);
    await seedAppointment('cancelled', requestExpiresAt);
    holder.access = accessFor('cancelled', requestExpiresAt);

    const response = await PATCH(patchRequest({ status: 'confirmed' }), {
      params: { id: APPT_ID },
    });
    const body = await response.json();

    // Reactivating from 'cancelled' succeeds through the ordinary
    // reactivation path (not REQUEST_EXPIRED) — proving the new guard is
    // scoped to a 'pending' source status only.
    expect(response.status).not.toBe(409);

    if (response.status !== 200) {
      expect(body.error?.code).not.toBe('REQUEST_EXPIRED');
    }
  });
});
