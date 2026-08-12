/**
 * BUILD F — the function-level hold fence on `updateAppointmentStatus`.
 *
 * `updateAppointmentStatus` takes no transaction, no lock and no expected
 * current status: whatever it is handed wins. D4 fenced the ONE route that
 * calls it, which protects today's callers and nobody else's. This fence is on
 * the function, so a future caller inherits it without having to know that
 * 'awaiting_payment' is money.
 *
 * The property under test: a deposit hold cannot be moved by this function, in
 * EITHER direction, while every other status still moves exactly as before.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import { updateAppointmentStatus } from '@/libs/queries';
/* eslint-enable import/first */

const SALON_ID = 'salon_fence';
const TECH_ID = 'tech_fence';
const OTHER_SALON_ID = 'salon_fence_other';

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let counter = 0;

async function seedAppointment(status: string, salonId = SALON_ID) {
  counter += 1;
  const id = `appt_fence_${counter}`;
  const startTime = new Date(Date.now() + counter * 3_600_000 + 86_400_000);
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId,
    technicianId: TECH_ID,
    clientPhone: '4165550000',
    clientName: 'Fence Client',
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

async function readStatus(id: string) {
  const [row] = await db
    .select({ status: schema.appointmentSchema.status, cancelReason: schema.appointmentSchema.cancelReason })
    .from(schema.appointmentSchema)
    .where(eq(schema.appointmentSchema.id, id));
  return row;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  for (const [id, slug] of [[SALON_ID, 'fence-salon'], [OTHER_SALON_ID, 'fence-salon-other']]) {
    await db.insert(schema.salonSchema).values({
      id: id!,
      name: 'Fence Salon',
      slug: slug!,
      ownerEmail: `${slug}@example.com`,
    });
  }

  await db.insert(schema.technicianSchema).values({
    id: TECH_ID,
    salonId: SALON_ID,
    name: 'Fence Tech',
  });
}, 60_000);

beforeEach(async () => {
  await db.delete(schema.appointmentSchema);
});

afterAll(async () => {
  await client.close();
});

describe('updateAppointmentStatus — deposit hold fence (BUILD F)', () => {
  it('REFUSES to confirm a hold, and reports the refusal as null', async () => {
    const id = await seedAppointment('awaiting_payment');

    const result = await updateAppointmentStatus(id, SALON_ID, 'confirmed');

    // Null is the caller's existing not-found/conflict branch, so no caller has
    // to learn a new failure shape to be safe.
    expect(result).toBeNull();
    expect((await readStatus(id))?.status).toBe('awaiting_payment');
  });

  it('REFUSES to cancel a hold', async () => {
    // The reaper's release is a status-guarded CAS inside a transaction that
    // also terminalises the deposit row. Letting this blind writer cancel a
    // hold would strand a non-terminal deposit behind a cancelled appointment.
    const id = await seedAppointment('awaiting_payment');

    const result = await updateAppointmentStatus(id, SALON_ID, 'cancelled', 'deposit_not_paid');

    expect(result).toBeNull();
    expect((await readStatus(id))?.status).toBe('awaiting_payment');
  });

  it('REFUSES to move a hold to pending, completed or no_show', async () => {
    for (const target of ['pending', 'completed', 'no_show'] as const) {
      const id = await seedAppointment('awaiting_payment');
      const result = await updateAppointmentStatus(id, SALON_ID, target);

      expect(result).toBeNull();
      expect((await readStatus(id))?.status).toBe('awaiting_payment');
    }
  });

  it('still moves every NON-hold status exactly as before', async () => {
    // The fence must not become a general-purpose refusal: this function is the
    // ordinary status writer for the rest of the application.
    for (const [from, to] of [
      ['pending', 'confirmed'],
      ['confirmed', 'in_progress'],
      ['in_progress', 'completed'],
      ['confirmed', 'no_show'],
    ] as const) {
      const id = await seedAppointment(from);
      const result = await updateAppointmentStatus(id, SALON_ID, to);

      expect(result?.status).toBe(to);
      expect((await readStatus(id))?.status).toBe(to);
    }
  });

  it('still writes the cancel reason on an ordinary cancel', async () => {
    const id = await seedAppointment('confirmed');

    const result = await updateAppointmentStatus(id, SALON_ID, 'cancelled', 'client_request');

    expect(result?.status).toBe('cancelled');
    expect((await readStatus(id))?.cancelReason).toBe('client_request');
  });

  it('keeps the pre-existing tenant scope', async () => {
    // Regression guard: adding a conjunct to a WHERE is exactly the edit that
    // can drop one by accident.
    const id = await seedAppointment('confirmed');

    const result = await updateAppointmentStatus(id, OTHER_SALON_ID, 'completed');

    expect(result).toBeNull();
    expect((await readStatus(id))?.status).toBe('confirmed');
  });
});
