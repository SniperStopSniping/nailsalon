import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { buildClientPhoneVariants, getActiveAppointmentsForContact } from './activeAppointments';

vi.mock('server-only', () => ({}));

// A dedicated in-memory PGlite instance (never the app's DB.ts singleton, so
// this suite can never touch a real DATABASE_URL regardless of environment).
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('./DB', () => ({
  get db() {
    return db;
  },
}));

const SALON_A = 'salon_active_a';
const SALON_B = 'salon_active_b';
const NOW = new Date('2099-07-01T12:00:00Z');

let appointmentSeq = 0;

async function insertAppointment(args: {
  salonId?: string;
  phone?: string;
  email?: string | null;
  start: string;
  end: string;
  status?: string;
  deletedAt?: Date | null;
}) {
  appointmentSeq += 1;
  const id = `appt_active_${appointmentSeq}`;
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: args.salonId ?? SALON_A,
    technicianId: null,
    clientPhone: args.phone ?? '4165550100',
    clientEmail: args.email ?? null,
    startTime: new Date(args.start),
    endTime: new Date(args.end),
    status: args.status ?? 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 60,
    deletedAt: args.deletedAt ?? null,
  });
  return id;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

  await db.insert(schema.salonSchema).values([
    { id: SALON_A, name: 'Active Salon A', slug: 'active-salon-a' },
    { id: SALON_B, name: 'Active Salon B', slug: 'active-salon-b' },
  ]);
});

describe('buildClientPhoneVariants', () => {
  it('covers raw, digits-only, 10-digit, and prefixed formats', () => {
    expect(buildClientPhoneVariants('(416) 555-1234')).toEqual(
      expect.arrayContaining(['(416) 555-1234', '4165551234', '+14165551234']),
    );
    expect(buildClientPhoneVariants('+1 416 555 1234')).toEqual(
      expect.arrayContaining(['4165551234', '+14165551234', '14165551234']),
    );
  });
});

describe('getActiveAppointmentsForContact', () => {
  it('throws when neither phone nor email is provided', async () => {
    await expect(
      getActiveAppointmentsForContact({ salonId: SALON_A, horizon: 'recovery', now: NOW }),
    ).rejects.toThrow('ACTIVE_APPOINTMENT_LOOKUP_REQUIRES_CONTACT');
  });

  it('matches phone regardless of stored format', async () => {
    const id = await insertAppointment({
      phone: '+14165550101',
      start: '2099-07-02T14:00:00Z',
      end: '2099-07-02T15:00:00Z',
    });

    const found = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '(416) 555-0101',
      horizon: 'booking-gate',
      now: NOW,
    });

    expect(found.map(appt => appt.id)).toContain(id);
  });

  it('matches email case-insensitively with surrounding whitespace', async () => {
    const id = await insertAppointment({
      phone: '4165550102',
      email: 'Jane.Doe@Example.com',
      start: '2099-07-03T14:00:00Z',
      end: '2099-07-03T15:00:00Z',
    });

    const found = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      email: '  jane.doe@example.COM ',
      horizon: 'recovery',
      now: NOW,
    });

    expect(found.map(appt => appt.id)).toContain(id);
  });

  it('matches when either identity matches (OR semantics)', async () => {
    const id = await insertAppointment({
      phone: '4165550103',
      email: 'or.match@example.com',
      start: '2099-07-04T14:00:00Z',
      end: '2099-07-04T15:00:00Z',
    });

    const byEmailOnly = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '9999999999',
      email: 'or.match@example.com',
      horizon: 'recovery',
      now: NOW,
    });
    const byPhoneOnly = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '4165550103',
      email: 'nobody@example.com',
      horizon: 'recovery',
      now: NOW,
    });

    expect(byEmailOnly.map(appt => appt.id)).toContain(id);
    expect(byPhoneOnly.map(appt => appt.id)).toContain(id);
  });

  it('excludes cancelled, completed, no-show, and soft-deleted appointments', async () => {
    const phone = '4165550104';
    await insertAppointment({ phone, status: 'cancelled', start: '2099-07-05T10:00:00Z', end: '2099-07-05T11:00:00Z' });
    await insertAppointment({ phone, status: 'completed', start: '2099-07-05T12:00:00Z', end: '2099-07-05T13:00:00Z' });
    await insertAppointment({ phone, status: 'no_show', start: '2099-07-05T14:00:00Z', end: '2099-07-05T15:00:00Z' });
    await insertAppointment({ phone, status: 'confirmed', deletedAt: new Date('2099-06-01T00:00:00Z'), start: '2099-07-05T16:00:00Z', end: '2099-07-05T17:00:00Z' });

    const found = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone,
      horizon: 'recovery',
      now: NOW,
    });

    expect(found).toHaveLength(0);
  });

  it('includes in_progress appointments', async () => {
    const id = await insertAppointment({
      phone: '4165550105',
      status: 'in_progress',
      start: '2099-07-06T14:00:00Z',
      end: '2099-07-06T15:00:00Z',
    });

    const found = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '4165550105',
      horizon: 'recovery',
      now: NOW,
    });

    expect(found.map(appt => appt.id)).toContain(id);
  });

  it('applies horizon semantics to an appointment that already started', async () => {
    // Started an hour ago relative to NOW, ends in an hour.
    const id = await insertAppointment({
      phone: '4165550106',
      status: 'in_progress',
      start: '2099-07-01T11:00:00Z',
      end: '2099-07-01T13:00:00Z',
    });

    const gate = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '4165550106',
      horizon: 'booking-gate',
      now: NOW,
    });
    const recovery = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '4165550106',
      horizon: 'recovery',
      now: NOW,
    });

    expect(gate.map(appt => appt.id)).not.toContain(id);
    expect(recovery.map(appt => appt.id)).toContain(id);
  });

  it('excludes fully past appointments under both horizons', async () => {
    await insertAppointment({
      phone: '4165550107',
      start: '2099-06-30T10:00:00Z',
      end: '2099-06-30T11:00:00Z',
    });

    for (const horizon of ['booking-gate', 'recovery'] as const) {
      const found = await getActiveAppointmentsForContact({
        salonId: SALON_A,
        phone: '4165550107',
        horizon,
        now: NOW,
      });

      expect(found).toHaveLength(0);
    }
  });

  it('never returns another salon\'s appointments for the same contact', async () => {
    await insertAppointment({
      salonId: SALON_B,
      phone: '4165550108',
      email: 'tenant.isolation@example.com',
      start: '2099-07-07T14:00:00Z',
      end: '2099-07-07T15:00:00Z',
    });

    const found = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '4165550108',
      email: 'tenant.isolation@example.com',
      horizon: 'recovery',
      now: NOW,
    });

    expect(found).toHaveLength(0);
  });

  it('returns appointments ordered by start time', async () => {
    const later = await insertAppointment({
      phone: '4165550109',
      start: '2099-07-09T14:00:00Z',
      end: '2099-07-09T15:00:00Z',
    });
    const sooner = await insertAppointment({
      phone: '4165550109',
      start: '2099-07-08T14:00:00Z',
      end: '2099-07-08T15:00:00Z',
    });

    const found = await getActiveAppointmentsForContact({
      salonId: SALON_A,
      phone: '4165550109',
      horizon: 'recovery',
      now: NOW,
    });

    expect(found.map(appt => appt.id)).toEqual([sooner, later]);
  });
});
