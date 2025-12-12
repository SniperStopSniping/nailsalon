/**
 * Direct migration script for admin auth tables
 * 
 * This bypasses Drizzle's migrator to apply the admin tables directly.
 * Run with: npx tsx scripts/apply-admin-migration.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load env from .env.development.local
dotenv.config({ path: '.env.development.local' });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in environment');
  process.exit(1);
}

console.log('Connecting to database...');
console.log('DATABASE_URL:', DATABASE_URL.substring(0, 50) + '...');

const pool = new Pool({ connectionString: DATABASE_URL });

const migrationSQL = `
-- Admin Auth Tables
-- Adds admin_user, admin_session, admin_invite, admin_salon_membership

-- Admin User - Admin/Super Admin identity (phone-based)
CREATE TABLE IF NOT EXISTS "admin_user" (
  "id" text PRIMARY KEY NOT NULL,
  "phone_e164" text NOT NULL UNIQUE,
  "name" text,
  "is_super_admin" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_user_phone_idx" ON "admin_user" ("phone_e164");

-- Admin Session - Server-side sessions for admin auth
CREATE TABLE IF NOT EXISTS "admin_session" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "last_seen_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_session_admin_idx" ON "admin_session" ("admin_id");
CREATE INDEX IF NOT EXISTS "admin_session_expires_idx" ON "admin_session" ("expires_at");

-- Admin Invite - Invites for admin access (invite-only system)
CREATE TABLE IF NOT EXISTS "admin_invite" (
  "id" text PRIMARY KEY NOT NULL,
  "phone_e164" text NOT NULL,
  "salon_id" text REFERENCES "salon"("id"),
  "role" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_by" text REFERENCES "admin_user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  -- Constraint: SUPER_ADMIN must have null salonId, ADMIN must have non-null salonId
  CONSTRAINT "admin_invite_role_salon_check" CHECK (
    (role = 'SUPER_ADMIN' AND salon_id IS NULL) OR
    (role = 'ADMIN' AND salon_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "admin_invite_phone_idx" ON "admin_invite" ("phone_e164");
CREATE INDEX IF NOT EXISTS "admin_invite_expires_idx" ON "admin_invite" ("expires_at");
CREATE INDEX IF NOT EXISTS "admin_invite_phone_used_idx" ON "admin_invite" ("phone_e164", "used_at");

-- Admin Salon Membership - Which admins can access which salons
CREATE TABLE IF NOT EXISTS "admin_salon_membership" (
  "admin_id" text NOT NULL REFERENCES "admin_user"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'admin' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("admin_id", "salon_id")
);

CREATE INDEX IF NOT EXISTS "admin_membership_salon_idx" ON "admin_salon_membership" ("salon_id");

-- Add membership_role column to admin_invite (for owner vs admin distinction)
ALTER TABLE "admin_invite" ADD COLUMN IF NOT EXISTS "membership_role" text;
`;

async function main() {
  try {
    console.log('Running admin auth migration...');
    await pool.query(migrationSQL);
    console.log('✅ Migration applied successfully!');
    
    // Verify tables exist
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'admin%'
    `);
    
    console.log('\nAdmin tables in database:');
    result.rows.forEach(row => console.log('  -', row.table_name));
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
