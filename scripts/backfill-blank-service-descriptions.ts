/**
 * Backfills public descriptions onto salon services that have none.
 *
 * A service whose `description` AND `descriptionItems` are both empty renders
 * the client-side placeholder "Bookable base service" on the public booking
 * page (BookServiceClient.tsx). Template descriptions only apply when a service
 * is seeded, so rows created before the canonical catalog existed keep showing
 * the placeholder forever. This fills those rows — and only those rows — from
 * the canonical template matching each row's `template_key`.
 *
 * Owner-written copy is never touched: blankness is re-checked inside the
 * UPDATE's WHERE clause, so a description written between the dry run and the
 * apply is left alone rather than overwritten.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-blank-service-descriptions.ts --salon=<slug>
 *   npx tsx scripts/backfill-blank-service-descriptions.ts --salon=<slug> --apply
 */
import 'dotenv/config';

import { Client } from 'pg';

import { getTemplateByKey } from '../src/libs/serviceTemplateCatalog';

type ServiceRow = {
  id: string;
  name: string;
  template_key: string | null;
  description: string | null;
  description_items: string[] | null;
  is_active: boolean;
};

function isBlank(row: ServiceRow): boolean {
  const fromItems = row.description_items?.[0] ?? '';
  return !fromItems.trim() && !(row.description ?? '').trim();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const salonArg = process.argv.find(a => a.startsWith('--salon='))?.split('=')[1];

  if (!salonArg) {
    throw new Error('Missing --salon=<slug>');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const salon = (await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM salon WHERE slug = $1',
      [salonArg],
    )).rows[0];

    if (!salon) {
      throw new Error(`No salon with slug "${salonArg}"`);
    }

    const services = (await client.query<ServiceRow>(
      `SELECT id, name, template_key, description, description_items, is_active
         FROM service WHERE salon_id = $1 ORDER BY name`,
      [salon.id],
    )).rows;

    const planned: Array<{ row: ServiceRow; description: string }> = [];
    const skipped: string[] = [];

    for (const row of services) {
      if (!row.is_active || !isBlank(row)) {
        continue;
      }
      const description = row.template_key ? getTemplateByKey(row.template_key)?.description : undefined;
      if (!description) {
        skipped.push(`${row.name} (template_key=${row.template_key ?? 'NULL'} has no canonical copy)`);
        continue;
      }
      planned.push({ row, description });
    }

    console.log(`Salon: ${salon.name} (${salon.id})`);
    console.log(`Active services: ${services.filter(s => s.is_active).length}`);
    console.log(`Blank and fillable: ${planned.length}`);
    console.log(`Left alone (already have copy): ${services.filter(s => s.is_active && !isBlank(s)).length}\n`);

    for (const { row, description } of planned) {
      console.log(`  ${row.name}`);
      console.log(`    id       : ${row.id}`);
      console.log(`    proposed : ${description}\n`);
    }

    for (const note of skipped) {
      console.log(`  SKIP ${note}`);
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');
    let updated = 0;

    for (const { row, description } of planned) {
      // Blankness is re-asserted here so copy written since the read above is
      // preserved rather than clobbered.
      // description_items is jsonb, not text[] — build a one-element json array
      // and probe it with jsonb operators.
      const result = await client.query(
        `UPDATE service
            SET description = $2, description_items = jsonb_build_array($2::text), updated_at = now()
          WHERE id = $1
            AND coalesce(btrim(description), '') = ''
            AND (description_items IS NULL
                 OR jsonb_array_length(description_items) = 0
                 OR coalesce(btrim(description_items->>0), '') = '')`,
        [row.id, description],
      );

      if (result.rowCount) {
        updated += result.rowCount;
        console.log(`  wrote: ${row.name}`);
      } else {
        console.log(`  skipped (no longer blank): ${row.name}`);
      }
    }

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${updated} row(s) updated.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
