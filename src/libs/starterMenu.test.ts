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
      price: 5500,
      priceDisplayText: null,
      isIntroPrice: true,
      introPriceLabel: 'Intro price',
      durationMinutes: 60,
      bookingCategory: 'manicure',
      isActive: true,
    });

    // Non-intro templates seed without the badge.
    expect(services.find(service => service.templateKey === 'classic_pedicure')).toMatchObject({
      isIntroPrice: false,
      introPriceLabel: null,
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

    const serviceIdByTemplate = new Map(services.map(service => [service.templateKey, service.id]));
    const addOnIdByTemplate = new Map(addOns.map(addOn => [addOn.templateKey, addOn.id]));
    const linkedAddOnTemplates = (templateKey: string) => new Set(
      rules
        .filter(rule => rule.serviceId === serviceIdByTemplate.get(templateKey))
        .map(rule => addOns.find(addOn => addOn.id === rule.addOnId)?.templateKey),
    );

    for (const serviceTemplate of ['luster_manicure', 'builder_gel_overlay', 'russian_manicure_no_colour', 'gel_manicure', 'gel_x_extensions', 'hard_gel_extensions']) {
      const linked = linkedAddOnTemplates(serviceTemplate);

      expect(linked.has('french_tips')).toBe(true);
      expect(linked.has('chrome')).toBe(true);
      expect(linked.has('nail_repair')).toBe(true);
    }

    const pedicureAddOns = linkedAddOnTemplates('classic_pedicure');

    expect(pedicureAddOns.has('french_tips')).toBe(true);
    expect(pedicureAddOns.has('chrome')).toBe(true);
    expect(pedicureAddOns.has('gel_removal')).toBe(false);
    expect(rules.filter(rule => rule.serviceId === serviceIdByTemplate.get('gel_mani_gel_pedi_combo'))
      .map(rule => rule.addOnId)).toEqual([...new Set(rules.filter(rule => rule.serviceId === serviceIdByTemplate.get('gel_mani_gel_pedi_combo')).map(rule => rule.addOnId))]);
    expect(addOnIdByTemplate.get('french_tips')).toBeDefined();

    // The seeded Luster leads Featured Services on the client page.
    const featured = getFeaturedServices(
      services.filter(service => service.isActive),
      { lusterFeaturingEnabled: true },
    );

    expect(featured[0]?.templateKey).toBe('luster_manicure');
  });

  it('is idempotent and revives inactive templates without replacing owner data', async () => {
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
    expect(rerun.skippedTemplateKeys).toHaveLength(28);
    expect(rerun.revivedServiceIds).toHaveLength(2);

    const gelManicure = await db
      .select()
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'gel_manicure'));

    expect(gelManicure[0]?.isActive).toBe(true);
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
