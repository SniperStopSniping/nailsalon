-- MVP Tech CRM: appointment completion record + post-appointment review follow-up.
-- Hand-authored (drizzle snapshot chain is incomplete pre-0043), idempotent, additive-only.

-- Appointment completion record (filled by the tech's Complete Appointment form)
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "final_price_cents" integer;
--> statement-breakpoint

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "tip_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "payment_method" text;
--> statement-breakpoint


-- Post-appointment review follow-up (per-visit action)
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "review_followup_action" text;
--> statement-breakpoint

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "review_followup_sent_at" timestamp;
--> statement-breakpoint

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "review_followup_sent_by" text;
--> statement-breakpoint


-- Google review tracking (client-level source of truth)
ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "has_google_review" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "google_review_marked_at" timestamp;
--> statement-breakpoint

ALTER TABLE "salon_client" ADD COLUMN IF NOT EXISTS "google_review_marked_by" text;
--> statement-breakpoint


-- FK for review_followup_sent_by -> technician (guarded; skip if it already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'appointment_review_followup_sent_by_technician_id_fk'
  ) THEN
    ALTER TABLE "appointment"
      ADD CONSTRAINT "appointment_review_followup_sent_by_technician_id_fk"
      FOREIGN KEY ("review_followup_sent_by") REFERENCES "public"."technician"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint


-- Payment-method reporting index for completed appointments
CREATE INDEX IF NOT EXISTS "appointment_payment_method_idx"
  ON "appointment" ("salon_id", "payment_method")
  WHERE "status" = 'completed';
