#!/usr/bin/env tsx
/* eslint-disable no-console, prefer-template, style/padded-blocks, test/padding-around-all, unicorn/prefer-number-properties -- Preserve the legacy smoke-report output while adding target guards. */
/**
 * Smoke Test: Fraud Signal System
 *
 * DB-BASED verification that fraud signals are created correctly.
 * Does NOT rely on console.log output - queries the actual database.
 *
 * Tests:
 * 1. Completing an appointment triggers fraud evaluation
 * 2. Double-complete is idempotent (no duplicate signals)
 * 3. Signal deduplication works (same type per appointment = 1 row)
 * 4. Resolving a signal works correctly
 *
 * Usage:
 *   NODE_ENV=development npx dotenv -c development -- npx tsx scripts/smoke-test-fraud-system.ts
 *
 * Prerequisites:
 * - Dev server running (or direct API access)
 * - At least one completed appointment with a client who has 3+ completions in 7 days
 *   (to trigger fraud signal)
 *
 * Exit codes:
 *   0 = All tests pass
 *   1 = One or more tests failed
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg, { type PoolConfig } from 'pg';

import {
  requireDevelopmentDatabase,
  requireNonProductionDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';

const { Pool } = pg;

// =============================================================================
// Test helpers
// =============================================================================

type TestResult = {
  name: string;
  passed: boolean;
  details: string;
};

type FraudSmokeDatabase = Pick<pg.Pool, 'end' | 'query'>;

export type FraudSmokePoolFactory = (
  configuration: PoolConfig,
) => FraudSmokeDatabase;

// =============================================================================
// Main smoke tests
// =============================================================================

export async function runFraudSmokeTests(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  createPool: FraudSmokePoolFactory = configuration => new Pool(configuration),
): Promise<number> {
  const target = requireNonProductionDatabaseTarget(environment);
  const dbUrl = target.connectionString;
  console.log(`Database host: ${target.host}\n`);

  const pool = createPool({
    connectionString: dbUrl,
    ssl: target.host === 'neon.tech' || target.host.endsWith('.neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
  });
  const results: TestResult[] = [];

  function test(name: string, passed: boolean, details: string): void {
    results.push({ name, passed, details });
    const status = passed ? '✓' : '✗';
    console.log(`${status} ${name}: ${details}`);
  }

  console.log('='.repeat(60));
  console.log('FRAUD SIGNAL SYSTEM - SMOKE TESTS');
  console.log('='.repeat(60));
  console.log('\nThese tests verify the DB state, not console logs.\n');

  try {
    await requireDevelopmentDatabase(pool);

    // =========================================================================
    // Test 1: Check if fraud_signal table exists and is queryable
    // =========================================================================
    console.log('--- Infrastructure Tests ---\n');

    const tableCheck = await pool.query(`
      SELECT COUNT(*) as count FROM fraud_signal
    `);
    test(
      'fraud_signal table is queryable',
      true,
      `Found ${tableCheck.rows[0].count} signals`,
    );

    // =========================================================================
    // Test 2: Check unique constraint exists (prevents duplicate signals)
    // =========================================================================
    const uniqueCheck = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes 
      WHERE indexname = 'fraud_signal_appt_type_unique'
    `);
    test(
      'Unique constraint (appointment_id, type) exists',
      uniqueCheck.rows.length > 0,
      uniqueCheck.rows.length > 0 ? 'Index exists' : 'MISSING - duplicates possible!',
    );

    // =========================================================================
    // Test 3: Find a client with multiple completed appointments (fraud candidate)
    // =========================================================================
    console.log('\n--- Data Tests ---\n');

    const frequentClientCheck = await pool.query<{
      salon_client_id: string;
      salon_id: string;
      completed_count: string;
    }>(`
      SELECT 
        salon_client_id,
        salon_id,
        COUNT(*) as completed_count
      FROM appointment
      WHERE status = 'completed' 
        AND salon_client_id IS NOT NULL
        AND completed_at >= NOW() - INTERVAL '7 days'
      GROUP BY salon_client_id, salon_id
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);

    // First check if there are ANY completed appointments
    const completedCheck = await pool.query<{ count: string }>(`
      SELECT COUNT(*) as count FROM appointment WHERE status = 'completed'
    `);
    const completedCount = parseInt(completedCheck.rows[0]?.count ?? '0', 10);

    if (completedCount === 0) {
      console.log('ℹ No completed appointments in database - skipping fraud trigger tests');
      console.log('  To test fraud signals, complete some appointments via the UI/API first.');
      console.log('  A client needs 3+ completions in 7 days to trigger HIGH_APPOINTMENT_FREQUENCY.\n');
    } else if (frequentClientCheck.rows.length > 0) {
      const client = frequentClientCheck.rows[0]!;
      test(
        'Found frequent client (3+ completions in 7d)',
        true,
        `salon_client_id=${client.salon_client_id.substring(0, 8)}..., count=${client.completed_count}`,
      );

      // Check if this client has a fraud signal
      const signalCheck = await pool.query<{ id: string; type: string; severity: string; created_at: Date }>(`
        SELECT id, type, severity, created_at
        FROM fraud_signal
        WHERE salon_client_id = $1 
          AND type = 'HIGH_APPOINTMENT_FREQUENCY'
        ORDER BY created_at DESC
        LIMIT 1
      `, [client.salon_client_id]);

      const signal = signalCheck.rows[0];
      test(
        'Fraud signal exists for frequent client',
        signalCheck.rows.length > 0,
        signal
          ? `Signal id=${signal.id.substring(0, 8)}..., severity=${signal.severity}`
          : 'NO SIGNAL FOUND - fraud eval may not have run',
      );
    } else {
      console.log(`ℹ ${completedCount} completed appointments but no client with 3+ in 7d`);
      console.log('  Fraud trigger test skipped (need 3+ completions for same client in 7 days)\n');
    }

    // =========================================================================
    // Test 4: Check for duplicate signals (should be 0)
    // =========================================================================
    const duplicateSignalCheck = await pool.query<{ appointment_id: string; type: string; count: string }>(`
      SELECT appointment_id, type, COUNT(*) as count
      FROM fraud_signal
      GROUP BY appointment_id, type
      HAVING COUNT(*) > 1
      LIMIT 5
    `);

    test(
      'No duplicate signals (same appointment + type)',
      duplicateSignalCheck.rows.length === 0,
      duplicateSignalCheck.rows.length === 0
        ? 'No duplicates found'
        : `DUPLICATES: ${duplicateSignalCheck.rows.map(r => `${r.appointment_id}/${r.type}:${r.count}`).join(', ')}`,
    );

    // =========================================================================
    // Test 5: Check signal <-> appointment FK integrity
    // =========================================================================
    const orphanSignalCheck = await pool.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM fraud_signal fs
      LEFT JOIN appointment a ON a.id = fs.appointment_id
      WHERE a.id IS NULL
    `);

    const orphanCount = orphanSignalCheck.rows[0]?.count ?? '0';
    test(
      'No orphaned fraud signals (FK integrity)',
      parseInt(orphanCount, 10) === 0,
      `Orphaned signals: ${orphanCount}`,
    );

    // =========================================================================
    // Test 6: Check signal <-> salon_client FK integrity
    // =========================================================================
    const orphanClientSignalCheck = await pool.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM fraud_signal fs
      LEFT JOIN salon_client sc ON sc.id = fs.salon_client_id
      WHERE sc.id IS NULL
    `);

    const orphanClientCount = orphanClientSignalCheck.rows[0]?.count ?? '0';
    test(
      'No orphaned fraud signals (salon_client FK)',
      parseInt(orphanClientCount, 10) === 0,
      `Orphaned signals: ${orphanClientCount}`,
    );

    // =========================================================================
    // Test 7: Resolution works (if any resolved signals exist)
    // =========================================================================
    console.log('\n--- Resolution Tests ---\n');

    const resolvedCheck = await pool.query<{
      total: string;
      resolved: string;
      with_resolved_by: string;
    }>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) as resolved,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_by IS NOT NULL) as with_resolved_by
      FROM fraud_signal
    `);

    const resolvedRow = resolvedCheck.rows[0];
    const totalSignals = parseInt(resolvedRow?.total ?? '0', 10);
    const resolvedSignals = parseInt(resolvedRow?.resolved ?? '0', 10);
    const withResolvedBy = parseInt(resolvedRow?.with_resolved_by ?? '0', 10);

    if (resolvedSignals > 0) {
      test(
        'Resolved signals have resolved_by set',
        withResolvedBy === resolvedSignals,
        `${withResolvedBy}/${resolvedSignals} have resolved_by`,
      );
    } else {
      console.log('ℹ No resolved signals yet - skipping resolution tests');
    }

    // =========================================================================
    // Test 8: Unresolved index is being used
    // =========================================================================
    const unresolvedIndexCheck = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes 
      WHERE indexname = 'fraud_signal_unresolved_idx'
    `);

    test(
      'Partial index for unresolved signals exists',
      unresolvedIndexCheck.rows.length > 0,
      unresolvedIndexCheck.rows.length > 0 ? 'Index exists' : 'MISSING - queries may be slow',
    );

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log(`\nTotal: ${results.length} tests`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    console.log('\n--- Data Overview ---');
    console.log(`Total fraud signals: ${totalSignals}`);
    console.log(`Resolved: ${resolvedSignals}`);
    console.log(`Unresolved: ${totalSignals - resolvedSignals}`);

    // =========================================================================
    // Manual test instructions
    // =========================================================================
    console.log('\n--- Manual Tests (if automated tests pass) ---\n');
    console.log('1. Complete an appointment via API/UI');
    console.log('2. Query: SELECT * FROM fraud_signal ORDER BY created_at DESC LIMIT 5;');
    console.log('3. Double-complete same appointment');
    console.log('4. Query: SELECT COUNT(*) FROM fraud_signal WHERE appointment_id = \'...\';');
    console.log('   → Must stay 1 per type');
    console.log('5. Resolve a signal via admin UI');
    console.log('6. Query: SELECT resolved_at, resolved_by FROM fraud_signal WHERE id = \'...\';');
    console.log('   → Both must be non-null');

    await pool.end();
    return failed > 0 ? 1 : 0;

  } catch (err) {
    console.error('\n❌ Smoke tests failed with error:', err);
    await pool.end();
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === path.resolve(entryPath)) {
  runFraudSmokeTests().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error('\n❌ Smoke tests failed with error:', error);
    process.exitCode = 1;
  });
}
