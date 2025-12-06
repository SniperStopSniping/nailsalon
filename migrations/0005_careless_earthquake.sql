CREATE TABLE IF NOT EXISTS "referral" (
	"id" text PRIMARY KEY NOT NULL,
	"salon_id" text NOT NULL,
	"referrer_phone" text NOT NULL,
	"referrer_name" text,
	"referee_phone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral" ADD CONSTRAINT "referral_salon_id_salon_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_salon_idx" ON "referral" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_referrer_idx" ON "referral" USING btree ("salon_id","referrer_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_referee_idx" ON "referral" USING btree ("referee_phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_referral" ON "referral" USING btree ("salon_id","referrer_phone","referee_phone");