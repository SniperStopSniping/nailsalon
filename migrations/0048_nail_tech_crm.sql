ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "sensitivities" text;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "nail_preferences" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "rebook_interval_days" integer;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "next_rebook_due_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "last_contact_at" timestamp with time zone;
--> statement-breakpoint


CREATE INDEX IF NOT EXISTS "salon_client_rebook_due_idx"
  ON "salon_client" ("salon_id", "next_rebook_due_at");
