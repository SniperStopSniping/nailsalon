CREATE TABLE IF NOT EXISTS "google_calendar_event" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "calendar_id" text NOT NULL,
  "google_event_id" text NOT NULL,
  "recurring_event_id" text,
  "appointment_id" text REFERENCES "appointment"("id") ON DELETE SET NULL,
  "source_access_role" text DEFAULT 'reader' NOT NULL,
  "sync_mode" text DEFAULT 'inbound_only' NOT NULL,
  "title" text,
  "description" text,
  "location" text,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone NOT NULL,
  "duration_minutes" integer NOT NULL,
  "is_all_day" boolean DEFAULT false NOT NULL,
  "transparency" text DEFAULT 'busy' NOT NULL,
  "google_status" text DEFAULT 'confirmed' NOT NULL,
  "review_status" text DEFAULT 'needs_review' NOT NULL,
  "google_updated_at" timestamp with time zone,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "superseded_by_event_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE UNIQUE INDEX IF NOT EXISTS "google_calendar_event_tenant_provider_idx"
  ON "google_calendar_event" ("salon_id", "calendar_id", "google_event_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "google_calendar_event_review_time_idx"
  ON "google_calendar_event" ("salon_id", "review_status", "start_time");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "google_calendar_event_salon_time_idx"
  ON "google_calendar_event" ("salon_id", "start_time", "end_time");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "google_calendar_event_appointment_idx"
  ON "google_calendar_event" ("appointment_id");
--> statement-breakpoint


CREATE TABLE IF NOT EXISTS "google_event_review_pattern" (
  "id" text PRIMARY KEY NOT NULL,
  "salon_id" text NOT NULL REFERENCES "salon"("id") ON DELETE CASCADE,
  "title_fingerprint" text NOT NULL,
  "last_decision" text NOT NULL,
  "decision_count" integer DEFAULT 1 NOT NULL,
  "last_decision_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE UNIQUE INDEX IF NOT EXISTS "google_event_review_pattern_tenant_title_idx"
  ON "google_event_review_pattern" ("salon_id", "title_fingerprint");
--> statement-breakpoint


INSERT INTO "google_calendar_event" (
  "id", "salon_id", "calendar_id", "google_event_id", "appointment_id",
  "title", "start_time", "end_time", "duration_minutes", "review_status",
  "reviewed_at", "created_at", "updated_at"
)
SELECT
  'gce_' || md5(d."salon_id" || ':' || d."google_event_id"),
  d."salon_id",
  COALESCE(c."destination_calendar_id", 'primary'),
  d."google_event_id",
  d."converted_appointment_id",
  d."title",
  d."start_time",
  d."end_time",
  GREATEST(1, ROUND(EXTRACT(EPOCH FROM (d."end_time" - d."start_time")) / 60)::integer),
  CASE
    WHEN d."converted_appointment_id" IS NOT NULL OR d."status" = 'converted' THEN 'appointment'
    WHEN d."status" = 'needs_details' AND d."end_time" >= now() THEN 'needs_review'
    ELSE 'reviewed'
  END,
  CASE WHEN d."status" = 'needs_details' AND d."end_time" >= now() THEN NULL ELSE now() END,
  d."created_at",
  d."updated_at"
FROM "google_calendar_draft" d
LEFT JOIN "salon_google_calendar_connection" c ON c."salon_id" = d."salon_id"
ON CONFLICT ("salon_id", "calendar_id", "google_event_id") DO NOTHING;
--> statement-breakpoint


-- Force one bounded initial resynchronization so existing current/future events
-- are discovered under the richer model. Historical rows are auto-reviewed.
UPDATE "salon_google_calendar_connection" SET "inbound_synced_at" = NULL;
