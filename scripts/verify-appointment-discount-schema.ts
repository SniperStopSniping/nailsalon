#!/usr/bin/env tsx
/**
 * Schema verification for appointment discount snapshot columns.
 *
 * This protects local/dev environments from relying on Drizzle migration state
 * alone when the actual appointment table is missing the columns introduced for
 * first-visit discount snapshots.
 */

import pg from 'pg';

const { Pool } = pg;

const REQUIRED_COLUMNS = [
  'subtotal_before_discount_cents',
  'discount_amount_cents',
  'discount_type',
  'discount_label',
  'discount_percent',
  'discount_applied_at',
] as const;

function maskDatabaseUrl(databaseUrl: string) {
  return databaseUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Run with: NODE_ENV=development npx dotenv -c development -- npx tsx scripts/verify-appointment-discount-schema.ts');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  console.log(`Database: ${maskDatabaseUrl(databaseUrl)}\n`);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('='.repeat(60));
    console.log('APPOINTMENT DISCOUNT SCHEMA VERIFICATION');
    console.log('='.repeat(60));

    const result = await pool.query<{ column_name: string; data_type: string; column_default: string | null }>(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'appointment'
        AND column_name = ANY($1)
      ORDER BY ordinal_position
    `, [REQUIRED_COLUMNS]);

    const foundColumns = new Map(result.rows.map((row) => [row.column_name, row]));
    const missingColumns = REQUIRED_COLUMNS.filter((columnName) => !foundColumns.has(columnName));

    for (const columnName of REQUIRED_COLUMNS) {
      const row = foundColumns.get(columnName);
      if (!row) {
        console.log(`FAIL ${columnName}: missing`);
        continue;
      }

      const defaultLabel = row.column_default ? `, default=${row.column_default}` : '';
      console.log(`PASS ${columnName}: type=${row.data_type}${defaultLabel}`);
    }

    console.log('='.repeat(60));

    if (missingColumns.length > 0) {
      console.error(`Schema verification failed. Missing columns: ${missingColumns.join(', ')}`);
      process.exit(1);
    }

    console.log(`All ${REQUIRED_COLUMNS.length} appointment discount snapshot columns are present.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Schema verification failed with an unexpected error:', error);
  process.exit(1);
});
