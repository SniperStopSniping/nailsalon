/**
 * Salon purge integration test (real PGlite, real migrations).
 *
 * This is the test that keeps the hard-delete bug fixed. It runs against a
 * database migrated from migrations/, so every foreign key — including the
 * ON DELETE RESTRICT on fraud_signal that broke the original handler — is
 * enforced exactly as it is in production.
 *
 * The coverage guard at the bottom is the important one: it fails when a
 * future migration adds a restrict-style child of `salon` that nobody added
 * to SALON_PURGE_PLAN.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
  countSalonImpact,
  purgeSalonData,
  type PurgeTx,
  SALON_PURGE_PLAN,
  SalonPurgeBlockedError,
} from './salonPurge';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const SALON = 'salon_purge_target';
const OTHER_SALON = 'salon_purge_bystander';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

/**
 * Every table the purge plan touches gets at least one row, so a missing or
 * misordered step surfaces as a foreign-key violation rather than a silent
 * pass. Ids are suffixed so the same seed can build a second, untouched salon.
 */
async function seedSalon(salonId: string, suffix: string, dayOffset: number): Promise<void> {
  const id = (name: string) => `${name}_${suffix}`;
  // Distinct days per salon: appointment_tech_active_slot_unique would otherwise
  // reject the cross-tenant test, which re-points one salon's appointment at the
  // other salon's technician.
  const start = new Date(Date.UTC(2026, 6, 20 + dayOffset, 15, 0, 0));
  const end = new Date(Date.UTC(2026, 6, 20 + dayOffset, 16, 0, 0));

  await db.insert(schema.salonSchema).values({ id: salonId, name: `Salon ${suffix}`, slug: `salon-${suffix}` });
  await db.insert(schema.salonLocationSchema).values({ id: id('loc'), salonId, name: 'Main' });
  await db.insert(schema.serviceSchema).values({
    id: id('svc'),
    salonId,
    name: 'Gel Manicure',
    price: 60,
    durationMinutes: 60,
    category: 'manicure',
  });
  await db.insert(schema.addOnSchema).values({
    id: id('addon'),
    salonId,
    name: 'Nail Art',
    slug: 'nail-art',
    category: 'nail_art',
    priceCents: 1000,
    durationMinutes: 15,
  });
  await db.insert(schema.serviceAddOnSchema).values({
    id: id('svcaddon'),
    salonId,
    serviceId: id('svc'),
    addOnId: id('addon'),
  });
  await db.insert(schema.technicianSchema).values({ id: id('tech'), salonId, name: 'Tech' });
  await db.insert(schema.technicianServicesSchema).values({ technicianId: id('tech'), serviceId: id('svc') });
  await db.insert(schema.technicianBlockedSlotSchema).values({
    id: id('blocked'),
    salonId,
    technicianId: id('tech'),
    startTime: '12:00',
    endTime: '13:00',
  });
  await db.insert(schema.technicianScheduleOverrideSchema).values({
    id: id('override'),
    salonId,
    technicianId: id('tech'),
    date: '2026-07-20',
    type: 'off',
  });
  await db.insert(schema.technicianTimeOffSchema).values({
    id: id('timeoff'),
    salonId,
    technicianId: id('tech'),
    startDate: start,
    endDate: end,
  });
  await db.insert(schema.salonClientSchema).values({
    id: id('sclient'),
    salonId,
    phone: '4165550100',
    preferredTechnicianId: id('tech'),
  });
  await db.insert(schema.clientPreferencesSchema).values({
    id: id('prefs'),
    salonId,
    normalizedClientPhone: '4165550100',
    favoriteTechId: id('tech'),
  });
  await db.insert(schema.appointmentSchema).values({
    id: id('appt'),
    salonId,
    clientPhone: '4165550100',
    salonClientId: id('sclient'),
    technicianId: id('tech'),
    startTime: start,
    endTime: end,
    totalPrice: 60,
    totalDurationMinutes: 60,
  });
  await db.insert(schema.appointmentServicesSchema).values({
    id: id('apptsvc'),
    appointmentId: id('appt'),
    serviceId: id('svc'),
    priceAtBooking: 60,
    durationAtBooking: 60,
  });
  await db.insert(schema.appointmentAddOnSchema).values({
    id: id('apptaddon'),
    appointmentId: id('appt'),
    addOnId: id('addon'),
    nameSnapshot: 'Nail Art',
    categorySnapshot: 'nail_art',
    pricingTypeSnapshot: 'fixed',
    unitPriceCentsSnapshot: 1000,
    durationMinutesSnapshot: 15,
    lineTotalCentsSnapshot: 1000,
    lineDurationMinutesSnapshot: 15,
  });
  await db.insert(schema.appointmentFinalItemSchema).values({
    id: id('final'),
    appointmentId: id('appt'),
    salonId,
    kind: 'service',
    name: 'Gel Manicure',
    unitPriceCents: 6000,
    lineTotalCents: 6000,
    catalogServiceId: id('svc'),
    catalogAddOnId: id('addon'),
  });
  await db.insert(schema.appointmentPaymentSchema).values({
    id: id('pay'),
    appointmentId: id('appt'),
    salonId,
    amountCents: 6000,
    recordedByType: 'admin',
  });
  await db.insert(schema.appointmentAuditLogSchema).values({
    id: id('apptaudit'),
    appointmentId: id('appt'),
    salonId,
    action: 'created',
    performedBy: 'admin_1',
    performedByRole: 'admin',
  });
  await db.insert(schema.appointmentPhotoSchema).values({
    id: id('photo'),
    appointmentId: id('appt'),
    salonId,
    normalizedClientPhone: '4165550100',
    cloudinaryPublicId: 'pub',
    imageUrl: 'https://example.test/p.jpg',
    uploadedByTechId: id('tech'),
  });
  await db.insert(schema.autopostQueueSchema).values({
    id: id('autopost'),
    salonId,
    appointmentId: id('appt'),
    platform: 'instagram',
  });
  await db.insert(schema.googleCalendarDraftSchema).values({
    id: id('gdraft'),
    salonId,
    googleEventId: `gev_${suffix}`,
    startTime: start,
    endTime: end,
    convertedAppointmentId: id('appt'),
  });
  await db.insert(schema.referralSchema).values({ id: id('ref'), salonId, referrerPhone: '4165550100' });
  await db.insert(schema.rewardSchema).values({
    id: id('reward'),
    salonId,
    clientPhone: '4165550100',
    type: 'referral',
    referralId: id('ref'),
    usedInAppointmentId: id('appt'),
  });
  await db.insert(schema.reviewSchema).values({
    id: id('review'),
    salonId,
    appointmentId: id('appt'),
    salonClientId: id('sclient'),
    technicianId: id('tech'),
    rating: 5,
  });
  // The row that broke the original handler: ON DELETE RESTRICT, NOT NULL.
  await db.insert(schema.fraudSignalSchema).values({
    id: id('fraud'),
    salonId,
    salonClientId: id('sclient'),
    appointmentId: id('appt'),
    type: 'HIGH_APPOINTMENT_FREQUENCY',
    reason: 'seeded',
  });
  await db.insert(schema.salonPageAppearanceSchema).values({ id: id('page'), salonId, pageName: 'home' });
  await db.insert(schema.adminInviteSchema).values({
    id: id('invite'),
    salonId,
    phoneE164: '+14165550100',
    role: 'ADMIN',
    expiresAt: new Date(Date.UTC(2026, 7, 1)),
  });
  await db.insert(schema.auditLogSchema).values({
    id: id('audit'),
    salonId,
    actorType: 'super_admin',
    action: 'updated',
  });
  await db.insert(schema.salonSignupInviteSchema).values({
    id: id('signup'),
    tokenHash: `hash_${suffix}`,
    invitedEmail: `owner-${suffix}@example.test`,
    expiresAt: new Date(Date.UTC(2026, 7, 1)),
    resultSalonId: salonId,
  });

  // Migration 0052 backup tables: no foreign keys, so they are invisible to any
  // FK-derived plan and only a seeded row proves the purge covers them.
  await db.execute(
    sql`insert into "luster_migration_backup_0052_appointment_times" ("id") values (${id('appt')})`,
  );
  await db.execute(
    sql`insert into "luster_migration_backup_0052_client_times" ("id") values (${id('sclient')})`,
  );
}

/** Row counts for every table in the plan, for the atomicity assertion. */
async function snapshot(salonId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const step of SALON_PURGE_PLAN) {
    out[step.table] = await step.count(db as unknown as PurgeTx, salonId);
  }
  return out;
}

beforeEach(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await seedSalon(SALON, 'target', 0);
  await seedSalon(OTHER_SALON, 'bystander', 1);
});

describe('purgeSalonData', () => {
  it('removes the salon and every one of its rows', async () => {
    const before = await snapshot(SALON);

    // Sanity: the seed actually populated every table in the plan.
    const emptyTables = Object.entries(before)
      .filter(([, n]) => n === 0)
      .map(([t]) => t);

    expect(emptyTables).toEqual([]);

    const result = await db.transaction(async tx => purgeSalonData(tx as unknown as PurgeTx, SALON));

    expect(result.totalRows).toBeGreaterThan(0);

    const after = await snapshot(SALON);
    for (const [table, count] of Object.entries(after)) {
      expect({ table, count }).toEqual({ table, count: 0 });
    }
  });

  it('leaves other salons completely untouched', async () => {
    const bystanderBefore = await snapshot(OTHER_SALON);

    await db.transaction(async tx => purgeSalonData(tx as unknown as PurgeTx, SALON));

    const bystanderAfter = await snapshot(OTHER_SALON);

    expect(bystanderAfter).toEqual(bystanderBefore);
  });

  it('preserves the platform audit trail by nulling salon_id instead of deleting', async () => {
    await db.transaction(async tx => purgeSalonData(tx as unknown as PurgeTx, SALON));

    const surviving = await db
      .select({ id: schema.auditLogSchema.id, salonId: schema.auditLogSchema.salonId })
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.id, 'audit_target'));

    expect(surviving).toEqual([{ id: 'audit_target', salonId: null }]);
  });

  it('is atomic: a failure part-way through leaves every row intact', async () => {
    const before = await snapshot(SALON);

    await expect(
      db.transaction(async (tx) => {
        await purgeSalonData(tx as unknown as PurgeTx, SALON);
        // Simulates any later failure — an audit write, a Stripe call, a bug.
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await snapshot(SALON);

    // This is the regression guard for the original data loss: the old handler
    // committed each delete independently, so 104 appointments lost their
    // service line items while the appointments themselves survived.
    expect(after).toEqual(before);
  });

  it('refuses to run when another salon references this salon (and writes nothing)', async () => {
    // A bystander appointment pointing at the target salon's technician.
    await db
      .update(schema.appointmentSchema)
      .set({ technicianId: 'tech_target' })
      .where(eq(schema.appointmentSchema.id, 'appt_bystander'));

    const before = await snapshot(SALON);

    await expect(
      db.transaction(async tx => purgeSalonData(tx as unknown as PurgeTx, SALON)),
    ).rejects.toThrow(SalonPurgeBlockedError);

    expect(await snapshot(SALON)).toEqual(before);
  });
});

describe('countSalonImpact', () => {
  it('reports the same rows the purge would remove', async () => {
    const preview = await countSalonImpact(db as unknown as PurgeTx, SALON);
    const actual = await db.transaction(async tx => purgeSalonData(tx as unknown as PurgeTx, SALON));

    expect(actual.counts).toEqual(preview.counts);
    expect(actual.totalRows).toEqual(preview.totalRows);
  });
});

describe('SALON_PURGE_PLAN coverage guard', () => {
  it('covers every restrict-style foreign key pointing at salon', async () => {
    const result = await db.execute(sql`
      select tc.table_name as child, kcu.column_name as col, rc.delete_rule as rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
      join information_schema.referential_constraints rc on tc.constraint_name = rc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_name = 'salon'
        and rc.delete_rule <> 'CASCADE'
    `);

    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
      child: string;
      col: string;
    }[];

    const planned = new Set(SALON_PURGE_PLAN.map(s => s.table));
    const uncovered = rows.map(r => r.child).filter(child => !planned.has(child));

    // If this fails, a migration added a restrict-style child of `salon` and
    // nobody added it to SALON_PURGE_PLAN. Add a step — do not weaken the test.
    expect([...new Set(uncovered)]).toEqual([]);
  });

  it('leaves no restrict-style foreign key pointing at salon (migration 0059)', async () => {
    const result = await db.execute(sql`
      select tc.table_name as child, kcu.column_name as col, tc.constraint_name as name, rc.delete_rule as rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
      join information_schema.referential_constraints rc on tc.constraint_name = rc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_name = 'salon'
        and rc.delete_rule not in ('CASCADE', 'SET NULL')
    `);

    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
      child: string;
      col: string;
      name: string;
    }[];

    // Migration 0059 converted all 21 restrict-style children of `salon`. A new
    // one here means a migration added a foreign key without an ON DELETE rule,
    // which is how the database drifted into the original bug.
    expect(rows.map(r => `${r.child}.${r.col} (${r.name})`)).toEqual([]);
  });

  it('lists each table exactly once', () => {
    const tables = SALON_PURGE_PLAN.map(s => s.table);

    expect(tables).toEqual([...new Set(tables)]);
  });

  it('deletes the salon row last', () => {
    expect(SALON_PURGE_PLAN.at(-1)?.table).toBe('salon');
  });
});
