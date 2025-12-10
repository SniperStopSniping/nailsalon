-- Add super admin / multi-tenant fields to salon table
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "owner_clerk_user_id" text;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "plan" text DEFAULT 'single_salon';
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "max_locations" integer DEFAULT 1;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "max_technicians" integer DEFAULT 10;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "is_multi_location_enabled" boolean DEFAULT false;
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "internal_notes" text;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS "salon_owner_idx" ON "salon"("owner_clerk_user_id");
CREATE INDEX IF NOT EXISTS "salon_status_idx" ON "salon"("status");
