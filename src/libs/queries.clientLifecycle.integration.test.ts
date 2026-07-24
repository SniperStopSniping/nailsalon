import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  getOrCreateSalonClient,
  getSalonClientById,
  getSalonClientByPhone,
  getSalonClients,
  resolveSalonClientIdentityByPhone,
  updateSalonClientStats,
  upsertSalonClient,
} from './queries';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const SALON_ID = 'salon_identity';
const OTHER_SALON_ID = 'salon_identity_other';
const PRIMARY_PHONE = '6475550199';
const OLD_PHONE = '4165550100';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function appointment(
  id: string,
  values: Partial<typeof schema.appointmentSchema.$inferInsert>,
): typeof schema.appointmentSchema.$inferInsert {
  const day = id.slice(-1).padStart(2, '0');
  const startTime = new Date(`2026-07-${day}T15:00:00.000Z`);
  return {
    id,
    salonId: SALON_ID,
    clientPhone: PRIMARY_PHONE,
    startTime,
    endTime: new Date(startTime.getTime() + 3_600_000),
    totalDurationMinutes: 60,
    totalPrice: 1000,
    ...values,
  };
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Identity Salon',
      slug: 'identity-salon',
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Identity Salon',
      slug: 'identity-salon-other',
    },
  ]);
  await db.insert(schema.clientSchema).values([
    {
      id: 'global_primary',
      phone: '+16475550199',
    },
    {
      id: 'global_source',
      phone: '+14165550100',
    },
  ]);
  await db.insert(schema.salonClientSchema).values([
    {
      id: 'client_primary',
      salonId: SALON_ID,
      clientId: 'global_primary',
      phone: PRIMARY_PHONE,
      fullName: 'Primary Client',
      totalVisits: 999,
      totalSpent: 0,
      loyaltyPoints: 0,
    },
    {
      id: 'client_source',
      salonId: SALON_ID,
      clientId: 'global_source',
      phone: OLD_PHONE,
      fullName: 'Merged Source',
      archivedAt: new Date('2026-07-01T00:00:00.000Z'),
      mergedIntoClientId: 'client_primary',
      mergedAt: new Date('2026-07-01T00:00:00.000Z'),
      totalVisits: 777,
      totalSpent: 777_777,
      loyaltyPoints: 777,
    },
    {
      id: 'client_other_salon',
      salonId: OTHER_SALON_ID,
      phone: OLD_PHONE,
      fullName: 'Other Salon Client',
    },
  ]);
  await db.insert(schema.salonClientContactAliasSchema).values({
    salonId: SALON_ID,
    salonClientId: 'client_primary',
    kind: 'phone',
    normalizedValue: OLD_PHONE,
  });
  await db.insert(schema.appointmentSchema).values([
    appointment('appt_identity_1', {
      salonClientId: 'client_primary',
      status: 'completed',
      paymentStatus: 'paid',
      totalPrice: 4000,
      finalPriceCents: 4000,
    }),
    appointment('appt_identity_2', {
      salonClientId: 'client_source',
      clientPhone: OLD_PHONE,
      status: 'completed',
      paymentStatus: 'paid',
      totalPrice: 3000,
      finalPriceCents: 3000,
    }),
    appointment('appt_identity_3', {
      salonClientId: null,
      clientPhone: `+1${OLD_PHONE}`,
      status: 'completed',
      paymentStatus: 'paid',
      totalPrice: 2000,
      finalPriceCents: 2000,
    }),
    {
      ...appointment('appt_identity_4', {
        salonClientId: 'client_other_salon',
        clientPhone: OLD_PHONE,
        status: 'completed',
        paymentStatus: 'paid',
        totalPrice: 99_999,
        finalPriceCents: 99_999,
      }),
      salonId: OTHER_SALON_ID,
    },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('merged salon-client operational identity', () => {
  it('resolves old phones to the same-salon primary without creating another active profile', async () => {
    const identity = await resolveSalonClientIdentityByPhone(
      SALON_ID,
      `+1${OLD_PHONE}`,
    );

    expect(identity?.client.id).toBe('client_primary');
    expect(identity?.clientIds).toEqual([
      'client_primary',
      'client_source',
    ]);
    expect(identity?.normalizedPhones).toEqual([
      OLD_PHONE,
      PRIMARY_PHONE,
    ]);

    const resolvedByPhone = await getSalonClientByPhone(SALON_ID, OLD_PHONE);
    const resolvedBySourceId = await getSalonClientById(
      SALON_ID,
      'client_source',
    );

    expect(resolvedByPhone?.id).toBe('client_primary');
    expect(resolvedBySourceId?.id).toBe('client_primary');

    const createdOrFound = await getOrCreateSalonClient(
      SALON_ID,
      OLD_PHONE,
      'Updated Through Old Phone',
    );

    expect(createdOrFound?.id).toBe('client_primary');

    const salonClients = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.salonId, SALON_ID));

    expect(salonClients).toHaveLength(2);
    expect(
      salonClients.filter(row => row.mergedIntoClientId === null),
    ).toHaveLength(1);
    expect(
      salonClients.find(row => row.id === 'client_source')?.fullName,
    ).toBe('Merged Source');
    expect(
      salonClients.find(row => row.id === 'client_primary')?.fullName,
    ).toBe('Primary Client');
  });

  it('does not transfer a merged source external identity to the primary', async () => {
    const resolved = await upsertSalonClient(
      SALON_ID,
      OLD_PHONE,
      'External Source Name',
      'external-source@example.com',
      'global_source',
    );

    expect(resolved.id).toBe('client_primary');

    const [primary] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_primary'));
    const [source] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_source'));

    expect(primary?.clientId).toBe('global_primary');
    expect(primary?.phone).toBe(PRIMARY_PHONE);
    expect(source?.clientId).toBe('global_source');
    expect(source?.phone).toBe(OLD_PHONE);
  });

  it('finds the active primary by a formatted historical phone alias', async () => {
    const result = await getSalonClients(SALON_ID, {
      search: '(416) 555-0100',
      scope: 'active',
    });

    expect(result.total).toBe(1);
    expect(result.clients.map(row => row.id)).toEqual(['client_primary']);
    expect(result.clients[0]?.salonId).toBe(SALON_ID);
  });

  it('recomputes only the primary cache from stable IDs and legacy alias snapshots', async () => {
    await updateSalonClientStats(SALON_ID, OLD_PHONE);

    const [primary] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_primary'));
    const [source] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_source'));

    expect(primary?.totalVisits).toBe(3);
    expect(primary?.totalSpent).toBe(9000);
    expect(primary?.loyaltyPoints).toBe(1800);
    expect(source?.totalVisits).toBe(777);
    expect(source?.totalSpent).toBe(777_777);
    expect(source?.loyaltyPoints).toBe(777);
  });
});
