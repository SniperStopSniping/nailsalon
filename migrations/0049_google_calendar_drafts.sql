CREATE TABLE IF NOT EXISTS "google_calendar_draft" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "google_event_id" text NOT NULL,
  "title" text,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'needs_details' NOT NULL,
  "converted_appointment_id" text REFERENCES "appointment"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_calendar_draft_salon_event_idx"
  ON "google_calendar_draft" ("salon_id", "google_event_id");
CREATE INDEX IF NOT EXISTS "google_calendar_draft_salon_status_time_idx"
  ON "google_calendar_draft" ("salon_id", "status", "start_time");
