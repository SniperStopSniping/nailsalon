ALTER TABLE "google_calendar_event" ADD COLUMN IF NOT EXISTS "attendee_name" text;
--> statement-breakpoint
ALTER TABLE "google_calendar_event" ADD COLUMN IF NOT EXISTS "attendee_phone" text;
--> statement-breakpoint
ALTER TABLE "google_calendar_event" ADD COLUMN IF NOT EXISTS "attendee_email" text;
