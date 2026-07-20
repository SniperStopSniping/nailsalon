import 'dotenv/config';

/* eslint-disable no-console -- This command is an operations report. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import { resolveVisibleBookingCategory } from '../src/libs/bookingCategory';
import { SERVICE_TEMPLATES } from '../src/libs/serviceTemplateCatalog';
import * as schema from '../src/models/Schema';

const salonSlug = process.argv[process.argv.indexOf('--salon-slug') + 1];

if (!salonSlug || salonSlug.startsWith('--')) {
  throw new Error('Usage: tsx scripts/report-service-availability.ts --salon-slug <slug>');
}
const requestedSalonSlug = salonSlug as string;
const EXPECTED_SALON_ID = 'f898d50d-c0b5-4bb5-a143-9f35ff7edf2a';

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
      .where(and(
        eq(schema.salonSchema.slug, requestedSalonSlug),
        eq(schema.salonSchema.id, EXPECTED_SALON_ID),
        eq(schema.salonSchema.isActive, true),
      ))
      .limit(1);

    if (!salon) {
      throw new Error(`Active salon not found: ${requestedSalonSlug}`);
    }

    const [services, technicians, assignments, addOns, rules] = await Promise.all([
      db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, salon.id)).orderBy(asc(schema.serviceSchema.sortOrder)),
      db.select({ id: schema.technicianSchema.id, name: schema.technicianSchema.name, isActive: schema.technicianSchema.isActive })
        .from(schema.technicianSchema).where(eq(schema.technicianSchema.salonId, salon.id)),
      db.select().from(schema.technicianServicesSchema)
        .innerJoin(schema.serviceSchema, eq(schema.serviceSchema.id, schema.technicianServicesSchema.serviceId))
        .where(eq(schema.serviceSchema.salonId, salon.id)),
      db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.salonId, salon.id)).orderBy(asc(schema.addOnSchema.displayOrder)),
      db.select().from(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.salonId, salon.id)),
    ]);

    const activeTechnicianIds = new Set(technicians.filter(technician => technician.isActive).map(technician => technician.id));
    const scopedAssignments = assignments.map(row => row.technician_services);
    const structuredSalon = scopedAssignments.length > 0;
    const publicServiceIds = new Set(
      services
        .filter(service => service.isActive)
        .filter(service => !structuredSalon || scopedAssignments.some(assignment => (
          assignment.serviceId === service.id
          && assignment.enabled
          && activeTechnicianIds.has(assignment.technicianId)
        )))
        .map(service => service.id),
    );
    const assignmentByService = new Map<string, typeof scopedAssignments>();
    for (const assignment of scopedAssignments) {
      const current = assignmentByService.get(assignment.serviceId) ?? [];
      current.push(assignment);
      assignmentByService.set(assignment.serviceId, current);
    }

    const serviceByTemplate = new Map(services.map(service => [service.templateKey, service]));
    const addOnByTemplate = new Map(addOns.map(addOn => [addOn.templateKey, addOn]));
    const expectedCompatibility = new Set<string>();
    for (const addOnTemplate of SERVICE_TEMPLATES.filter(template => template.serviceType === 'addon' && template.compatibleTemplateKeys?.length)) {
      const addOn = addOnByTemplate.get(addOnTemplate.systemKey);
      if (!addOn) {
        continue;
      }
      const compatibleKeys = new Set(addOnTemplate.compatibleTemplateKeys);
      for (const combo of SERVICE_TEMPLATES.filter(template => template.serviceType === 'combo')) {
        if (combo.componentTemplateKeys?.some(component => compatibleKeys.has(component))) {
          compatibleKeys.add(combo.systemKey);
        }
      }
      for (const serviceTemplateKey of compatibleKeys) {
        const service = serviceByTemplate.get(serviceTemplateKey);
        if (service?.isActive) {
          expectedCompatibility.add(`${service.id}:${addOn.id}`);
        }
      }
    }
    const actualCompatibility = new Set(rules.map(rule => `${rule.serviceId}:${rule.addOnId}`));
    const missingCompatibilityLinks = [...expectedCompatibility]
      .filter(key => !actualCompatibility.has(key))
      .map((key) => {
        const [serviceId, addOnId] = key.split(':');
        const service = services.find(candidate => candidate.id === serviceId);
        const addOn = addOns.find(candidate => candidate.id === addOnId);
        return {
          serviceId,
          serviceName: service?.name ?? null,
          serviceTemplateKey: service?.templateKey ?? null,
          addOnId,
          addOnName: addOn?.name ?? null,
          addOnTemplateKey: addOn?.templateKey ?? null,
        };
      });

    console.log(JSON.stringify({
      mode: 'read-only',
      salon,
      activeTechnicians: technicians.filter(technician => technician.isActive),
      services: services.map(service => ({
        id: service.id,
        name: service.name,
        templateKey: service.templateKey,
        isActive: service.isActive,
        bookingCategory: resolveVisibleBookingCategory(service),
        public: publicServiceIds.has(service.id),
        assignments: assignmentByService.get(service.id) ?? [],
        missingAssignment: Boolean(service.isActive && structuredSalon && !publicServiceIds.has(service.id)),
      })),
      addOns,
      compatibility: rules,
      missingCompatibilityLinks,
      compatibilityGaps: services
        .filter(service => service.isActive)
        .map(service => ({
          serviceId: service.id,
          serviceName: service.name,
          linkedAddOnIds: rules.filter(rule => rule.serviceId === service.id).map(rule => rule.addOnId),
        })),
      summary: {
        activeServiceCount: services.filter(service => service.isActive).length,
        publicServiceCount: publicServiceIds.size,
        unassignedActiveServiceIds: services.filter(service => service.isActive && structuredSalon && !publicServiceIds.has(service.id)).map(service => service.id),
        addOnCount: addOns.length,
        compatibilityLinkCount: rules.length,
        missingCompatibilityLinkCount: missingCompatibilityLinks.length,
      },
    }, null, 2));
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
