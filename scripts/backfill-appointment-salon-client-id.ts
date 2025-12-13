#!/usr/bin/env tsx
/**
 * Backfill Script: appointment.salon_client_id
 *
 * Populates salon_client_id for existing appointments that don't have it set.
 * Uses normalized phone matching to find corresponding salon_client records.
 *
 * SELF-CONTAINED: Uses direct pg connection, no app imports.
 *
 * IDEMPOTENT: Safe to run multiple times - only updates WHERE salon_client_id IS NULL
 *
 * Usage:
 *   NODE_ENV=development npx tsx scripts/backfill-appointment-salon-client-id.ts --dry-run
 *   NODE_ENV=development npx tsx scripts/backfill-appointment-salon-client-id.ts
 *   NODE_ENV=development npx tsx scripts/backfill-appointment-salon-client-id.ts --strict
 *
 * Production usage (requires explicit flags):
 *   NODE_ENV=production npx tsx scripts/backfill-appointment-salon-client-id.ts --i-know-what-im-doing --prod
 *
 * SAFETY:
 * - Prints connection details (host/db/user, never password) for verification
 * - NODE_ENV=production requires --i-know-what-im-doing flag
 * - Database name containing "prod" requires --prod flag
 * - Advisory lock prevents concurrent runs
 * - Uses transactions per batch for atomicity
 * - Uses created_at keyset pagination (handles UUID/text IDs correctly)
 * - Batch lookups to avoid N+1 queries
 * - Post-run integrity checks (orphans, cross-tenant)
 * - Exits non-zero if duplicates exist (unless --allow-duplicates)
 * - Exits non-zero if unmatched > 0 with --strict flag
 *
 * After successful backfill (exit 0), run:
 *   ALTER TABLE appointment ALTER COLUMN salon_client_id SET NOT NULL;
 */

import pg from 'pg';

const { Pool } = pg;

// =============================================================================
// CLI FLAGS
// =============================================================================

const DRY_RUN = process.argv.includes('--dry-run');
const STRICT_MODE = process.argv.includes('--strict');
const I_KNOW_WHAT_IM_DOING = process.argv.includes('--i-know-what-im-doing');
const PROD_FLAG = process.argv.includes('--prod');
const ALLOW_DUPLICATES = process.argv.includes('--allow-duplicates');

// =============================================================================
// Configuration
// =============================================================================

const BATCH_SIZE = 500; // Keep reasonable for transaction size
const MAX_PHONES_PER_BATCH = 1000; // Cap for ANY() array size
const ADVISORY_LOCK_ID = 8675309; // Unique ID for this script's lock

// =============================================================================
// SAFETY CHECKS - Run before any DB operations
// =============================================================================

// Require explicit DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  console.error('Set it explicitly before running this script.');
  process.exit(1);
}

// Parse DATABASE_URL to extract connection info (for logging, never log password)
const dbUrl = process.env.DATABASE_URL;
let parsedDb: { host: string; database: string; user: string; ssl: boolean } | null = null;

try {
  const url = new URL(dbUrl);
  parsedDb = {
    host: url.hostname,
    database: url.pathname.slice(1), // Remove leading /
    user: url.username,
    ssl: url.searchParams.get('sslmode') === 'require' || url.searchParams.has('ssl'),
  };
} catch {
  // URL parsing failed - will show masked URL instead
}

console.log('\n' + '='.repeat(60));
console.log('DATABASE CONNECTION');
console.log('='.repeat(60));
if (parsedDb) {
  console.log(`  Host:     ${parsedDb.host}`);
  console.log(`  Database: ${parsedDb.database}`);
  console.log(`  User:     ${parsedDb.user}`);
  console.log(`  SSL:      ${parsedDb.ssl ? 'required' : 'not required'}`);
} else {
  const maskedUrl = dbUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  console.log(`  URL: ${maskedUrl}`);
}
console.log('='.repeat(60));

// Check 1: NODE_ENV protection
if (process.env.NODE_ENV !== 'development') {
  if (!I_KNOW_WHAT_IM_DOING) {
    console.error('\n❌ ERROR: This script defaults to NODE_ENV=development only.');
    console.error(`Current NODE_ENV: ${process.env.NODE_ENV || '(not set)'}`);
    console.error('To run in non-development, add: --i-know-what-im-doing');
    process.exit(1);
  }
  console.warn('\n⚠️  WARNING: Running in non-development mode (--i-know-what-im-doing)');
}

// Check 2: Production database name protection
if (parsedDb?.database.toLowerCase().includes('prod') && !PROD_FLAG) {
  console.error('\n❌ ERROR: Database name contains "prod" - refusing to run without --prod flag.');
  console.error('This is a safety check. If you really mean to run against production, add: --prod');
  process.exit(1);
}

// Check 3: SSL warning for cloud databases
if (parsedDb && !parsedDb.ssl && (parsedDb.host.includes('neon') || parsedDb.host.includes('supabase'))) {
  console.warn('\n⚠️  WARNING: Cloud database detected without sslmode=require');
  console.warn('Consider adding ?sslmode=require to DATABASE_URL');
}

// =============================================================================
// Phone Normalization (must match src/libs/phone.ts exactly)
// =============================================================================

/**
 * Normalize phone number to 10 digits (US format).
 * Strips country code (+1) and all non-digit characters.
 * Returns null if input is invalid. NEVER throws.
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  // If 11 digits starting with 1, strip the leading 1 (US country code)
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  // Valid 10-digit US phone
  if (digits.length === 10) {
    return digits;
  }
  // Invalid - return null (never throw)
  return null;
}

// =============================================================================
// Types
// =============================================================================

type UnmatchedReason = 'NO_PHONE' | 'INVALID_PHONE' | 'NO_SALON_CLIENT_MATCH';

type UnmatchedAppointment = {
  appointmentId: string;
  salonId: string;
  rawPhone: string | null;
  normalizedPhone: string | null;
  reason: UnmatchedReason;
};

type AppointmentRow = {
  id: string;
  salon_id: string;
  client_phone: string | null;
  created_at: Date;
};

type SalonClientRow = {
  id: string;
  salon_id: string;
  phone: string;
};

// =============================================================================
// Main Backfill Logic
// =============================================================================

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('\n' + '='.repeat(60));
  console.log('Backfill: appointment.salon_client_id');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('='.repeat(60));

  let totalProcessed = 0;
  let totalUpdated = 0;
  let batchCount = 0;
  const unmatched: UnmatchedAppointment[] = [];
  let advisoryLockAcquired = false;

  try {
    // ==========================================================================
    // ADVISORY LOCK: Prevent concurrent runs
    // ==========================================================================
    console.log('\n[Pre-flight] Acquiring advisory lock...');
    const lockResult = await pool.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1)',
      [ADVISORY_LOCK_ID],
    );

    if (!lockResult.rows[0]?.pg_try_advisory_lock) {
      console.error('❌ ERROR: Another instance of this script is already running!');
      console.error('Wait for it to complete or manually release the lock:');
      console.error(`  SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID});`);
      await pool.end();
      process.exit(1);
    }
    advisoryLockAcquired = true;
    console.log('✅ Advisory lock acquired');

    // ==========================================================================
    // PRE-FLIGHT: Verify appointment.salon_client_id column exists
    // ==========================================================================
    console.log('\n[Pre-flight] Checking appointment.salon_client_id column...');
    const columnCheck = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'appointment' AND column_name = 'salon_client_id'`,
    );
    if (columnCheck.rows.length === 0) {
      console.error('❌ ERROR: appointment.salon_client_id column does not exist!');
      console.error('Run the migration first:');
      console.error('  ALTER TABLE appointment ADD COLUMN salon_client_id TEXT REFERENCES salon_client(id);');
      await pool.end();
      process.exit(1);
    }
    console.log('✅ Column exists');

    // ==========================================================================
    // PRE-FLIGHT: Verify salon_client unique constraint exists
    // ==========================================================================
    console.log('\n[Pre-flight] Checking salon_client unique constraint...');
    const constraintCheck = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes 
       WHERE tablename = 'salon_client' 
       AND (indexdef LIKE '%salon_id%phone%' OR indexdef LIKE '%phone%salon_id%')`,
    );
    if (constraintCheck.rows.length === 0) {
      console.error('❌ ERROR: No unique index on salon_client(salon_id, phone) found!');
      console.error('This is required for data integrity. Add it before running backfill:');
      console.error('  CREATE UNIQUE INDEX salon_client_salon_id_phone_key ON salon_client (salon_id, phone);');
      await pool.end();
      process.exit(1);
    }
    console.log(`✅ Found constraint: ${constraintCheck.rows[0]?.indexname}`);

    // ==========================================================================
    // PRE-FLIGHT: Check for duplicate salon_client records (FAIL by default)
    // ==========================================================================
    console.log('\n[Pre-flight] Checking for duplicate salon_client records...');
    const duplicateCheck = await pool.query<{ salon_id: string; phone: string; cnt: string }>(
      `SELECT salon_id, phone, COUNT(*) as cnt 
       FROM salon_client 
       GROUP BY salon_id, phone 
       HAVING COUNT(*) > 1 
       LIMIT 10`,
    );
    if (duplicateCheck.rows.length > 0) {
      console.error('❌ ERROR: Found duplicate salon_client records!');
      for (const row of duplicateCheck.rows) {
        console.error(`   salon: ${row.salon_id}, phone: ${row.phone}, count: ${row.cnt}`);
      }
      if (ALLOW_DUPLICATES) {
        console.warn('\n⚠️  Proceeding anyway (--allow-duplicates). Will use lowest id deterministically.');
      } else {
        console.error('\nClean up duplicates before running backfill, or add --allow-duplicates to proceed.');
        console.error('To find and clean duplicates:');
        console.error(`  SELECT * FROM salon_client WHERE (salon_id, phone) IN (
    SELECT salon_id, phone FROM salon_client GROUP BY salon_id, phone HAVING COUNT(*) > 1
  ) ORDER BY salon_id, phone, id;`);
        await pool.end();
        process.exit(1);
      }
    } else {
      console.log('✅ No duplicates found');
    }

    // ==========================================================================
    // Get total count of appointments to backfill
    // ==========================================================================
    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::int AS count FROM appointment WHERE salon_client_id IS NULL',
    );
    const totalToProcess = parseInt(countResult.rows[0]?.count ?? '0', 10);

    console.log(`\nFound ${totalToProcess} appointments without salon_client_id\n`);

    if (totalToProcess === 0) {
      console.log('Nothing to backfill. All appointments have salon_client_id.');
      return; // Will release lock in finally block
    }

    // ==========================================================================
    // Process in batches using CREATED_AT KEYSET PAGINATION
    // This handles UUID/text IDs correctly (lexicographic comparison is unreliable)
    // ==========================================================================
    let lastCreatedAt: Date | null = null;
    let lastId: string | null = null;

    while (true) {
      batchCount++;

      // Fetch batch using created_at keyset pagination
      // WHERE (created_at > $lastCreatedAt) OR (created_at = $lastCreatedAt AND id > $lastId)
      let appointments: AppointmentRow[];

      if (lastCreatedAt && lastId) {
        const result = await pool.query<AppointmentRow>(
          `SELECT id, salon_id, client_phone, created_at 
           FROM appointment 
           WHERE salon_client_id IS NULL 
             AND (created_at > $1 OR (created_at = $1 AND id > $2))
           ORDER BY created_at, id 
           LIMIT $3`,
          [lastCreatedAt, lastId, BATCH_SIZE],
        );
        appointments = result.rows;
      } else {
        const result = await pool.query<AppointmentRow>(
          `SELECT id, salon_id, client_phone, created_at 
           FROM appointment 
           WHERE salon_client_id IS NULL
           ORDER BY created_at, id 
           LIMIT $1`,
          [BATCH_SIZE],
        );
        appointments = result.rows;
      }

      if (appointments.length === 0) {
        break; // No more to process
      }

      // Update cursor for next iteration
      const lastAppt = appointments[appointments.length - 1]!;
      lastCreatedAt = lastAppt.created_at;
      lastId = lastAppt.id;

      // =======================================================================
      // BATCH PROCESSING: Normalize phones and build lookup map
      // =======================================================================
      type ProcessedAppt = {
        appt: AppointmentRow;
        normalizedPhone: string | null;
        reason: UnmatchedReason | null;
      };

      const processed: ProcessedAppt[] = [];
      const phoneLookups: Map<string, Set<string>> = new Map(); // salonId -> Set of phones

      for (const appt of appointments) {
        // Guard: No phone at all
        if (!appt.client_phone) {
          processed.push({ appt, normalizedPhone: null, reason: 'NO_PHONE' });
          continue;
        }

        // Normalize phone - returns null if invalid (never throws)
        const normalizedPhone = normalizePhone(appt.client_phone);

        // Guard: Invalid phone after normalization
        if (!normalizedPhone) {
          processed.push({ appt, normalizedPhone: null, reason: 'INVALID_PHONE' });
          continue;
        }

        // Valid phone - add to lookup batch
        processed.push({ appt, normalizedPhone, reason: null });

        // Group by salonId for batch lookup
        const existing = phoneLookups.get(appt.salon_id) ?? new Set();
        existing.add(normalizedPhone);
        phoneLookups.set(appt.salon_id, existing);
      }

      // =======================================================================
      // BATCH LOOKUP: Fetch all matching salon_clients in one query per salon
      // Uses ANY($phones) to avoid N+1
      // Deterministic pick: ORDER BY id (lowest id wins if duplicates exist)
      // =======================================================================
      const salonClientMap: Map<string, string> = new Map(); // key: "salonId:phone" -> clientId

      for (const [salonId, phoneSet] of phoneLookups.entries()) {
        const uniquePhones = [...phoneSet];

        if (uniquePhones.length === 0) continue;

        // Cap phones per query to avoid huge ANY() arrays
        const phoneChunks: string[][] = [];
        for (let i = 0; i < uniquePhones.length; i += MAX_PHONES_PER_BATCH) {
          phoneChunks.push(uniquePhones.slice(i, i + MAX_PHONES_PER_BATCH));
        }

        for (const phones of phoneChunks) {
          // Batch lookup with deterministic ordering (lowest id first)
          // DISTINCT ON ensures we get exactly one row per phone
          const clientResult = await pool.query<SalonClientRow>(
            `SELECT DISTINCT ON (phone) id, salon_id, phone
             FROM salon_client 
             WHERE salon_id = $1 AND phone = ANY($2)
             ORDER BY phone, id`, // Deterministic: lowest id wins
            [salonId, phones],
          );

          for (const client of clientResult.rows) {
            const mapKey = `${client.salon_id}:${client.phone}`;
            salonClientMap.set(mapKey, client.id);
          }
        }
      }

      // =======================================================================
      // BEGIN TRANSACTION for this batch (atomic updates)
      // =======================================================================
      const client = await pool.connect();

      try {
        if (!DRY_RUN) {
          await client.query('BEGIN');
        }

        // Process each appointment and update if match found
        for (const { appt, normalizedPhone, reason } of processed) {
          totalProcessed++;

          // Already marked as unmatched (no phone or invalid phone)
          if (reason) {
            unmatched.push({
              appointmentId: appt.id,
              salonId: appt.salon_id,
              rawPhone: appt.client_phone,
              normalizedPhone,
              reason,
            });
            continue;
          }

          // Lookup salon_client
          const mapKey = `${appt.salon_id}:${normalizedPhone}`;
          const salonClientId = salonClientMap.get(mapKey);

          if (!salonClientId) {
            unmatched.push({
              appointmentId: appt.id,
              salonId: appt.salon_id,
              rawPhone: appt.client_phone,
              normalizedPhone,
              reason: 'NO_SALON_CLIENT_MATCH',
            });
            continue;
          }

          // Update appointment with salon_client_id (idempotent: WHERE salon_client_id IS NULL)
          if (!DRY_RUN) {
            const updateResult = await client.query(
              `UPDATE appointment 
               SET salon_client_id = $1 
               WHERE id = $2 AND salon_client_id IS NULL`,
              [salonClientId, appt.id],
            );

            if (updateResult.rowCount !== 1) {
              // Could be 0 if already updated by concurrent process (idempotent)
              console.warn(`[WARN] Expected 1 row updated for ${appt.id}, got ${updateResult.rowCount}`);
            }
          }

          totalUpdated++;
        }

        if (!DRY_RUN) {
          await client.query('COMMIT');
        }
      } catch (batchError) {
        if (!DRY_RUN) {
          await client.query('ROLLBACK');
        }
        console.error(`[ERROR] Batch ${batchCount} failed, rolled back:`, batchError);
        throw batchError;
      } finally {
        client.release();
      }

      // Progress logging
      const pct = Math.round((totalProcessed / totalToProcess) * 100);
      console.log(`Batch ${batchCount}: ${totalProcessed}/${totalToProcess} (${pct}%) - Updated: ${totalUpdated}, Unmatched: ${unmatched.length}`);
    }

    // ==========================================================================
    // POST-RUN INTEGRITY CHECKS (only in LIVE mode)
    // ==========================================================================
    if (!DRY_RUN) {
      console.log('\n' + '='.repeat(60));
      console.log('POST-RUN INTEGRITY CHECKS');
      console.log('='.repeat(60));

      // Check 1: Remaining nulls (should match unmatched count)
      const nullsResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::int AS count FROM appointment WHERE salon_client_id IS NULL',
      );
      const remainingNulls = parseInt(nullsResult.rows[0]?.count ?? '0', 10);
      console.log(`\n1. Remaining NULL salon_client_id: ${remainingNulls}`);
      if (remainingNulls !== unmatched.length) {
        console.error(`   ❌ MISMATCH: Expected ${unmatched.length} based on unmatched count!`);
      } else {
        console.log('   ✅ Matches unmatched count');
      }

      // Check 2: Orphaned references (salon_client_id points to non-existent salon_client)
      const orphansResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count
         FROM appointment a
         LEFT JOIN salon_client sc ON sc.id = a.salon_client_id
         WHERE a.salon_client_id IS NOT NULL AND sc.id IS NULL`,
      );
      const orphans = parseInt(orphansResult.rows[0]?.count ?? '0', 10);
      console.log(`\n2. Orphaned references: ${orphans}`);
      if (orphans > 0) {
        console.error('   ❌ CRITICAL: Found appointments with invalid salon_client_id!');
      } else {
        console.log('   ✅ No orphans');
      }

      // Check 3: Cross-tenant mismatch (appointment.salon_id != salon_client.salon_id)
      const crossTenantResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count
         FROM appointment a
         JOIN salon_client sc ON sc.id = a.salon_client_id
         WHERE a.salon_id <> sc.salon_id`,
      );
      const crossTenant = parseInt(crossTenantResult.rows[0]?.count ?? '0', 10);
      console.log(`\n3. Cross-tenant mismatches: ${crossTenant}`);
      if (crossTenant > 0) {
        console.error('   ❌ CRITICAL: Found appointments linked to wrong tenant!');
      } else {
        console.log('   ✅ No cross-tenant issues');
      }

      // Overall integrity
      if (orphans > 0 || crossTenant > 0) {
        console.error('\n❌ INTEGRITY CHECK FAILED - manual investigation required!');
        await pool.end();
        process.exit(1);
      }
    }

    // ==========================================================================
    // Final summary
    // ==========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed: ${totalProcessed}`);
    console.log(`Updated: ${totalUpdated}`);
    console.log(`Unmatched: ${unmatched.length}`);
    console.log(`Batches: ${batchCount}`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no actual changes)' : 'LIVE'}`);

    // Log unmatched grouped by reason
    if (unmatched.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('UNMATCHED APPOINTMENTS (require manual review)');
      console.log('='.repeat(60));

      // Group by reason
      const byReason = new Map<UnmatchedReason, UnmatchedAppointment[]>();
      for (const u of unmatched) {
        const existing = byReason.get(u.reason) ?? [];
        existing.push(u);
        byReason.set(u.reason, existing);
      }

      // Log each reason with sample IDs
      for (const [reason, items] of byReason.entries()) {
        const label = {
          NO_PHONE: 'No phone number on appointment',
          INVALID_PHONE: 'Invalid phone after normalization (not 10 digits)',
          NO_SALON_CLIENT_MATCH: 'No matching salon_client record found',
        }[reason];

        console.log(`\n${label} (${items.length}):`);
        // Show up to 10 samples with full details
        for (const item of items.slice(0, 10)) {
          console.log(`  - appt: ${item.appointmentId}`);
          console.log(`    salon: ${item.salonId}`);
          console.log(`    rawPhone: ${item.rawPhone ?? '(null)'}`);
          console.log(`    normalizedPhone: ${item.normalizedPhone ?? '(null)'}`);
        }
        if (items.length > 10) {
          console.log(`  ... and ${items.length - 10} more`);
        }
      }
    }

    // Next steps
    console.log('\n' + '='.repeat(60));
    console.log('NEXT STEPS');
    console.log('='.repeat(60));

    if (DRY_RUN) {
      console.log('1. Review the output above');
      console.log('2. If satisfied, run without --dry-run:');
      console.log('   NODE_ENV=development npx tsx scripts/backfill-appointment-salon-client-id.ts');
    } else {
      if (unmatched.length === 0) {
        console.log('\n✅ All appointments have salon_client_id!');
        console.log('You can now run:');
        console.log('  ALTER TABLE appointment ALTER COLUMN salon_client_id SET NOT NULL;');
      } else {
        console.log(`\n⚠️  ${unmatched.length} appointments could not be matched.`);
        console.log('Options:');
        console.log('  1. Create missing salon_client records for unmatched phones');
        console.log('  2. Mark unmatched appointments as orphaned (soft-delete)');
        console.log('  3. Keep salon_client_id nullable (not recommended)');
      }
    }

    // Handle exit code
    console.log('\nBackfill complete.');

    if (unmatched.length > 0 && STRICT_MODE) {
      console.error(`\n❌ [--strict] Exiting with code 1: ${unmatched.length} unmatched appointments.`);
      process.exit(1);
    } else if (unmatched.length > 0) {
      console.warn(`\n⚠️  ${unmatched.length} unmatched appointments. Run with --strict to fail CI.`);
    }
  } finally {
    // Release advisory lock (also released automatically on disconnect)
    if (advisoryLockAcquired) {
      try {
        await pool.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
        console.log('\n[Cleanup] Advisory lock released');
      } catch {
        // Ignore - lock will be released on disconnect anyway
      }
    }
    await pool.end();
  }
}

// =============================================================================
// Run
// =============================================================================

main().catch((err) => {
  console.error('\n❌ Backfill failed:', err);
  process.exit(1);
});
