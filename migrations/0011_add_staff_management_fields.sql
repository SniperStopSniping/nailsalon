-- Add staff management fields to technician table
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'tech';
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "commission_rate" numeric(5, 2) DEFAULT '0';
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "pay_type" text DEFAULT 'commission';
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(8, 2);
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "salary_amount" numeric(10, 2);
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "current_status" text DEFAULT 'available';
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "languages" jsonb;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "skill_level" text DEFAULT 'standard';
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "hired_at" timestamp DEFAULT now();
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "terminated_at" timestamp;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "return_date" timestamp;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "onboarding_status" text DEFAULT 'pending';
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "accepting_new_clients" boolean DEFAULT true;
--> statement-breakpoint

ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "primary_location_id" text;
--> statement-breakpoint


-- Add priority and enabled columns to technician_services
ALTER TABLE "technician_services" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "technician_services" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true;
--> statement-breakpoint


-- Create technician_time_off table for vacation, sick days, personal time
CREATE TABLE IF NOT EXISTS "technician_time_off" (
  "id" text PRIMARY KEY,
  "technician_id" text NOT NULL REFERENCES "technician"("id") ON DELETE CASCADE,
  "salon_id" text NOT NULL REFERENCES "salon"("id"),
  "start_date" timestamp NOT NULL,
  "end_date" timestamp NOT NULL,
  "reason" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE INDEX IF NOT EXISTS "time_off_technician_idx" ON "technician_time_off"("technician_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "time_off_salon_idx" ON "technician_time_off"("salon_id");
