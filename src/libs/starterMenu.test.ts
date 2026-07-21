import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
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
        { templateKey: 'gel_x_extensions', enabled: false },
      ],
      mode: 'initial',
    });

    expect(result.createdServiceIds).toHaveLength(20);
    expect(result.createdAddOnIds).toHaveLength(33);
    expect(result.skippedTemplateKeys).toEqual([]);

    const services = await db
      .select()
      .from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.salonId, SALON_ID));

    const luster = services.find(service => service.templateKey === 'luster_manicure');

    expect(luster).toMatchObject({
      name: 'Luster Manicure',
      price: 5500,
      // Starting-price display AGREES with the numeric price (the incident was
      // a display string that contradicted it). Totals still use `price`.
      priceDisplayText: '$55+',
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
    expect(services.find(service => service.templateKey === 'gel_x_extensions')?.isActive).toBe(false);

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

    expect(techLinks).toHaveLength(20);

    // Starter add-ons exist and are wired to compatible services.
    const addOns = await db
      .select()
      .from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.salonId, SALON_ID));

    expect(addOns).toHaveLength(33);
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

    // Gel-finish hand services carry the full hand design set.
    for (const serviceTemplate of ['luster_manicure', 'builder_gel_overlay', 'gel_manicure', 'gel_x_extensions']) {
      const linked = linkedAddOnTemplates(serviceTemplate);

      expect(linked.has('french_tips'), serviceTemplate).toBe(true);
      expect(linked.has('chrome'), serviceTemplate).toBe(true);
      expect(linked.has('nail_repair'), serviceTemplate).toBe(true);
    }

    // No-colour services never advertise design work.
    // Russian Manicure — No Colour is a library service, not a starter, so a
    // brand-new salon does not get it. (Its add-on rules are pinned in
    // canonicalServiceMenu.test.ts.)
    expect(serviceIdByTemplate.has('russian_manicure_no_colour')).toBe(false);

    // Regular-polish pedicure: French and simple toe art only — chrome and cat
    // eye need a gel finish, and hand add-ons never appear on a pedicure.
    const pedicureAddOns = linkedAddOnTemplates('classic_pedicure');

    expect(pedicureAddOns.has('french_toes')).toBe(true);
    expect(pedicureAddOns.has('simple_toe_art')).toBe(true);
    expect(pedicureAddOns.has('toenail_repair')).toBe(true);
    expect(pedicureAddOns.has('chrome_toes')).toBe(false);
    expect(pedicureAddOns.has('cat_eye_toes')).toBe(false);
    expect(pedicureAddOns.has('french_tips')).toBe(false);
    expect(pedicureAddOns.has('gel_removal')).toBe(false);

    // Shellac / Gel Toes gets the full toe set but no full-pedicure treatments.
    const gelToes = linkedAddOnTemplates('shellac_gel_toes');

    for (const expected of ['french_toes', 'chrome_toes', 'cat_eye_toes', 'simple_toe_art', 'detailed_toe_art', 'three_d_toe_art_charms', 'toenail_repair', 'gel_removal_toes', 'outside_salon_removal_toes']) {
      expect(gelToes.has(expected), expected).toBe(true);
    }
    for (const treatment of ['callus_treatment', 'paraffin_wax', 'extended_foot_massage']) {
      expect(gelToes.has(treatment), treatment).toBe(false);
    }

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
    expect(rerun.skippedTemplateKeys).toHaveLength(51);
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

    expect(restored[0]?.name).toBe('Classic Pedicure — Regular Polish');
  });
});

describe('seedStarterMenuForSalon — owner data and ordering guarantees', () => {
  const SALON_B = 'salon_starter_guarantees';
  let clientB: PGlite;
  let dbB: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    clientB = new PGlite();
    await clientB.waitReady;
    dbB = drizzle(clientB, { schema });
    await migrate(dbB, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    await dbB.insert(schema.salonSchema).values({ id: SALON_B, name: 'Guarantees', slug: 'guarantees-salon' });
    await seedStarterMenuForSalon({ db: dbB, salonId: SALON_B, mode: 'initial' });
  }, 60_000);

  afterAll(async () => {
    await clientB.close();
  });

  it('writes display_order from the canonical add-on order', async () => {
    const [service] = await dbB.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'gel_pedicure'));
    const rules = await dbB.select().from(schema.serviceAddOnSchema)
      .where(eq(schema.serviceAddOnSchema.serviceId, service!.id));
    const addOns = await dbB.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.salonId, SALON_B));
    const nameByAddOnId = new Map(addOns.map(addOn => [addOn.id, addOn.templateKey]));
    const ordered = rules
      .slice()
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map(rule => nameByAddOnId.get(rule.addOnId));

    expect(ordered[0]).toBe('french_toes');
    expect(ordered.indexOf('toenail_repair')).toBeLessThan(ordered.indexOf('callus_treatment'));
    // Every rule carries a distinct position, so rendering is deterministic.
    expect(new Set(rules.map(rule => rule.displayOrder)).size).toBe(rules.length);
  });

  it('gives every seeded service a real description — never a public placeholder', async () => {
    const services = await dbB.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.salonId, SALON_B));

    for (const service of services) {
      expect(service.description, service.name).toBeTruthy();
      expect(service.description, service.name).not.toMatch(/bookable base service/i);
    }
  });

  it('preserves owner edits when the starter menu is re-run', async () => {
    const [before] = await dbB.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'gel_manicure'));
    await dbB.update(schema.serviceSchema)
      .set({ name: 'House Gel Mani', price: 9999, durationMinutes: 111, description: 'Owner copy' })
      .where(eq(schema.serviceSchema.id, before!.id));

    const rerun = await seedStarterMenuForSalon({ db: dbB, salonId: SALON_B, mode: 'restore' });

    expect(rerun.createdServiceIds).toEqual([]);

    const [after] = await dbB.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.id, before!.id));

    expect(after).toMatchObject({
      name: 'House Gel Mani',
      price: 9999,
      durationMinutes: 111,
      description: 'Owner copy',
    });
  });

  it('creates no duplicate services or compatibility rows on re-run', async () => {
    const countRows = async () => ({
      services: (await dbB.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, SALON_B))).length,
      addOns: (await dbB.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.salonId, SALON_B))).length,
      rules: (await dbB.select().from(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.salonId, SALON_B))).length,
    });
    const before = await countRows();

    await seedStarterMenuForSalon({ db: dbB, salonId: SALON_B, mode: 'restore' });

    expect(await countRows()).toEqual(before);
  });

  it('never reuses an add-on display_order across seeding runs', async () => {
    // Regression: the counter restarted at 1 on every call, so a salon seeded
    // once and then topped up from the Library ended with colliding positions
    // (Isla had 16 duplicated pairs) and a list order that shuffled per load.
    const [glitter] = await dbB.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.templateKey, 'glitter_finish'));

    expect(glitter).toBeUndefined();

    await seedStarterMenuForSalon({
      db: dbB,
      salonId: SALON_B,
      mode: 'restore',
      templateKeys: ['glitter_finish', 'deep_french'],
    });

    const addOns = await dbB.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.salonId, SALON_B));
    const orders = addOns.map(addOn => addOn.displayOrder);

    expect(new Set(orders).size).toBe(addOns.length);
  });

  it('does not resurrect a compatibility link the owner removed', async () => {
    // reconcileSalonServiceAddOnCompatibility only inserts, so running it over
    // the whole salon undid owner deletions on the next Library add. It is now
    // scoped to the records each run actually touches.
    const [service] = await dbB.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.templateKey, 'gel_pedicure'));
    const [addOn] = await dbB.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.templateKey, 'french_toes'));

    await dbB.delete(schema.serviceAddOnSchema).where(
      and(
        eq(schema.serviceAddOnSchema.serviceId, service!.id),
        eq(schema.serviceAddOnSchema.addOnId, addOn!.id),
      ),
    );

    await seedStarterMenuForSalon({
      db: dbB,
      salonId: SALON_B,
      mode: 'restore',
      templateKeys: ['rhinestones'],
    });

    const revived = await dbB.select().from(schema.serviceAddOnSchema).where(
      and(
        eq(schema.serviceAddOnSchema.serviceId, service!.id),
        eq(schema.serviceAddOnSchema.addOnId, addOn!.id),
      ),
    );

    expect(revived).toHaveLength(0);

    // The newly added add-on still gets wired to its compatible services.
    const [rhinestones] = await dbB.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.templateKey, 'rhinestones'));

    expect(rhinestones).toBeDefined();
  });

  it('keeps per-unit repair add-ons priced and timed per nail', async () => {
    const addOns = await dbB.select().from(schema.addOnSchema)
      .where(eq(schema.addOnSchema.salonId, SALON_B));

    for (const key of ['nail_repair', 'toenail_repair']) {
      const repair = addOns.find(addOn => addOn.templateKey === key);

      expect(repair, key).toBeDefined();
      expect(repair!.pricingType).toBe('per_unit');
      expect(repair!.unitLabel).toBe('nail');
      expect(repair!.maxQuantity).toBe(10);
      // 3 nails ⇒ 3× price and 3× duration.
      expect(repair!.priceCents * 3).toBe(1500);
      expect(repair!.durationMinutes * 3).toBe(30);
    }
  });
});
