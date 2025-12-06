CREATE TABLE IF NOT EXISTS "reward" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"client_phone" text NOT NULL,
	"client_name" text,
	"referral_id" text,
	"type" text NOT NULL,
	"eligible_service_name" text DEFAULT 'Gel Manicure',
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp,
	"used_in_appointment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "unique_referral";--> statement-breakpoint
ALTER TABLE "referral" ALTER COLUMN "referee_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "referral" ALTER COLUMN "status" SET DEFAULT 'sent';--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN "referee_name" text;--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward" ADD CONSTRAINT "reward_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward" ADD CONSTRAINT "reward_referral_id_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referral"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward" ADD CONSTRAINT "reward_used_in_appointment_id_appointment_id_fk" FOREIGN KEY ("used_in_appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_salon_idx" ON "reward" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_client_idx" ON "reward" USING btree ("client_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_referral_idx" ON "reward" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_status_idx" ON "reward" USING btree ("client_phone","status");