-- Add staff management fields to technician table
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'tech';
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "commission_rate" numeric(5, 2) DEFAULT '0';
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "pay_type" text DEFAULT 'commission';
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(8, 2);
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "salary_amount" numeric(10, 2);
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "current_status" text DEFAULT 'available';
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "languages" jsonb;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "skill_level" text DEFAULT 'standard';
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "hired_at" timestamp DEFAULT now();
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "terminated_at" timestamp;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "return_date" timestamp;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "onboarding_status" text DEFAULT 'pending';
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "accepting_new_clients" boolean DEFAULT true;
ALTER TABLE "technician" ADD COLUMN IF NOT EXISTS "primary_location_id" text;

-- Add priority and enabled columns to technician_services
ALTER TABLE "technician_services" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0;
ALTER TABLE "technician_services" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true;

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

CREATE INDEX IF NOT EXISTS "time_off_technician_idx" ON "technician_time_off"("technician_id");
CREATE INDEX IF NOT EXISTS "time_off_salon_idx" ON "technician_time_off"("salon_id");
