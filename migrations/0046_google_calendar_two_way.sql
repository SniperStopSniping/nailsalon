-- Google Calendar inbound synchronization cursor and health state.
-- Luster remains the appointment source of truth, while changes to Luster-owned
-- Google events can safely flow back into their tenant-scoped appointments.

ALTER TABLE "salon_google_calendar_connection"
  ADD COLUMN IF NOT EXISTS "inbound_sync_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "salon_google_calendar_connection"
  ADD COLUMN IF NOT EXISTS "inbound_synced_at" timestamp with time zone;

ALTER TABLE "salon_google_calendar_connection"
  ADD COLUMN IF NOT EXISTS "inbound_sync_error" text;
