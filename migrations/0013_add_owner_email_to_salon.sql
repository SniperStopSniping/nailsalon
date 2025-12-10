-- Add owner_email column to salon table
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "owner_email" text;
