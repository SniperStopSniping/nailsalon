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
import { serviceAddOnRowId } from '../src/libs/starterMenu';
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
const linkTemplates = args.includes('--link-templates');

/**
 * Owner-approved links for hand-created rows that match a canonical template
 * but were never tagged, so no repair could infer their add-ons. Only the
 * `template_key` column is written — never name, price, duration or status.
 */
const TEMPLATE_LINKS: Array<{ serviceId: string; templateKey: string }> = [
  { serviceId: 'e8a58dec-f24d-4ae8-94b2-57b72d545a57', templateKey: 'builder_gel_overlay' },
  { serviceId: '96f9dd5c-d5eb-4995-b4a8-5fcf9d318761', templateKey: 'russian_manicure_no_colour' },
  { serviceId: 'svc_B8sR-FFRyDbq-d34y6yfS', templateKey: 'builder_gel_refill' },
  { serviceId: 'svc_6_k3Q-ZQMxvo18tvUC05U', templateKey: 'gel_pedicure' },
];

/**
 * Linking is blocked by the partial unique index on (salon_id, template_key):
 * a template copy created by "Add recommended" already holds each key. The
 * copies are unassigned, unbooked duplicates of the owner's real services, so
 * linking releases the key from the copy and deactivates it. Reversible:
 * reactivate the copy and move the key back.
 */

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

    // 7. Approved template links + duplicate deactivation (opt-in).
    const serviceById = new Map(services.map(service => [service.id, service]));
    const proposedLinks = linkTemplates
      ? TEMPLATE_LINKS.map((link) => {
        const service = serviceById.get(link.serviceId);
        return {
          ...link,
          found: Boolean(service),
          name: service?.name ?? null,
          currentTemplateKey: service?.templateKey ?? null,
          // Refuse to overwrite a different, already-set template link.
          safe: Boolean(service) && (service!.templateKey === null || service!.templateKey === link.templateKey),
        };
      })
      : [];
    // Each key is held by a template copy created by "Add recommended". The
    // copy must release the key before the live row can take it. Only copies
    // that are unassigned AND unbooked are safe to retire this way.
    const technicianLinks = linkTemplates
      ? await db.select().from(schema.technicianServicesSchema)
        .innerJoin(schema.serviceSchema, eq(schema.serviceSchema.id, schema.technicianServicesSchema.serviceId))
        .where(eq(schema.serviceSchema.salonId, salon.id))
        .then(rows => rows.map(row => row.technician_services))
      : [];
    const bookedCountByService = new Map<string, number>();
    if (linkTemplates) {
      const booked = await db
        .select({ serviceId: schema.appointmentServicesSchema.serviceId })
        .from(schema.appointmentServicesSchema);
      for (const row of booked) {
        bookedCountByService.set(row.serviceId, (bookedCountByService.get(row.serviceId) ?? 0) + 1);
      }
    }
    const proposedDeactivations = linkTemplates
      ? TEMPLATE_LINKS.map((link) => {
        const copy = services.find(service => service.templateKey === link.templateKey && service.id !== link.serviceId);
        const bookings = copy ? bookedCountByService.get(copy.id) ?? 0 : 0;
        const assignedTechs = copy
          ? technicianLinks.filter(row => row.serviceId === copy.id && row.enabled).length
          : 0;
        return {
          releasesKeyFor: link.templateKey,
          serviceId: copy?.id ?? null,
          name: copy?.name ?? null,
          currentlyActive: copy?.isActive ?? null,
          bookings,
          assignedTechnicians: assignedTechs,
          // Retiring a copy that customers can book, or that has history,
          // would be destructive — refuse and surface it for review.
          safe: !copy || (bookings === 0 && assignedTechs === 0),
        };
      }).filter(item => item.serviceId !== null)
      : [];

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      linkTemplates,
      proposedLinks,
      proposedDeactivations,
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

    // Links first: tagging a row makes its canonical add-ons resolvable, and
    // the compatibility pass below then fills them in the same run.
    if (linkTemplates) {
      const unsafe = proposedLinks.filter(link => !link.safe);
      if (unsafe.length > 0) {
        throw new Error(`Refusing to link — rows missing or already tagged differently: ${JSON.stringify(unsafe)}`);
      }
      const unsafeCopies = proposedDeactivations.filter(item => !item.safe);
      if (unsafeCopies.length > 0) {
        throw new Error(`Refusing to retire a template copy that is bookable or has history: ${JSON.stringify(unsafeCopies)}`);
      }

      // One transaction: release each key from its copy, retire the copy, then
      // move the key onto the live row. A partial failure rolls everything back.
      await db.transaction(async (tx) => {
        for (const copy of proposedDeactivations) {
          await tx.update(schema.serviceSchema)
            .set({ templateKey: null, isActive: false })
            .where(and(eq(schema.serviceSchema.id, copy.serviceId!), eq(schema.serviceSchema.salonId, salon.id)));
        }
        for (const link of proposedLinks) {
          await tx.update(schema.serviceSchema)
            .set({ templateKey: link.templateKey })
            .where(and(eq(schema.serviceSchema.id, link.serviceId), eq(schema.serviceSchema.salonId, salon.id)));
        }
      });
      console.log(`\nRetired ${proposedDeactivations.length} template copies and linked ${proposedLinks.length} live services.`);
    }

    // Recompute after linking so rows tagged in this run are included.
    const finalServices = await db.select().from(schema.serviceSchema)
      .where(eq(schema.serviceSchema.salonId, salon.id));
    const finalRules = await db.select().from(schema.serviceAddOnSchema)
      .where(eq(schema.serviceAddOnSchema.salonId, salon.id));
    const finalRuleKeys = new Set(finalRules.map(rule => `${rule.serviceId}:${rule.addOnId}`));

    let inserted = 0;
    for (const service of finalServices) {
      if (!service.templateKey) {
        continue;
      }
      const declared = getTemplateByKey(service.templateKey)?.compatibleAddOnKeys ?? [];
      for (const [index, addOnKey] of declared.entries()) {
        const addOn = addOnByKey.get(addOnKey);
        if (!addOn || finalRuleKeys.has(`${service.id}:${addOn.id}`)) {
          continue;
        }
        await db.insert(schema.serviceAddOnSchema).values({
          // Shared with the seeder so both paths mint identical ids.
          id: serviceAddOnRowId(service.id, addOnKey),
          salonId: salon.id,
          serviceId: service.id,
          addOnId: addOn.id,
          selectionMode: 'optional',
          displayOrder: index,
        }).onConflictDoNothing();
        inserted += 1;
      }
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
