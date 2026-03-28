import 'dotenv/config';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import * as schema from '../src/models/Schema';

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const db = drizzlePg(client, { schema });
    await migratePg(db, {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });

    return { db, client };
  }

  const client = new PGlite();
  await client.waitReady;

  const db = drizzlePglite(client, { schema }) as PgliteDatabase<typeof schema>;
  await migratePglite(db, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });

  return { db, client: null };
}

async function main() {
  const { db, client } = await getDatabase();

  try {
    const salon = await db.query.salonSchema.findFirst({
      where: (salon, { and, eq }) => and(
        eq(salon.slug, 'isla-nail-studio'),
        eq(salon.isActive, true),
      ),
    });

    if (!salon) {
      throw new Error('Salon "isla-nail-studio" not found.');
    }

    const technician = await db.query.technicianSchema.findFirst({
      where: (technician, { and, eq }) => and(
        eq(technician.salonId, salon.id),
        eq(technician.name, 'Daniela'),
        eq(technician.isActive, true),
      ),
    });

    if (!technician) {
      throw new Error('Active technician "Daniela" not found in isla-nail-studio.');
    }

    const activeServices = await db
      .select({
        id: schema.serviceSchema.id,
        name: schema.serviceSchema.name,
      })
      .from(schema.serviceSchema)
      .where(
        and(
          eq(schema.serviceSchema.salonId, salon.id),
          eq(schema.serviceSchema.isActive, true),
        ),
      )
      .orderBy(asc(schema.serviceSchema.sortOrder), asc(schema.serviceSchema.name));

    const existingAssignments = await db
      .select()
      .from(schema.technicianServicesSchema)
      .where(eq(schema.technicianServicesSchema.technicianId, technician.id));

    const assignmentsByServiceId = new Map(
      existingAssignments.map(assignment => [assignment.serviceId, assignment] as const),
    );

    let inserted = 0;
    let updated = 0;

    // Idempotent by serviceId: reruns only re-enable or reprioritize existing rows.
    for (const [index, service] of activeServices.entries()) {
      const existing = assignmentsByServiceId.get(service.id);

      if (!existing) {
        await db.insert(schema.technicianServicesSchema).values({
          technicianId: technician.id,
          serviceId: service.id,
          enabled: true,
          priority: index,
        });
        inserted += 1;
        continue;
      }

      if (!existing.enabled || existing.priority !== index) {
        await db
          .update(schema.technicianServicesSchema)
          .set({
            enabled: true,
            priority: index,
          })
          .where(
            and(
              eq(schema.technicianServicesSchema.technicianId, technician.id),
              eq(schema.technicianServicesSchema.serviceId, service.id),
            ),
          );
        updated += 1;
      }
    }

    console.log(JSON.stringify({
      salonSlug: salon.slug,
      technicianId: technician.id,
      technicianName: technician.name,
      activeServiceCount: activeServices.length,
      inserted,
      updated,
    }, null, 2));
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
