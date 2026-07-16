/* eslint-disable no-console */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const apply = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const candidates = await client.query<{
      id: string;
      slug: string;
      name: string;
      publication_status: string;
    }>(`
      select s.id, s.slug, s.name, s.publication_status
        from salon s
       where s.deleted_at is null
         and s.publication_status = 'published'
         and not exists (
           select 1 from admin_salon_membership m where m.salon_id = s.id
         )
         and not exists (
           select 1 from appointment a where a.salon_id = s.id
         )
       order by s.slug
    `);

    console.log(`${apply ? 'Applying' : 'Previewing'} safe draft cleanup for ${candidates.rowCount ?? 0} salon(s).`);
    for (const salon of candidates.rows) {
      console.log(`- ${salon.slug}`);
    }

    if (!apply || candidates.rows.length === 0) {
      return;
    }

    const backupPath = `/tmp/luster-unowned-empty-salons-${Date.now()}.json`;
    await writeFile(backupPath, JSON.stringify(candidates.rows, null, 2), { mode: 0o600 });

    await client.query('begin');
    try {
      for (const salon of candidates.rows) {
        const guarded = await client.query(`
          update salon s
             set publication_status = 'draft', published_at = null, updated_at = now()
           where s.id = $1
             and s.publication_status = 'published'
             and not exists (select 1 from admin_salon_membership m where m.salon_id = s.id)
             and not exists (select 1 from appointment a where a.salon_id = s.id)
          returning s.id
        `, [salon.id]);

        if (guarded.rowCount !== 1) {
          throw new Error(`CLEANUP_GUARD_CHANGED:${salon.slug}`);
        }

        await client.query(`
          insert into audit_log (
            id, salon_id, actor_type, action, entity_type, entity_id, metadata, created_at
          ) values (gen_random_uuid()::text, $1, 'system', 'unowned_empty_salon_moved_to_draft', 'salon', $1, $2, now())
        `, [salon.id, JSON.stringify({ priorPublicationStatus: salon.publication_status, reason: 'unowned_and_no_appointments' })]);
      }
      await client.query('commit');
      console.log(`Cleanup complete. Backup: ${backupPath}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}

void main();
