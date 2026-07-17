#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Verification for the double-booking constraints from migration 0054.
 *
 * Read-only. Reports:
 *  1. Whether the active-slot unique index exists (required).
 *  2. Whether the overlap exclusion constraint exists (best-effort; the
 *     migration skips it where btree_gist is unavailable or where existing
 *     rows still overlap).
 *  3. Any existing ACTIVE rows that violate either rule, so a data repair can
 *     be planned before re-running the migration.
 */

import pg from 'pg';

const { Pool } = pg;

function maskDatabaseUrl(databaseUrl: string) {
  return databaseUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Run with: NODE_ENV=development npx dotenv -c development -- npx tsx scripts/verify-booking-constraints.ts');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  console.log(`Database: ${maskDatabaseUrl(databaseUrl)}\n`);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  });

  let failed = false;

  try {
    console.log('='.repeat(60));
    console.log('DOUBLE-BOOKING CONSTRAINT VERIFICATION');
    console.log('='.repeat(60));

    const uniqueIndex = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'appointment' AND indexname = 'appointment_tech_active_slot_unique'`,
    );
    if (uniqueIndex.rows.length === 1) {
      console.log('✓ appointment_tech_active_slot_unique index present');
    } else {
      console.error('✗ appointment_tech_active_slot_unique index MISSING (run migrations)');
      failed = true;
    }

    const exclusion = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'appointment'::regclass AND conname = 'appointment_tech_active_no_overlap'`,
    );
    if (exclusion.rows.length === 1) {
      console.log('✓ appointment_tech_active_no_overlap exclusion constraint present');
    } else {
      console.warn('⚠ appointment_tech_active_no_overlap exclusion constraint absent (best-effort; see migration 0054 notes)');
    }

    const duplicates = await pool.query<{ technician_id: string; start_time: string; count: string }>(
      `SELECT technician_id, start_time, COUNT(*) AS count
       FROM appointment
       WHERE status IN ('pending', 'confirmed', 'in_progress')
         AND deleted_at IS NULL
         AND technician_id IS NOT NULL
       GROUP BY technician_id, start_time
       HAVING COUNT(*) > 1`,
    );
    if (duplicates.rows.length === 0) {
      console.log('✓ no active same-slot duplicates');
    } else {
      console.error(`✗ ${duplicates.rows.length} active technician/start-time duplicate group(s) found:`);
      for (const row of duplicates.rows) {
        console.error(`   technician=${row.technician_id} start=${row.start_time} count=${row.count}`);
      }
      failed = true;
    }

    const overlaps = await pool.query<{ a_id: string; b_id: string }>(
      `SELECT a.id AS a_id, b.id AS b_id
       FROM appointment a
       JOIN appointment b
         ON a.technician_id = b.technician_id
        AND a.id < b.id
        AND a.start_time < b.end_time
        AND a.end_time > b.start_time
       WHERE a.status IN ('pending', 'confirmed', 'in_progress')
         AND b.status IN ('pending', 'confirmed', 'in_progress')
         AND a.deleted_at IS NULL AND b.deleted_at IS NULL
         AND a.technician_id IS NOT NULL
       LIMIT 20`,
    );
    if (overlaps.rows.length === 0) {
      console.log('✓ no active overlapping appointments');
    } else {
      console.warn(`⚠ ${overlaps.rows.length} active overlapping pair(s) found (blocks the exclusion constraint; unique index unaffected):`);
      for (const row of overlaps.rows) {
        console.warn(`   ${row.a_id} overlaps ${row.b_id}`);
      }
    }

    console.log('='.repeat(60));
    if (failed) {
      console.error('RESULT: FAILED');
      process.exit(1);
    }
    console.log('RESULT: OK');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Verification error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
