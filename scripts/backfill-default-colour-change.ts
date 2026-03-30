import 'dotenv/config';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import { backfillMissingColourChangeForSalon } from '../src/libs/defaultCatalog';
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

function parseSlugArg(argv: string[]): string | null {
  const slugArg = argv.find(arg => arg.startsWith('--slug='));
  return slugArg ? slugArg.slice('--slug='.length).trim() || null : null;
}

async function main() {
  const slug = parseSlugArg(process.argv.slice(2));
  const { db, client } = await getDatabase();

  try {
    const salons = await db
      .select({
        id: schema.salonSchema.id,
        slug: schema.salonSchema.slug,
      })
      .from(schema.salonSchema)
      .where(eq(schema.salonSchema.isActive, true));

    const targetSalons = slug
      ? salons.filter(salon => salon.slug === slug)
      : salons;

    if (slug && targetSalons.length === 0) {
      throw new Error(`Salon not found for slug "${slug}"`);
    }

    const results: Array<{
      slug: string;
      insertedService: boolean;
      insertedAssignments: number;
    }> = [];

    for (const salon of targetSalons) {
      const result = await backfillMissingColourChangeForSalon({
        db,
        salonId: salon.id,
      });

      results.push({
        slug: salon.slug,
        insertedService: result.insertedService,
        insertedAssignments: result.insertedAssignments,
      });
    }

    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
