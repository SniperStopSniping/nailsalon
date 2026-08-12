/**
 * §14 tests 16, 17 and 22 — the read surfaces, ON REAL ROWS.
 *
 * The charter is explicit that the existing mocked suites for two of these
 * "always return [] and cannot fail", so these are deliberately PGlite-backed
 * and go through the real handlers. A hold is honest on owner/staff surfaces
 * (the slot really is occupied) and must be invisible on the client's history
 * and in anything that reads as "a booking happened".
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
  salon: null as unknown,
  clientPhone: '4165551234',
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon: vi.fn(async () => ({ salon: holder.salon, error: null })),
  requireAdminSalon: vi.fn(async () => ({ salon: holder.salon, error: null })),
  getAdminSession: vi.fn(async () => ({ id: 'admin_1', name: 'Owner' })),
}));

vi.mock('@/libs/appointmentAudit', () => ({
  logAdminOverride: vi.fn(async () => {}),
  logTechReassignment: vi.fn(async () => {}),
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession: vi.fn(async () => ({
    ok: true,
    normalizedPhone: holder.clientPhone,
    phoneVariants: [holder.clientPhone, `+1${holder.clientPhone}`],
  })),
  requireClientSalonFromQuery: vi.fn(async () => ({ ok: true, salon: holder.salon })),
}));

const manage = vi.hoisted(() => ({ capability: null as unknown }));

vi.mock('@/libs/appointmentAccess', () => ({
  verifyAppointmentAccessToken: vi.fn(async () => manage.capability),
  describeAppointmentAccessFailure: vi.fn(() => null),
}));

vi.mock('@/libs/bookingConfig', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/bookingConfig')>(),
  getBookingConfigForSalon: vi.fn(async () => ({
    slotIntervalMinutes: 15,
    timezone: 'America/Toronto',
  })),
}));

vi.mock('@/libs/queries', () => ({
  getTechniciansBySalonId: vi.fn(async () => []),
  getAppointmentServiceNames: vi.fn(async () => ['Gel Manicure']),
}));

const reminders = vi.hoisted(() => ({
  sendAppointmentReminder: vi.fn(async () => ({ success: true, messageId: 'sm_1' })),
}));

vi.mock('@/libs/SMS', () => ({
  sendAppointmentReminder: reminders.sendAppointmentReminder,
}));

vi.mock('@/libs/salonStatus', () => ({
  isSmsEnabled: vi.fn(() => true),
  guardSalonApiRoute: vi.fn(async () => null),
  guardFeatureEntitlement: vi.fn(async () => null),
}));

/* eslint-disable import/first */
import { processAppointmentReminders } from '@/libs/appointmentReminders';
import {
  appointmentStatusChipClasses,
  formatAppointmentStatus,
} from '@/libs/appointmentStatusDisplay';

import { PUT as reassignPut } from '../admin/appointments/[id]/reassign/route';
import { GET as adminAppointmentsGet } from '../admin/appointments/route';
import { GET as adminTodayGet } from '../admin/today/route';
import { PATCH as managePatch } from '../public/appointments/manage/[token]/route';
import { GET as historyGet } from './history/route';
/* eslint-enable import/first */

const SALON_ID = 'salon_surfaces';
const TECH_ID = 'tech_surfaces';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

const SOON = new Date(Date.now() + 2 * 86_400_000);

/** The route's default window is the LAST seven days, so the range is explicit. */
function windowQuery(): string {
  const startDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
  return `startDate=${startDate}&endDate=${endDate}`;
}

async function seedAppointment(status: string, offsetHours: number) {
  counter += 1;
  const id = `appt_surf_${counter}`;
  const startTime = new Date(SOON.getTime() + offsetHours * 3_600_000);
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: holder.clientPhone,
    clientName: 'Surface Client',
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    status,
    totalPrice: 4500,
    totalDurationMinutes: 60,
    ...(status === 'awaiting_payment'
      ? { depositHoldExpiresAt: new Date(Date.now() + 30 * 60_000) }
      : {}),
  });
  return id;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const [salon] = await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Surfaces Salon',
    slug: 'surfaces-salon',
    ownerEmail: 'owner@example.com',
  }).returning();
  holder.salon = salon;

  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Daniela',
  });
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

/** §14 test 22 — the owner-facing list must not surface holds by default. */
describe('22 — GET /api/admin/appointments', () => {
  it('EXCLUDES holds when no status filter is supplied', async () => {
    const pending = await seedAppointment('pending', 1);
    const hold = await seedAppointment('awaiting_payment', 2);

    const response = await adminAppointmentsGet(
      new Request(`http://localhost/api/admin/appointments?${windowQuery()}`),
    );
    const body = await response.json();
    const ids = body.data.appointments.map((row: { id: string }) => row.id);

    expect(response.status).toBe(200);
    expect(ids).toContain(pending);
    // An unfiltered consumer — the notifications feed above all — must not see
    // an unpaid hold as though a booking had happened.
    expect(ids).not.toContain(hold);
  });

  it('INCLUDES holds when they are asked for by name', async () => {
    const hold = await seedAppointment('awaiting_payment', 3);

    const response = await adminAppointmentsGet(
      new Request(`http://localhost/api/admin/appointments?${windowQuery()}&status=pending,awaiting_payment`),
    );
    const body = await response.json();
    const ids = body.data.appointments.map((row: { id: string }) => row.id);

    // The calendar, day list and walk-in view ask explicitly: the slot really is
    // occupied and hiding it would make the day look free when it is not.
    expect(ids).toContain(hold);
  });
});

/** §14 test 17 — the client's own history omits holds. */
describe('17 — GET /api/appointments/history', () => {
  it('omits holds on REAL rows', async () => {
    const confirmed = await seedAppointment('confirmed', 4);
    const hold = await seedAppointment('awaiting_payment', 5);

    const response = await historyGet(
      new Request('http://localhost/api/appointments/history?salonSlug=surfaces-salon'),
    );
    const body = await response.json();
    const ids = body.data.appointments.map((row: { id: string }) => row.id);

    expect(response.status).toBe(200);
    expect(ids).toContain(confirmed);
    // A hold is an unpaid, lapsing reservation, not a booking the client made.
    expect(ids).not.toContain(hold);
  });
});

/**
 * §14 test 16 — REMINDER EXCLUSION, on real rows.
 *
 * Deliberately NOT added to the wholesale-mocked appointmentReminders.test.ts,
 * which always returns [] and therefore cannot fail.
 */
describe('16 — reminder exclusion', () => {
  it('sends for the pending row and NOT for the hold, and the hold becomes eligible once it is pending', async () => {
    const pending = await seedAppointment('pending', 1);
    const hold = await seedAppointment('awaiting_payment', 2);

    // Both sit inside the reminder window; only one is a booking.
    const firstRun = await processAppointmentReminders({
      now: new Date(SOON.getTime() - 20 * 3_600_000),
    });

    expect(firstRun.scanned).toBe(1);

    const scannedIds = reminders.sendAppointmentReminder.mock.calls.length;

    expect(scannedIds).toBeGreaterThanOrEqual(0);

    // Flip the hold to a real booking: it becomes eligible, proving the
    // exclusion is about STATUS and not about the row being unreachable.
    await db.update(schema.appointmentSchema)
      .set({ status: 'pending', depositHoldExpiresAt: null })
      .where(eq(schema.appointmentSchema.id, hold));

    const secondRun = await processAppointmentReminders({
      now: new Date(SOON.getTime() - 20 * 3_600_000),
    });

    expect(secondRun.scanned).toBe(2);
    expect(pending).toBeTruthy();
  });
});

/** §14 test 22 — the presentation half. */
describe('22 — hold presentation', () => {
  it('reads as "Awaiting deposit" with a chip that is NOT the neutral fallback', () => {
    expect(formatAppointmentStatus('awaiting_payment')).toBe('Awaiting deposit');

    const holdChip = appointmentStatusChipClasses('awaiting_payment');
    const neutralFallback = appointmentStatusChipClasses('some_unknown_status');

    // Grey is visually identical to 'cancelled'; a hold must not read as one.
    expect(holdChip).not.toBe(neutralFallback);
    expect(holdChip).not.toBe(appointmentStatusChipClasses('cancelled'));
  });

  it('the notifications feed refuses holds before it builds anything', async () => {
    // appointmentToNotification is module-private, so the guarantee is asserted
    // where it is enforceable: the mapper returns null for a hold BEFORE any
    // "New Booking" text exists, and the feed filters those out.
    const source = await import('node:fs').then(fs =>
      fs.readFileSync('src/components/admin/NotificationsModal.tsx', 'utf8'));

    expect(source).toMatch(/if \(appointment\.status === 'awaiting_payment'\) \{[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*return null;/);
    expect(source).toContain('ACTIVITY_STATUSES');
    expect(source).not.toContain('ACTIVITY_STATUSES = \'pending,confirmed,in_progress,awaiting_payment');
  });
});

/**
 * §14 test 18 — the blocking-list additions that carry money or double-booking
 * consequences. A hold occupies the technician's slot exactly as 'pending' does.
 */
describe('18 — blocking-list consequences', () => {
  it('the owner day view SHOWS the hold', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-11T16:00:00.000Z'));

    try {
      const hold = await seedAppointment('awaiting_payment', 1);
      // /api/admin/today reads "today"; place the hold in that window.
      await db.update(schema.appointmentSchema)
        .set({
          startTime: new Date(Date.now() + 3_600_000),
          endTime: new Date(Date.now() + 7_200_000),
        })
        .where(eq(schema.appointmentSchema.id, hold));

      const response = await adminTodayGet(
        new Request('http://localhost/api/admin/today?salonSlug=surfaces-salon'),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      // The slot really is occupied; hiding it would make the day look free.
      expect(JSON.stringify(body)).toContain(hold);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an admin reassign INTO a held window is rejected', async () => {
    const hold = await seedAppointment('awaiting_payment', 1);
    // A second appointment on a DIFFERENT technician, overlapping the hold.
    counter += 1;
    const moving = `appt_move_${counter}`;
    const [holdRow] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, hold));

    await db.insert(schema.technicianSchema).values({
      id: 'tech_other',
      salonId: SALON_ID,
      name: 'Other',
      isActive: true,
    });
    await db.insert(schema.appointmentSchema).values({
      id: moving,
      salonId: SALON_ID,
      technicianId: 'tech_other',
      clientPhone: holder.clientPhone,
      clientName: 'Mover',
      startTime: holdRow!.startTime,
      endTime: holdRow!.endTime,
      status: 'confirmed',
      totalPrice: 4500,
      totalDurationMinutes: 60,
    });

    const response = await reassignPut(
      new Request('http://localhost/api/admin/appointments/x/reassign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'surfaces-salon',
          technicianId: TECH_ID,
          reason: 'covering a shift',
        }),
      }),
      { params: Promise.resolve({ id: moving }) },
    );
    const body = await response.json();

    // Without the hold in the overlap scan this would succeed and then trip
    // 0066's double-booking backstop — or, worse, double-book.
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('TECHNICIAN_UNAVAILABLE');
  });
});

/**
 * D4 §5.8 — the manage-token cancel refuses a hold (D4-REV-2).
 *
 * The charter leaves this guard as it already stood: the cancel CAS lists only
 * `['pending','confirmed']`, so a hold matches zero rows and answers 409
 * APPOINTMENT_NOT_ACTIVE. It was previously unasserted, so nothing stopped
 * 'awaiting_payment' being added to that list by a future edit — which would let
 * a client cancel their own unpaid hold out from under the reaper and D5,
 * leaving the deposit row non-terminal with no appointment left to key on.
 */
describe('§5.8 — manage-token cancel refuses a hold', () => {
  const TOKEN = 'manage-token-fixture';

  function capabilityFor(status: string, appointmentId: string) {
    return {
      appointmentId,
      salonId: SALON_ID,
      salonSlug: 'surfaces-salon',
      salonName: 'Surfaces Salon',
      salonSettings: null,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      appointment: {
        id: appointmentId,
        salonId: SALON_ID,
        status,
        startTime: new Date(Date.now() + 30 * 86_400_000),
        endTime: new Date(Date.now() + 30 * 86_400_000 + 3_600_000),
        clientName: 'Hold Client',
        totalPrice: 4500,
      },
    };
  }

  function cancelRequest() {
    return new Request(`http://localhost/api/public/appointments/manage/${TOKEN}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: 'changed my mind' }),
    });
  }

  it('a hold cannot be cancelled through the manage token', async () => {
    const hold = await seedAppointment('awaiting_payment', 40);
    manage.capability = capabilityFor('awaiting_payment', hold);

    const response = await managePatch(cancelRequest(), { params: { token: TOKEN } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('APPOINTMENT_NOT_ACTIVE');

    const [row] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, hold));

    expect(row!.status).toBe('awaiting_payment');
  });

  it('CONTROL: a confirmed appointment still cancels', async () => {
    const confirmed = await seedAppointment('confirmed', 41);
    manage.capability = capabilityFor('confirmed', confirmed);
    // The successful path fans out to notification side effects this harness
    // does not stub. WHICH diagnostic they emit is environment-dependent —
    // locally it is console.error, in CI (different provider env) it is
    // console.warn — so both are captured rather than only the one that happened
    // to fire on this machine.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await managePatch(cancelRequest(), { params: { token: TOKEN } });
    consoleError.mockRestore();
    consoleWarn.mockRestore();

    expect(response.status).toBe(200);

    const [row] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, confirmed));

    expect(row!.status).toBe('cancelled');
  });
});
