/**
 * A1-3 Piece 1 — the loader, against a real migrated database.
 *
 * PGlite + the repo's real migrations (the bootstrap pattern used by
 * `src/libs/deposits/depositHealth.test.ts`), so every reused loader runs its
 * real SQL: services including inactive rows, active technicians with their
 * assignments, `getPublicBookableServiceIds`' three-way null/empty/set
 * semantics, the location-else-salon hours ceiling, the stored-rows-only
 * deposit policy, and the upcoming schedule-override read.
 *
 * `@/libs/integrationHealth` is the one seam: it fans out across eight
 * unrelated tables, a credit-ledger transaction and five environment
 * variables to answer two connection questions, none of which this module
 * derives. Holding it at the seam keeps this suite about the projection. The
 * derivation of the two integration codes from those statuses is covered
 * exhaustively in `readiness.test.ts`.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const health = vi.hoisted(() => ({
  google: { readiness: 'ready' as string },
  stripeConnect: { status: 'charge_ready' as string },
}));

vi.mock('@/libs/integrationHealth', () => ({
  getSalonIntegrationHealth: vi.fn(async () => health),
}));

/* eslint-disable import/first */
import { loadSetupReadiness } from './readiness.server';

/* eslint-enable import/first */

type Db = ReturnType<typeof drizzle<typeof schema>>;

let client: PGlite;
let db: Db;

const SALON_ID = 'salon_readiness_test';

const WORKING_WEEK = {
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
};

const SALON_HOURS = {
  monday: { open: '09:00', close: '17:00' },
  tuesday: { open: '09:00', close: '17:00' },
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

async function seedSalon(overrides: Partial<typeof schema.salonSchema.$inferInsert> = {}) {
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Isla Nail Studio',
    slug: 'isla-readiness-test',
    publicationStatus: 'published',
    isActive: true,
    businessHours: SALON_HOURS,
    settings: {
      bookingPageContent: {
        version: 1,
        draft: { bio: 'Builder gel, structured and long-wearing.' },
        live: { bio: 'Builder gel, structured and long-wearing.' },
      },
      bookingPage: {
        version: 1,
        draft: { layout: 'quick_book', quickBookProfile: { version: 1, showBio: true } },
        live: { layout: 'quick_book', quickBookProfile: { version: 1, showBio: true } },
      },
    } as never,
    ...overrides,
  });
}

async function seedTechnician(
  id: string,
  overrides: Partial<typeof schema.technicianSchema.$inferInsert> = {},
) {
  await db.insert(schema.technicianSchema).values({
    id,
    salonId: SALON_ID,
    name: `Technician ${id}`,
    isActive: true,
    weeklySchedule: WORKING_WEEK,
    ...overrides,
  });
}

async function seedService(
  id: string,
  overrides: Partial<typeof schema.serviceSchema.$inferInsert> = {},
) {
  await db.insert(schema.serviceSchema).values({
    id,
    salonId: SALON_ID,
    name: `Service ${id}`,
    price: 9500,
    durationMinutes: 60,
    category: 'builder_gel',
    isActive: true,
    ...overrides,
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  health.google.readiness = 'ready';
  health.stripeConnect.status = 'charge_ready';

  await db.delete(schema.technicianScheduleOverrideSchema);
  await db.delete(schema.technicianServicesSchema);
  await db.delete(schema.serviceSchema);
  await db.delete(schema.technicianSchema);
  await db.delete(schema.salonLocationSchema);
  await db.delete(schema.salonSchema);
});

describe('loadSetupReadiness', () => {
  it('returns null for a salon that does not exist', async () => {
    await expect(loadSetupReadiness('salon_missing')).resolves.toBeNull();
  });

  it('projects a finished salon with nothing outstanding', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');
    await seedService('svc_2');
    await db.insert(schema.technicianServicesSchema).values([
      { technicianId: 'tech_1', serviceId: 'svc_1', enabled: true },
      { technicianId: 'tech_1', serviceId: 'svc_2', enabled: true },
    ]);

    const result = await loadSetupReadiness(SALON_ID, new Date('2026-09-16T12:00:00.000Z'));

    expect(result?.items).toEqual([]);
    expect(result?.salon).toEqual({
      name: 'Isla Nail Studio',
      publicationStatus: 'published',
      timezone: 'America/Toronto',
      businessMode: 'solo',
      technicianCount: 1,
    });
    expect(result?.customersWillSee).toEqual({
      layoutId: 'quick_book',
      rendersBio: true,
      activeServiceCount: 2,
      publiclyBookableServiceCount: 2,
      openDays: ['monday', 'tuesday'],
    });
    expect(result?.computedAt).toBe('2026-09-16T12:00:00.000Z');
  });

  it('reads inactive services through the including-inactive loader', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');
    await seedService('svc_2', { isActive: false });
    await db.insert(schema.technicianServicesSchema).values([
      { technicianId: 'tech_1', serviceId: 'svc_1', enabled: true },
      { technicianId: 'tech_1', serviceId: 'svc_2', enabled: true },
    ]);

    const result = await loadSetupReadiness(SALON_ID);

    expect(result?.customersWillSee?.activeServiceCount).toBe(1);
    expect(result?.items.map(item => item.code)).not.toContain('services_not_bookable');
  });

  it('reports a service no active technician offers', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');
    await seedService('svc_2');
    await db.insert(schema.technicianServicesSchema).values([
      { technicianId: 'tech_1', serviceId: 'svc_1', enabled: true },
      { technicianId: 'tech_1', serviceId: 'svc_2', enabled: false },
    ]);

    const result = await loadSetupReadiness(SALON_ID);
    const item = result?.items.find(entry => entry.code === 'services_not_bookable');

    expect(item?.severity).toBe('required');
    expect(item?.detail).toEqual({ count: 1, serviceNames: ['Service svc_2'] });
    expect(result?.customersWillSee?.publiclyBookableServiceCount).toBe(1);
  });

  it('treats a salon with no assignment rows at all as legacy unrestricted', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);

    expect(result?.items.map(item => item.code)).not.toContain('services_not_bookable');
    expect(result?.customersWillSee?.publiclyBookableServiceCount).toBe(1);
  });

  it('suppresses services_not_bookable when the salon has no active technician', async () => {
    await seedSalon();
    await seedTechnician('tech_1', { isActive: false });
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);
    const produced = result?.items.map(item => item.code) ?? [];

    expect(produced).toContain('no_active_technician');
    expect(produced).not.toContain('services_not_bookable');
  });

  it('prefers the primary location hours over the salon hours', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');
    await db.insert(schema.salonLocationSchema).values({
      id: 'loc_1',
      salonId: SALON_ID,
      name: 'Primary location',
      isPrimary: true,
      isActive: true,
      businessHours: {
        ...SALON_HOURS,
        saturday: { open: '10:00', close: '15:00' },
      },
    });

    const result = await loadSetupReadiness(SALON_ID);
    const item = result?.items.find(entry => entry.code === 'hours_days_without_staff');

    expect(item?.detail).toEqual({ count: 1, days: ['saturday'] });
  });

  it('reports no_business_hours when neither the salon nor a location has hours', async () => {
    await seedSalon({ businessHours: null });
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);

    expect(result?.items.map(item => item.code)).toContain('no_business_hours');
  });

  it('downgrades a schedule-less technician that has an upcoming hours override', async () => {
    await seedSalon({
      features: { staff: { scheduleOverrides: true } } as never,
      businessHours: null,
    });
    await seedTechnician('tech_1', { weeklySchedule: null });
    await seedService('svc_1');
    await db.insert(schema.technicianScheduleOverrideSchema).values({
      id: 'ovr_1',
      salonId: SALON_ID,
      technicianId: 'tech_1',
      date: '2026-09-20',
      type: 'hours',
      startTime: '10:00',
      endTime: '16:00',
    });

    const result = await loadSetupReadiness(SALON_ID, new Date('2026-09-16T12:00:00.000Z'));
    const item = result?.items.find(entry => entry.code === 'technician_no_weekly_days');

    expect(item?.severity).toBe('recommended');
    expect(item?.detail).toEqual({ count: 1, reason: 'overrides_present' });
  });

  it('ignores a PAST override and an OFF-type override', async () => {
    await seedSalon({
      features: { staff: { scheduleOverrides: true } } as never,
      businessHours: null,
    });
    await seedTechnician('tech_1', { weeklySchedule: null });
    await seedService('svc_1');
    await db.insert(schema.technicianScheduleOverrideSchema).values([
      {
        id: 'ovr_past',
        salonId: SALON_ID,
        technicianId: 'tech_1',
        date: '2026-09-01',
        type: 'hours',
        startTime: '10:00',
        endTime: '16:00',
      },
      {
        id: 'ovr_off',
        salonId: SALON_ID,
        technicianId: 'tech_1',
        date: '2026-10-01',
        type: 'off',
        startTime: null,
        endTime: null,
      },
    ]);

    const result = await loadSetupReadiness(SALON_ID, new Date('2026-09-16T12:00:00.000Z'));
    const item = result?.items.find(entry => entry.code === 'technician_no_weekly_days');

    expect(item?.severity).toBe('required');
    expect(item?.detail).toEqual({ count: 1 });
  });

  it('keeps the item required when the salon lacks the scheduleOverrides entitlement', async () => {
    await seedSalon({
      features: { staff: { scheduleOverrides: false } } as never,
      businessHours: null,
    });
    await seedTechnician('tech_1', { weeklySchedule: null });
    await seedService('svc_1');
    await db.insert(schema.technicianScheduleOverrideSchema).values({
      id: 'ovr_1',
      salonId: SALON_ID,
      technicianId: 'tech_1',
      date: '2026-09-20',
      type: 'hours',
      startTime: '10:00',
      endTime: '16:00',
    });

    const result = await loadSetupReadiness(SALON_ID, new Date('2026-09-16T12:00:00.000Z'));

    expect(result?.items.find(entry => entry.code === 'technician_no_weekly_days')?.severity)
      .toBe('required');
  });

  it('reports no deposits item for a salon without the deposits entitlement', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);

    expect(result?.items.map(item => item.code)).not.toContain('deposits_not_ready');
  });

  it('maps the integration statuses onto the optional codes', async () => {
    health.google.readiness = 'not_connected';
    health.stripeConnect.status = 'not_connected';
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);
    const produced = result?.items.map(item => item.code) ?? [];

    expect(produced).toContain('google_not_connected');
    expect(produced).toContain('payments_not_connected');
  });

  it('reports the draft side and not_published for an unpublished salon', async () => {
    await seedSalon({ publicationStatus: 'draft' });
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);

    expect(result?.items.map(item => item.code)).toContain('not_published');
    expect(result?.items.map(item => item.code)).not.toContain('draft_unpublished_changes');
  });

  it('reports draft_unpublished_changes for a published salon whose sides differ', async () => {
    await seedSalon({
      settings: {
        bookingPageContent: {
          version: 1,
          draft: { bio: 'New copy not published yet.' },
          live: { bio: 'Builder gel, structured and long-wearing.' },
        },
        bookingPage: {
          version: 1,
          draft: { layout: 'quick_book', quickBookProfile: { version: 1, showBio: true } },
          live: { layout: 'quick_book', quickBookProfile: { version: 1, showBio: true } },
        },
      } as never,
    });
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);

    expect(result?.items.map(item => item.code)).toContain('draft_unpublished_changes');
  });

  it('carries no client-data key through the loaded path either', async () => {
    await seedSalon();
    await seedTechnician('tech_1');
    await seedService('svc_1');

    const result = await loadSetupReadiness(SALON_ID);
    const serialized = JSON.stringify(result);

    for (const key of [
      'phone',
      'email',
      'full_name',
      'first_name',
      'birthday',
      'notes',
      'sensitivities',
      'tags',
      'clientPhone',
      'clientSensitivities',
      'totalPrice',
      'totalSpent',
      'title',
      'summary',
      'attendees',
    ]) {
      expect(serialized).not.toContain(`"${key}":`);
    }
  });
});
