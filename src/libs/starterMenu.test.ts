import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { getFeaturedServices } from './bookingMerchandising';
import { seedStarterMenuForSalon } from './starterMenu';

vi.mock('server-only', () => ({}));

const SALON_ID = 'salon_starter_test';
const TECH_ID = 'tech_starter_test';

describe('seedStarterMenuForSalon', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'Starter Test Salon',
      slug: 'starter-test-salon',
    });
    await db.insert(schema.technicianSchema).values({
      id: TECH_ID,
      salonId: SALON_ID,
      name: 'Owner Tech',
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('seeds the full starter menu with template keys, booking categories, and tech links', async () => {
    const result = await seedStarterMenuForSalon({
      db,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      overrides: [
        { templateKey: 'gel_manicure', priceCents: 4200 },
        { templateKey: 'hard_gel_extensions', enabled: false },
      ],
      mode: 'initial',
    });

    expect(result.createdServiceIds).toHaveLength(14);
    expect(result.createdAddOnIds).toHaveLength(16);
    expect(result.skippedTemplateKeys).toEqual([]);

    const services = await db
      .select()
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.salonId, SALON_ID));

    const luster = services.find(service => service.templateKey === 'luster_manicure');

    expect(luster).toMatchObject({
      name: 'Luster Manicure',
      price: 4500,
      durationMinutes: 60,
      bookingCategory: 'manicure',
      isActive: true,
    });

    // Overrides applied; disabling keeps the record but not bookable.
    expect(services.find(service => service.templateKey === 'gel_manicure')?.price).toBe(4200);
    expect(services.find(service => service.templateKey === 'hard_gel_extensions')?.isActive).toBe(false);

    // Combos land under the combo booking tab; pedicures under pedicure.
    expect(services.find(service => service.templateKey === 'gel_mani_gel_pedi_combo')?.bookingCategory).toBe('combo');
    expect(services.find(service => service.templateKey === 'classic_pedicure')?.bookingCategory).toBe('pedicure');

    // No acrylic ever arrives via the starter menu.
    expect(services.some(service => /acrylic|dip/i.test(service.name))).toBe(false);

    // Every created service is bookable through the owner technician.
    const techLinks = await db
      .select()
      .from(schema.technicianServicesSchema)
      .where(eq(schema.technicianServicesSchema.technicianId, TECH_ID));

    expect(techLinks).toHaveLength(14);

    // Starter add-ons exist and are wired to compatible services.
    const addOns = await db
      .select()
      .from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.salonId, SALON_ID));

    expect(addOns).toHaveLength(16);
    expect(addOns.find(addOn => addOn.templateKey === 'nail_repair')).toMatchObject({
      pricingType: 'per_unit',
      unitLabel: 'nail',
    });

    const rules = await db
      .select()
      .from(schema.serviceAddOnSchema)
      .where(eq(schema.serviceAddOnSchema.salonId, SALON_ID));

    expect(rules.length).toBeGreaterThan(20);

    // The seeded Luster leads Featured Services on the client page.
    const featured = getFeaturedServices(
      services.filter(service => service.isActive),
      { lusterFeaturingEnabled: true },
    );

    expect(featured[0]?.templateKey).toBe('luster_manicure');
  });

  it('is idempotent: re-running skips every existing template and never reactivates', async () => {
    await db
      .update(schema.serviceSchema)
      .set({ isActive: false })
      .where(eq(schema.serviceSchema.templateKey, 'gel_manicure'));

    const rerun = await seedStarterMenuForSalon({
      db,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      mode: 'restore',
    });

    expect(rerun.createdServiceIds).toEqual([]);
    expect(rerun.createdAddOnIds).toEqual([]);
    expect(rerun.skippedTemplateKeys).toHaveLength(30);

    const gelManicure = await db
      .select()
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'gel_manicure'));

    expect(gelManicure[0]?.isActive).toBe(false);
  });

  it('restores only an explicitly deleted template on request, leaving the rest untouched', async () => {
    const [pedicure] = await db
      .select({ id: schema.serviceSchema.id })
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'classic_pedicure'));

    await db
      .delete(schema.serviceAddOnSchema)
      .where(eq(schema.serviceAddOnSchema.salonId, SALON_ID));
    await db
      .delete(schema.technicianServicesSchema)
      .where(eq(schema.technicianServicesSchema.serviceId, pedicure!.id));
    await db
      .delete(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'classic_pedicure'));

    const restore = await seedStarterMenuForSalon({
      db,
      salonId: SALON_ID,
      mode: 'restore',
      templateKeys: ['classic_pedicure'],
    });

    expect(restore.createdServiceIds).toHaveLength(1);

    const restored = await db
      .select()
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'classic_pedicure'));

    expect(restored[0]?.name).toBe('Classic Pedicure');
  });
});
