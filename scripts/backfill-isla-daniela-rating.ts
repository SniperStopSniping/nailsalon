import 'dotenv/config';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import {
  backfillIslaDanielaRating,
  IslaDanielaRatingAmbiguityError,
} from '../src/libs/islaDanielaRating';
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
    try {
      const result = await backfillIslaDanielaRating({ db });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      if (error instanceof IslaDanielaRatingAmbiguityError) {
        console.error(JSON.stringify({
          salonSlug: error.salonSlug,
          status: error.status,
          matchedTechnicianCount: error.matchedTechnicianCount,
          rating: error.rating,
          reviewCount: error.reviewCount,
          error: error.message,
        }, null, 2));
        process.exitCode = 1;
        return;
      }

      throw error;
    }
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
