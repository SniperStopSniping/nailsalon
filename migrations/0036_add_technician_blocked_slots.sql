CREATE TABLE IF NOT EXISTS "technician_blocked_slot" (
  "id" text PRIMARY KEY,
  "salon_id" text NOT NULL REFERENCES "salon"("id"),
  "technician_id" text NOT NULL REFERENCES "technician"("id") ON DELETE CASCADE,
  "day_of_week" integer,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "specific_date" timestamp,
  "label" text,
  "is_recurring" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "blocked_slot_technician_idx" ON "technician_blocked_slot"("technician_id");
CREATE INDEX IF NOT EXISTS "blocked_slot_salon_idx" ON "technician_blocked_slot"("salon_id");
CREATE INDEX IF NOT EXISTS "blocked_slot_day_idx" ON "technician_blocked_slot"("technician_id", "day_of_week");
