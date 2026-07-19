/**
 * One-time rollout repair for the migration→deploy window of 0056.
 *
 * Between applying migrations/0056_booking_category_luster_featuring.sql and
 * deploying the code that derives booking_category on insert, old code can
 * create pedicure/feet/combo services that silently take the column default
 * ('manicure') and therefore render under the wrong client booking tab.
 *
 * This re-derives booking_category from the legacy category for exactly that
 * wrong direction (category pedicure/feet/combo but booking_category still
 * 'manicure'). Run it ONCE right after the code deploy — running it later
 * could revert an owner who deliberately moved a pedicure-category service
 * into the Manicure tab.
 *
 * Usage: npx dotenv -c development -- tsx scripts/repair-booking-categories.ts [--dry-run]
 */
/* eslint-disable no-console */
import 'dotenv/config';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
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
  const dryRun = process.argv.includes('--dry-run');
  const { db, client } = await getDatabase();

  try {
    const wrongRows = await db.execute(sql`
      SELECT id, salon_id, name, category
      FROM service
      WHERE booking_category = 'manicure'
        AND category IN ('pedicure', 'feet', 'combo')
    `);
    const rows = 'rows' in wrongRows ? wrongRows.rows : wrongRows;

    if (dryRun) {
      console.log(JSON.stringify({ dryRun: true, wouldRepair: rows }, null, 2));
      return;
    }

    await db.execute(sql`
      UPDATE service
      SET booking_category = CASE
        WHEN category IN ('pedicure', 'feet') THEN 'pedicure'::booking_category
        ELSE 'combo'::booking_category
      END
      WHERE booking_category = 'manicure'
        AND category IN ('pedicure', 'feet', 'combo')
    `);

    console.log(JSON.stringify({ repaired: rows.length }, null, 2));
  } finally {
    if (client) {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
