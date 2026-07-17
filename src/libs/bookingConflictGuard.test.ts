import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  isSlotConstraintViolation,
  lockTechnicianAndAssertSlotFree,
  SlotConflictError,
} from './bookingConflictGuard';

vi.mock('server-only', () => ({}));

// A dedicated in-memory PGlite instance (never the app's DB.ts singleton, so
// this suite can never touch a real DATABASE_URL regardless of environment).
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const SALON_ID = 'salon_guard_test';
const TECH_ID = 'tech_guard_test';

function appointmentRow(args: {
  id: string;
  start: string;
  end: string;
  status?: string;
  blockedDurationMinutes?: number | null;
}) {
  return {
    id: args.id,
    salonId: SALON_ID,
    technicianId: TECH_ID,
    clientPhone: '4165550000',
    startTime: new Date(args.start),
    endTime: new Date(args.end),
    status: args.status ?? 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 60,
    blockedDurationMinutes: args.blockedDurationMinutes ?? null,
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Guard Test Salon',
    slug: 'guard-test-salon',
  });
  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Guard Tech',
  });
});

describe('0054 double-booking constraints', () => {
  it('creates the active-slot unique index via migrations', async () => {
    const result = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'appointment' AND indexname = 'appointment_tech_active_slot_unique'`,
    );

    expect(result.rows).toHaveLength(1);
  });

  it('rejects a second active appointment at the same technician and start time', async () => {
    await db.insert(schema.appointmentSchema).values(
      appointmentRow({ id: 'appt_dup_1', start: '2099-05-01T14:00:00Z', end: '2099-05-01T15:00:00Z' }),
    );

    let caught: unknown;
    try {
      await db.insert(schema.appointmentSchema).values(
        appointmentRow({ id: 'appt_dup_2', start: '2099-05-01T14:00:00Z', end: '2099-05-01T15:30:00Z' }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeTruthy();
    expect(isSlotConstraintViolation(caught)).toBe(true);
  });

  it('allows rebooking a slot after the blocking appointment is cancelled', async () => {
    await db
      .update(schema.appointmentSchema)
      .set({ status: 'cancelled', cancelReason: 'client_request' })
      .where(eq(schema.appointmentSchema.id, 'appt_dup_1'));

    await expect(
      db.insert(schema.appointmentSchema).values(
        appointmentRow({ id: 'appt_dup_3', start: '2099-05-01T14:00:00Z', end: '2099-05-01T15:00:00Z' }),
      ),
    ).resolves.not.toThrow();

    // Clean up for later tests.
    await db
      .update(schema.appointmentSchema)
      .set({ status: 'cancelled', cancelReason: 'client_request' })
      .where(eq(schema.appointmentSchema.id, 'appt_dup_3'));
  });
});

describe('lockTechnicianAndAssertSlotFree', () => {
  it('throws SlotConflictError when the requested window overlaps a buffered appointment', async () => {
    // Occupies 10:00–11:00 visible, blocked through 11:15 (75 blocked minutes).
    await db.insert(schema.appointmentSchema).values(
      appointmentRow({
        id: 'appt_buffered',
        start: '2099-06-01T10:00:00Z',
        end: '2099-06-01T11:00:00Z',
        blockedDurationMinutes: 75,
      }),
    );

    // 11:00–11:30 starts inside the buffer window → conflict.
    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-06-01T11:00:00Z'),
          blockedEndTime: new Date('2099-06-01T11:30:00Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(SlotConflictError);

    // 11:15–12:00 clears the buffer → allowed.
    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-06-01T11:15:00Z'),
          blockedEndTime: new Date('2099-06-01T12:00:00Z'),
        }),
      ),
    ).resolves.toBeUndefined();

    // Same window, but excluded as the appointment being rescheduled → allowed.
    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-06-01T10:30:00Z'),
          blockedEndTime: new Date('2099-06-01T11:30:00Z'),
          excludedAppointmentId: 'appt_buffered',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('ignores cancelled, no-show and soft-deleted appointments', async () => {
    await db.insert(schema.appointmentSchema).values(
      appointmentRow({
        id: 'appt_inactive',
        start: '2099-07-01T10:00:00Z',
        end: '2099-07-01T11:00:00Z',
        status: 'no_show',
      }),
    );

    await expect(
      db.transaction(tx =>
        lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-07-01T10:00:00Z'),
          blockedEndTime: new Date('2099-07-01T11:00:00Z'),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('lets exactly one of two concurrent bookings for the same slot succeed', async () => {
    // On multi-connection Postgres the advisory lock serializes the two
    // transactions; on single-connection PGlite the driver serializes them.
    // Either way the loser must observe the winner's committed row and fail.
    const bookSlot = (id: string) =>
      db.transaction(async (tx) => {
        await lockTechnicianAndAssertSlotFree(tx, {
          salonId: SALON_ID,
          technicianId: TECH_ID,
          startTime: new Date('2099-08-01T09:00:00Z'),
          blockedEndTime: new Date('2099-08-01T10:15:00Z'),
        });
        await tx.insert(schema.appointmentSchema).values(
          appointmentRow({
            id,
            start: '2099-08-01T09:00:00Z',
            end: '2099-08-01T10:00:00Z',
            blockedDurationMinutes: 75,
          }),
        );
      });

    const results = await Promise.allSettled([bookSlot('appt_race_a'), bookSlot('appt_race_b')]);

    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const loserError = rejected[0]?.reason;

    expect(
      loserError instanceof SlotConflictError || isSlotConstraintViolation(loserError),
    ).toBe(true);

    const stored = await db
      .select({ id: schema.appointmentSchema.id })
      .from(schema.appointmentSchema)
      .where(sql`${schema.appointmentSchema.id} IN ('appt_race_a', 'appt_race_b')`);

    expect(stored).toHaveLength(1);
  });
});
