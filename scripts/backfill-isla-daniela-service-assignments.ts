import 'dotenv/config';

/* eslint-disable no-console -- Operations script emits a structured repair report. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import * as schema from '../src/models/Schema';

type CliOptions = {
  salonSlug: string;
  technicianId: string | null;
  technicianName: string | null;
  apply: boolean;
};

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

export function parseOptions(): CliOptions {
  const salonSlug = readOption('--salon-slug');
  const technicianId = readOption('--technician-id');
  const technicianName = readOption('--technician-name');

  if (!salonSlug || (!technicianId && !technicianName) || (technicianId && technicianName)) {
    throw new Error(
      'Usage: --salon-slug <slug> (--technician-id <id> | --technician-name <name>) [--apply]',
    );
  }

  return {
    salonSlug,
    technicianId,
    technicianName,
    apply: process.argv.includes('--apply'),
  };
}

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const db = drizzlePg(client, { schema });
    return { db, client };
  }

  const client = new PGlite();
  await client.waitReady;
  const db = drizzlePglite(client, { schema }) as PgliteDatabase<typeof schema>;
  await migratePglite(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  return { db, client: null };
}

async function main() {
  const options = parseOptions();
  const { db, client } = await getDatabase();

  try {
    const salons = await db
      .select({ id: schema.salonSchema.id, slug: schema.salonSchema.slug })
      .from(schema.salonSchema)
      .where(and(eq(schema.salonSchema.slug, options.salonSlug), eq(schema.salonSchema.isActive, true)));

    if (salons.length !== 1) {
      throw new Error(`Expected exactly one active salon with slug "${options.salonSlug}"; found ${salons.length}.`);
    }
    const salon = salons[0]!;

    const technicians = await db
      .select({ id: schema.technicianSchema.id, name: schema.technicianSchema.name })
      .from(schema.technicianSchema)
      .where(and(
        eq(schema.technicianSchema.salonId, salon.id),
        eq(schema.technicianSchema.isActive, true),
        options.technicianId
          ? eq(schema.technicianSchema.id, options.technicianId)
          : eq(schema.technicianSchema.name, options.technicianName!),
      ));

    if (technicians.length !== 1) {
      throw new Error(`Expected exactly one matching active technician in "${options.salonSlug}"; found ${technicians.length}.`);
    }
    const technician = technicians[0]!;

    const activeServices = await db
      .select({ id: schema.serviceSchema.id })
      .from(schema.serviceSchema)
      .where(and(
        eq(schema.serviceSchema.salonId, salon.id),
        eq(schema.serviceSchema.isActive, true),
      ))
      .orderBy(asc(schema.serviceSchema.sortOrder), asc(schema.serviceSchema.id));

    const existingAssignments = await db
      .select()
      .from(schema.technicianServicesSchema)
      .where(eq(schema.technicianServicesSchema.technicianId, technician.id));
    const assignmentsByServiceId = new Map(existingAssignments.map(row => [row.serviceId, row]));

    const insertedServiceIds: string[] = [];
    const reEnabledServiceIds: string[] = [];
    const unchangedServiceIds: string[] = [];

    for (const [priority, service] of activeServices.entries()) {
      const existing = assignmentsByServiceId.get(service.id);
      if (!existing) {
        insertedServiceIds.push(service.id);
      } else if (!existing.enabled) {
        reEnabledServiceIds.push(service.id);
      } else {
        unchangedServiceIds.push(service.id);
      }

      if (options.apply && (!existing || !existing.enabled)) {
        await db
          .insert(schema.technicianServicesSchema)
          .values({
            technicianId: technician.id,
            serviceId: service.id,
            enabled: true,
            priority,
          })
          .onConflictDoUpdate({
            target: [
              schema.technicianServicesSchema.technicianId,
              schema.technicianServicesSchema.serviceId,
            ],
            set: { enabled: true },
          });
      }
    }

    console.log(JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      salonSlug: salon.slug,
      technicianId: technician.id,
      technicianName: technician.name,
      activeServiceCount: activeServices.length,
      inserted: insertedServiceIds,
      reEnabled: reEnabledServiceIds,
      unchangedCount: unchangedServiceIds.length,
      skippedCount: 0,
    }, null, 2));
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
