-- Schedule Overrides v1: Per-date availability overrides for technicians
-- Supports "off" days and custom hours that override the weekly schedule

CREATE TABLE IF NOT EXISTS "technician_schedule_override" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id"),
  "technician_id" text NOT NULL REFERENCES "technician"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('off', 'hours')),
  "start_time" text,
  "end_time" text,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  
  -- Ensure start_time and end_time are present when type='hours'
  CONSTRAINT "hours_require_times" CHECK (
    "type" = 'off' OR ("start_time" IS NOT NULL AND "end_time" IS NOT NULL)
  )
);

-- One override per technician per day
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_override_tech_date_idx" 
  ON "technician_schedule_override"("technician_id", "date");

-- For querying all overrides in a salon
CREATE INDEX IF NOT EXISTS "schedule_override_salon_idx" 
  ON "technician_schedule_override"("salon_id");

-- For efficient date range queries
CREATE INDEX IF NOT EXISTS "schedule_override_date_idx" 
  ON "technician_schedule_override"("technician_id", "date");

