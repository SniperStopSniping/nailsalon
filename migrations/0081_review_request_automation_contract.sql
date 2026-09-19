CREATE TYPE "public"."review_request_automation_mode" AS ENUM('manual', 'marked_completed', 'scheduled_end');--> statement-breakpoint
CREATE TYPE "public"."review_request_trigger_kind" AS ENUM('completed', 'scheduled_end');--> statement-breakpoint
CREATE TYPE "public"."review_request_trigger_state" AS ENUM('pending', 'materialized', 'skipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_request_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"kind" "review_request_trigger_kind" NOT NULL,
	"trigger_at" timestamp with time zone NOT NULL,
	"appointment_start_at" timestamp with time zone NOT NULL,
	"appointment_end_at" timestamp with time zone NOT NULL,
	"policy_revision" integer NOT NULL,
	"state" "review_request_trigger_state" DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"scheduled_for" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_request_trigger_policy_revision_nonnegative" CHECK ("review_request_trigger"."policy_revision" >= 0),
	CONSTRAINT "review_request_trigger_expires_after_scheduled" CHECK ("review_request_trigger"."expires_at" > "review_request_trigger"."scheduled_for")
);
--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "trigger_id" text;--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD COLUMN "review_request_automation_mode" "review_request_automation_mode";--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD COLUMN "review_request_repeat_cooldown_days" integer;--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD COLUMN "review_request_policy_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_request_trigger" ADD CONSTRAINT "review_request_trigger_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_request_trigger_appointment_policy_once" ON "review_request_trigger" USING btree ("salon_id","appointment_id","kind","trigger_at","appointment_start_at","appointment_end_at","policy_revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_trigger_pending_due_idx" ON "review_request_trigger" USING btree ("available_at","id") WHERE "review_request_trigger"."state" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_trigger_salon_appointment_created_idx" ON "review_request_trigger" USING btree ("salon_id","appointment_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_request" ADD CONSTRAINT "review_request_trigger_id_review_request_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."review_request_trigger"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_request_trigger_once" ON "review_request" USING btree ("trigger_id");--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD CONSTRAINT "salon_retention_settings_review_request_cooldown_valid" CHECK ("salon_retention_settings"."review_request_repeat_cooldown_days" IS NULL OR "salon_retention_settings"."review_request_repeat_cooldown_days" IN (90, 180, 365));--> statement-breakpoint
ALTER TABLE "salon_retention_settings" ADD CONSTRAINT "salon_retention_settings_review_request_policy_revision_nonnegative" CHECK ("salon_retention_settings"."review_request_policy_revision" >= 0);
--> statement-breakpoint
-- Scheduling is a historical decision. A policy edit applies to later
-- appointments; reschedules supersede an unresolved trigger instead of
-- mutating the original due time.
CREATE FUNCTION "review_request_trigger_scheduled_for_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for" THEN
    RAISE EXCEPTION 'review request trigger scheduled_for is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "review_request_trigger_scheduled_for_immutable_trigger"
  BEFORE UPDATE ON "review_request_trigger"
  FOR EACH ROW EXECUTE FUNCTION "review_request_trigger_scheduled_for_immutable"();
