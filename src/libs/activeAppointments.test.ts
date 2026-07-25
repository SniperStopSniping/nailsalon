import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  buildClientPhoneVariants,
  getActiveAppointmentsForCanonicalClientWithHandle,
  getActiveAppointmentsForContact,
} from './activeAppointments';

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
  salonClientId?: string | null;
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
    salonClientId: args.salonClientId ?? null,
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
  await db.insert(schema.salonClientSchema).values([
    {
      id: 'active-terminal',
      salonId: SALON_A,
      phone: '4165550300',
      email: 'current@example.com',
    },
    {
      id: 'active-source',
      salonId: SALON_A,
      phone: '4165550200',
      email: 'historical@example.com',
    },
    {
      id: 'active-other',
      salonId: SALON_A,
      phone: '4165550400',
      email: 'other@example.com',
    },
  ]);
  await db.execute(sql.raw(
    'ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
  ));
  try {
    await db.update(schema.salonClientSchema).set({
      archivedAt: new Date('2099-01-01T00:00:00Z'),
      archivedBy: 'active-test',
      mergedIntoClientId: 'active-terminal',
      mergedAt: new Date('2099-01-01T00:00:00Z'),
      mergedBy: 'active-test',
    }).where(sql`${schema.salonClientSchema.id} = 'active-source'`);
  } finally {
    await db.execute(sql.raw(
      'ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
    ));
  }
  await db.insert(schema.salonClientContactAliasSchema).values([
    {
      salonId: SALON_A,
      salonClientId: 'active-source',
      kind: 'phone',
      normalizedValue: '4165550500',
    },
    {
      salonId: SALON_A,
      salonClientId: 'active-source',
      kind: 'email',
      normalizedValue: 'lineage-alias@example.com',
    },
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

describe('getActiveAppointmentsForCanonicalClientWithHandle', () => {
  it('uses stable lineage ownership first and fallback only for null stable IDs', async () => {
    const stableSource = await insertAppointment({
      salonClientId: 'active-source',
      phone: '4165559999',
      email: 'wrong-snapshot@example.com',
      start: '2099-08-01T14:00:00Z',
      end: '2099-08-01T15:00:00Z',
    });
    const legacyAlias = await insertAppointment({
      salonClientId: null,
      phone: '+1 (416) 555-0500',
      email: null,
      start: '2099-08-02T14:00:00Z',
      end: '2099-08-02T15:00:00Z',
    });
    await insertAppointment({
      salonClientId: 'active-other',
      phone: '4165550500',
      email: 'lineage-alias@example.com',
      start: '2099-08-03T14:00:00Z',
      end: '2099-08-03T15:00:00Z',
    });

    const found = await getActiveAppointmentsForCanonicalClientWithHandle(
      db,
      {
        salonId: SALON_A,
        terminalClientId: 'active-terminal',
        horizon: 'booking-gate',
        now: NOW,
      },
    );

    expect(found.map(row => row.id)).toEqual([stableSource, legacyAlias]);
  });

  it('supports email aliases for null-ID legacy rows without reassigning stable rows', async () => {
    const legacyAlias = await insertAppointment({
      salonClientId: null,
      phone: '4165550999',
      email: 'LINEAGE-ALIAS@example.com',
      start: '2099-08-04T14:00:00Z',
      end: '2099-08-04T15:00:00Z',
    });
    await insertAppointment({
      salonClientId: 'active-other',
      phone: '4165550998',
      email: 'lineage-alias@example.com',
      start: '2099-08-05T14:00:00Z',
      end: '2099-08-05T15:00:00Z',
    });

    const found = await getActiveAppointmentsForCanonicalClientWithHandle(
      db,
      {
        salonId: SALON_A,
        terminalClientId: 'active-terminal',
        horizon: 'booking-gate',
        now: new Date('2099-08-03T00:00:00Z'),
      },
    );

    expect(found.map(row => row.id)).toContain(legacyAlias);
    expect(found.some(row => row.salonClientId === 'active-other')).toBe(false);
  });

  it('can exclude the affected appointment during an authoritative transition', async () => {
    const appointmentId = await insertAppointment({
      salonClientId: 'active-terminal',
      start: '2099-08-06T14:00:00Z',
      end: '2099-08-06T15:00:00Z',
    });

    const found = await getActiveAppointmentsForCanonicalClientWithHandle(
      db,
      {
        salonId: SALON_A,
        terminalClientId: 'active-terminal',
        horizon: 'booking-gate',
        now: new Date('2099-08-06T00:00:00Z'),
        excludeAppointmentId: appointmentId,
      },
    );

    expect(found.some(row => row.id === appointmentId)).toBe(false);
  });

  it('treats an already-started active row as lineage-active', async () => {
    const appointmentId = await insertAppointment({
      salonClientId: 'active-terminal',
      status: 'in_progress',
      start: '2099-06-30T14:00:00Z',
      end: '2099-06-30T15:00:00Z',
    });

    const found = await getActiveAppointmentsForCanonicalClientWithHandle(
      db,
      {
        salonId: SALON_A,
        terminalClientId: 'active-terminal',
        horizon: 'lineage-active',
        now: NOW,
      },
    );

    expect(found.map(row => row.id)).toContain(appointmentId);
  });
});
