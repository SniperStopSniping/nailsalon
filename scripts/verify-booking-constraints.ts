#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Verification for the double-booking backstops (introduced in 0054, widened
 * for deposit holds in 0066).
 *
 * Read-only. Reports:
 *  1. Whether the active-slot unique index exists (required) AND whether its
 *     predicate text actually covers every BLOCKING_APPOINTMENT_STATUSES member.
 *  2. Whether the overlap exclusion constraint exists — a FAILURE, not a
 *     warning, whenever `btree_gist` is installed, because in that case the
 *     migration had no licence to skip it — and whether its predicate text
 *     covers the same set.
 *  3. Any existing ACTIVE rows that violate either rule, so a data repair can
 *     be planned before re-running the migration.
 *
 * Existence alone is not verification: a deployment can carry an index of the
 * right NAME whose predicate is a stale, narrower status list, which is exactly
 * the divergence that lets a hold be double-booked. So the predicate text is
 * asserted, and every status list below is sourced from the constant rather
 * than retyped.
 */

import pg from 'pg';

import { BLOCKING_APPOINTMENT_STATUSES } from '@/libs/bookingConflictGuard';

const { Pool } = pg;

const BLOCKING_STATUSES = [...BLOCKING_APPOINTMENT_STATUSES];

/** Report which blocking statuses a stored predicate fails to mention. */
function missingStatuses(definition: string): string[] {
  return BLOCKING_STATUSES.filter(status => !definition.includes(`'${status}'`));
}

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

    console.log(`Blocking statuses (from BLOCKING_APPOINTMENT_STATUSES): ${BLOCKING_STATUSES.join(', ')}\n`);

    const uniqueIndex = await pool.query<{ definition: string }>(
      `SELECT pg_get_indexdef(c.oid) AS definition
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'appointment_tech_active_slot_unique'
          AND c.relkind = 'i'
          AND n.nspname = ANY (current_schemas(false))`,
    );
    const uniqueIndexDef = uniqueIndex.rows[0]?.definition;
    if (!uniqueIndexDef) {
      console.error('✗ appointment_tech_active_slot_unique index MISSING (run migrations)');
      failed = true;
    } else {
      const missing = missingStatuses(uniqueIndexDef);
      if (missing.length === 0) {
        console.log('✓ appointment_tech_active_slot_unique index present, predicate covers every blocking status');
      } else {
        console.error(`✗ appointment_tech_active_slot_unique predicate omits: ${missing.join(', ')}`);
        console.error(`   stored definition: ${uniqueIndexDef}`);
        failed = true;
      }
    }

    const gist = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
    const btreeGistInstalled = gist.rows.length === 1;

    const exclusion = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'appointment'::regclass
          AND conname = 'appointment_tech_active_no_overlap'`,
    );
    const exclusionDef = exclusion.rows[0]?.definition;
    if (exclusionDef) {
      const missing = missingStatuses(exclusionDef);
      if (missing.length === 0) {
        console.log('✓ appointment_tech_active_no_overlap present, predicate covers every blocking status');
      } else {
        console.error(`✗ appointment_tech_active_no_overlap predicate omits: ${missing.join(', ')}`);
        console.error(`   stored definition: ${exclusionDef}`);
        failed = true;
      }
    } else if (btreeGistInstalled) {
      // btree_gist is installed, so the migration's skip handler had no licence
      // to fire. An absent constraint here means the overlap backstop was
      // dropped and never restored — a silent loss of production protection,
      // not a best-effort miss.
      console.error('✗ appointment_tech_active_no_overlap MISSING while btree_gist IS installed');
      failed = true;
    } else {
      console.warn('⚠ appointment_tech_active_no_overlap absent and btree_gist is not installed (the migration skips it here by design)');
    }

    const duplicates = await pool.query<{ technician_id: string; start_time: string; count: string }>(
      `SELECT technician_id, start_time, COUNT(*) AS count
       FROM appointment
       WHERE status = ANY ($1)
         AND deleted_at IS NULL
         AND technician_id IS NOT NULL
       GROUP BY technician_id, start_time
       HAVING COUNT(*) > 1`,
      [BLOCKING_STATUSES],
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
       WHERE a.status = ANY ($1)
         AND b.status = ANY ($1)
         AND a.deleted_at IS NULL AND b.deleted_at IS NULL
         AND a.technician_id IS NOT NULL
       LIMIT 20`,
      [BLOCKING_STATUSES],
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
