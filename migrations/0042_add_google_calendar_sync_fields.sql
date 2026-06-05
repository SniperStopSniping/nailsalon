ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "google_calendar_event_id" text;
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "google_calendar_sync_status" text DEFAULT 'not_synced';
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "google_calendar_synced_at" timestamp with time zone;
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "google_calendar_sync_error" text;
