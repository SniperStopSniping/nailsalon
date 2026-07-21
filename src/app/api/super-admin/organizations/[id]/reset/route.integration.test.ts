/**
 * Data reset endpoint (real PGlite, real migrations).
 *
 * The reset route carried a copy of the same non-transactional block as the hard
 * delete, so it could destroy appointment line items and then fail on the
 * fraud_signal RESTRICT — the most likely origin of the production data loss.
 * These tests pin the transactional behaviour and the per-category scoping.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin: vi.fn(async () => null),
  getSuperAdminInfo: vi.fn(async () => ({ userId: 'sa_1', name: 'Root', email: 'root@example.test' })),
  logAuditAction: vi.fn(async () => {}),
}));

const { POST } = await import('./route');

const SALON = 'salon_reset';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const params = Promise.resolve({ id: SALON });

function resetRequest(body: unknown): Request {
  return new Request(`http://localhost/api/super-admin/organizations/${SALON}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function tally() {
  const [appointments, lineItems, fraud, technicians, services, clients, preferences, rewards] = await Promise.all([
    db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON)),
    db.select().from(schema.appointmentServicesSchema),
    db.select().from(schema.fraudSignalSchema).where(eq(schema.fraudSignalSchema.salonId, SALON)),
    db.select().from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, SALON)),
    db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, SALON)),
    db.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.salonId, SALON)),
    db.select().from(schema.clientPreferencesSchema).where(eq(schema.clientPreferencesSchema.salonId, SALON)),
    db.select().from(schema.rewardSchema).where(eq(schema.rewardSchema.salonId, SALON)),
  ]);

  return {
    appointments: appointments.length,
    lineItems: lineItems.length,
    fraud: fraud.length,
    technicians: technicians.length,
    services: services.length,
    clients: clients.length,
    preferences: preferences.length,
    rewards: rewards.length,
  };
}

beforeEach(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const start = new Date(Date.UTC(2026, 6, 20, 15, 0, 0));

  await db.insert(schema.salonSchema).values({ id: SALON, name: 'Reset Salon', slug: 'reset-salon' });
  await db.insert(schema.serviceSchema).values({
    id: 'svc_1',
    salonId: SALON,
    name: 'Gel Manicure',
    price: 60,
    durationMinutes: 60,
    category: 'manicure',
  });
  await db.insert(schema.technicianSchema).values({ id: 'tech_1', salonId: SALON, name: 'Tech' });
  await db.insert(schema.technicianServicesSchema).values({ technicianId: 'tech_1', serviceId: 'svc_1' });
  await db.insert(schema.salonClientSchema).values({
    id: 'sc_1',
    salonId: SALON,
    phone: '4165550100',
    preferredTechnicianId: 'tech_1',
  });
  await db.insert(schema.clientPreferencesSchema).values({
    id: 'pref_1',
    salonId: SALON,
    normalizedClientPhone: '4165550100',
    favoriteTechId: 'tech_1',
  });
  await db.insert(schema.appointmentSchema).values({
    id: 'appt_1',
    salonId: SALON,
    clientPhone: '4165550100',
    salonClientId: 'sc_1',
    technicianId: 'tech_1',
    startTime: start,
    endTime: new Date(start.getTime() + 3_600_000),
    totalPrice: 60,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: 'as_1',
    appointmentId: 'appt_1',
    serviceId: 'svc_1',
    priceAtBooking: 60,
    durationAtBooking: 60,
  });
  await db.insert(schema.fraudSignalSchema).values({
    id: 'fs_1',
    salonId: SALON,
    salonClientId: 'sc_1',
    appointmentId: 'appt_1',
    type: 'HIGH_APPOINTMENT_FREQUENCY',
    reason: 'seeded',
  });
  await db.insert(schema.referralSchema).values({ id: 'ref_1', salonId: SALON, referrerPhone: '4165550100' });
  await db.insert(schema.rewardSchema).values({
    id: 'rw_1',
    salonId: SALON,
    clientPhone: '4165550100',
    type: 'referral',
    referralId: 'ref_1',
    usedInAppointmentId: 'appt_1',
  });
});

describe('POST reset', () => {
  it('clears appointments and their line items together, past the fraud_signal blocker', async () => {
    const response = await POST(resetRequest({ appointments: true }), { params });

    expect(response.status).toBe(200);

    // The old handler deleted the line items, then threw on fraud_signal,
    // leaving appointments with no services. Both must go, or neither.
    expect(await tally()).toMatchObject({ appointments: 0, lineItems: 0, fraud: 0 });
  });

  it('leaves staff, services and client records alone when only appointments are reset', async () => {
    await POST(resetRequest({ appointments: true }), { params });

    expect(await tally()).toMatchObject({ technicians: 1, services: 1, clients: 1 });
  });

  it('clears staff without orphaning the appointments that referenced them', async () => {
    const response = await POST(resetRequest({ staff: true }), { params });

    expect(response.status).toBe(200);

    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, 'appt_1'));

    expect(await tally()).toMatchObject({ technicians: 0, appointments: 1 });
    expect(appointment?.technicianId).toBeNull();
  });

  it('treats "clients" as preferences only and never deletes client records', async () => {
    const response = await POST(resetRequest({ clients: true }), { params });

    expect(response.status).toBe(200);
    // salon_client holds loyalty points and lifetime spend — a reset must not
    // destroy it. Only a full salon purge does.
    expect(await tally()).toMatchObject({ preferences: 0, clients: 1 });
  });

  it('clears rewards and referrals together', async () => {
    await POST(resetRequest({ rewards: true }), { params });

    const referrals = await db.select().from(schema.referralSchema).where(eq(schema.referralSchema.salonId, SALON));

    expect(await tally()).toMatchObject({ rewards: 0 });
    expect(referrals).toHaveLength(0);
  });

  it('clears every category with all: true while keeping the salon itself', async () => {
    const response = await POST(resetRequest({ all: true }), { params });

    expect(response.status).toBe(200);
    expect(await tally()).toMatchObject({
      appointments: 0,
      lineItems: 0,
      fraud: 0,
      technicians: 0,
      preferences: 0,
      rewards: 0,
    });

    const salons = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    expect(salons).toHaveLength(1);
  });

  it('rejects a request that selects nothing, rather than silently doing nothing', async () => {
    const before = await tally();

    const response = await POST(resetRequest({}), { params });

    expect(response.status).toBe(400);
    expect(await tally()).toEqual(before);
  });
});
