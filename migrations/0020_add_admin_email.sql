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
