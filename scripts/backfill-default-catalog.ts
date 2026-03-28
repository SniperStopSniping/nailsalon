import 'dotenv/config';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import { seedDefaultCatalogForSalon } from '../src/libs/defaultCatalog';
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

type ScriptOptions = {
  slug: string | null;
};

function parseArgs(argv: string[]): ScriptOptions {
  const slugArg = argv.find(arg => arg.startsWith('--slug='));

  return {
    slug: slugArg ? slugArg.slice('--slug='.length).trim() || null : null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { db, client } = await getDatabase();

  try {
    const salons = await db
      .select({
        id: schema.salonSchema.id,
        slug: schema.salonSchema.slug,
      })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.isActive, true));

    const targetSalons = options.slug
      ? salons.filter(salon => salon.slug === options.slug)
      : salons;

    if (options.slug && targetSalons.length === 0) {
      throw new Error(`Salon not found for slug "${options.slug}"`);
    }

    const seeded: string[] = [];
    const skipped: string[] = [];

    for (const salon of targetSalons) {
      const [existingService, existingAddOn] = await Promise.all([
        db
          .select({ id: schema.serviceSchema.id })
          .from(schema.serviceSchema)
          .where(eq(schema.serviceSchema.salonId, salon.id))
          .limit(1),
        db
          .select({ id: schema.addOnSchema.id })
          .from(schema.addOnSchema)
          .where(eq(schema.addOnSchema.salonId, salon.id))
          .limit(1),
      ]);

      if (existingService.length > 0 || existingAddOn.length > 0) {
        skipped.push(salon.slug);
        continue;
      }

      await seedDefaultCatalogForSalon({
        db,
        salonId: salon.id,
        onlyIfEmpty: true,
      });
      seeded.push(salon.slug);
    }

    console.log(JSON.stringify({ seeded, skipped }, null, 2));
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
