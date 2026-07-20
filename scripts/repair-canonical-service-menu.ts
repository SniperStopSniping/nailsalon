import 'dotenv/config';

/* eslint-disable no-console -- This command is an operations report. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import { LUSTER_MANICURE_TEMPLATE_KEY, LUSTER_PEDICURE_TEMPLATE_KEY } from '../src/libs/bookingMerchandising';
import { getTemplateByKey, SERVICE_TEMPLATES } from '../src/libs/serviceTemplateCatalog';
import * as schema from '../src/models/Schema';

/**
 * Reports (and, only with --apply, repairs) the gap between a salon's menu and
 * the canonical catalog. Read-only by default.
 *
 * Deliberately NEVER touches owner-editable values (price, duration, name,
 * description, visibility, ordering) on records that already exist, and never
 * touches bookings or appointment snapshots. It only ever ADDS missing
 * service→add-on compatibility rows, which is the one repair that is safe to
 * infer.
 *
 *   npx tsx scripts/repair-canonical-service-menu.ts --salon-slug <slug>
 *   npx tsx scripts/repair-canonical-service-menu.ts --salon-slug <slug> --apply
 */
const args = process.argv;
const salonSlug = args[args.indexOf('--salon-slug') + 1];
const apply = args.includes('--apply');

if (!salonSlug || salonSlug.startsWith('--')) {
  throw new Error('Usage: tsx scripts/repair-canonical-service-menu.ts --salon-slug <slug> [--apply]');
}
const requestedSalonSlug = salonSlug as string;

/** Generic descriptions that should be replaced with real customer copy. */
const GENERIC_DESCRIPTIONS = [/^bookable base service$/i, /^service$/i];

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return { db: drizzlePg(client, { schema }), client };
  }
  const client = new PGlite();
  await client.waitReady;
  const db = drizzlePglite(client, { schema }) as PgliteDatabase<typeof schema>;
  await migratePglite(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  return { db, client: null };
}

async function main() {
  const { db, client } = await getDatabase();
  try {
    const [salon] = await db
      .select({ id: schema.salonSchema.id, slug: schema.salonSchema.slug, name: schema.salonSchema.name })
      .from(schema.salonSchema)
      .where(and(eq(schema.salonSchema.slug, requestedSalonSlug), eq(schema.salonSchema.isActive, true)))
      .limit(1);

    if (!salon) {
      throw new Error(`Active salon not found: ${requestedSalonSlug}`);
    }

    const [services, addOns, rules] = await Promise.all([
      db.select().from(schema.serviceSchema)
        .where(eq(schema.serviceSchema.salonId, salon.id))
        .orderBy(asc(schema.serviceSchema.sortOrder)),
      db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.salonId, salon.id)),
      db.select().from(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.salonId, salon.id)),
    ]);

    const serviceByKey = new Map(services.filter(s => s.templateKey).map(s => [s.templateKey!, s]));
    const addOnByKey = new Map(addOns.filter(a => a.templateKey).map(a => [a.templateKey!, a]));
    const existingRule = new Set(rules.map(rule => `${rule.serviceId}:${rule.addOnId}`));

    // 1. Canonical starter services the salon does not have at all.
    const missingServices = SERVICE_TEMPLATES
      .filter(template => template.serviceType !== 'addon' && template.isRecommendedStarter)
      .filter(template => !serviceByKey.has(template.systemKey))
      .map(template => ({ templateKey: template.systemKey, name: template.name, category: template.bookingCategory }));

    // 2. Missing service→add-on compatibility (the safe, additive repair).
    const missingCompatibility: Array<{ serviceKey: string; serviceName: string; addOnKey: string; addOnName: string; displayOrder: number }> = [];
    const unavailableAddOns = new Set<string>();
    for (const [templateKey, service] of serviceByKey) {
      const declared = getTemplateByKey(templateKey)?.compatibleAddOnKeys ?? [];
      declared.forEach((addOnKey, index) => {
        const addOn = addOnByKey.get(addOnKey);
        if (!addOn) {
          unavailableAddOns.add(addOnKey);
          return;
        }
        if (!existingRule.has(`${service.id}:${addOn.id}`)) {
          missingCompatibility.push({
            serviceKey: templateKey,
            serviceName: service.name,
            addOnKey,
            addOnName: addOn.name,
            displayOrder: index,
          });
        }
      });
    }

    // 3. Active services with no add-ons at all (customer sees no customise UI).
    const servicesWithNoAddOns = services
      .filter(service => service.isActive)
      .filter(service => !rules.some(rule => rule.serviceId === service.id))
      .map(service => ({ id: service.id, name: service.name, templateKey: service.templateKey }));

    // 4. Generic public descriptions.
    const genericDescriptions = services
      .filter(service => service.isActive)
      .filter((service) => {
        const text = (service.descriptionItems?.[0] ?? service.description ?? '').trim();
        return text === '' || GENERIC_DESCRIPTIONS.some(pattern => pattern.test(text));
      })
      .map(service => ({ id: service.id, name: service.name, description: service.description }));

    // 5. Duplicate normalized names — reported only, never merged.
    const byNormalizedName = new Map<string, Array<{ id: string; name: string; templateKey: string | null }>>();
    for (const service of services) {
      const normalized = service.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      byNormalizedName.set(normalized, [...(byNormalizedName.get(normalized) ?? []), { id: service.id, name: service.name, templateKey: service.templateKey }]);
    }
    const duplicates = [...byNormalizedName.entries()].filter(([, rows]) => rows.length > 1)
      .map(([normalized, rows]) => ({ normalized, records: rows }));

    // 6. Luster lead ordering per category.
    const orderingIssues: Array<{ category: string; expected: string; actualFirst: string | null }> = [];
    for (const [category, leadKey] of [['manicure', LUSTER_MANICURE_TEMPLATE_KEY], ['pedicure', LUSTER_PEDICURE_TEMPLATE_KEY]] as const) {
      const inCategory = services.filter(service => service.isActive && service.bookingCategory === category);
      const lead = inCategory.find(service => service.templateKey === leadKey);
      if (!lead) {
        orderingIssues.push({ category, expected: leadKey, actualFirst: inCategory[0]?.name ?? null });
        continue;
      }
      const minSort = Math.min(...inCategory.map(service => service.sortOrder ?? Number.MAX_SAFE_INTEGER));
      if ((lead.sortOrder ?? Number.MAX_SAFE_INTEGER) > minSort) {
        orderingIssues.push({ category, expected: leadKey, actualFirst: inCategory.find(s => (s.sortOrder ?? 0) === minSort)?.name ?? null });
      }
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      salon,
      summary: {
        services: services.length,
        addOns: addOns.length,
        compatibilityRows: rules.length,
        missingStarterServices: missingServices.length,
        missingCompatibilityRows: missingCompatibility.length,
        activeServicesWithNoAddOns: servicesWithNoAddOns.length,
        genericDescriptions: genericDescriptions.length,
        duplicateNameGroups: duplicates.length,
        orderingIssues: orderingIssues.length,
        addOnTemplatesNotOnMenu: [...unavailableAddOns].length,
      },
      missingServices,
      missingCompatibility,
      servicesWithNoAddOns,
      genericDescriptions,
      duplicates,
      orderingIssues,
      addOnTemplatesNotOnMenu: [...unavailableAddOns],
      note: 'Owner-edited price, duration, name, description, visibility and ordering are never modified by this command. Only missing service→add-on rows are inserted with --apply.',
    }, null, 2));

    if (!apply) {
      console.log('\nDry run only — no writes performed. Re-run with --apply to insert the missing compatibility rows.');
      return;
    }

    let inserted = 0;
    for (const row of missingCompatibility) {
      const service = serviceByKey.get(row.serviceKey)!;
      const addOn = addOnByKey.get(row.addOnKey)!;
      await db.insert(schema.serviceAddOnSchema).values({
        id: `svcaddon_${salon.id.replace(/[^a-z0-9]/gi, '_')}_${row.addOnKey.replace(/_/g, '-')}_${row.serviceKey.replace(/_/g, '-')}`,
        salonId: salon.id,
        serviceId: service.id,
        addOnId: addOn.id,
        selectionMode: 'optional',
        displayOrder: row.displayOrder,
      }).onConflictDoNothing();
      inserted += 1;
    }
    console.log(`\nApplied: inserted up to ${inserted} compatibility rows (idempotent — existing rows skipped).`);
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
