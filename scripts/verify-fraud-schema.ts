#!/usr/bin/env tsx
/**
 * Schema Verification Script for Fraud Signal System (v1)
 *
 * SINGLE SOURCE OF TRUTH for verifying the fraud signal schema is correctly applied.
 *
 * Checks:
 * 1. appointment.salon_client_id column exists
 * 2. fraud_signal table exists with correct columns
 * 3. Enums (fraud_signal_type, fraud_signal_severity) exist
 * 4. Required indexes exist
 * 5. Data integrity (no orphans, no cross-tenant mismatches)
 *
 * Usage:
 *   NODE_ENV=development npx dotenv -c development -- npx tsx scripts/verify-fraud-schema.ts
 *
 * Exit codes:
 *   0 = All checks pass
 *   1 = One or more checks failed
 */

import pg from 'pg';

const { Pool } = pg;

// =============================================================================
// Environment validation
// =============================================================================

if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL environment variable is required');
  console.error('Run with: npx dotenv -c development -- npx tsx scripts/verify-fraud-schema.ts');
  process.exit(1);
}

// Log which database we're connecting to (masked for safety)
const dbUrl = process.env.DATABASE_URL;
const maskedUrl = dbUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
console.log(`Database: ${maskedUrl}\n`);

// =============================================================================
// Types
// =============================================================================

type CheckResult = {
  name: string;
  passed: boolean;
  details: string;
  critical: boolean; // If critical and fails, exit immediately
};

// =============================================================================
// Main verification
// =============================================================================

async function verify(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  });

  const results: CheckResult[] = [];

  console.log('='.repeat(60));
  console.log('FRAUD SIGNAL SCHEMA VERIFICATION');
  console.log('='.repeat(60));

  try {
    // =========================================================================
    // 1. Check appointment.salon_client_id column exists
    // =========================================================================
    const colCheck = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'appointment' AND column_name = 'salon_client_id'
    `);

    results.push({
      name: 'appointment.salon_client_id column',
      passed: colCheck.rows.length > 0,
      details: colCheck.rows[0]
        ? `type=${colCheck.rows[0].data_type}, nullable=${colCheck.rows[0].is_nullable}`
        : 'COLUMN NOT FOUND',
      critical: true,
    });

    // =========================================================================
    // 2. Check fraud_signal table exists with required columns
    // =========================================================================
    const tableCheck = await pool.query<{ column_name: string }>(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'fraud_signal'
      ORDER BY ordinal_position
    `);

    const fraudColumns = tableCheck.rows.map(r => r.column_name);
    const requiredColumns = [
      'id',
      'salon_id',
      'salon_client_id',
      'appointment_id',
      'type',
      'severity',
      'reason',
      'metadata',
      'resolved_at',
      'resolved_by',
      'resolution_note',
      'created_at',
    ];
    const missingColumns = requiredColumns.filter(c => !fraudColumns.includes(c));

    results.push({
      name: 'fraud_signal table',
      passed: fraudColumns.length >= requiredColumns.length && missingColumns.length === 0,
      details:
        missingColumns.length === 0
          ? `All ${requiredColumns.length} columns present`
          : `MISSING: ${missingColumns.join(', ')}`,
      critical: true,
    });

    // =========================================================================
    // 3. Check enums exist
    // =========================================================================
    const enumCheck = await pool.query<{ typname: string }>(`
      SELECT typname 
      FROM pg_type 
      WHERE typname IN ('fraud_signal_type', 'fraud_signal_severity')
    `);

    const foundEnums = enumCheck.rows.map(r => r.typname);
    const requiredEnums = ['fraud_signal_type', 'fraud_signal_severity'];
    const missingEnums = requiredEnums.filter(e => !foundEnums.includes(e));

    results.push({
      name: 'Fraud signal enums',
      passed: missingEnums.length === 0,
      details: missingEnums.length === 0 ? `Found: ${foundEnums.join(', ')}` : `MISSING: ${missingEnums.join(', ')}`,
      critical: true,
    });

    // =========================================================================
    // 4. Check required indexes exist
    // =========================================================================
    const indexCheck = await pool.query<{ indexname: string }>(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename IN ('appointment', 'fraud_signal')
        AND (indexname LIKE '%fraud%' 
             OR indexname = 'appt_fraud_lookup_idx' 
             OR indexname = 'appointment_salon_client_idx')
    `);

    const foundIndexes = indexCheck.rows.map(r => r.indexname);
    const requiredIndexes = [
      'appointment_salon_client_idx',
      'appt_fraud_lookup_idx',
      'fraud_signal_salon_idx',
      'fraud_signal_appt_type_unique',
      'fraud_signal_unresolved_idx',
    ];
    const missingIndexes = requiredIndexes.filter(i => !foundIndexes.includes(i));

    results.push({
      name: 'Required indexes',
      passed: missingIndexes.length === 0,
      details:
        missingIndexes.length === 0
          ? `All ${requiredIndexes.length} indexes present`
          : `MISSING: ${missingIndexes.join(', ')}`,
      critical: false, // Indexes are important but not critical for functionality
    });

    // =========================================================================
    // 5. Data integrity: Check for orphaned appointment.salon_client_id
    // =========================================================================
    const orphanCheck = await pool.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM appointment a 
      LEFT JOIN salon_client sc ON sc.id = a.salon_client_id 
      WHERE a.salon_client_id IS NOT NULL AND sc.id IS NULL
    `);

    const orphanCount = parseInt(orphanCheck.rows[0]?.count ?? '0', 10);

    results.push({
      name: 'Orphaned salon_client_id (FK integrity)',
      passed: orphanCount === 0,
      details: orphanCount === 0 ? 'No orphans' : `FOUND ${orphanCount} orphaned records!`,
      critical: true,
    });

    // =========================================================================
    // 6. Data integrity: Check for cross-tenant mismatches
    // =========================================================================
    const crossTenantCheck = await pool.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM appointment a 
      JOIN salon_client sc ON sc.id = a.salon_client_id 
      WHERE a.salon_id <> sc.salon_id
    `);

    const crossTenantCount = parseInt(crossTenantCheck.rows[0]?.count ?? '0', 10);

    results.push({
      name: 'Cross-tenant mismatch (a.salon_id != sc.salon_id)',
      passed: crossTenantCount === 0,
      details: crossTenantCount === 0 ? 'No mismatches' : `CRITICAL: ${crossTenantCount} cross-tenant records!`,
      critical: true,
    });

    // =========================================================================
    // 7. Data counts (informational)
    // =========================================================================
    const countCheck = await pool.query<{
      total_appointments: string;
      with_client_id: string;
      without_client_id: string;
      fraud_signals: string;
      unresolved_signals: string;
    }>(`
      SELECT 
        (SELECT COUNT(*) FROM appointment) as total_appointments,
        (SELECT COUNT(*) FROM appointment WHERE salon_client_id IS NOT NULL) as with_client_id,
        (SELECT COUNT(*) FROM appointment WHERE salon_client_id IS NULL) as without_client_id,
        (SELECT COUNT(*) FROM fraud_signal) as fraud_signals,
        (SELECT COUNT(*) FROM fraud_signal WHERE resolved_at IS NULL) as unresolved_signals
    `);

    const counts = countCheck.rows[0];
    if (!counts) {
      throw new Error('Count query returned no rows');
    }

    // =========================================================================
    // Print results
    // =========================================================================
    console.log('\n--- Schema Checks ---\n');

    let allPassed = true;
    let criticalFailed = false;

    for (const result of results) {
      const status = result.passed ? '✓' : '✗';
      const prefix = result.passed ? '' : result.critical ? '[CRITICAL] ' : '[WARNING] ';
      console.log(`${status} ${prefix}${result.name}: ${result.details}`);

      if (!result.passed) {
        allPassed = false;
        if (result.critical) {
          criticalFailed = true;
        }
      }
    }

    console.log('\n--- Data Counts ---\n');
    console.log(`Total appointments:    ${counts.total_appointments}`);
    console.log(`With salon_client_id:  ${counts.with_client_id}`);
    console.log(`Without (need backfill): ${counts.without_client_id}`);
    console.log(`Fraud signals:         ${counts.fraud_signals}`);
    console.log(`Unresolved signals:    ${counts.unresolved_signals}`);

    // =========================================================================
    // 8. Spot-check: Sample 5 appointments with salon_client_id
    // =========================================================================
    if (parseInt(counts.with_client_id, 10) > 0) {
      console.log('\n--- Spot Check (5 random appointments with salon_client_id) ---\n');

      const spotCheck = await pool.query<{
        appt_id: string;
        appt_salon_id: string;
        client_phone: string;
        sc_phone: string;
        phones_match: boolean;
      }>(`
        SELECT 
          a.id as appt_id,
          a.salon_id as appt_salon_id,
          a.client_phone,
          sc.phone as sc_phone,
          (a.client_phone IS NOT NULL AND 
           regexp_replace(a.client_phone, '\\D', '', 'g') LIKE '%' || sc.phone) as phones_match
        FROM appointment a 
        JOIN salon_client sc ON sc.id = a.salon_client_id 
        ORDER BY random()
        LIMIT 5
      `);

      for (const row of spotCheck.rows) {
        const matchStatus = row.phones_match ? '✓' : '⚠';
        console.log(`  ${matchStatus} appt=${row.appt_id.substring(0, 8)}... client_phone="${row.client_phone}" sc_phone="${row.sc_phone}"`);
      }

      const mismatchCount = spotCheck.rows.filter(r => !r.phones_match).length;
      if (mismatchCount > 0) {
        console.log(`\n  ⚠ WARNING: ${mismatchCount}/5 samples have phone mismatch (may be normalization issue)`);
      }
    }

    // =========================================================================
    // Final verdict
    // =========================================================================
    console.log('\n' + '='.repeat(60));

    if (allPassed) {
      console.log('✓ ALL CHECKS PASSED');
      console.log('='.repeat(60));
      await pool.end();
      process.exit(0);
    } else if (criticalFailed) {
      console.log('✗ CRITICAL CHECKS FAILED - Schema is not ready');
      console.log('='.repeat(60));
      await pool.end();
      process.exit(1);
    } else {
      console.log('⚠ SOME WARNINGS - Schema is functional but has issues');
      console.log('='.repeat(60));
      await pool.end();
      process.exit(0); // Non-critical warnings don't fail
    }
  } catch (err) {
    console.error('\n❌ Verification failed with error:', err);
    await pool.end();
    process.exit(1);
  }
}

verify();
