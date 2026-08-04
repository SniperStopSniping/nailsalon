/**
 * Migration script to add email fields to admin_user
 *
 * Run with: npx tsx scripts/apply-email-migration.ts
 */

import * as dotenv from 'dotenv';
import { Pool } from 'pg';

// Load env from .env.development.local
dotenv.config({ path: '.env.development.local' });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in environment');
  process.exit(1);
}

console.log('Connecting to database...');
console.log('DATABASE_URL:', `${DATABASE_URL.substring(0, 50)}...`);

const pool = new Pool({ connectionString: DATABASE_URL });

const migrationSQL = `
-- Add email fields to admin_user for profile completion
-- Email is nullable to support existing users, but required via onboarding flow

ALTER TABLE "admin_user" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "admin_user" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;

-- Drop any existing email indexes (covering possible naming variations)
DROP INDEX IF EXISTS "admin_user_email_idx";
DROP INDEX IF EXISTS "admin_user_email_unique_idx";
DROP INDEX IF EXISTS "admin_user_email_unique";

-- Case-insensitive unique index on email (partial - allows multiple NULLs)
CREATE UNIQUE INDEX "admin_user_email_idx" ON "admin_user" (lower("email")) WHERE "email" IS NOT NULL;
`;

async function main() {
  try {
    console.log('Running email migration...');
    await pool.query(migrationSQL);
    console.log('✅ Email migration applied successfully!');

    // Verify columns exist
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'admin_user'
      ORDER BY ordinal_position
    `);

    console.log('\nadmin_user columns:');
    result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));

    // Verify index
    const indexResult = await pool.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'admin_user'
    `);

    console.log('\nadmin_user indexes:');
    indexResult.rows.forEach(row => console.log(`  - ${row.indexname}`));
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
