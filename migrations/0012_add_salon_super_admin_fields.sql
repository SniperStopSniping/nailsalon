-- Add super admin / multi-tenant fields to salon table
ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "owner_clerk_user_id" text;
--> statement-breakpoint

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "plan" text DEFAULT 'single_salon';
--> statement-breakpoint

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "max_locations" integer DEFAULT 1;
--> statement-breakpoint

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "max_technicians" integer DEFAULT 10;
--> statement-breakpoint

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "is_multi_location_enabled" boolean DEFAULT false;
--> statement-breakpoint

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
--> statement-breakpoint

ALTER TABLE "salon" ADD COLUMN IF NOT EXISTS "internal_notes" text;
--> statement-breakpoint


-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS "salon_owner_idx" ON "salon"("owner_clerk_user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "salon_status_idx" ON "salon"("status");
