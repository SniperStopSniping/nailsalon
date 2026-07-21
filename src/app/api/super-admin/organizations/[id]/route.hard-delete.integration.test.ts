/**
 * Hard-delete endpoint contract (real PGlite, real migrations).
 *
 * Companion to src/libs/salonPurge.integration.test.ts, which proves the delete
 * ORDER is correct. This file proves the ENDPOINT is safe: it cannot be reached
 * without a server-verified confirmation, it refuses to destroy a salon that is
 * still live, and a failure leaves nothing behind.
 *
 * The seed reproduces the shape that caused the original data loss: appointments
 * with service line items plus a fraud_signal row whose ON DELETE RESTRICT
 * foreign key blocked the delete half-way through.
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

const superAdmin = vi.hoisted(() => ({
  guard: null as Response | null,
}));

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin: vi.fn(async () => superAdmin.guard),
  getSuperAdminInfo: vi.fn(async () => ({ userId: 'sa_1', name: 'Root', email: 'root@example.test' })),
  logAuditAction: vi.fn(async () => {}),
}));

const { DELETE } = await import('./route');

const SALON = 'salon_endpoint';
const SLUG = 'endpoint-salon';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const params = Promise.resolve({ id: SALON });

function deleteRequest(options: { hard: boolean; body?: unknown }): Request {
  const url = `http://localhost/api/super-admin/organizations/${SALON}${options.hard ? '?hard=true' : ''}`;
  return new Request(url, {
    method: 'DELETE',
    ...(options.body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }),
  });
}

async function softDelete(): Promise<void> {
  await db
    .update(schema.salonSchema)
    .set({ deletedAt: new Date(), deletedBy: 'sa_1', status: 'cancelled' })
    .where(eq(schema.salonSchema.id, SALON));
}

async function counts(): Promise<{ salons: number; appointments: number; lineItems: number; fraud: number }> {
  const [salons, appointments, lineItems, fraud] = await Promise.all([
    db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON)),
    db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.salonId, SALON)),
    db.select().from(schema.appointmentServicesSchema),
    db.select().from(schema.fraudSignalSchema).where(eq(schema.fraudSignalSchema.salonId, SALON)),
  ]);

  return {
    salons: salons.length,
    appointments: appointments.length,
    lineItems: lineItems.length,
    fraud: fraud.length,
  };
}

beforeEach(async () => {
  superAdmin.guard = null;

  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const start = new Date(Date.UTC(2026, 6, 20, 15, 0, 0));

  await db.insert(schema.salonSchema).values({ id: SALON, name: 'Endpoint Salon', slug: SLUG });
  await db.insert(schema.serviceSchema).values({
    id: 'svc_1',
    salonId: SALON,
    name: 'Gel Manicure',
    price: 60,
    durationMinutes: 60,
    category: 'manicure',
  });
  await db.insert(schema.salonClientSchema).values({ id: 'sc_1', salonId: SALON, phone: '4165550100' });

  // Two appointments, each with a service line item — the rows the old handler
  // deleted before hitting the fraud_signal RESTRICT and failing.
  for (const n of [1, 2]) {
    await db.insert(schema.appointmentSchema).values({
      id: `appt_${n}`,
      salonId: SALON,
      clientPhone: '4165550100',
      salonClientId: 'sc_1',
      startTime: new Date(start.getTime() + n * 3_600_000),
      endTime: new Date(start.getTime() + (n + 1) * 3_600_000),
      totalPrice: 60,
      totalDurationMinutes: 60,
    });
    await db.insert(schema.appointmentServicesSchema).values({
      id: `as_${n}`,
      appointmentId: `appt_${n}`,
      serviceId: 'svc_1',
      priceAtBooking: 60,
      durationAtBooking: 60,
    });
  }

  await db.insert(schema.fraudSignalSchema).values({
    id: 'fs_1',
    salonId: SALON,
    salonClientId: 'sc_1',
    appointmentId: 'appt_1',
    type: 'HIGH_APPOINTMENT_FREQUENCY',
    reason: 'seeded',
  });
});

describe('DELETE ?hard=true', () => {
  it('refuses a salon that has not been archived, and touches nothing', async () => {
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Soft delete the salon first'),
    });
    expect(await counts()).toEqual(before);
  });

  it('refuses a request with no confirmation body', async () => {
    await softDelete();
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true }), { params });

    expect(response.status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('refuses a confirmation that does not match the slug', async () => {
    await softDelete();
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: 'not-the-slug' } }), { params });

    expect(response.status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it('refuses a caller who is not a super admin', async () => {
    await softDelete();
    superAdmin.guard = Response.json({ error: 'Forbidden' }, { status: 403 });
    const before = await counts();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(403);
    expect(await counts()).toEqual(before);
  });

  it('purges the salon completely once archived and confirmed', async () => {
    await softDelete();

    const response = await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, deletedId: SALON });

    // Including the fraud_signal row that made this impossible before.
    expect(await counts()).toEqual({ salons: 0, appointments: 0, lineItems: 0, fraud: 0 });
  });

  it('records the deletion in a platform audit row that outlives the salon', async () => {
    await softDelete();

    await DELETE(deleteRequest({ hard: true, body: { confirmSlug: SLUG } }), { params });

    const audits = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'salon_hard_deleted'));

    expect(audits).toHaveLength(1);
    // salonId must be null, otherwise the row would have been cascaded away with
    // the salon and the deletion would leave no trace anywhere.
    expect(audits[0]).toMatchObject({ salonId: null, entityType: 'salon', entityId: SALON });
    expect(audits[0]?.metadata).toMatchObject({ slug: SLUG, name: 'Endpoint Salon' });
  });
});

describe('DELETE (soft)', () => {
  it('archives the salon and preserves its data', async () => {
    const response = await DELETE(deleteRequest({ hard: false }), { params });

    expect(response.status).toBe(200);

    const [salon] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    expect(salon?.deletedAt).toBeInstanceOf(Date);
    expect(salon?.status).toBe('cancelled');
    expect(await counts()).toMatchObject({ appointments: 2, lineItems: 2 });
  });

  it('will not overwrite the original deletedAt on a second archive', async () => {
    await DELETE(deleteRequest({ hard: false }), { params });
    const [first] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    const response = await DELETE(deleteRequest({ hard: false }), { params });

    expect(response.status).toBe(409);

    const [second] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, SALON));

    expect(second?.deletedAt).toEqual(first?.deletedAt);
  });
});
